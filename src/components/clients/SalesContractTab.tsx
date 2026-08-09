// 거래처관리 › 매출계약등록 (거래처관리 2.0.0 · step 2)
// 매출유형 트리 선택(cascade) + leaf 플래그 조건입력 + 발생/청구단위 + 청구주기·분할 + 담당 + 날짜 + 무료/할인.
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { listBizEntities, corpDisplayName, type BizEntityFull } from '../../lib/bizRegistryApi';
import {
  TAXONOMY, findNode, isLeaf, leafOf, pathLabel, type Team, type TaxNode,
} from '../../lib/salesContractTaxonomy';
import {
  listSalesContracts, createSalesContract, updateSalesContract, deleteSalesContract,
  saveInstallments, saveDiscounts, saveContractStaff, listContractStaffProfiles,
  staffCandidatesForTeam, BILLING_CYCLES, CPA_LIST,
  type SalesContract, type ContractInput, type Installment, type Discount,
  type OccurrenceUnit, type BillingUnit, type BillingCycle, type AdvisoryType, type StaffProfileLite,
} from '../../lib/salesContractApi';

const won = (n: number) => n.toLocaleString('ko-KR');
// 연환산 계수(청구주기→연 횟수). 월환산 = 연환산/12.
const CYCLE_ANN: Record<string, number> = { '월': 12, '분기': 4, '반기': 2, '연': 1, '발생시': 1, '건': 1 };
const annualize = (c: SalesContract) => c.amount * (CYCLE_ANN[c.billingCycle] ?? 1);
// 집계(피봇) 기준
const GROUP_OPTS: { key: string; label: string }[] = [
  { key: 'team', label: '팀' }, { key: 'type', label: '매출유형' }, { key: 'cpa', label: '담당CPA' },
  { key: 'staff', label: '담당직원' }, { key: 'cycle', label: '청구주기' }, { key: 'year', label: '귀속연도' },
];
function groupKeyOf(g: string, c: SalesContract): string {
  switch (g) {
    case 'team': return c.team;
    case 'type': return pathLabel(c.categoryCode);
    case 'cpa': return c.cpa || '(미지정)';
    case 'staff': return c.staff.map((s) => s.staffName).join(',') || '(미지정)';
    case 'cycle': return c.billingCycle;
    case 'year': return c.fiscalYear ? String(c.fiscalYear) : '(없음)';
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
  fiscalYear: string; billingCycle: BillingCycle; isInstallment: boolean; amount: string;
  cpa: string; staffIds: string[];
  contractDate: string; startDate: string; endDate: string;
  parentContractId: string; note: string;
  installments: Installment[]; discounts: Discount[];
}
const emptyForm = (): FormState => ({
  entityId: '', placeId: '', team: '감사team', categoryCode: '', categoryEtcName: '',
  includesVat: false, includesWht: false, advisoryType: '', occurrenceUnit: '사업장', billingUnit: '',
  fiscalYear: '', billingCycle: '월', isInstallment: false, amount: '', cpa: '', staffIds: [],
  contractDate: '', startDate: '', endDate: '', parentContractId: '', note: '', installments: [], discounts: [],
});

export default function SalesContractTab() {
  const { readonly } = useAuth();
  const canWrite = !readonly;
  const [entities, setEntities] = useState<BizEntityFull[]>([]);
  const [staff, setStaff] = useState<StaffProfileLite[]>([]);
  const [contracts, setContracts] = useState<SalesContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [teamFilter, setTeamFilter] = useState<'' | Team>('');
  const [q, setQ] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'box' | 'table'>('box');
  const [colF, setColF] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [groupBy, setGroupBy] = useState<string>('');   // 피봇 행 기준
  const [groupBy2, setGroupBy2] = useState<string>(''); // 피봇 열 기준(교차표)
  const [measure, setMeasure] = useState<'mon' | 'amt' | 'ann' | 'cnt'>('mon'); // 값

  async function load() {
    try {
      setError(null);
      const [ents, stf, cons] = await Promise.all([listBizEntities(), listContractStaffProfiles(), listSalesContracts()]);
      setEntities(ents); setStaff(stf); setContracts(cons);
    } catch (e) { setError(e instanceof Error ? e.message : '불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(''), 2500); }

  const entMap = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const entName = (id: string) => { const e = entMap.get(id); return e ? `${e.code} ${corpDisplayName(e.name, e.corpForm, e.corpFormPosition)}` : '(삭제됨)'; };
  const placeName = (eid: string, pid: string | null) => { if (!pid) return ''; const e = entMap.get(eid); return e?.places.find((p) => p.id === pid)?.placeName ?? ''; };

  // 표(list)형 컬럼 정의 — 각 컬럼 val 로 필터·표시
  const COLUMNS: { key: string; label: string; val: (c: SalesContract) => string; w?: number; num?: boolean }[] = [
    { key: 'code', label: '코드', val: (c) => entMap.get(c.entityId)?.code ?? '', w: 56 },
    { key: 'name', label: '거래처', val: (c) => { const e = entMap.get(c.entityId); return e ? corpDisplayName(e.name, e.corpForm, e.corpFormPosition) : ''; }, w: 150 },
    { key: 'team', label: '팀', val: (c) => c.team, w: 66 },
    { key: 'type', label: '매출유형', val: (c) => pathLabel(c.categoryCode) + (c.categoryEtcName ? ` (${c.categoryEtcName})` : ''), w: 200 },
    { key: 'occ', label: '발생단위', val: (c) => c.occurrenceUnit + (c.placeId ? `/${placeName(c.entityId, c.placeId)}` : ''), w: 100 },
    { key: 'cycle', label: '주기', val: (c) => c.billingCycle + (c.isInstallment ? '·분할' : ''), w: 66 },
    { key: 'bunit', label: '청구단위', val: (c) => c.billingUnit ?? '', w: 70 },
    { key: 'amount', label: '계약금액', val: (c) => won(c.amount), w: 90, num: true },
    { key: 'year', label: '귀속', val: (c) => (c.fiscalYear ? String(c.fiscalYear) : ''), w: 56 },
    { key: 'cpa', label: 'CPA', val: (c) => c.cpa, w: 66 },
    { key: 'staff', label: '담당직원', val: (c) => c.staff.map((s) => s.staffName).join(','), w: 100 },
    { key: 'period', label: '개시~종료', val: (c) => `${dateToMonth(c.startDate) || ''}~${dateToMonth(c.endDate) || '계속'}`, w: 130 },
    { key: 'cdate', label: '계약일', val: (c) => c.contractDate ?? '', w: 90 },
    { key: 'note', label: '비고', val: (c) => c.note, w: 120 },
  ];
  const tableRows = useMemo(() => contracts.filter((c) => COLUMNS.every((col) => {
    const fv = (colF[col.key] || '').trim().toLowerCase();
    return !fv || col.val(c).toLowerCase().includes(fv);
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
  // 집계(피봇) — groupBy 기준 부분합
  const pivot = useMemo(() => {
    if (!groupBy) return [];
    const m = new Map<string, { key: string; cnt: number; amt: number; ann: number }>();
    for (const c of sortedRows) {
      const k = groupKeyOf(groupBy, c);
      const g = m.get(k) ?? { key: k, cnt: 0, amt: 0, ann: 0 };
      g.cnt++; g.amt += c.amount; g.ann += annualize(c); m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.ann - a.ann);
  }, [sortedRows, groupBy]);
  // 교차표(피봇) — 행(groupBy) × 열(groupBy2), 모든 조합 표시
  type Agg = { amt: number; ann: number; cnt: number };
  const matrix = useMemo(() => {
    if (!groupBy || !groupBy2) return null;
    const add = (a: Agg, c: SalesContract) => { a.amt += c.amount; a.ann += annualize(c); a.cnt++; };
    const cells = new Map<string, Agg>(), rowTot = new Map<string, Agg>(), colTot = new Map<string, Agg>();
    const grand: Agg = { amt: 0, ann: 0, cnt: 0 };
    const get = (m: Map<string, Agg>, k: string) => { let v = m.get(k); if (!v) { v = { amt: 0, ann: 0, cnt: 0 }; m.set(k, v); } return v; };
    for (const c of sortedRows) {
      const r = groupKeyOf(groupBy, c), col = groupKeyOf(groupBy2, c);
      add(get(cells, `${r}\0${col}`), c); add(get(rowTot, r), c); add(get(colTot, col), c); add(grand, c);
    }
    const rowKeys = [...rowTot.keys()].sort((a, b) => rowTot.get(b)!.ann - rowTot.get(a)!.ann);
    const colKeys = [...colTot.keys()].sort((a, b) => colTot.get(b)!.ann - colTot.get(a)!.ann);
    return { rowKeys, colKeys, cells, rowTot, colTot, grand };
  }, [sortedRows, groupBy, groupBy2]);
  // 값(measure) 계산·표시
  const mval = (a?: Agg) => !a ? 0 : measure === 'amt' ? a.amt : measure === 'ann' ? a.ann : measure === 'cnt' ? a.cnt : Math.round(a.ann / 12);
  const mfmt = (n: number) => (measure === 'cnt' ? String(n) : won(n));
  const measLabel = ({ mon: '월환산', amt: '계약금액', ann: '연환산', cnt: '건수' } as Record<string, string>)[measure];

  const view = useMemo(() => {
    let list = contracts;
    if (teamFilter) list = list.filter((c) => c.team === teamFilter);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter((c) => entName(c.entityId).toLowerCase().includes(s) || pathLabel(c.categoryCode).toLowerCase().includes(s) || (c.cpa || '').toLowerCase().includes(s));
    }
    return list;
  }, [contracts, teamFilter, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const total = contracts.length;
    const aud = contracts.filter((c) => c.team === '감사team').length;
    const tax = contracts.filter((c) => c.team === 'taxteam').length;
    return { total, aud, tax };
  }, [contracts]);

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
      amount: form.amount ? Number(form.amount.replace(/,/g, '')) : 0, cpa: form.cpa.trim(),
      contractDate: form.contractDate || null, startDate: monthToDate(form.startDate), endDate: monthToDate(form.endDate),
      note: form.note.trim(),
    };
    try {
      const id = existingId ? (await updateSalesContract(existingId, input), existingId) : await createSalesContract(input);
      // 빈 줄은 저장하지 않는다(내용 없는 분할·무료/할인 제외)
      const insts = form.isInstallment ? form.installments.filter((x) => x.label.trim() || x.amount) : [];
      const discs = form.discounts.filter((d) => d.startDate || d.endDate || d.rate != null || d.amount != null || (d.note && d.note.trim()));
      await saveInstallments(id, insts);
      await saveDiscounts(id, discs);
      await saveContractStaff(id, form.staffIds.map((sid) => ({ staffId: sid, staffName: staff.find((s) => s.id === sid)?.name ?? '' })));
      setShowAdd(false); setEditId(null); await load();
      flash(existingId ? '✓ 매출계약 수정됨' : '✓ 매출계약 등록됨');
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
        <span style={{ fontSize: 11, fontWeight: 400, color: '#888' }}>총 {stats.total} · 감사 {stats.aud} · tax {stats.tax}</span>
        {msg && <span style={{ marginLeft: 'auto', fontSize: 12, color: '#2a7' }}>{msg}</span>}
      </div>
      {error && <div style={{ color: '#c33', fontSize: 12, marginBottom: 8 }}>{error}</div>}

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
        {viewMode === 'table' && <span style={{ fontSize: 11, color: '#888' }}>각 컬럼 아래 칸에 입력해 필터 ({tableRows.length}건)</span>}
        {viewMode === 'table' && (
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
              <select value={measure} onChange={(e) => setMeasure(e.target.value as 'mon' | 'amt' | 'ann' | 'cnt')} style={selStyle} title="값">
                <option value="mon">값: 월환산</option>
                <option value="amt">값: 계약금액</option>
                <option value="ann">값: 연환산</option>
                <option value="cnt">값: 건수</option>
              </select>
            )}
          </span>
        )}
        {viewMode === 'table' && Object.keys(colF).length > 0 && <button className="btn-sm" onClick={() => setColF({})}>필터 초기화</button>}
        {canWrite && <button className="btn-p" onClick={() => { setShowAdd((s) => !s); setEditId(null); }}>{showAdd ? '닫기' : '＋ 신규 매출계약'}</button>}
      </div>

      {showAdd && canWrite && (
        <ContractForm entities={entities} staff={staff} contracts={contracts} onSubmit={(f) => persist(f)} onCancel={() => setShowAdd(false)} />
      )}

      {viewMode === 'box' && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {view.length === 0 && <div style={{ color: '#999', fontSize: 12, padding: 12 }}>매출계약이 없습니다.</div>}
        {view.map((c) => {
          const leaf = leafOf(c.categoryCode);
          return (
            <div key={c.id} style={{ border: '1px solid #e6e0d8', borderRadius: 6, padding: '8px 10px', marginLeft: c.parentContractId ? 24 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {c.parentContractId && <span style={{ fontSize: 10, color: '#a80' }}>↳종속</span>}
                <span style={teamBadge(c.team)}>{c.team}</span>
                <b style={{ fontSize: 12.5 }}>{entName(c.entityId)}</b>
                {c.placeId && <span style={{ fontSize: 11, color: '#777' }}>· {placeName(c.entityId, c.placeId)}</span>}
                <span style={{ fontSize: 11.5, color: '#456' }}>{pathLabel(c.categoryCode)}{c.categoryEtcName && ` (${c.categoryEtcName})`}</span>
                {leaf?.jangbuOptions && (c.includesVat || c.includesWht) && <span style={{ fontSize: 10.5, color: '#a66' }}>{[c.includesVat && '부가', c.includesWht && '원천'].filter(Boolean).join('·')} 포함</span>}
                {c.advisoryType && <span style={{ fontSize: 10.5, color: '#a66' }}>{c.advisoryType}</span>}
                <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: '#245' }}>{won(c.amount)}원</span>
                <span style={{ fontSize: 10.5, color: '#888' }}>/{c.billingCycle}{c.isInstallment ? '·분할' : ''}</span>
              </div>
              <div style={{ fontSize: 11, color: '#777', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span>발생 {c.occurrenceUnit}</span>
                {c.billingUnit && <span>청구단위 {c.billingUnit}</span>}
                {c.fiscalYear && <span>귀속 {c.fiscalYear}</span>}
                {c.cpa && <span>CPA {c.cpa}</span>}
                {c.staff.length > 0 && <span>담당 {c.staff.map((s) => s.staffName).join('·')}</span>}
                <span>{dateToMonth(c.startDate) || '개시?'} ~ {dateToMonth(c.endDate) || '계속'}</span>
                {c.contractDate && <span>계약일 {c.contractDate}</span>}
                {c.installments.length > 0 && <span style={{ color: '#a60' }}>분할 {c.installments.length}회</span>}
                {c.discounts.length > 0 && <span style={{ color: '#c80' }}>무료/할인 {c.discounts.length}건</span>}
                {c.note && <span style={{ color: '#999' }}>· {c.note}</span>}
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
        {groupBy && !groupBy2 && (
          <div style={{ overflowX: 'auto', border: '1px solid #d8cfa0', borderRadius: 6, marginBottom: 8, background: '#fbf8ef' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 520 }}>
              <thead><tr style={{ background: '#f0e9d2' }}>
                <th style={thc}>{GROUP_OPTS.find((g) => g.key === groupBy)?.label}별</th>
                <th style={{ ...thc, textAlign: 'right' }}>건수</th>
                <th style={{ ...thc, textAlign: 'right' }}>계약금액 합계</th>
                <th style={{ ...thc, textAlign: 'right' }}>월환산 합계</th>
                <th style={{ ...thc, textAlign: 'right' }}>연환산 합계</th>
              </tr></thead>
              <tbody>
                {pivot.map((g) => (
                  <tr key={g.key} style={{ borderTop: '1px solid #eadfbf' }}>
                    <td style={{ ...tdc, fontWeight: 600 }}>{g.key}</td>
                    <td style={{ ...tdc, textAlign: 'right' }}>{g.cnt}</td>
                    <td style={{ ...tdc, textAlign: 'right' }}>{won(g.amt)}</td>
                    <td style={{ ...tdc, textAlign: 'right' }}>{won(Math.round(g.ann / 12))}</td>
                    <td style={{ ...tdc, textAlign: 'right' }}>{won(g.ann)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ borderTop: '2px solid #c9a54a', background: '#f5efdd', fontWeight: 700 }}>
                <td style={tdc}>총계</td>
                <td style={{ ...tdc, textAlign: 'right' }}>{summary.cnt}</td>
                <td style={{ ...tdc, textAlign: 'right' }}>{won(summary.amt)}</td>
                <td style={{ ...tdc, textAlign: 'right' }}>{won(summary.mon)}</td>
                <td style={{ ...tdc, textAlign: 'right' }}>{won(summary.ann)}</td>
              </tr></tfoot>
            </table>
          </div>
        )}
        {matrix && (
          <div style={{ overflowX: 'auto', border: '1px solid #d8cfa0', borderRadius: 6, marginBottom: 8, background: '#fbf8ef' }}>
            <div style={{ fontSize: 11, color: '#846', padding: '5px 8px' }}>
              📊 <b>{GROUP_OPTS.find((g) => g.key === groupBy)?.label}</b>(행) × <b>{GROUP_OPTS.find((g) => g.key === groupBy2)?.label}</b>(열) · 값: <b>{measLabel}</b> · 필터 반영
            </div>
            <table style={{ borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead><tr style={{ background: '#f0e9d2' }}>
                <th style={{ ...thc, position: 'sticky', left: 0, background: '#f0e9d2' }}>{GROUP_OPTS.find((g) => g.key === groupBy)?.label} \ {GROUP_OPTS.find((g) => g.key === groupBy2)?.label}</th>
                {matrix.colKeys.map((ck) => <th key={ck} style={{ ...thc, textAlign: 'right' }}>{ck}</th>)}
                <th style={{ ...thc, textAlign: 'right', borderLeft: '2px solid #c9a54a' }}>합계</th>
              </tr></thead>
              <tbody>
                {matrix.rowKeys.map((rk) => (
                  <tr key={rk} style={{ borderTop: '1px solid #eadfbf' }}>
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
        <div style={{ overflowX: 'auto', border: '1px solid #eee', borderRadius: 6 }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11.5, minWidth: 1100 }}>
            <thead>
              <tr style={{ background: '#f4efe4' }}>
                {COLUMNS.map((col) => (
                  <th key={col.key} style={{ ...thc, minWidth: col.w, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort(col.key)} title="클릭: 오름/내림/해제">
                    {col.label}{sort?.key === col.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                  </th>
                ))}
                {canWrite && <th style={thc}></th>}
              </tr>
              <tr style={{ background: '#faf7f0' }}>
                {COLUMNS.map((col) => (
                  <th key={col.key} style={{ padding: 2 }}>
                    <input value={colF[col.key] || ''} onChange={(e) => setColF((p) => ({ ...p, [col.key]: e.target.value }))} placeholder="필터" style={{ width: '100%', fontSize: 10.5, padding: '2px 4px', boxSizing: 'border-box' }} />
                  </th>
                ))}
                {canWrite && <th style={{ padding: 2 }}></th>}
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 && <tr><td colSpan={COLUMNS.length + 1} style={{ ...tdc, color: '#999', padding: 12 }}>조건에 맞는 매출계약이 없습니다.</td></tr>}
              {sortedRows.map((c) => (
                <tr key={c.id} style={{ borderTop: '1px solid #eee' }}>
                  {COLUMNS.map((col) => <td key={col.key} style={{ ...tdc, textAlign: col.num ? 'right' : 'left', fontWeight: col.key === 'name' ? 600 : 400 }}>{col.val(c)}</td>)}
                  {canWrite && (
                    <td style={tdc}>
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
              <tr style={{ borderTop: '2px solid #c9a54a', background: '#f5efdd', fontWeight: 700 }}>
                {COLUMNS.map((col) => {
                  if (col.key === 'code') return <td key={col.key} style={{ ...tdc, whiteSpace: 'nowrap' }}>합계 {summary.cnt}건</td>;
                  if (col.key === 'name') return <td key={col.key} style={tdc}>월환산 {won(summary.mon)} · 연환산 {won(summary.ann)}</td>;
                  if (col.key === 'amount') return <td key={col.key} style={{ ...tdc, textAlign: 'right' }}>{won(summary.amt)}</td>;
                  return <td key={col.key} style={tdc}></td>;
                })}
                {canWrite && <td style={tdc}></td>}
              </tr>
            </tfoot>
          </table>
        </div>
        </>
      )}
    </div>
  );
}

const thc: React.CSSProperties = { padding: '5px 6px', textAlign: 'left', fontWeight: 700, color: '#555', whiteSpace: 'nowrap' };
const tdc: React.CSSProperties = { padding: '4px 6px', whiteSpace: 'nowrap' };

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
    setF((p) => ({ ...p, categoryCode: code, ...(lf?.defaultUnit ? { occurrenceUnit: lf.defaultUnit } : {}) }));
  }
  function pickPlace(pid: string) {
    const pl = entity?.places.find((x) => x.id === pid);
    setF((p) => ({ ...p, placeId: pid, cpa: p.cpa || pl?.cpa || '' }));
  }
  // 계약일(일단위) → 개시월 자동(비었을 때)
  function pickContractDate(v: string) {
    setF((p) => ({ ...p, contractDate: v, startDate: p.startDate || v.slice(0, 7) }));
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
      <div style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 8 }}>{initial ? '✏️ 매출계약 수정' : '＋ 새 매출계약'}</div>

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
      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#345', margin: '10px 0 4px' }}>· 매출유형</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['감사team', 'taxteam'] as Team[]).map((t) => (
          <button key={t} type="button" onClick={() => setF((p) => ({ ...p, team: t, categoryCode: '' }))} className={f.team === t ? 'btn-p' : 'btn-sm'}>{t}</button>
        ))}
        <TaxonomyPicker team={f.team} code={f.categoryCode} onPick={pickCategory} />
      </div>
      {leaf && <div style={{ fontSize: 11, color: '#2a6', marginTop: 3 }}>선택: {pathLabel(f.categoryCode)}</div>}

      {/* leaf 플래그 조건입력 */}
      {leaf?.needsEtcName && (
        <div className="frow" style={{ marginTop: 6 }}><span className="fl">신고대상명칭<span className="req">*</span></span>
          <input value={f.categoryEtcName} onChange={(e) => set('categoryEtcName', e.target.value)} placeholder="기타 항목 명칭 입력" /></div>
      )}
      {leaf?.jangbuOptions && (
        <div className="frow" style={{ marginTop: 6 }}><span className="fl">기장 포함</span>
          <span style={{ display: 'flex', gap: 12 }}>
            <label style={{ fontSize: 11.5, display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={f.includesVat} onChange={(e) => set('includesVat', e.target.checked)} /> 부가가치세</label>
            <label style={{ fontSize: 11.5, display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={f.includesWht} onChange={(e) => set('includesWht', e.target.checked)} /> 원천세</label>
          </span></div>
      )}
      {leaf?.advisoryType && (
        <div className="frow" style={{ marginTop: 6 }}><span className="fl">자문구분</span>
          <span style={{ display: 'flex', gap: 12 }}>
            {(['일반', '전문'] as AdvisoryType[]).map((a) => (
              <label key={a} style={{ fontSize: 11.5, display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="radio" name="adv" checked={f.advisoryType === a} onChange={() => set('advisoryType', a)} /> {a}자문{a === '전문' ? '(letter)' : ''}
              </label>
            ))}
          </span></div>
      )}
      {leaf?.filingAgentEligible && (
        <div style={{ fontSize: 10.5, color: '#a80', marginTop: 4 }}>※ 기장 없이 이 신고만 하면 '신고대리'입니다.</div>
      )}
      {leaf?.linksConfirmation && (
        <div style={{ fontSize: 10.5, color: '#47a', marginTop: 4 }}>※ 회계감사 계약은 조회서발송관리에서 발송대상으로 참조됩니다.</div>
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
        <div className="frow"><span className="fl">{f.isInstallment ? '계약금액(총액)' : '계약금액'} <span style={{ fontSize: 10, color: '#a55' }}>VAT별도</span></span>
          <input value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder={f.billingCycle === '월' ? '월 금액 (예: 150000)' : f.billingCycle === '건' ? '건당 금액' : '1회 금액'} /></div>
        <div className="frow"><span className="fl">귀속연도</span>
          <>
            <input value={f.fiscalYear} onChange={(e) => pickYear(e.target.value)} placeholder="연단위 신고만 (예: 2025)" maxLength={4} />
          </></div>
        {canInstallment && (
          <div className="frow"><span className="fl">분할청구</span>
            <label style={{ fontSize: 11.5, display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={f.isInstallment} onChange={(e) => set('isInstallment', e.target.checked)} /> 계약금/중도금/잔금 분할
            </label></div>
        )}
      </div>
      <div style={{ fontSize: 10.5, color: '#999', marginTop: 2 }}>※ 귀속연도는 <b>연단위 신고</b>(법인세·소득세 등)만 기재 — 월 기장 등은 비워둡니다. 청구주기가 '연'이면 개시·종료월이 귀속연도 1~12월로 자동 설정됩니다.</div>

      {f.isInstallment && <InstallmentsEditor rows={f.installments} onChange={(r) => set('installments', r)} sum={instSum} target={amountNum} />}

      {/* 담당 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px', marginTop: 8 }}>
        <div className="frow"><span className="fl">담당CPA</span>
          <>
            <input list="sc-cpa" value={f.cpa} onChange={(e) => set('cpa', e.target.value)} placeholder="거래처 CPA 상속·수정" />
            <datalist id="sc-cpa">{CPA_LIST.map((c) => <option key={c} value={c} />)}</datalist>
          </></div>
        <div className="frow"><span className="fl">담당직원 <span style={{ fontSize: 10, color: '#999' }}>({f.team})</span></span>
          <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {staffCands.map((s) => {
              const on = f.staffIds.includes(s.id);
              return <button key={s.id} type="button" onClick={() => set('staffIds', on ? f.staffIds.filter((x) => x !== s.id) : [...f.staffIds, s.id])} style={chip(on)}>{s.name}</button>;
            })}
            {staffCands.length === 0 && <span style={{ fontSize: 11, color: '#999' }}>후보 계정 없음</span>}
          </span></div>
      </div>

      {/* 날짜: 계약일(일) + 개시·종료(월) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 14px', marginTop: 8 }}>
        <div className="frow"><span className="fl">매출계약일</span>
          <input type="date" value={f.contractDate} onChange={(e) => pickContractDate(e.target.value)} /></div>
        <div className="frow"><span className="fl">매출개시월</span>
          <input type="month" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></div>
        <div className="frow"><span className="fl">종료월(비움=계속)</span>
          <input type="month" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} /></div>
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
      <div style={{ fontSize: 11, fontWeight: 700, color: '#845', marginBottom: 4 }}>분할 회차 (합계 {won(sum)} / 계약금액 {won(target)} {sum === target ? '✓' : '⚠불일치'})</div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 3, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={r.label} onChange={(e) => upd(i, { label: e.target.value })} placeholder="명칭(계약금/중도금1차/잔금)" style={{ width: 160 }} />
          <input value={r.amount ? String(r.amount) : ''} onChange={(e) => upd(i, { amount: Number(e.target.value.replace(/\D/g, '')) })} placeholder="금액" style={{ width: 110 }} />
          <input type="date" value={r.dueDate ?? ''} onChange={(e) => upd(i, { dueDate: e.target.value || null })} />
          <input value={r.conditionNote} onChange={(e) => upd(i, { conditionNote: e.target.value })} placeholder="조건메모(착수 시 등)" style={{ width: 150 }} />
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
      <div style={{ fontSize: 11, fontWeight: 700, color: '#658', marginBottom: 4 }}>무료 / 할인 구간</div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 3, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={r.discType} onChange={(e) => upd(i, { discType: e.target.value as '무료' | '할인' })} style={selStyle}><option>무료</option><option>할인</option></select>
          <input type="date" value={r.startDate ?? ''} onChange={(e) => upd(i, { startDate: e.target.value || null })} />
          <span style={{ fontSize: 11 }}>~</span>
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
    isInstallment: c.isInstallment, amount: c.amount ? String(c.amount) : '', cpa: c.cpa, staffIds: c.staff.map((s) => s.staffId),
    contractDate: c.contractDate ?? '', startDate: dateToMonth(c.startDate), endDate: dateToMonth(c.endDate), parentContractId: c.parentContractId ?? '',
    note: c.note, installments: c.installments.length ? c.installments : [], discounts: c.discounts,
  };
}

const selStyle: React.CSSProperties = { padding: '4px 7px', fontSize: 12 };
const teamBadge = (t: Team): React.CSSProperties => ({ fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 4, color: '#fff', background: t === '감사team' ? '#4a6fa5' : '#7a9a4a' });
const chip = (on: boolean): React.CSSProperties => ({ fontSize: 10.5, padding: '2px 7px', borderRadius: 10, cursor: 'pointer', border: '1px solid', borderColor: on ? '#2a7' : '#ccc', background: on ? '#e3f5ec' : '#fff', color: on ? '#175' : '#888' });
