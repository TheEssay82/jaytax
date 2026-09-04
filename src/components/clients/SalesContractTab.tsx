// 거래처관리 › 매출계약등록 (거래처관리 2.0.0 · step 2)
// 매출유형 트리 선택(cascade) + leaf 플래그 조건입력 + 발생/청구단위 + 청구주기·분할 + 담당 + 날짜 + 무료/할인.
import { useEffect, useMemo, useState } from 'react';
import { takeNavQuery } from '../../lib/navSearch';
import Guide from '../common/Guide';
import { useAuth } from '../../context/AuthContext';
import { listBizEntities, corpDisplayName, type BizEntityFull } from '../../lib/bizRegistryApi';
import {
  TAXONOMY, findNode, isLeaf, leafOf, pathLabel, typeMnemonicTable, contractTypeOptions, type Team, type TaxNode,
} from '../../lib/salesContractTaxonomy';
import { TAX_ADJ_CPA } from '../../lib/taxContractSync';
import { todayYmd } from '../../lib/format';
import { ColFilter, scrollBox, stickyTop, useTableView, ColumnSettings, ResizeHandle, clip } from './tableKit';
import { VIEW_KEYS } from '../../lib/tableViewApi';
import { exportContractTemplate, parseContractExcelFile, applyContractExcel, type ContractExcelResult } from '../../lib/bizContractExcel';
import { periodRevenue, defaultWindow, monthIndex } from '../../lib/billingSchedule';
import { listInvoiceRequests } from '../../lib/invoiceRequestApi';
import {
  listSalesContracts, createSalesContract, updateSalesContract, deleteSalesContract, backfillContractCodes,
  saveInstallments, saveDiscounts, saveContractStaff, listContractStaffProfiles, setInstallmentBilled,
  staffCandidatesForTeam, BILLING_CYCLES, CPA_LIST, settlementYearOfDate, contractFiscalYear,
  changeContractStaffFrom, staffHistoryApplies,
  listRenewableTaxContracts, renewTaxContracts, type RenewCandidate,
  type SalesContract, type ContractInput, type Installment, type Discount,
  type OccurrenceUnit, type BillingUnit, type BillingCycle, type AdvisoryType, type StaffProfileLite,
} from '../../lib/salesContractApi';

const won = (n: number) => n.toLocaleString('ko-KR');
// 연환산 계수(청구주기→연 횟수). 월환산 = 연환산/12.
const CYCLE_ANN: Record<string, number> = { '월': 12, '분기': 4, '반기': 2, '연': 1, '발생시': 1, '건': 1 };
const annualize = (c: SalesContract) => c.amount * (CYCLE_ANN[c.billingCycle] ?? 1);
// 운영 시작 = 2026-07(정산연도 2026). 계속계약(종료 없음·귀속 null)은 이 연도부터 매 귀속연도에 포함.
const OPERATION_START_YEAR = 2026;
const isOngoing = (c: SalesContract) => !c.endDate && c.fiscalYear == null;
/** 계약이 특정 귀속(정산)연도에 포함되는가. 계속계약은 운영 시작연도 이후 계속 포함(연도 필터에서 제외 안 됨). */
function contractInYear(c: SalesContract, year: number): boolean {
  const fy = contractFiscalYear(c);
  if (fy != null) return fy === year;
  if (isOngoing(c)) return year >= Math.max(OPERATION_START_YEAR, settlementYearOfDate(c.startDate) ?? OPERATION_START_YEAR);
  return false;
}
/** 계약의 생애구간이 창구[fromIdx,toIdx](월 인덱스)와 겹치는가. 특정기간·특정월 대상기간의 포함 판정. */
function overlapsWindow(c: SalesContract, fromIdx: number, toIdx: number): boolean {
  const s = monthIndex(c.startDate) ?? (c.fiscalYear != null ? monthIndex(`${c.fiscalYear}-01`) : null);
  const e = c.endDate ? monthIndex(c.endDate) : (isOngoing(c) ? Infinity : (c.fiscalYear != null ? monthIndex(`${c.fiscalYear}-12`) : null));
  if (s == null || e == null) return true; // 날짜 불명 → 일단 포함
  return s <= toIdx && e >= fromIdx;
}
// 피봇 값(measure) — acc/bill는 엔진 기반 기간 집계, 나머지는 계약 스냅샷(비율).
//   acc(발생주의 월할) = '매출' 인식액(감사 등은 대상기간 월할). bill(청구주의) = '청구액'(현금·선수금).
type Measure = 'acc' | 'bill' | 'mon' | 'amt' | 'ann' | 'cnt';
const MEASURE_LABEL: Record<Measure, string> = {
  acc: '매출(월할)', bill: '청구액', mon: '월환산', amt: '계약금액', ann: '연환산', cnt: '건수',
};
// 대상기간 모드
type PeriodMode = 'all' | 'year' | 'range' | 'month';
// 집계(피봇) 기준
const GROUP_OPTS: { key: string; label: string }[] = [
  { key: 'team', label: '팀' }, { key: 'type', label: '매출유형' }, { key: 'cpa', label: '담당CPA' }, { key: 'confirmed', label: '계약상태' },
  { key: 'staff', label: '담당직원' }, { key: 'cycle', label: '청구주기' }, { key: 'year', label: '귀속연도' },
];
function groupKeyOf(g: string, c: SalesContract): string {
  switch (g) {
    case 'team': return c.team;
    case 'type': return pathLabel(c.categoryCode);
    case 'cpa': return c.effectiveCpa || '(미지정)';
    case 'confirmed': return c.confirmed ? '확정' : '미계약';
    case 'staff': return c.effectiveStaff.map((s) => s.staffName).join(',') || '(미지정)';
    case 'cycle': return c.billingCycle;
    case 'year': { const fy = contractFiscalYear(c); return fy != null ? String(fy) : (isOngoing(c) ? '계속' : '(없음)'); }
    default: return '';
  }
}
const UNITS: OccurrenceUnit[] = ['사업장', '법인', '개인'];
const BILL_UNITS: BillingUnit[] = ['사업장', '법인', '개인']; // '건'은 청구주기에만(청구단위 아님)
// 날짜: 개시일·종료일은 '월' 최소단위(YYYY-MM). DB(date)엔 -01 로 저장.
const monthToDate = (m: string): string | null => (m ? `${m}-01` : null);
const dateToMonth = (d: string | null): string => (d ? d.slice(0, 7) : '');

interface FormState {
  entityId: string; placeId: string;
  team: Team; categoryCode: string; categoryEtcName: string;
  includesVat: boolean; includesWht: boolean; advisoryType: AdvisoryType | '';
  occurrenceUnit: OccurrenceUnit; billingUnit: BillingUnit | '';
  fiscalYear: string; billingCycle: BillingCycle; isInstallment: boolean; amount: string; billingMonth: string;
  cpa: string; staffIds: string[]; staffApplyMonth: string;
  contractDate: string; startDate: string; endDate: string; dateEstimated: boolean; confirmed: boolean;
  parentContractId: string; note: string; includedCodes: string[];
  installments: Installment[]; discounts: Discount[];
}
const emptyForm = (): FormState => ({
  entityId: '', placeId: '', team: '감사team', categoryCode: '', categoryEtcName: '',
  includesVat: false, includesWht: false, advisoryType: '', occurrenceUnit: '사업장', billingUnit: '',
  fiscalYear: '', billingCycle: '월', isInstallment: false, amount: '', billingMonth: '', cpa: '', staffIds: [], staffApplyMonth: '',
  contractDate: '', startDate: '', endDate: '', dateEstimated: false, confirmed: true, parentContractId: '', note: '', includedCodes: [], installments: [], discounts: [],
});

interface TaxOffer { entityId: string; placeId: string | null; kind: '법인' | '개인'; code: string; year: number }

