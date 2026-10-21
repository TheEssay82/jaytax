// 팀결산시스템 › 기장배분 — **셈법만** 모은 곳(supabase 를 물지 않는다, 시험이 돌아야 하므로).
//
// 원본: 조현규 결산 엑셀 「3. 기장_세무배분안(연도)」(사용자 2026-10-19). 원본의 실수 넷은 고쳐서 옮겼다(사용자 확정):
//   ① 기말 미수금이 한 칸 밀려 조현규가 김준성 값을 썼다  ② 미수금에 VAT 포함·제외가 섞였다 → 미수금은 모두 VAT 제외
//   ③ 안분미대상 자문을 김준성만 뺐다 → 모두 뺀다  ④ 이 파일에 없는 옛 시트를 가리키던 칸 → 그 해 값
// 기본분담분(월 10만원×4) 표는 이제 쓰지 않는다(사용자).

export const CPAS = ['조현규', '김준성', '정우철'] as const;
export type Cpa = typeof CPAS[number];
export type CellState = '작년값' | '추정' | '확정';
export const STATES: CellState[] = ['작년값', '추정', '확정'];

/** 비용 항목 — 원본 13~26행 순서. perStaff 는 직원마다 한 칸, 아니면 한 칸. */
export const COST_ITEMS: { key: string; perStaff: boolean; hint?: string }[] = [
  { key: '1) 급여+상여', perStaff: true },
  { key: '2) 별도상여', perStaff: true },
  { key: '3) 퇴직급여', perStaff: true },
  { key: '4) 복리후생비(4대보험)', perStaff: true, hint: '법인부담분' },
  { key: '5) 임대료 등', perStaff: false, hint: '관리비및임차료 × 기장팀 인원 비율' },
  { key: '6) 자산구입', perStaff: false },
  { key: '7) 법인/개인카드(기장분)', perStaff: false, hint: '기장팀 직원 카드' },
  { key: '8) 법인카드(정우철/송현주)', perStaff: false, hint: '경비귀속처리 「기장」 업무 금액' },
  { key: '9) 기타', perStaff: false },
  { key: '10) 기장팀 경비 등', perStaff: false },
  { key: '11) 내일채움공제', perStaff: false },
  { key: '12) 퇴직연금수수료', perStaff: false },
  { key: '13) 현금시재', perStaff: false },
];
export const EXPENSE_ITEM = '8) 법인카드(정우철/송현주)';

/** 기장팀 직원 — 2025.07~ 정남지·김민섭·김동주(안지연 퇴사, 사용자 2026-10-19). 지난 해 줄에 다른 이름이 있으면 그대로 보인다. */
export const BK_STAFF = ['정남지', '김민섭', '김동주'];

export interface Settle { fy: number; status: '예상' | '확정'; fixed_share: number; common_rate: number; note: string | null }
export interface CostCell { item: string; staff: string; amount: number; state: CellState; source: string | null; memo: string | null }
export const CPA_FIELDS = ['bk_fee', 'tax_bk', 'tax_self', 'advisory_excl', 'ar_open', 'ar_close', 'writeoff'] as const;
export type CpaField = typeof CPA_FIELDS[number];
export const CPA_FIELD_LABEL: Record<CpaField, string> = {
  bk_fee: '기장료 입금', tax_bk: '기장수행 세무조정', tax_self: '자가 세무조정', advisory_excl: '안분미대상 자문',
  ar_open: '기초 미수금', ar_close: '기말 미수금', writeoff: '당기 대손',
};
/** VAT 포함으로 적는 칸(입금) / 제외로 적는 칸(미수금·대손). */
export const VAT_INCLUDED: Record<CpaField, boolean> = {
  bk_fee: true, tax_bk: true, tax_self: true, advisory_excl: true, ar_open: false, ar_close: false, writeoff: false,
};
export type CpaRow = { cpa: Cpa; states: Partial<Record<CpaField, CellState>>; sources: Partial<Record<CpaField, string>>; memo: string | null } & Record<CpaField, number>;

export interface CpaResult {
  cpa: Cpa;
  /** 비율의 바탕(VAT 제외) = (기장료 + 기장수행 세무조정 − 자문)/1.1 + (기말 − 기초 + 대손). */
  base: number;
  arChange: number;
  ratio: number;
  /** 비율부담금. */
  share: number;
  fixed: number;
  /** 회수금액(VAT 포함) = 기장료 + 기장수행 세무조정 + 자가 세무조정. */
  collected: number;
  vat: number;
  sales: number;
  common: number;
  target: number;
  /** 받을 금액 = 배분대상 − 정액 − 비율부담. */
  receive: number;
  /** 요약 — 기장 관련 수익(base) − 기장 관련 비용(정액+비율) − 공통비(수익 × 공통비율). */
  profit: number;
}
export interface SettleResult { costTotal: number; fixedTotal: number; allocTarget: number; baseTotal: number; rows: CpaResult[] }

export interface SettleBundle { settle: Settle; cpas: CpaRow[]; costs: CostCell[] }

export const sumCosts = (costs: CostCell[]) => costs.reduce((s, c) => s + (Number(c.amount) || 0), 0);