export default function SalesContractTab() {
  const { readonly, role, profileName } = useAuth();
  const canWrite = !readonly && role !== 'per_head_accountant'; // 인당회계사는 조회 전용
  const canPivot = role !== 'team_member'; // 집계(피봇)는 기장팀원(김민섭·김동주 등)에게 숨김
  const [entities, setEntities] = useState<BizEntityFull[]>([]);
  const [staff, setStaff] = useState<StaffProfileLite[]>([]);
  const [contracts, setContracts] = useState<SalesContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [teamFilter, setTeamFilter] = useState<'' | Team>('');
  // Ctrl+K 에서 거래처를 골라 왔으면 그 이름으로 걸러 놓고 연다.
  // 기본이 표 화면이라 검색칸(q)이 아니라 **거래처명 열 필터**에 넣는다 — 화면 모양을
  // 멋대로 바꾸지 않으면서 원하는 줄만 남긴다.
  const navQ = useState(() => takeNavQuery('biz-contract'))[0];
  const [q, setQ] = useState(navQ);
  const [showAdd, setShowAdd] = useState(false);
  const [taxOffer, setTaxOffer] = useState<TaxOffer | null>(null);   // 세무조정 계약 동반등록 제안
  const [editId, setEditId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'box' | 'table'>('table');
  /**
   * 표에서 '수정'을 누르면 박스 화면으로 넘어가는데, 화면이 맨 위로 올라가 그 계약을 다시 찾아야 했다.
   * 넘어간 뒤 그 행으로 내려가 준다.
   */
  useEffect(() => {
    if (viewMode !== 'box' || !editId) return;
    // 목록이 길면(계약 266건) 한 번만 불러서는 아직 그려지기 전이라 그냥 지나간다.
    // 그려진 뒤 다시 한 번 더 부른다. smooth 는 재렌더에 끊겨서 쓰지 않는다.
    const jump = () => document.getElementById(`contract-${editId}`)?.scrollIntoView({ block: 'center' });
    const raf = requestAnimationFrame(jump);
    const t = setTimeout(jump, 250);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [viewMode, editId]);
  const [showCodeHelp, setShowCodeHelp] = useState(false);
  const [codeFixing, setCodeFixing] = useState(false);
  const [showRenew, setShowRenew] = useState(false);
  const tv = useTableView(VIEW_KEYS.salesContract);
  const { widthOf, startResize } = tv;
  const [colF, setColF] = useState<Record<string, string>>(() => (navQ ? { name: navQ } : {} as Record<string, string>));
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [groupBy, setGroupBy] = useState<string>('');   // 피봇 행 기준
  const [groupBy2, setGroupBy2] = useState<string>(''); // 피봇 열 기준(교차표)
  const [measure, setMeasure] = useState<Measure>('acc'); // 값(기본: 매출=발생주의 월할)
  // 피봇 대상기간
  const [periodMode, setPeriodMode] = useState<PeriodMode>('all');
  const [pivotYear, setPivotYear] = useState<string>('');   // 귀속연도 모드
  const [periodFrom, setPeriodFrom] = useState<string>(''); // 특정기간 시작월 'YYYY-MM'
  const [periodTo, setPeriodTo] = useState<string>('');     // 특정기간 종료월
  const [periodMonth, setPeriodMonth] = useState<string>(''); // 특정월
  const [capToday, setCapToday] = useState<boolean>(true);  // 경과분(오늘까지 상한)
  /** 발행요청(취소 제외)이 이미 걸린 회차 id — 알람을 자동으로 닫는 근거. */
  const [billedKeys, setBilledKeys] = useState<Set<string>>(new Set());

  async function load() {
    try {
      setError(null);
      const [ents, stf, cons, reqs] = await Promise.all([
        listBizEntities(), listContractStaffProfiles(), listSalesContracts(), listInvoiceRequests(),
      ]);
      setEntities(ents); setStaff(stf); setContracts(cons);
      // 이미 발행요청이 걸린 회차 — 알람에서 뺀다(취소된 것은 걸린 것으로 치지 않는다).
      setBilledKeys(new Set(reqs.filter((r) => r.status !== '취소' && r.installmentId).map((r) => r.installmentId!)));
    } catch (e) { setError(e instanceof Error ? e.message : '불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(''), 2500); }

  const entMap = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const entName = (id: string) => { const e = entMap.get(id); return e ? `${e.code} ${corpDisplayName(e.name, e.corpForm, e.corpFormPosition)}` : '(삭제됨)'; };
  const placeName = (eid: string, pid: string | null) => { if (!pid) return ''; const e = entMap.get(eid); return e?.places.find((p) => p.id === pid)?.placeName ?? ''; };

  // 담당직원·귀속 필터 드롭다운 후보 — 현재 데이터 기준.
  const staffOpts = useMemo(() => [...new Set(contracts.flatMap((c) => c.effectiveStaff.map((s) => s.staffName)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')), [contracts]);
  const yearOpts = useMemo(() => {
    const years = [...new Set(contracts.map((c) => contractFiscalYear(c)).filter((y): y is number => !!y))].sort((a, b) => b - a).map(String);
    return contracts.some(isOngoing) ? [...years, '계속'] : years;
  }, [contracts]);
  // 피봇 대상기간 후보(정산연도). 계속계약이 있으면 운영시작~현재 정산연도 구간을 연속 채운다.
  const pivotYearOpts = useMemo(() => {
    const ys = new Set<number>();
    for (const c of contracts) { const fy = contractFiscalYear(c); if (fy != null) ys.add(fy); }
    if (contracts.some(isOngoing)) {
      const now = settlementYearOfDate(todayYmd()) ?? OPERATION_START_YEAR;
      const top = Math.max(now, OPERATION_START_YEAR, ...ys);
      for (let y = OPERATION_START_YEAR; y <= top; y++) ys.add(y);
    }
    return [...ys].sort((a, b) => b - a);
  }, [contracts]);
  // 오늘 월(경과분 상한 기준). 렌더당 1회.
  const todayMonth = useMemo(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }, []);
  // 대상기간 → 집계 창구[from,to] ('YYYY-MM'). 엔진 기간 매출은 이 창구로 계산.
  const win = useMemo(() => {
    const cap = (from: string, to: string) => ({ from, to: capToday && to > todayMonth ? todayMonth : to });
    if (periodMode === 'year' && /^\d{4}$/.test(pivotYear)) {
      const y = Number(pivotYear); return cap(`${y}-07`, `${y + 1}-06`);
    }
    if (periodMode === 'range' && periodFrom && periodTo && periodFrom <= periodTo) return cap(periodFrom, periodTo);
    if (periodMode === 'month' && periodMonth) return { from: periodMonth, to: periodMonth };
    return defaultWindow(contracts, todayMonth, capToday); // 전체(또는 입력 미완)
  }, [periodMode, pivotYear, periodFrom, periodTo, periodMonth, capToday, contracts, todayMonth]);

  // 표(list)형 컬럼 정의 — 각 컬럼 val 로 필터·표시. opts 있으면 필터가 드롭다운.
  const COLUMNS: { key: string; label: string; val: (c: SalesContract) => string; w?: number; num?: boolean; opts?: readonly string[] }[] = [
    { key: 'ccode', label: '매출계약코드', val: (c) => c.contractCode + (c.dateEstimated ? ' ·추정' : ''), w: 150 },
    { key: 'confirmed', label: '계약상태', val: (c) => (c.confirmed ? '확정' : '미계약'), w: 70, opts: ['확정', '미계약'] },
    { key: 'code', label: '거래처', val: (c) => entMap.get(c.entityId)?.code ?? '', w: 56 },
    { key: 'name', label: '거래처명', val: (c) => { const e = entMap.get(c.entityId); return e ? corpDisplayName(e.name, e.corpForm, e.corpFormPosition) : ''; }, w: 150 },
    { key: 'team', label: '팀', val: (c) => c.team, w: 66, opts: ['감사team', 'taxteam'] },
    { key: 'type', label: '매출유형', val: (c) => pathLabel(c.categoryCode) + (c.categoryEtcName ? ` (${c.categoryEtcName})` : ''), w: 200 },
    { key: 'occ', label: '발생단위', val: (c) => c.occurrenceUnit + (c.placeId ? `/${placeName(c.entityId, c.placeId)}` : ''), w: 100 },
    { key: 'cycle', label: '주기', val: (c) => c.billingCycle + (c.isInstallment ? '·분할' : ''), w: 66, opts: BILLING_CYCLES },
    { key: 'bunit', label: '청구단위', val: (c) => c.billingUnit ?? '', w: 70 },
    { key: 'amount', label: '계약금액', val: (c) => won(c.amount), w: 90, num: true },
    { key: 'year', label: '귀속', val: (c) => { const fy = contractFiscalYear(c); return fy != null ? String(fy) : (isOngoing(c) ? '계속' : ''); }, w: 56, opts: yearOpts },
    { key: 'cpa', label: 'CPA', val: (c) => c.effectiveCpa, w: 66, opts: CPA_LIST },
    { key: 'staff', label: '담당직원', val: (c) => c.effectiveStaff.map((s) => s.staffName).join(','), w: 100, opts: staffOpts },
    { key: 'period', label: '개시~종료', val: (c) => `${dateToMonth(c.startDate) || ''}~${dateToMonth(c.endDate) || '계속'}`, w: 130 },
    { key: 'cdate', label: '계약일', val: (c) => c.contractDate ?? '', w: 90 },
    { key: 'note', label: '비고', val: (c) => c.note, w: 120 },
  ];
  // 숨긴 열은 표에서만 뺀다 — 필터·정렬·합계 계산은 전체 COLUMNS 기준 그대로다.
  const orderedCols = tv.orderCols(COLUMNS);            // 개인 표시순서 적용
  const shownCols = orderedCols.filter((c) => !tv.isHidden(c.key));
  const tableW = shownCols.reduce((s, c) => s + widthOf(c.key, c.w), 0) + (canWrite ? 96 : 0);
  const tableRows = useMemo(() => contracts.filter((c) => COLUMNS.every((col) => {
    const fv = (colF[col.key] || '').trim().toLowerCase();
    if (!fv) return true;
    // 귀속 필터가 연도 숫자면 정산연도 판정(계속계약은 운영연도 이후 포함) — 그 외엔 일반 부분일치
    if (col.key === 'year' && /^\d{4}$/.test(fv)) return contractInYear(c, Number(fv));
    return col.val(c).toLowerCase().includes(fv);
  })), [contracts, colF]); // eslint-disable-line react-hooks/exhaustive-deps
  const sortedRows = useMemo(() => {
    if (!sort) return tableRows;
    const col = COLUMNS.find((c) => c.key === sort.key);
    if (!col) return tableRows;
    const arr = [...tableRows];
    arr.sort((a, b) => {
      const va = col.val(a), vb = col.val(b);
      const cmp = col.num
        ? (parseFloat(va.replace(/[^\d.-]/g, '')) || 0) - (parseFloat(vb.replace(/[^\d.-]/g, '')) || 0)
        : va.localeCompare(vb, 'ko');
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [tableRows, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  // 헤더 클릭: 오름 → 내림 → 해제
  const toggleSort = (key: string) => setSort((s) => (s?.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' }));

  // 필터 반영 합계(부분합) — 표에 보이는 행 기준
  const summary = useMemo(() => {
    let cnt = 0, amt = 0, ann = 0;
    for (const c of sortedRows) { cnt++; amt += c.amount; ann += annualize(c); }
    return { cnt, amt, ann, mon: Math.round(ann / 12) };
  }, [sortedRows]);
  // 피봇 집계 대상 행 — 표 필터(sortedRows)에 대상기간 포함판정을 추가.
  //   귀속연도: contractInYear(정산 7/1~6/30, 운영시작 이전·타연도 제외, 계속계약 연속포함)
  //   특정기간·특정월: 창구와 생애구간이 겹치는 계약. 전체: 전부.
  const pivotRows = useMemo(() => {
    if (periodMode === 'year') {
      if (!/^\d{4}$/.test(pivotYear)) return sortedRows;
      return sortedRows.filter((c) => contractInYear(c, Number(pivotYear)));
    }
    if (periodMode === 'range' || periodMode === 'month') {
      const f = monthIndex(win.from), t = monthIndex(win.to);
      if (f == null || t == null) return sortedRows;
      return sortedRows.filter((c) => overlapsWindow(c, f, t));
    }
    return sortedRows; // 전체
  }, [sortedRows, periodMode, pivotYear, win]);
  // 계약별 엔진 기간집계(매출=발생주의 월할·청구액=청구주의). 피봇·교차표·합계가 공유.
  //   회계감사 매출을 회사 회계연도로 인식하는 remap은 엔진(billingSchedule.recognitionSpan)에서 처리.
  const revById = useMemo(() => {
    const m = new Map<string, { bill: number; acc: number }>();
    for (const c of pivotRows) m.set(c.id, { bill: periodRevenue(c, 'billing', win.from, win.to), acc: periodRevenue(c, 'accrual', win.from, win.to) });
    return m;
  }, [pivotRows, win]);
  type Agg = { amt: number; ann: number; cnt: number; bill: number; acc: number };
  const newAgg = (): Agg => ({ amt: 0, ann: 0, cnt: 0, bill: 0, acc: 0 });
  const addAgg = (a: Agg, c: SalesContract) => {
    const r = revById.get(c.id); a.amt += c.amount; a.ann += annualize(c); a.cnt++; a.bill += r?.bill ?? 0; a.acc += r?.acc ?? 0;
  };
  const pivotSummary = useMemo(() => {
    const a = newAgg(); for (const c of pivotRows) addAgg(a, c); return a;
  }, [pivotRows, revById]); // eslint-disable-line react-hooks/exhaustive-deps
  // 집계(피봇) — groupBy 기준 부분합
  const pivot = useMemo(() => {
    if (!groupBy) return [];
    const m = new Map<string, Agg & { key: string }>();
    for (const c of pivotRows) {
      const k = groupKeyOf(groupBy, c);
      let g = m.get(k); if (!g) { g = { key: k, ...newAgg() }; m.set(k, g); }
      addAgg(g, c);
    }
    return [...m.values()].sort((a, b) => mval(b) - mval(a));
  }, [pivotRows, groupBy, revById, measure]); // eslint-disable-line react-hooks/exhaustive-deps
  // 교차표(피봇) — 행(groupBy) × 열(groupBy2), 모든 조합 표시
  const matrix = useMemo(() => {
    if (!groupBy || !groupBy2) return null;
    const cells = new Map<string, Agg>(), rowTot = new Map<string, Agg>(), colTot = new Map<string, Agg>();
    const grand = newAgg();
    const get = (m: Map<string, Agg>, k: string) => { let v = m.get(k); if (!v) { v = newAgg(); m.set(k, v); } return v; };
    for (const c of pivotRows) {
      const r = groupKeyOf(groupBy, c), col = groupKeyOf(groupBy2, c);
      addAgg(get(cells, `${r}\0${col}`), c); addAgg(get(rowTot, r), c); addAgg(get(colTot, col), c); addAgg(grand, c);
    }
    const rowKeys = [...rowTot.keys()].sort((a, b) => mval(rowTot.get(b)!) - mval(rowTot.get(a)!));
    const colKeys = [...colTot.keys()].sort((a, b) => mval(colTot.get(b)!) - mval(colTot.get(a)!));
    return { rowKeys, colKeys, cells, rowTot, colTot, grand };
  }, [pivotRows, groupBy, groupBy2, revById, measure]); // eslint-disable-line react-hooks/exhaustive-deps
  // 값(measure) 계산·표시
  function mval(a?: Agg): number {
    if (!a) return 0;
    switch (measure) {
      case 'bill': return a.bill; case 'acc': return a.acc; case 'amt': return a.amt;
      case 'ann': return a.ann; case 'cnt': return a.cnt; default: return Math.round(a.ann / 12);
    }
  }
  const mfmt = (n: number) => (measure === 'cnt' ? String(n) : won(n));
  const measLabel = MEASURE_LABEL[measure];
  // 피봇 대상기간 표시 라벨.
  const periodLabel = useMemo(() => {
    const w = `${win.from}~${win.to}`;
    if (periodMode === 'year' && /^\d{4}$/.test(pivotYear)) return `${pivotYear} 귀속(정산 ${pivotYear}-07~${Number(pivotYear) + 1}-06)`;
    if (periodMode === 'range' && periodFrom && periodTo) return `기간 ${w}`;
    if (periodMode === 'month' && periodMonth) return `${periodMonth}월`;
    return `전체(${w})`;
  }, [periodMode, pivotYear, periodFrom, periodTo, periodMonth, win]);

  /**
   * 청구예정일 경과 알람 — 로그인한 담당CPA 본인 계약의 분할 회차 중 예정일이 지난 것.
   *
   * 알람이 닫히는 길은 **둘**이다(사용자 확정 2026-09-03):
   *   ① 그 회차에 발행요청이 걸렸다(취소 제외) — **자동**
   *   ② 사람이 '✓ 청구확인'을 눌렀다(billedAt) — ERP 에서 직접 발행한 경우
   *
   * ①이 없던 시절에는 손으로만 닫을 수 있었고, 그래서 실제 발행과 어긋난 적이 있다 —
   * 감사팀 착수금 3건(23,000,000)이 청구는 됐는데 계약에 연결되지 않아 알람만 손으로 껐다.
   */
  const myOverdue = useMemo(() => {
    if (!profileName) return [];
    const today = todayYmd();   // UTC 로 찍으면 오전 9시 이전에 기한 지난 건이 안 잡힌다
    const out: { id: string; name: string; label: string; due: string; amount: number }[] = [];
    for (const c of contracts) {
      if (c.effectiveCpa !== profileName) continue;
      for (const it of c.installments) {
        if (!it.id || !it.dueDate || it.dueDate >= today) continue;
        if (it.billedAt || billedKeys.has(it.id)) continue;
        out.push({ id: it.id, name: entName(c.entityId), label: it.label, due: it.dueDate, amount: it.amount });
      }
    }
    return out.sort((a, b) => a.due.localeCompare(b.due));
  }, [contracts, profileName, billedKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  async function confirmBilled(id: string) {
    try { await setInstallmentBilled(id, true); await load(); flash('청구완료 확인됨'); }
    catch (e) { alert('확인 실패: ' + (e instanceof Error ? e.message : e)); }
  }

  const view = useMemo(() => {
    let list = contracts;
    if (teamFilter) list = list.filter((c) => c.team === teamFilter);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter((c) => entName(c.entityId).toLowerCase().includes(s) || pathLabel(c.categoryCode).toLowerCase().includes(s) || (c.effectiveCpa || '').toLowerCase().includes(s));
    }
    return list;
  }, [contracts, teamFilter, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const total = contracts.length;
    const aud = contracts.filter((c) => c.team === '감사team').length;
    const tax = contracts.filter((c) => c.team === 'taxteam').length;
    const pending = contracts.filter((c) => !c.confirmed).length;
    return { total, aud, tax, pending };
  }, [contracts]);

  // SQL 로 직접 적재한 계약은 앱의 생성 경로를 타지 않아 매출계약코드가 비어 있다. 규칙(contractCodeBase)을
  // 그대로 재사용해 일괄 부여한다.
  async function fixMissingCodes() {
    const missing = contracts.filter((c) => !c.contractCode).length;
    if (!missing) return alert('매출계약코드가 없는 계약이 없습니다.');
    if (!confirm(`매출계약코드가 없는 ${missing}건에 코드를 부여합니다.
기존 코드는 건드리지 않습니다. 진행할까요?`)) return;
    setCodeFixing(true);
    try {
      const r = await backfillContractCodes();
      await load();
      alert(`✓ 코드 부여 — 완료 ${r.updated}건` +
        (r.skipped ? ` · 건너뜀 ${r.skipped}건(거래처코드·연도 없음)` : '') +
        (r.failed.length ? ` · 실패 ${r.failed.length}건` : ''));
    } catch (e) { alert('코드 부여 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setCodeFixing(false); }
  }

  // 기장 등 taxteam 계약을 정우철 담당으로 새로 등록하면, 같은 거래처의 세무조정(법인세·종합소득세)
  // 계약도 대개 함께 생긴다. 매번 따로 등록하지 않도록 바로 물어본다(금액은 청구기록에서 따라온다).
  function maybeOfferTaxFiling(form: FormState) {
    if (form.team !== 'taxteam') return;
    if (form.cpa.trim() !== TAX_ADJ_CPA) return;
    if (form.categoryCode === 'TAX.FILING.CORP' || form.categoryCode === 'TAX.FILING.INCOME') return;
    const ent = entities.find((e) => e.id === form.entityId);
    if (!ent) return;
    const code = ent.kind === '개인' ? 'TAX.FILING.INCOME' : 'TAX.FILING.CORP';
    const year = settlementYearOfDate(todayYmd()) ?? new Date().getFullYear();
    // 이미 있는 해는 빼고 제안한다.
    const has = (y: number) => contracts.some((c) => c.entityId === ent.id && c.categoryCode === code && Number(c.fiscalYear) === y);
    if (has(year) && has(year - 1)) return;
    setTaxOffer({ entityId: ent.id, placeId: form.placeId || null, kind: ent.kind === '개인' ? '개인' : '법인', code, year: has(year) ? year - 1 : year });
  }

  async function createTaxFiling(o: TaxOffer) {
    try {
      await createSalesContract({
        entityId: o.entityId,
        placeId: null,                       // 세무조정은 거래처(법인·개인) 단위
        team: 'taxteam',
        categoryCode: o.code,
        occurrenceUnit: o.kind,
        billingCycle: '연',
        amount: 0,
        cpa: TAX_ADJ_CPA,
        fiscalYear: o.year,
        startDate: `${o.year}-07-01`,
        endDate: `${o.year + 1}-06-01`,
        note: '기장계약 등록 시 함께 생성 — 금액은 세무조정수수료관리 청구 확정 시 반영',
      });
      setTaxOffer(null);
      await load();
      flash('✓ 세무조정 계약도 등록됨 (금액은 청구 확정 시 채워집니다)');
    } catch (e) { alert('세무조정 계약 등록 실패: ' + (e instanceof Error ? e.message : e)); }
  }

  async function persist(form: FormState, existingId?: string) {
    const leaf = leafOf(form.categoryCode);
    if (!form.entityId) return alert('거래처를 선택하세요.');
    if (!leaf) return alert('매출유형(최종 항목)을 선택하세요.');
    if (form.occurrenceUnit === '사업장' && !form.placeId) return alert('발생단위가 사업장이면 사업장을 선택하세요.');
    const input: ContractInput = {
      entityId: form.entityId, placeId: form.occurrenceUnit === '사업장' ? form.placeId : null,
      occurrenceUnit: form.occurrenceUnit, billingUnit: form.billingUnit || null,
      team: form.team, categoryCode: form.categoryCode,
      categoryEtcName: leaf.needsEtcName ? form.categoryEtcName.trim() : '',
      includesVat: leaf.jangbuOptions ? form.includesVat : false,
      includesWht: leaf.jangbuOptions ? form.includesWht : false,
      advisoryType: leaf.advisoryType ? (form.advisoryType || null) : null,
      parentContractId: form.parentContractId || null,
      fiscalYear: form.fiscalYear ? Number(form.fiscalYear) : null,
      billingCycle: form.billingCycle, isInstallment: form.isInstallment,
      billingMonth: form.billingCycle === '연' && form.billingMonth ? Number(form.billingMonth) : null,
      amount: form.amount ? Number(form.amount.replace(/,/g, '')) : 0, cpa: form.cpa.trim(),
      contractDate: form.contractDate || null, startDate: monthToDate(form.startDate), endDate: monthToDate(form.endDate),
      note: form.note.trim(), includedCodes: form.includedCodes, dateEstimated: form.dateEstimated, confirmed: form.confirmed,
    };
    try {
      const id = existingId ? (await updateSalesContract(existingId, input), existingId) : await createSalesContract(input);
      // 빈 줄은 저장하지 않는다(내용 없는 분할·무료/할인 제외)
      const insts = form.isInstallment ? form.installments.filter((x) => x.label.trim() || x.amount) : [];
      const discs = form.discounts.filter((d) => d.startDate || d.endDate || d.rate != null || d.amount != null || (d.note && d.note.trim()));
      await saveInstallments(id, insts);
      await saveDiscounts(id, discs);
      const staffRows = form.staffIds.map((sid) => ({ staffId: sid, staffName: staff.find((s) => s.id === sid)?.name ?? '' }));
      // 매월 청구하는 taxteam 계약에서 '적용월'을 적었으면 이력을 남기며 교체한다(그 전월까지는 이전 담당 유지).
      if (existingId && form.staffApplyMonth && staffHistoryApplies({ team: form.team, billingCycle: form.billingCycle })) {
        await changeContractStaffFrom(id, staffRows, form.staffApplyMonth);
      } else {
        await saveContractStaff(id, staffRows);
      }
      setShowAdd(false); setEditId(null); await load();
      flash(existingId ? '✓ 매출계약 수정됨' : '✓ 매출계약 등록됨');
      if (!existingId) maybeOfferTaxFiling(form);
    } catch (e) { alert('저장 실패: ' + (e instanceof Error ? e.message : e)); }
  }
  async function del(c: SalesContract) {
    if (!confirm('이 매출계약을 삭제할까요? (분할·할인·담당 함께 삭제)')) return;
    try { await deleteSalesContract(c.id); await load(); flash('삭제됨'); }
    catch (e) { alert('삭제 실패: ' + (e instanceof Error ? e.message : e)); }
  }

  if (loading) return <div className="card">불러오는 중…</div>;

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        📄 매출계약등록
        <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>
          총 {stats.total} · 감사 {stats.aud} · tax {stats.tax}
          {stats.pending > 0 && <span style={{ color: '#b45309', fontWeight: 700 }}> · 미계약 {stats.pending}</span>}
        </span>
        {msg && <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-2)', color: 'var(--good)' }}>{msg}</span>}
      </div>
      {error && <div style={{ color: 'var(--bad)', fontSize: 'var(--fs-2)', marginBottom: 8 }}>{error}</div>}

      {myOverdue.length > 0 && (
        <div style={{ fontSize: 'var(--fs-2)', background: '#fbecec', border: '1px solid #e6b8b8', borderRadius: 6, padding: '8px 10px', marginBottom: 10, color: 'var(--bad)' }}>
          <b>⏰ 청구예정일 경과 {myOverdue.length}건</b> <span style={{ color: '#c66', fontSize: 'var(--fs-1)' }}>(내 담당 {profileName})</span>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {myOverdue.slice(0, 12).map((o) => (
              <li key={o.id} style={{ marginBottom: 2 }}>
                <b>{o.name}</b> — {o.label} {won(o.amount)}원 · 예정일 <b>{o.due}</b>
                <button className="btn-sm" style={{ marginLeft: 6 }} onClick={() => confirmBilled(o.id)} title="청구완료로 표시하면 알람에서 제외됩니다">✓ 청구확인</button>
              </li>
            ))}
            {myOverdue.length > 12 && <li>… 외 {myOverdue.length - 12}건</li>}
          </ul>
        </div>
      )}

      {/* 도구 — **연 1~2회** 쓰는 것들. 매일 보는 표를 밀어내지 않도록 접어 둔다.
          코드부여는 '코드 없는 계약이 있을 때'만 나오므로 그때만 눈에 띈다. */}
      <details className="toolbar">
        <summary>🛠️ 도구</summary>
        <div className="toolbar-body">
          <button className="btn-sm" onClick={() => setShowCodeHelp(true)} title="매출계약코드 규칙 보기">📖 코드안내</button>
          {canWrite && (
            <button className="btn-sm btn-sm-blue" onClick={() => setShowRenew(true)} title="전년 세무조정(법인세·종합소득세) 계약을 올해 귀속으로 복제">
              🔄 세무조정 계약 갱신
            </button>
          )}
          {role === 'superuser' && contracts.some((c) => !c.contractCode) && (
            <button className="btn-sm btn-sm-blue" disabled={codeFixing}
              onClick={() => void fixMissingCodes()}
              title="SQL 로 적재돼 코드가 비어 있는 계약에 규칙대로 코드를 부여합니다">
              {codeFixing ? '부여 중…' : `🏷 코드없는 ${contracts.filter((c) => !c.contractCode).length}건 코드부여`}
            </button>
          )}
          {role === 'superuser' && (
            <div style={{ flexBasis: '100%' }}>
              <ContractImportPanel entities={entities} contracts={contracts} onImported={load} />
            </div>
          )}
        </div>
      </details>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ display: 'flex', gap: 2 }}>
          <button className={viewMode === 'box' ? 'btn-p' : 'btn-sm'} onClick={() => setViewMode('box')}>▤ 박스</button>
          <button className={viewMode === 'table' ? 'btn-p' : 'btn-sm'} onClick={() => setViewMode('table')}>▦ 표</button>
        </span>
        {viewMode === 'box' && (
          <>
            <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value as '' | Team)} style={selStyle}>
              <option value="">팀 전체</option><option value="감사team">감사team</option><option value="taxteam">taxteam</option>
            </select>
            <input placeholder="🔍 거래처·매출유형·CPA" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          </>
        )}
        {viewMode === 'table' && <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>각 컬럼 아래 칸에 입력해 필터 ({tableRows.length}건)</span>}
        {viewMode === 'table' && canPivot && (
          <span style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 'auto' }}>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} style={selStyle} title="피봇 행 기준">
              <option value="">📊 집계 안 함</option>
              {GROUP_OPTS.map((g) => <option key={g.key} value={g.key}>행: {g.label}</option>)}
            </select>
            {groupBy && (
              <select value={groupBy2} onChange={(e) => setGroupBy2(e.target.value)} style={selStyle} title="피봇 열 기준(교차표)">
                <option value="">열: 없음</option>
                {GROUP_OPTS.filter((g) => g.key !== groupBy).map((g) => <option key={g.key} value={g.key}>열: {g.label}</option>)}
              </select>
            )}
            {groupBy && (
              <select value={measure} onChange={(e) => setMeasure(e.target.value as Measure)} style={selStyle} title="값 — 매출=발생주의 월할 인식(감사 등 기간귀속), 청구액=현금 청구(선수금). 둘 다 대상기간 창구 엔진 집계, 나머지는 계약 스냅샷">
                <option value="acc">값: 매출(월할)</option>
                <option value="bill">값: 청구액</option>
                <option value="mon">값: 월환산</option>
                <option value="amt">값: 계약금액</option>
                <option value="ann">값: 연환산</option>
                <option value="cnt">값: 건수</option>
              </select>
            )}
            {groupBy && (
              <select value={periodMode} onChange={(e) => setPeriodMode(e.target.value as PeriodMode)} style={selStyle} title="집계 대상기간 모드">
                <option value="all">기간: 전체</option>
                <option value="year">기간: 귀속연도</option>
                <option value="range">기간: 특정기간</option>
                <option value="month">기간: 특정월</option>
              </select>
            )}
            {groupBy && periodMode === 'year' && (
              <select value={pivotYear} onChange={(e) => setPivotYear(e.target.value)} style={selStyle} title="정산연도(7/1~익년 6/30)">
                <option value="">귀속연도 선택</option>
                {pivotYearOpts.map((y) => <option key={y} value={String(y)}>{y} 귀속</option>)}
              </select>
            )}
            {groupBy && periodMode === 'range' && (
              <>
                <input type="month" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} style={selStyle} title="시작월" />
                <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>~</span>
                <input type="month" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} style={selStyle} title="종료월" />
              </>
            )}
            {groupBy && periodMode === 'month' && (
              <input type="month" value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value)} style={selStyle} title="대상월" />
            )}
            {groupBy && periodMode !== 'month' && (
              <label style={{ fontSize: 'var(--fs-1)', color: '#667', display: 'flex', alignItems: 'center', gap: 3 }} title="집계 상한을 이번 달까지로 제한(경과분만)">
                <input type="checkbox" checked={capToday} onChange={(e) => setCapToday(e.target.checked)} /> 경과분
              </label>
            )}
          </span>
        )}
        {viewMode === 'table' && Object.keys(colF).length > 0 && <button className="btn-sm" onClick={() => setColF({})}>필터 초기화</button>}
        {viewMode === 'table' && <ColumnSettings cols={orderedCols} view={tv} onMessage={flash} />}
        {canWrite && <button className="btn-p" onClick={() => { setShowAdd((s) => !s); setEditId(null); }}>{showAdd ? '닫기' : '＋ 신규 매출계약'}</button>}
      </div>

      {showAdd && canWrite && (
        <ContractForm entities={entities} staff={staff} contracts={contracts} onSubmit={(f) => persist(f)} onCancel={() => setShowAdd(false)} />
      )}

      {taxOffer && (
        <div className="modal-overlay" onClick={() => setTaxOffer(null)}>
          <div className="modal-box" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 8 }}>세무조정 계약도 함께 등록할까요?</div>
            <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.6, marginBottom: 10 }}>
              방금 등록한 계약이 <b>taxteam · 담당 {TAX_ADJ_CPA}</b> 이라, 같은 거래처의{' '}
              <b>{taxOffer.code === 'TAX.FILING.CORP' ? '법인세' : '종합소득세'}</b> 계약도 대개 함께 생깁니다.
              여기서 등록해 두면 <b>세무조정 대상선정</b>에서 바로 가져올 수 있습니다.
              <div style={{ marginTop: 6, color: 'var(--ink-3)', fontSize: 'var(--fs-1)' }}>
                금액은 비워둡니다 — 세무조정수수료관리에서 청구서를 확정하면 그 공급가액으로 자동으로 채워집니다.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--ink-2)' }}>귀속연도</span>
              <select
                value={taxOffer.year}
                onChange={(e) => setTaxOffer({ ...taxOffer, year: Number(e.target.value) })}
                style={{ fontWeight: 700 }}
              >
                {[taxOffer.year + 1, taxOffer.year, taxOffer.year - 1].map((y) => (
                  <option key={y} value={y}>{y}년 귀속</option>
                ))}
              </select>
              <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>정산기간 {taxOffer.year}-07 ~ {taxOffer.year + 1}-06</span>
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button className="btn-sm" onClick={() => setTaxOffer(null)}>나중에</button>
              <button className="btn-p" onClick={() => void createTaxFiling(taxOffer)}>세무조정 계약 등록</button>
            </div>
          </div>
        </div>
      )}

      {viewMode === 'box' && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {view.length === 0 && <div style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-2)', padding: 12 }}>매출계약이 없습니다.</div>}
        {view.map((c) => {
          const leaf = leafOf(c.categoryCode);
          return (
            <div key={c.id} id={`contract-${c.id}`} style={{
              border: editId === c.id ? '2px solid #c9a54a' : '1px solid var(--rule)',
              borderRadius: 6, padding: '8px 10px', marginLeft: c.parentContractId ? 24 : 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {c.parentContractId && <span style={{ fontSize: 'var(--fs-0)', color: '#a80' }}>↳종속</span>}
                {c.contractCode && <span style={{ fontSize: 'var(--fs-0)', fontFamily: 'monospace', color: '#667', background: '#f2f0ea', padding: '1px 5px', borderRadius: 3 }}>{c.contractCode}{c.dateEstimated && ' ·추정'}</span>}
                {!c.confirmed && <span style={{ fontSize: 'var(--fs-0)', fontWeight: 700, color: 'var(--warn)', background: '#FEF3C7', border: '1px solid #FCD34D', padding: '1px 5px', borderRadius: 3 }}>미계약</span>}
                <span style={teamBadge(c.team)}>{c.team}</span>
                <b style={{ fontSize: 'var(--fs-2)' }}>{entName(c.entityId)}</b>
                {c.placeId && <span style={{ fontSize: 'var(--fs-1)', color: '#777' }}>· {placeName(c.entityId, c.placeId)}</span>}
                <span style={{ fontSize: 'var(--fs-1)', color: '#456' }}>{pathLabel(c.categoryCode)}{c.categoryEtcName && ` (${c.categoryEtcName})`}</span>
                {c.includedCodes.length > 0 && <span style={{ fontSize: 'var(--fs-0)', color: '#786', background: '#eef3ea', padding: '1px 5px', borderRadius: 3 }} title={c.includedCodes.map((cc) => pathLabel(cc)).join(', ')}>＋포함 {c.includedCodes.length}</span>}
                {leaf?.jangbuOptions && (c.includesVat || c.includesWht) && <span style={{ fontSize: 'var(--fs-0)', color: '#a66' }}>{[c.includesVat && '부가', c.includesWht && '원천'].filter(Boolean).join('·')} 포함</span>}
                {c.advisoryType && <span style={{ fontSize: 'var(--fs-0)', color: '#a66' }}>{c.advisoryType}</span>}
                <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-2)', fontWeight: 700, color: '#245' }}>{won(c.amount)}원</span>
                <span style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)' }}>/{c.billingCycle}{c.isInstallment ? '·분할' : ''}</span>
              </div>
              <div style={{ fontSize: 'var(--fs-1)', color: '#777', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span>발생 {c.occurrenceUnit}</span>
                {c.billingUnit && <span>청구단위 {c.billingUnit}</span>}
                {c.fiscalYear && <span>귀속 {c.fiscalYear}</span>}
                {c.billingMonth && <span>청구 {c.billingMonth}월</span>}
                {c.effectiveCpa && <span>CPA {c.effectiveCpa}{c.cpaInherited && <span style={{ color: 'var(--ink-4)' }}> (거래처)</span>}</span>}
                {c.effectiveStaff.length > 0 && <span>담당 {c.effectiveStaff.map((s) => s.staffName).join('·')}{c.staffInherited && <span style={{ color: 'var(--ink-4)' }}> (거래처)</span>}</span>}
                <span>{dateToMonth(c.startDate) || '개시?'} ~ {dateToMonth(c.endDate) || '계속'}</span>
                {c.contractDate && <span>계약일 {c.contractDate}</span>}
                {c.installments.length > 0 && <span style={{ color: '#a60' }}>분할 {c.installments.length}회</span>}
                {c.discounts.length > 0 && <span style={{ color: '#c80' }}>무료/할인 {c.discounts.length}건</span>}
                {c.note && <span style={{ color: 'var(--ink-3)' }}>· {c.note}</span>}
                {canWrite && (
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    <button className="btn-sm btn-sm-blue" onClick={() => { setEditId(c.id); setShowAdd(false); }}>수정</button>
                    <button className="btn-sm btn-sm-del" onClick={() => del(c)}>삭제</button>
                  </span>
                )}
              </div>
              {editId === c.id && canWrite && (
                <div style={{ marginTop: 8 }}>
                  <ContractForm entities={entities} staff={staff} contracts={contracts} initial={c} onSubmit={(f) => persist(f, c.id)} onCancel={() => setEditId(null)} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}

      {viewMode === 'table' && (
        <>
        {canPivot && groupBy && !groupBy2 && (
          <div style={{ overflowX: 'auto', border: '1px solid #d8cfa0', borderRadius: 6, marginBottom: 8, background: '#fbf8ef' }}>
            <div style={{ fontSize: 'var(--fs-1)', color: '#846', padding: '5px 8px' }}>
              📊 <b>{GROUP_OPTS.find((g) => g.key === groupBy)?.label}</b>별 집계 · 대상기간: <b>{periodLabel}</b> · 필터 반영
              <span style={{ color: '#a98', marginLeft: 6 }}>매출=월할 인식(회계감사는 회계연도 7/1~6/30 균등) · 청구액=현금 청구(선수금) · 모두 공급가액(순액) · 강조열=선택값</span>
            </div>
            <table style={{ borderCollapse: 'collapse', fontSize: 'var(--fs-2)', minWidth: 640 }}>
              {(() => { const hi = (m: Measure) => (measure === m ? { background: '#efe7c8' } : undefined); return (<>
              <thead><tr style={{ background: '#f0e9d2' }}>
                <th style={thc}>{GROUP_OPTS.find((g) => g.key === groupBy)?.label}별</th>
                <th style={{ ...thc, textAlign: 'right' }}>건수</th>
                <th style={{ ...thc, textAlign: 'right', ...hi('acc') }}>매출(월할)</th>
                <th style={{ ...thc, textAlign: 'right', ...hi('bill') }}>청구액</th>
                <th style={{ ...thc, textAlign: 'right', ...hi('amt') }}>계약금액</th>
                <th style={{ ...thc, textAlign: 'right', ...hi('mon') }}>월환산</th>
                <th style={{ ...thc, textAlign: 'right', ...hi('ann') }}>연환산</th>
              </tr></thead>
              <tbody>
                {pivot.map((g) => (
                  <tr key={g.key} style={{ borderTop: '1px solid var(--rule-2)' }}>
                    <td style={{ ...tdc, fontWeight: 600 }}>{g.key}</td>
                    <td style={{ ...tdc, textAlign: 'right' }}>{g.cnt}</td>
                    <td style={{ ...tdc, textAlign: 'right', ...hi('acc') }}>{won(g.acc)}</td>
                    <td style={{ ...tdc, textAlign: 'right', ...hi('bill') }}>{won(g.bill)}</td>
                    <td style={{ ...tdc, textAlign: 'right', ...hi('amt') }}>{won(g.amt)}</td>
                    <td style={{ ...tdc, textAlign: 'right', ...hi('mon') }}>{won(Math.round(g.ann / 12))}</td>
                    <td style={{ ...tdc, textAlign: 'right', ...hi('ann') }}>{won(g.ann)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ borderTop: '2px solid #c9a54a', background: '#f5efdd', fontWeight: 700 }}>
                <td style={tdc}>총계</td>
                <td style={{ ...tdc, textAlign: 'right' }}>{pivotSummary.cnt}</td>
                <td style={{ ...tdc, textAlign: 'right', ...hi('acc') }}>{won(pivotSummary.acc)}</td>
                <td style={{ ...tdc, textAlign: 'right', ...hi('bill') }}>{won(pivotSummary.bill)}</td>
                <td style={{ ...tdc, textAlign: 'right', ...hi('amt') }}>{won(pivotSummary.amt)}</td>
                <td style={{ ...tdc, textAlign: 'right', ...hi('mon') }}>{won(Math.round(pivotSummary.ann / 12))}</td>
                <td style={{ ...tdc, textAlign: 'right', ...hi('ann') }}>{won(pivotSummary.ann)}</td>
              </tr></tfoot>
              </>); })()}
            </table>
          </div>
        )}
        {canPivot && matrix && (
          <div style={{ overflowX: 'auto', border: '1px solid #d8cfa0', borderRadius: 6, marginBottom: 8, background: '#fbf8ef' }}>
            <div style={{ fontSize: 'var(--fs-1)', color: '#846', padding: '5px 8px' }}>
              📊 <b>{GROUP_OPTS.find((g) => g.key === groupBy)?.label}</b>(행) × <b>{GROUP_OPTS.find((g) => g.key === groupBy2)?.label}</b>(열) · 값: <b>{measLabel}</b> · 대상기간: <b>{periodLabel}</b> · 필터 반영
            </div>
            <table style={{ borderCollapse: 'collapse', fontSize: 'var(--fs-1)' }}>
              <thead><tr style={{ background: '#f0e9d2' }}>
                <th style={{ ...thc, position: 'sticky', left: 0, background: '#f0e9d2' }}>{GROUP_OPTS.find((g) => g.key === groupBy)?.label} \ {GROUP_OPTS.find((g) => g.key === groupBy2)?.label}</th>
                {matrix.colKeys.map((ck) => <th key={ck} style={{ ...thc, textAlign: 'right' }}>{ck}</th>)}
                <th style={{ ...thc, textAlign: 'right', borderLeft: '2px solid #c9a54a' }}>합계</th>
              </tr></thead>
              <tbody>
                {matrix.rowKeys.map((rk) => (
                  <tr key={rk} style={{ borderTop: '1px solid var(--rule-2)' }}>
                    <td style={{ ...tdc, fontWeight: 600, position: 'sticky', left: 0, background: '#fbf8ef' }}>{rk}</td>
                    {matrix.colKeys.map((ck) => { const v = mval(matrix.cells.get(`${rk}\0${ck}`)); return <td key={ck} style={{ ...tdc, textAlign: 'right', color: v ? '#245' : '#ccc' }}>{v ? mfmt(v) : '·'}</td>; })}
                    <td style={{ ...tdc, textAlign: 'right', fontWeight: 700, borderLeft: '2px solid #c9a54a' }}>{mfmt(mval(matrix.rowTot.get(rk)))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ borderTop: '2px solid #c9a54a', background: '#f5efdd', fontWeight: 700 }}>
                <td style={{ ...tdc, position: 'sticky', left: 0, background: '#f5efdd' }}>합계</td>
                {matrix.colKeys.map((ck) => <td key={ck} style={{ ...tdc, textAlign: 'right' }}>{mfmt(mval(matrix.colTot.get(ck)))}</td>)}
                <td style={{ ...tdc, textAlign: 'right', borderLeft: '2px solid #c9a54a' }}>{mfmt(mval(matrix.grand))}</td>
              </tr></tfoot>
            </table>
          </div>
        )}
        <div className="tbl-scroll" style={scrollBox()}>
          <table style={{ tableLayout: 'fixed', width: tableW, borderCollapse: 'separate', borderSpacing: 0, fontSize: 'var(--fs-1)' }}>
            <colgroup>
              {shownCols.map((col) => <col key={col.key} style={{ width: widthOf(col.key, col.w) }} />)}
              {canWrite && <col style={{ width: 96 }} />}
            </colgroup>
            <thead>
              <tr>
                {shownCols.map((col) => (
                  <th key={col.key} style={{ ...thc, ...clip, height: 26, cursor: 'pointer', userSelect: 'none', ...stickyTop(0, '#f4efe4') }} onClick={() => toggleSort(col.key)} title="클릭: 정렬 · 우측 끝 드래그: 너비 조절">
                    {col.label}{sort?.key === col.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                    <ResizeHandle onMouseDown={startResize(col.key, widthOf(col.key, col.w))} onAutoFit={(px) => tv.setWidth(col.key, px)} />
                  </th>
                ))}
                {canWrite && <th style={{ ...thc, ...stickyTop(0, '#f4efe4') }}></th>}
              </tr>
              <tr>
                {shownCols.map((col) => (
                  <th key={col.key} style={{ padding: 2, ...stickyTop(26, '#faf7f0') }}>
                    <ColFilter opts={col.opts} value={colF[col.key] || ''} onChange={(v) => setColF((p) => ({ ...p, [col.key]: v }))} />
                  </th>
                ))}
                {canWrite && <th style={{ padding: 2, ...stickyTop(26, '#faf7f0') }}></th>}
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 && <tr><td colSpan={shownCols.length + 1} style={{ ...tdc, color: 'var(--ink-3)', padding: 12 }}>조건에 맞는 매출계약이 없습니다.</td></tr>}
              {sortedRows.map((c) => (
                <tr key={c.id}>
                  {shownCols.map((col) => <td key={col.key} style={{ ...tdc, ...clip, textAlign: col.num ? 'right' : 'left', fontWeight: col.key === 'name' ? 600 : 400, borderTop: '1px solid var(--rule-2)' }} title={col.val(c)}>{col.val(c)}</td>)}
                  {canWrite && (
                    <td style={{ ...tdc, borderTop: '1px solid var(--rule-2)' }}>
                      <span style={{ display: 'flex', gap: 3 }}>
                        <button className="btn-sm btn-sm-blue" onClick={() => { setViewMode('box'); setEditId(c.id); setShowAdd(false); }}>수정</button>
                        <button className="btn-sm btn-sm-del" onClick={() => del(c)}>삭제</button>
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: '#f5efdd', fontWeight: 700 }}>
                {shownCols.map((col) => {
                  const st: React.CSSProperties = { ...tdc, borderTop: '2px solid #c9a54a' };
                  // 건수는 보이는 첫 열에 붙인다 — 코드 열을 숨겨도 합계가 사라지지 않게.
                  const head = col.key === shownCols[0]?.key ? `합계 ${summary.cnt}건` : '';
                  if (col.key === 'amount') return <td key={col.key} style={{ ...st, textAlign: 'right' }}>{head || won(summary.amt)}</td>;
                  const body = col.key === 'name' ? `월환산 ${won(summary.mon)} · 연환산 ${won(summary.ann)}` : '';
                  return <td key={col.key} style={{ ...st, whiteSpace: head && !body ? 'nowrap' : undefined }}>
                    {[head, body].filter(Boolean).join(' · ')}
                  </td>;
                })}
                {canWrite && <td style={{ ...tdc, borderTop: '2px solid #c9a54a' }}></td>}
              </tr>
            </tfoot>
          </table>
        </div>
        </>
      )}

      {showCodeHelp && <CodeHelpModal onClose={() => setShowCodeHelp(false)} />}
      {showRenew && (
        <RenewTaxPanel
          onClose={() => setShowRenew(false)}
          onDone={async () => { setShowRenew(false); await load(); }}
        />
      )}
    </div>
  );
}

// ── 매출계약코드 규칙 안내 ──────────────────────────────────
function CodeHelpModal({ onClose }: { onClose: () => void }) {
  const table = typeMnemonicTable();
  const aud = table.filter((t) => t.team === '감사team');
  const tax = table.filter((t) => t.team === 'taxteam');
  const Row = ({ t }: { t: { label: string; mnemonic: string } }) => (
    <tr style={{ borderTop: '1px solid var(--rule-2)' }}><td style={{ padding: '2px 6px' }}>{t.label}</td><td style={{ padding: '2px 6px', fontWeight: 700, fontFamily: 'monospace' }}>{t.mnemonic}</td></tr>
  );
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflow: 'auto', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, padding: 18, maxWidth: 760, width: '100%', boxShadow: '0 8px 30px rgba(0,0,0,.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <b style={{ fontSize: 14 }}>📖 매출계약코드 규칙</b>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>
        <div style={{ fontSize: 'var(--fs-2)', lineHeight: 1.6, marginBottom: 10 }}>
          <div style={{ fontFamily: 'monospace', fontSize: 'var(--fs-3)', background: '#f6f4ef', padding: '6px 8px', borderRadius: 5, marginBottom: 8 }}>
            거래처코드 - 사업장코드 - 자동갱신 - 유형코드 - 팀코드 - 시작연도 - 순번
          </div>
          예) <b style={{ fontFamily: 'monospace' }}>I0002-01-R-BK-T-2026-01</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            <li><b>사업장코드</b>: 발생단위=사업장이면 사업장순번(01), 법인·개인 전체는 <b>00</b></li>
            <li><b>자동갱신</b>: 종료일 없음 = <b>R</b>(자동갱신) · 있음 = <b>F</b>(재계약)</li>
            <li><b>팀코드</b>: 감사team = <b>A</b> · taxteam = <b>T</b></li>
            <li><b>시작연도</b>: 개시연도 · <b>순번</b>: 동일 조합 내 일련번호</li>
            <li>표에 <b>·추정</b> 표시 = 정보관리 시작(2026-07) 이전이라 개시/종료일이 추정값</li>
          </ul>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <div style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--ink-2)', marginBottom: 4 }}>🅰 감사team (팀코드 A)</div>
            <table style={{ width: '100%', fontSize: 'var(--fs-1)', borderCollapse: 'collapse' }}><tbody>{aud.map((t) => <Row key={t.mnemonic + t.label} t={t} />)}</tbody></table>
          </div>
          <div>
            <div style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--ink-2)', marginBottom: 4 }}>🆃 taxteam (팀코드 T)</div>
            <table style={{ width: '100%', fontSize: 'var(--fs-1)', borderCollapse: 'collapse' }}><tbody>{tax.map((t) => <Row key={t.mnemonic + t.label} t={t} />)}</tbody></table>
          </div>
        </div>
      </div>
    </div>
  );
}

const thc: React.CSSProperties = { padding: '5px 6px', textAlign: 'left', fontWeight: 700, color: 'var(--ink-2)', whiteSpace: 'nowrap' };
const tdc: React.CSSProperties = { padding: '4px 6px', whiteSpace: 'nowrap' };

// ── 매출계약 일괄등록 패널(최고관리자) ──────────────────────
function ContractImportPanel({ entities, contracts, onImported }: { entities: BizEntityFull[]; contracts: SalesContract[]; onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ContractExcelResult | null>(null);
  async function doExport() {
    try { await exportContractTemplate(entities, contracts); }
    catch (e) { alert('내보내기 실패: ' + (e instanceof Error ? e.message : e)); }
  }
  async function onFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    if (!confirm('업로드한 Excel로 매출계약을 일괄 등록합니다.\n(매출유형이 채워진 행만 · 동일 사업장+유형 중복은 스킵)\n진행할까요?')) return;
    setBusy(true); setResult(null);
    try {
      const rows = await parseContractExcelFile(file);
      const r = await applyContractExcel(rows, entities);
      setResult(r);
      onImported();
    } catch (e) { alert('업로드 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }
  return (
    <div style={{ border: '1px dashed #c9a54a', borderRadius: 6, background: '#fdfaf1', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <span style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: '#8a6d1f' }}>📥 매출계약 일괄등록 (Excel)</span>
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>최고관리자 · 거래처코드+사업장명으로 매칭</span>
        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-2)' }}>{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div style={{ padding: '0 10px 10px' }}>
          <div style={{ fontSize: 'var(--fs-1)', color: '#777', marginBottom: 8 }}>
            <b>양식 내보내기</b> → <b>회색 열</b>=매출계약코드·거래처·사업장(키/참고, 수정금지),
            <b>노란 칸</b>=입력·수정(매출유형·금액·주기·담당 등) → <b>업로드</b>.
            <b>매출계약코드 있는 행</b>=그 계약 <b>수정</b>, <b>없는 행</b>=신규(행 복사). <b>매출유형 빈 행 제외</b>,
            신규 중 동일 사업장+유형(+귀속연도) 있으면 <b>스킵</b>.
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn-sm btn-sm-blue" onClick={doExport} disabled={busy || entities.length === 0}>
              📤 양식 내보내기 ({entities.reduce((s, e) => s + e.places.length, 0)} 사업장)
            </button>
            <label className="btn-p" style={{ cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
              {busy ? '처리 중…' : '📥 Excel 업로드'}
              <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} disabled={busy} onChange={onFile} />
            </label>
          </div>
          {result && (
            <div style={{ fontSize: 'var(--fs-2)', background: result.failed.length ? '#fbf0ee' : '#eef7ee', border: `1px solid ${result.failed.length ? '#e3cbcb' : '#cbe3cb'}`, borderRadius: 5, padding: '6px 8px', marginTop: 8, color: '#256b25' }}>
              <div>✓ 완료 — 신규 {result.created} · 수정 {result.updated} · 스킵(중복) {result.skipped} {result.failed.length > 0 && <span style={{ color: 'var(--bad)' }}>· 실패 {result.failed.length}</span>}</div>
              {result.failed.length > 0 && (
                <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: 'var(--bad)' }}>
                  {result.failed.slice(0, 12).map((f, i) => <li key={i}><b>{f.ref}</b>: {f.error}</li>)}
                  {result.failed.length > 12 && <li>… 외 {result.failed.length - 12}건</li>}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 등록/수정 폼 ────────────────────────────────────────────
function ContractForm({ entities, staff, contracts, initial, onSubmit, onCancel }: {
  entities: BizEntityFull[]; staff: StaffProfileLite[]; contracts: SalesContract[];
  initial?: SalesContract; onSubmit: (f: FormState) => void; onCancel: () => void;
}) {
  const [f, setF] = useState<FormState>(() => initial ? fromContract(initial) : emptyForm());
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));
  const entity = entities.find((e) => e.id === f.entityId);
  const leaf = leafOf(f.categoryCode);
  const staffCands = staff.filter((s) => (staffCandidatesForTeam(f.team) as readonly string[]).includes(s.name));
  const entLabel = (e: BizEntityFull) => `${e.code} ${corpDisplayName(e.name, e.corpForm, e.corpFormPosition)}`;
  const [entityText, setEntityText] = useState(() => (entity ? entLabel(entity) : ''));
  const [showDetail, setShowDetail] = useState(false);
  const canInstallment = f.billingCycle === '연' || f.billingCycle === '건'; // 분할은 연·건 계약에서만

  // 거래처 입력(타입/선택) → id·CPA 상속
  function onEntityText(v: string) {
    setEntityText(v);
    const t = v.trim();
    const code = t.split(/\s+/)[0];
    const match = entities.find((e) => entLabel(e) === t || e.code === code);
    const hq = match?.places.find((p) => p.isHeadquarters) ?? match?.places[0];
    setF((p) => ({ ...p, entityId: match?.id ?? '', placeId: '', cpa: p.cpa || hq?.cpa || '' }));
  }
  function pickCategory(code: string) {
    const lf = leafOf(code);
    setF((p) => {
      const next: FormState = { ...p, categoryCode: code, ...(lf?.defaultUnit ? { occurrenceUnit: lf.defaultUnit } : {}) };
      if (code === 'AUD.AUDIT') next.staffIds = []; // 회계감사는 담당직원 개념 없음(담당CPA가 수행자)
      if (lf?.defaultCycle) {
        next.billingCycle = lf.defaultCycle;
        // 연단위(회계감사 등): 귀속연도가 있으면 개시=Y-01·종료=Y-12 자동(감사 대상 회계연도)
        if (lf.defaultCycle === '연' && /^\d{4}$/.test(p.fiscalYear)) { next.startDate = `${p.fiscalYear}-01`; next.endDate = `${p.fiscalYear}-12`; }
      }
      return next;
    });
  }
  function pickPlace(pid: string) {
    const pl = entity?.places.find((x) => x.id === pid);
    setF((p) => ({ ...p, placeId: pid, cpa: p.cpa || pl?.cpa || '' }));
  }
  // 계약일(일단위) → 개시월 자동(비었을 때)
  function pickContractDate(v: string) {
    setF((p) => ({ ...p, contractDate: v, startDate: p.startDate || v.slice(0, 7) }));
  }
  // 종료월 → 귀속연도 자동도출(정산기간 7/1~6/30 규칙, 귀속연도 비었을 때만). 기장 등 계속거래는 종료 비워 미적용.
  function pickEndMonth(v: string) {
    setF((p) => {
      const next = { ...p, endDate: v };
      if (v && !p.fiscalYear) { const y = settlementYearOfDate(v); if (y) next.fiscalYear = String(y); }
      return next;
    });
  }
  // 청구주기 '연' + 귀속연도 → 개시월~종료월 자동(1~12월). 연/건 아니면 분할 해제.
  function pickCycle(v: BillingCycle) {
    setF((p) => {
      const next = { ...p, billingCycle: v };
      if (v !== '연' && v !== '건') next.isInstallment = false;
      if (v === '연' && /^\d{4}$/.test(p.fiscalYear)) { next.startDate = `${p.fiscalYear}-01`; next.endDate = `${p.fiscalYear}-12`; }
      return next;
    });
  }
  function pickYear(v: string) {
    const y = v.replace(/\D/g, '').slice(0, 4);
    setF((p) => {
      const next = { ...p, fiscalYear: y };
      if (p.billingCycle === '연' && /^\d{4}$/.test(y)) { next.startDate = `${y}-01`; next.endDate = `${y}-12`; }
      return next;
    });
  }

  const instSum = f.installments.reduce((s, x) => s + (x.amount || 0), 0);
  const amountNum = f.amount ? Number(f.amount.replace(/,/g, '')) : 0;

  return (
    <div className="card" style={{ background: '#F5F1EB', marginBottom: 10 }}>
      <div style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--ink-2)', marginBottom: 8 }}>{initial ? '✏️ 매출계약 수정' : '＋ 새 매출계약'}</div>

      {/* 거래처 · 발생단위 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
        <div className="frow"><span className="fl">거래처<span className="req">*</span></span>
          <>
            <input list="sc-entity" value={entityText} onChange={(e) => onEntityText(e.target.value)} placeholder="코드·거래처명 입력·선택" />
            <datalist id="sc-entity">{entities.map((e) => <option key={e.id} value={entLabel(e)} />)}</datalist>
          </></div>
        <div className="frow"><span className="fl">발생단위</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <select value={f.occurrenceUnit} onChange={(e) => set('occurrenceUnit', e.target.value as OccurrenceUnit)} style={selStyle}>
              {UNITS.map((u) => <option key={u}>{u}</option>)}
            </select>
            {f.occurrenceUnit === '사업장' && (
              <select value={f.placeId} onChange={(e) => pickPlace(e.target.value)} style={selStyle} disabled={!entity}>
                <option value="">사업장 선택</option>
                {entity?.places.map((pl) => <option key={pl.id} value={pl.id}>{pl.placeName}</option>)}
              </select>
            )}
          </span></div>
      </div>

      {/* 매출유형 트리 */}
      <div style={{ fontSize: 'var(--fs-1)', fontWeight: 700, color: '#345', margin: '10px 0 4px' }}>· 매출유형</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['감사team', 'taxteam'] as Team[]).map((t) => (
          <button key={t} type="button" onClick={() => setF((p) => ({ ...p, team: t, categoryCode: '' }))} className={f.team === t ? 'btn-p' : 'btn-sm'}>{t}</button>
        ))}
        <TaxonomyPicker team={f.team} code={f.categoryCode} onPick={pickCategory} />
      </div>
      {leaf && <div style={{ fontSize: 'var(--fs-1)', color: '#2a6', marginTop: 3 }}>선택: {pathLabel(f.categoryCode)}</div>}

      {/* leaf 플래그 조건입력 */}
      {leaf?.needsEtcName && (
        <div className="frow" style={{ marginTop: 6 }}><span className="fl">신고대상명칭<span className="req">*</span></span>
          <input value={f.categoryEtcName} onChange={(e) => set('categoryEtcName', e.target.value)} placeholder="기타 항목 명칭 입력" /></div>
      )}
      {leaf?.jangbuOptions && (
        <div className="frow" style={{ marginTop: 6 }}><span className="fl">기장 포함</span>
          <span style={{ display: 'flex', gap: 12 }}>
            <label style={{ fontSize: 'var(--fs-1)', display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={f.includesVat} onChange={(e) => set('includesVat', e.target.checked)} /> 부가가치세</label>
            <label style={{ fontSize: 'var(--fs-1)', display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={f.includesWht} onChange={(e) => set('includesWht', e.target.checked)} /> 원천세</label>
          </span></div>
      )}
      {leaf?.advisoryType && (
        <div className="frow" style={{ marginTop: 6 }}><span className="fl">자문구분</span>
          <span style={{ display: 'flex', gap: 12 }}>
            {(['일반', '전문'] as AdvisoryType[]).map((a) => (
              <label key={a} style={{ fontSize: 'var(--fs-1)', display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="radio" name="adv" checked={f.advisoryType === a} onChange={() => set('advisoryType', a)} /> {a}자문{a === '전문' ? '(letter)' : ''}
              </label>
            ))}
          </span></div>
      )}
      {leaf?.filingAgentEligible && (
        <div style={{ fontSize: 'var(--fs-0)', color: '#a80', marginTop: 4 }}>※ 기장 없이 이 신고만 하면 '신고대리'입니다.</div>
      )}
      {leaf?.linksConfirmation && (
        <div style={{ fontSize: 'var(--fs-0)', color: '#47a', marginTop: 4 }}>※ 회계감사 계약은 조회서발송관리에서 발송대상으로 참조됩니다.</div>
      )}

      {/* 청구주기 · 계약금액 · 귀속연도 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px', marginTop: 8 }}>
        <div className="frow"><span className="fl">청구주기</span>
          <select value={f.billingCycle} onChange={(e) => pickCycle(e.target.value as BillingCycle)} style={selStyle}>
            {BILLING_CYCLES.map((c) => <option key={c}>{c}</option>)}
          </select></div>
        <div className="frow"><span className="fl">청구단위</span>
          <select value={f.billingUnit} onChange={(e) => set('billingUnit', e.target.value as BillingUnit | '')} style={selStyle}>
            <option value="">(선택)</option>{BILL_UNITS.map((u) => <option key={u}>{u}</option>)}
          </select></div>
        <div className="frow"><span className="fl">{f.isInstallment ? '계약금액(총액)' : '계약금액'} <span style={{ fontSize: 'var(--fs-0)', color: '#a55' }}>VAT별도</span></span>
          <input value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder={f.billingCycle === '월' ? '월 금액 (예: 150000)' : f.billingCycle === '건' ? '건당 금액' : '1회 금액'} /></div>
        {f.billingCycle === '연' && (
          <div className="frow"><span className="fl">청구월 <span style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)' }}>(연 1회)</span></span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <select value={f.billingMonth} onChange={(e) => set('billingMonth', e.target.value)} style={selStyle}>
                <option value="">개시월에 청구</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={String(m)}>{m}월</option>)}
              </select>
              <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
                정산기간 안에서 실제 청구하는 달. 세무조정은 신고 뒤에 청구하므로 <b>법인세 3월 · 소득세 5월(성실신고 6월)</b>입니다.
                지난 실적에서 잡은 <b>예상치</b>이며, 발행요청을 실제로 내면 <b>그 달로 자동으로 맞춰집니다</b>.
              </span>
            </span></div>
        )}
        {(f.categoryCode === 'TAX.FILING.CORP' || f.categoryCode === 'TAX.FILING.INCOME') && f.cpa === '정우철' && (
          <div style={{ gridColumn: '1 / -1', fontSize: 'var(--fs-1)', color: '#8a6d1f', background: '#fdfaf1', border: '1px dashed #c9a54a', borderRadius: 5, padding: '5px 8px' }}>
            🔗 정우철 담당 세무조정입니다 — 이 계약금액은 <b>세무조정수수료관리</b>에서 청구서를 확정할 때
            그 청구총액의 공급가액(÷1.1)으로 <b>자동 갱신</b>됩니다. 여기서 적은 값은 다음 청구 때 덮어써집니다.
          </div>
        )}
        <div className="frow"><span className="fl">귀속연도</span>
          <>
            <input value={f.fiscalYear} onChange={(e) => pickYear(e.target.value)} placeholder="연단위 신고만 (예: 2025)" maxLength={4} />
          </></div>
        {canInstallment && (
          <div className="frow"><span className="fl">분할청구</span>
            <label style={{ fontSize: 'var(--fs-1)', display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={f.isInstallment} onChange={(e) => set('isInstallment', e.target.checked)} /> 계약금/중도금/잔금 분할
            </label></div>
        )}
      </div>
      <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)', marginTop: 2 }}>※ 귀속연도 = 정산기간(<b>7/1~익년 6/30</b>) 기준. <b>종료월을 넣으면 자동</b>(종료 7~12월→그 해, 1~6월→전년). 월 기장 등 계속거래는 비워둡니다.</div>

      {f.isInstallment && <InstallmentsEditor rows={f.installments} onChange={(r) => set('installments', r)} sum={instSum} target={amountNum} />}

      {/* 담당 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px', marginTop: 8 }}>
        <div className="frow"><span className="fl">담당CPA</span>
          <>
            <input list="sc-cpa" value={f.cpa} onChange={(e) => set('cpa', e.target.value)} placeholder="비우면 거래처 CPA 상속" />
            <datalist id="sc-cpa">{CPA_LIST.map((c) => <option key={c} value={c} />)}</datalist>
          </></div>
        {f.categoryCode !== 'AUD.AUDIT' && (
        <div className="frow"><span className="fl">담당직원 <span style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)' }}>({f.team})</span></span>
          <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {staffCands.map((s) => {
              const on = f.staffIds.includes(s.id);
              return <button key={s.id} type="button" onClick={() => set('staffIds', on ? f.staffIds.filter((x) => x !== s.id) : [...f.staffIds, s.id])} style={chip(on)}>{s.name}</button>;
            })}
            {staffCands.length === 0 && <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>후보 계정 없음</span>}
          </span></div>
        )}
        {f.categoryCode !== 'AUD.AUDIT' && staffHistoryApplies({ team: f.team, billingCycle: f.billingCycle }) && initial && (
          <div className="frow" style={{ gridColumn: '1 / -1' }}>
            <span className="fl">담당 변경 적용월</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <input type="month" value={f.staffApplyMonth} onChange={(e) => set('staffApplyMonth', e.target.value)} style={{ width: 150 }} />
              <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
                매월 청구하는 계약이라 <b>담당이 바뀐 달</b>을 적어야 그 전 달 청구가 누구 담당이었는지 남습니다.
                비우면 이력 없이 지금 담당을 통째로 바꿉니다.
              </span>
            </span>
          </div>
        )}
        {initial && initial.staffHistory.length > 0 && (
          <div className="frow" style={{ gridColumn: '1 / -1' }}>
            <span className="fl">담당 이력</span>
            <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {[...initial.staffHistory]
                .sort((a, b) => (a.fromMonth ?? '').localeCompare(b.fromMonth ?? ''))
                .map((h) => (
                  <span key={h.id}>
                    {h.staffName} · {h.fromMonth ? h.fromMonth.slice(0, 7) : '처음'} ~ {h.toMonth ? h.toMonth.slice(0, 7) : '현재'}
                  </span>
                ))}
            </span>
          </div>
        )}
      </div>

      {/* 날짜: 계약일(일) + 개시·종료(월) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 14px', marginTop: 8 }}>
        <div className="frow"><span className="fl">매출계약일</span>
          <input type="date" value={f.contractDate} onChange={(e) => pickContractDate(e.target.value)} /></div>
        <div className="frow"><span className="fl">매출개시월</span>
          <input type="month" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></div>
        <div className="frow"><span className="fl">종료월(비움=계속)</span>
          <input type="month" value={f.endDate} onChange={(e) => pickEndMonth(e.target.value)} /></div>
        <label
          style={{ gridColumn: '1 / -1', fontSize: 'var(--fs-1)', color: f.confirmed ? '#666' : '#92400E', display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, fontWeight: f.confirmed ? 400 : 700 }}
          title="아직 체결되지 않은(예산·검토용) 계약이면 체크를 해제하세요. 목록에서 '미계약'으로 걸러볼 수 있습니다."
        >
          <input type="checkbox" checked={f.confirmed} onChange={(e) => set('confirmed', e.target.checked)} />
          {f.confirmed
            ? '계약 확정 (체결됨) — 해제하면 미계약으로 표시됩니다'
            : '미계약 — 예산·검토용으로만 잡힌 계약입니다 (체결되면 체크하세요)'}
        </label>
        <label
          style={{ gridColumn: '1 / -1', fontSize: 'var(--fs-1)', color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}
          title="정보관리 시작(2026-07) 이전 계약은 날짜를 규칙으로 채워 넣어 추정으로 표시합니다. 실제 계약서 날짜를 넣었으면 해제하세요."
        >
          <input type="checkbox" checked={f.dateEstimated} onChange={(e) => set('dateEstimated', e.target.checked)} />
          개시·종료일이 <b>추정값</b>임 (표에 <b>·추정</b> 으로 표시 — 실제 날짜를 확인해 넣었으면 체크를 해제하세요)
        </label>
      </div>

      {/* 상세(접기) — 청구단위·무료할인·메인종속·비고 */}
      <button type="button" className="btn-sm" style={{ marginTop: 10 }} onClick={() => setShowDetail((s) => !s)}>{showDetail ? '▾ 상세 접기' : '▸ 상세 (무료/할인·메인종속·비고)'}</button>
      {showDetail && (
        <div style={{ marginTop: 8 }}>
          <div className="frow"><span className="fl">메인계약(종속 시)</span>
            <select value={f.parentContractId} onChange={(e) => set('parentContractId', e.target.value)} style={selStyle}>
              <option value="">없음(단독/메인)</option>
              {contracts.filter((c) => c.id !== initial?.id && c.entityId === f.entityId && !c.parentContractId).map((c) => (
                <option key={c.id} value={c.id}>{pathLabel(c.categoryCode)} ({won(c.amount)})</option>
              ))}
            </select></div>
          <DiscountsEditor rows={f.discounts} onChange={(r) => set('discounts', r)} />
          <div className="frow" style={{ marginTop: 8, alignItems: 'flex-start' }}><span className="fl">포함유형(복합)</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)', marginBottom: 3 }}>이 계약이 함께 커버하는 세부 유형(예: 기장검토→원천·부가). 대표유형·코드·금액과 무관</div>
              <div style={{ maxHeight: 116, overflow: 'auto', border: '1px solid #e2ddd2', borderRadius: 5, padding: 4, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {contractTypeOptions().filter((o) => o.code !== f.categoryCode).map((o) => {
                  const on = f.includedCodes.includes(o.code);
                  return <button key={o.code} type="button" onClick={() => set('includedCodes', on ? f.includedCodes.filter((x) => x !== o.code) : [...f.includedCodes, o.code])} style={chip(on)}>{o.label}</button>;
                })}
              </div>
            </div></div>
          <div className="frow" style={{ marginTop: 8 }}><span className="fl">비고</span>
            <input value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="(선택)" /></div>
        </div>
      )}

      <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
        <button className="btn-p" onClick={() => onSubmit(f)}>{initial ? '저장' : '매출계약 등록'}</button>
        <button className="btn-sm" onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}

// ── 매출유형 cascade 선택 ───────────────────────────────────
function TaxonomyPicker({ team, code, onPick }: { team: Team; code: string; onPick: (code: string) => void }) {
  const entry = code ? findNode(code) : null;
  const path = entry && entry.team === team ? entry.path : [];
  const levels: TaxNode[][] = [TAXONOMY[team]];
  for (const n of path) if (n.children) levels.push(n.children);
  return (
    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {levels.map((opts, li) => (
        <select key={li} value={path[li]?.code ?? ''} onChange={(e) => onPick(e.target.value)} style={selStyle}>
          <option value="">{li === 0 ? '대분류' : '선택'}</option>
          {opts.map((o) => <option key={o.code} value={o.code}>{o.label}{isLeaf(o) ? '' : ' ▸'}</option>)}
        </select>
      ))}
    </span>
  );
}

// ── 분할 회차 편집 ─────────────────────────────────────────
function InstallmentsEditor({ rows, onChange, sum, target }: { rows: Installment[]; onChange: (r: Installment[]) => void; sum: number; target: number }) {
  const upd = (i: number, patch: Partial<Installment>) => onChange(rows.map((r, j) => j === i ? { ...r, ...patch } : r));
  return (
    <div style={{ background: '#fbf7ee', borderRadius: 5, padding: 8, marginTop: 6 }}>
      <div style={{ fontSize: 'var(--fs-1)', fontWeight: 700, color: '#845', marginBottom: 4 }}>분할 회차 (합계 {won(sum)} / 계약금액 {won(target)} {sum === target ? '✓' : '⚠불일치'})</div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 3, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={r.label} onChange={(e) => upd(i, { label: e.target.value })} placeholder="명칭(계약금/중도금1차/잔금)" style={{ width: 160 }} />
          <input value={r.amount ? String(r.amount) : ''} onChange={(e) => upd(i, { amount: Number(e.target.value.replace(/\D/g, '')) })} placeholder="금액" style={{ width: 110 }} />
          <input type="date" value={r.dueDate ?? ''} onChange={(e) => upd(i, { dueDate: e.target.value || null })} />
          <input value={r.conditionNote} onChange={(e) => upd(i, { conditionNote: e.target.value })} placeholder="조건메모(착수 시 등)" style={{ width: 150 }} />
          <label style={{ fontSize: 'var(--fs-0)', display: 'flex', gap: 3, alignItems: 'center', color: r.billedAt ? '#2a7' : '#999' }}>
            <input type="checkbox" checked={!!r.billedAt} onChange={(e) => upd(i, { billedAt: e.target.checked ? new Date().toISOString() : null })} /> 청구완료
          </label>
          <button type="button" className="btn-sm btn-sm-del" onClick={() => onChange(rows.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="btn-sm" onClick={() => onChange([...rows, { seq: rows.length + 1, label: '', amount: 0, dueDate: null, conditionNote: '' }])}>＋회차</button>
    </div>
  );
}

// ── 무료/할인 편집 ─────────────────────────────────────────
function DiscountsEditor({ rows, onChange }: { rows: Discount[]; onChange: (r: Discount[]) => void }) {
  const upd = (i: number, patch: Partial<Discount>) => onChange(rows.map((r, j) => j === i ? { ...r, ...patch } : r));
  return (
    <div style={{ background: '#f6f0f8', borderRadius: 5, padding: 8, marginTop: 8 }}>
      <div style={{ fontSize: 'var(--fs-1)', fontWeight: 700, color: '#658', marginBottom: 4 }}>무료 / 할인 구간</div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 3, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={r.discType} onChange={(e) => upd(i, { discType: e.target.value as '무료' | '할인' })} style={selStyle}><option>무료</option><option>할인</option></select>
          <input type="date" value={r.startDate ?? ''} onChange={(e) => upd(i, { startDate: e.target.value || null })} />
          <span style={{ fontSize: 'var(--fs-1)' }}>~</span>
          <input type="date" value={r.endDate ?? ''} onChange={(e) => upd(i, { endDate: e.target.value || null })} />
          {r.discType === '할인' && <input value={r.rate != null ? String(r.rate) : ''} onChange={(e) => upd(i, { rate: e.target.value ? Number(e.target.value) : null })} placeholder="할인율%" style={{ width: 70 }} />}
          {r.discType === '할인' && <input value={r.amount != null ? String(r.amount) : ''} onChange={(e) => upd(i, { amount: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null })} placeholder="또는 할인액" style={{ width: 100 }} />}
          <input value={r.note} onChange={(e) => upd(i, { note: e.target.value })} placeholder="메모" style={{ width: 120 }} />
          <button type="button" className="btn-sm btn-sm-del" onClick={() => onChange(rows.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="btn-sm" onClick={() => onChange([...rows, { discType: '무료', startDate: null, endDate: null, rate: null, amount: null, note: '' }])}>＋구간</button>
    </div>
  );
}

// FormState ← 기존 계약
function fromContract(c: SalesContract): FormState {
  return {
    entityId: c.entityId, placeId: c.placeId ?? '', team: c.team, categoryCode: c.categoryCode, categoryEtcName: c.categoryEtcName,
    includesVat: c.includesVat, includesWht: c.includesWht, advisoryType: c.advisoryType ?? '', occurrenceUnit: c.occurrenceUnit,
    billingUnit: c.billingUnit ?? '', fiscalYear: c.fiscalYear ? String(c.fiscalYear) : '', billingCycle: c.billingCycle,
    isInstallment: c.isInstallment, amount: c.amount ? String(c.amount) : '', billingMonth: c.billingMonth ? String(c.billingMonth) : '', cpa: c.cpa, staffIds: c.staff.map((s) => s.staffId), staffApplyMonth: '',
    contractDate: c.contractDate ?? '', startDate: dateToMonth(c.startDate), endDate: dateToMonth(c.endDate), dateEstimated: c.dateEstimated, confirmed: c.confirmed, parentContractId: c.parentContractId ?? '',
    note: c.note, includedCodes: c.includedCodes ?? [], installments: c.installments.length ? c.installments : [], discounts: c.discounts,
  };
}

const selStyle: React.CSSProperties = { padding: '4px 7px', fontSize: 'var(--fs-2)' };
const teamBadge = (t: Team): React.CSSProperties => ({ fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 4, color: '#fff', background: t === '감사team' ? '#4a6fa5' : '#7a9a4a' });
const chip = (on: boolean): React.CSSProperties => ({ fontSize: 'var(--fs-0)', padding: '2px 7px', borderRadius: 10, cursor: 'pointer', border: '1px solid', borderColor: on ? '#2a7' : '#ccc', background: on ? '#e3f5ec' : '#fff', color: on ? '#175' : '#888' });

// ── 전년 세무조정 계약 갱신 ────────────────────────────────
// 세무조정은 귀속연도가 고정된 재계약형이라 해마다 새로 등록해야 한다. 전년 계약을 띄워
// 체크한 것만 올해 귀속으로 복제한다(올해 세무조정을 안 하는 거래처는 체크를 빼면 된다).
function RenewTaxPanel({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const thisYear = settlementYearOfDate(todayYmd()) ?? new Date().getFullYear();
  const [toYear, setToYear] = useState(thisYear);
  const [rows, setRows] = useState<RenewCandidate[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRows(null); setErr(null);
    listRenewableTaxContracts(toYear - 1, toYear)
      .then((r) => {
        setRows(r);
        // 기본 선택: 아직 갱신 안 됐고 **갱신해도 되는** 건(정상·폐업).
        // 폐업도 넣는다 — 청산이 아닌 이상 폐업 연도 신고는 우리가 한다.
        setPick(new Set(r.filter((x) => !x.alreadyRenewed && !x.blocked).map((x) => x.id)));
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [toYear]);

  const view = useMemo(() => {
    const list = rows ?? [];
    if (!q.trim()) return list;
    const k = q.trim().toLowerCase();
    return list.filter((r) => (r.code + r.companyName + r.cpa + r.taxType).toLowerCase().includes(k));
  }, [rows, q]);

  const target = (rows ?? []).filter((r) => pick.has(r.id) && !r.alreadyRenewed && !r.blocked);
  const blockedCount = (rows ?? []).filter((r) => r.blocked).length;
  const sum = target.reduce((a, r) => a + r.amount, 0);

  async function run() {
    if (!target.length) return;
    if (!confirm(`${target.length}건을 ${toYear}년 귀속 세무조정 계약으로 만듭니다. 진행할까요?`)) return;
    setBusy(true);
    try {
      const n = await renewTaxContracts(target, toYear);
      alert(`✓ ${n}건을 ${toYear}년 귀속으로 갱신했습니다. 세무조정 대상선정에서 가져올 수 있습니다.`);
      await onDone();
    } catch (e) { alert('갱신 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 1000 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <b style={{ color: 'var(--navy)' }}>세무조정 계약 갱신</b>
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)' }}>
            {toYear - 1}년 귀속 계약을
            <select value={toYear} onChange={(e) => setToYear(Number(e.target.value))} style={{ margin: '0 4px', fontWeight: 700 }}>
              {[thisYear + 1, thisYear, thisYear - 1].map((y) => <option key={y} value={y}>{y}년 귀속</option>)}
            </select>
            으로 복제 (정산기간 {toYear}-07 ~ {toYear + 1}-06)
          </span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>

        {err && <div className="alert-w">{err}</div>}
        {!rows && !err && <div style={{ padding: 20, color: 'var(--ink-3)', fontSize: 'var(--fs-2)' }}>불러오는 중…</div>}

        {rows && (
          <>
            <Guide id="contract-renew" label="갱신 규칙 자세히"
              summary={<>
                갱신분은 <b style={{ color: 'var(--warn)' }}>미계약</b> 상태로 만들어집니다.
                {' '}<b>올해 세무조정을 하지 않는 거래처는 체크를 빼세요.</b>
              </>}>
              · 연말이 지나기 전에는 매출확정으로 보지 않기 때문입니다. 체결되면 계약을 열어 '계약 확정'에
              {' '}체크하세요(목록에서 계약상태로 걸러볼 수 있습니다).
              <br />· 계약금액·담당CPA·담당직원을 그대로 이어받습니다. 정우철 담당분은 세무조정수수료관리에서
              {' '}청구를 확정하면 그 금액으로 다시 맞춰집니다.
              <br />· <b>이관·종료</b>한 거래처는 <b>갱신할 수 없습니다</b> — 일이 다른 사무소로 넘어갔거나 거래가 끝났기 때문입니다.
              {blockedCount > 0 && <> 지금 <b>{blockedCount}건</b>이 그렇습니다.</>}
              <br />· <b>폐업</b>은 갱신합니다 — 청산이 아닌 이상 <b>폐업 연도 신고는 우리가 합니다</b>
              {' '}(개인도 본인 계약이 살아 있으면 종합소득세를 우리가 합니다).
              <br />· 이미 갱신된 건도 선택에서 빠져 있습니다.
            </Guide>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' }}>
              <input placeholder="🔍 코드·거래처·담당CPA·유형" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
              <button className="btn-sm" onClick={() => setPick(new Set(view.filter((r) => !r.alreadyRenewed && !r.blocked).map((r) => r.id)))}>보이는 건 전체선택</button>
              <button className="btn-sm" onClick={() => setPick(new Set())}>전체해제</button>
              <span style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)' }}>선택 <b>{target.length}</b>건 · 합계 {won(sum)}</span>
              <button className="btn-p" disabled={busy || target.length === 0} onClick={() => void run()}>
                {busy ? '처리 중…' : `${toYear}년 귀속으로 갱신`}
              </button>
            </div>

            <div style={{ maxHeight: '55vh', overflow: 'auto', border: '1px solid var(--rule)', borderRadius: 6 }}>
              <table className="tbl" style={{ fontSize: 'var(--fs-1)' }}>
                <thead>
                  <tr>
                    <th style={{ width: 32 }}></th>
                    <th>거래처코드</th><th>거래처</th><th>유형</th><th className="r">계약금액</th><th>담당CPA</th><th>사업장</th><th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {view.length === 0 && (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: 20, color: 'var(--ink-4)' }}>
                      {toYear - 1}년 귀속 세무조정 계약이 없습니다.
                    </td></tr>
                  )}
                  {view.map((r) => (
                    <tr key={r.id} style={{ opacity: r.alreadyRenewed || r.blocked ? 0.45 : 1 }}>
                      <td>
                        <input
                          type="checkbox"
                          disabled={r.alreadyRenewed || r.blocked}
                          title={r.blocked ? `${r.placeStatus} 거래처는 갱신하지 않습니다` : undefined}
                          checked={pick.has(r.id)}
                          onChange={() => setPick((prev) => {
                            const n = new Set(prev);
                            if (n.has(r.id)) n.delete(r.id); else n.add(r.id);
                            return n;
                          })}
                        />
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: 'var(--fs-1)' }}>{r.code}</td>
                      <td style={{ fontWeight: 700, color: 'var(--navy)' }}>{r.companyName}</td>
                      <td>{r.taxType}</td>
                      <td className="r">{won(r.amount)}</td>
                      <td>{r.cpa || <span style={{ color: 'var(--ink-4)' }}>—</span>}</td>
                      <td style={{ color: r.blocked ? '#9B3527' : undefined, fontWeight: r.blocked ? 700 : 400 }}>
                        {r.placeStatus}
                      </td>
                      <td>
                        {r.alreadyRenewed ? <span style={{ color: 'var(--ink-3)' }}>이미 갱신됨</span>
                          : r.blocked ? <span style={{ color: '#9B3527' }}>갱신 안 함</span> : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