export function computeSettle(s: Pick<Settle, 'fixed_share' | 'common_rate'>, cpas: CpaRow[], costs: CostCell[]): SettleResult {
  const costTotal = sumCosts(costs);
  const rows0 = CPAS.map((cpa) => {
    const r = cpas.find((x) => x.cpa === cpa);
    const v = (k: CpaField) => Number(r?.[k] ?? 0);
    const arChange = v('ar_close') - v('ar_open') + v('writeoff');
    const base = (v('bk_fee') + v('tax_bk') - v('advisory_excl')) / 1.1 + arChange;
    const collected = v('bk_fee') + v('tax_bk') + v('tax_self');
    return { cpa, base, arChange, collected };
  });
  const baseTotal = rows0.reduce((a, r) => a + r.base, 0);
  const fixedTotal = s.fixed_share * CPAS.length;
  const allocTarget = costTotal - fixedTotal;
  const rows: CpaResult[] = rows0.map((r) => {
    const ratio = baseTotal ? r.base / baseTotal : 0;
    const share = allocTarget * ratio;
    // 원본 그대로: 부가세 = ROUND(D×0.1/1.1), 공통비 = TRUNC(매출×율).
    const vat = Math.round((r.collected * 0.1) / 1.1);
    const sales = r.collected - vat;
    const common = Math.trunc(sales * s.common_rate);
    const target = sales - common;
    const receive = target - s.fixed_share - share;
    const profit = r.base - (share + s.fixed_share) - r.base * s.common_rate;
    return { ...r, ratio, share, fixed: s.fixed_share, vat, sales, common, target, receive, profit };
  });
  return { costTotal, fixedTotal, allocTarget, baseTotal, rows };
}

/** 새 해 예상안 — 지난해 값을 「작년값」으로 가져온다. 미수금 기초는 지난해 기말(확정). 앱에 있는 값은 덮어쓰기 함수가 따로 얹는다. */
export function rollCpa(prev: CpaRow[]): CpaRow[] {
  return CPAS.map((cpa) => {
    const p = prev.find((x) => x.cpa === cpa);
    const row = { cpa, states: {}, sources: {}, memo: null } as unknown as CpaRow;
    for (const k of CPA_FIELDS) {
      row[k] = k === 'ar_open' ? Number(p?.ar_close ?? 0) : k === 'writeoff' || k === 'ar_close' ? 0 : Number(p?.[k] ?? 0);
      row.states[k] = k === 'ar_open' ? '확정' : '작년값';
      row.sources[k] = k === 'ar_open' ? '지난해 기말 미수금' : '지난해 값';
    }
    return row;
  });
}

export function rollCosts(prev: CostCell[]): CostCell[] {
  // 사람별 줄은 지금 직원으로만 가져온다(퇴사자 줄은 버린다) — 인건비 계획이 따로 얹힌다.
  return prev.filter((c) => !c.staff || BK_STAFF.includes(c.staff))
    .map((c) => ({ ...c, state: '작년값' as const, source: '지난해 값', memo: null }));
}

// ── ERP 실제 발생분 → 비용 항목 ─────────────────────────────────────────────────
// 결산 엑셀의 항목과 ERP 부서별원장(기장24팀) 계정을 잇는다(2026-10-21, FY2026 원장으로 대 봄 — 급여·퇴직급여·내일채움·퇴직연금수수료는 원 단위까지 같다).
//   · 7) 카드·경비 = 복리후생비 · 여비교통비 · 통신비 · 도서인쇄비 · 소모품비 · 운반비 · 교육훈련비 — 엑셀 「법인개인카드지급(기장팀)」과 거의 같다.
//   · 8) 정우철/송현주 카드는 기장24팀 원장에 없다(경비귀속처리 「기장」). 13) 현금시재도 원장에 없다.
//   · 그 밖(주민세 종업원분 · 인지세 · 잡급 · CMS · 텍스넷 · 등기 · 감가상각비)은 9) 기타 — 엑셀에는 없는 돈이라 차이로 드러난다.
export interface ErpCostRow { acct: string; sub: string; staff: string; amount: number; n: number; lines: { slip: string; sum: string; amount: number }[] }

export function erpCostItem(acct: string, sub: string): string {
  if (acct === '직원급여' || acct === '상여금') return '1) 급여+상여';
  if (acct === '퇴직급여') return '3) 퇴직급여';
  if (acct === '세금과공과금' && sub.startsWith('4대보험')) return '4) 복리후생비(4대보험)';
  if (acct === '지급임차료') return '5) 임대료 등';
  if (sub === '자산(노트북 등)') return '6) 자산구입';
  if (sub === '내일채움공제') return '11) 내일채움공제';
  if (sub === '퇴직연금수수료') return '12) 퇴직연금수수료';
  if (/^(복리후생비|여비교통비|통신비|도서인쇄비|소모품비|운반비|교육훈련비)$/.test(acct)) return '7) 법인/개인카드(기장분)';
  return '9) 기타';
}

/** 항목(직원별 항목은 직원까지)마다 ERP 발생 합계. 키 = `항목|직원`(직원 안 나누는 항목은 `항목|`). */
export function erpCostByCell(rows: ErpCostRow[]): Map<string, number> {
  const per = new Map(COST_ITEMS.map((it) => [it.key, it.perStaff]));
  const m = new Map<string, number>();
  for (const r of rows) {
    const item = erpCostItem(r.acct, r.sub);
    const k = `${item}|${per.get(item) ? r.staff : ''}`;
    m.set(k, (m.get(k) ?? 0) + r.amount);
  }
  return m;
}
