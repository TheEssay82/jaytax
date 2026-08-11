// 매출계약(biz_sales_contract) + 위성(담당직원·분할·할인) 데이터 접근 레이어. 거래처관리 2.0.0 step2.
import { supabase, assertWrote } from './supabase';
import { typeMnemonic, teamCode, type Team } from './salesContractTaxonomy';

export type OccurrenceUnit = '사업장' | '법인' | '개인';
export type BillingUnit = '사업장' | '법인' | '개인' | '건';
export type BillingCycle = '월' | '분기' | '반기' | '연' | '발생시' | '건';
export type AdvisoryType = '일반' | '전문';
export const BILLING_CYCLES: BillingCycle[] = ['월', '분기', '반기', '연', '발생시', '건'];

// ── 정산연도(귀속연도) 규칙 ──────────────────────────────
// 정산기간(회계연도) = 매년 7/1 ~ 익년 6/30. 어떤 날짜의 정산연도 = 월이 7~12면 그 해, 1~6이면 전년.
// (예: 종료 2027-03 → 2026 귀속 / 종료 2026-11 → 2026 귀속). 날짜는 'YYYY-MM' 또는 'YYYY-MM-DD'.
export function settlementYearOfDate(d: string | null | undefined): number | null {
  if (!d || d.length < 7) return null;
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
  if (!y || !m) return null;
  return m >= 7 ? y : y - 1;
}
// 계약의 귀속(정산)연도: 명시 fiscalYear 우선, 없으면 종료시점에서 도출(일회성 감사·컨설팅·신고).
// 기장 등 계속거래(종료 없음)는 계약 단위 귀속이 없어 null(귀속은 월 청구/발생 단계에서 적용).
export function contractFiscalYear(c: { fiscalYear: number | null; endDate: string | null }): number | null {
  return c.fiscalYear ?? settlementYearOfDate(c.endDate);
}
// 팀별 담당직원 후보(#10) · 담당CPA 후보. 입사·변경 시 여기만 수정.
export const AUDIT_STAFF = ['정우철', '김준성', '조현규', '송현주'] as const;   // 감사team 담당직원=CPA
export const TAX_STAFF = ['정남지', '김민섭', '김동주', '송현주'] as const;      // taxteam 담당직원=기장팀
export const CPA_LIST = ['정우철', '조현규', '김준성', '송현주', '법인(지정)'] as const; // 담당CPA 후보 · '법인(지정)'=지정감사(개인 담당 없이 법인 배정)
export function staffCandidatesForTeam(team: Team): readonly string[] { return team === '감사team' ? AUDIT_STAFF : TAX_STAFF; }

export interface StaffProfileLite { id: string; name: string }
/** 매출계약 담당직원 후보 프로필(감사·기장 관련 이름만). */
export async function listContractStaffProfiles(): Promise<StaffProfileLite[]> {
  const names = Array.from(new Set([...AUDIT_STAFF, ...TAX_STAFF]));
  const { data, error } = await supabase.from('profiles').select('id, name').in('name', names);
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data as any[]).map((r) => ({ id: r.id, name: (r.name || '').trim() }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export interface ContractStaff { id: string; contractId: string; staffId: string; staffName: string; active: boolean }
export interface Installment { id?: string; seq: number; label: string; amount: number; dueDate: string | null; conditionNote: string; billedAt?: string | null }
export interface Discount { id?: string; discType: '무료' | '할인'; startDate: string | null; endDate: string | null; rate: number | null; amount: number | null; note: string }

export interface SalesContract {
  id: string;
  entityId: string;
  placeId: string | null;
  occurrenceUnit: OccurrenceUnit;
  billingUnit: BillingUnit | null;
  team: Team;
  categoryCode: string;
  categoryEtcName: string;
  includesVat: boolean;
  includesWht: boolean;
  advisoryType: AdvisoryType | null;
  parentContractId: string | null;
  fiscalYear: number | null;
  billingCycle: BillingCycle;
  isInstallment: boolean;
  amount: number;
  cpa: string;
  contractDate: string | null;
  startDate: string | null;
  endDate: string | null;
  note: string;
  /** 매출계약코드(자동생성). 거래처-사업장-자동갱신(R/F)-유형-팀-시작연도-순번. */
  contractCode: string;
  /** 복합계약 포함유형(부수) leaf code 목록. 대표 유형(categoryCode)과 별개. */
  includedCodes: string[];
  /** 개시/종료 추정 여부(정보관리 2026-07 이전 등). */
  dateEstimated: boolean;
  staff: ContractStaff[];
  installments: Installment[];
  discounts: Discount[];
  createdAt?: string;
  updatedAt?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const toContract = (r: any): SalesContract => ({
  id: r.id, entityId: r.entity_id, placeId: r.place_id, occurrenceUnit: r.occurrence_unit,
  billingUnit: r.billing_unit, team: r.team, categoryCode: r.category_code, categoryEtcName: r.category_etc_name || '',
  includesVat: !!r.includes_vat, includesWht: !!r.includes_wht, advisoryType: r.advisory_type,
  parentContractId: r.parent_contract_id, fiscalYear: r.fiscal_year, billingCycle: r.billing_cycle,
  isInstallment: !!r.is_installment, amount: r.amount != null ? Number(r.amount) : 0, cpa: r.cpa || '',
  contractDate: r.contract_date, startDate: r.start_date, endDate: r.end_date, note: r.note || '',
  contractCode: r.contract_code || '', includedCodes: r.included_codes || [], dateEstimated: !!r.date_estimated,
  staff: [], installments: [], discounts: [], createdAt: r.created_at, updatedAt: r.updated_at,
});
const toStaff = (r: any): ContractStaff => ({ id: r.id, contractId: r.contract_id, staffId: r.staff_id, staffName: r.staff_name || '', active: !!r.active });
const toInst = (r: any): Installment => ({ id: r.id, seq: r.seq ?? 1, label: r.label || '', amount: r.amount != null ? Number(r.amount) : 0, dueDate: r.due_date, conditionNote: r.condition_note || '', billedAt: r.billed_at ?? null });
const toDisc = (r: any): Discount => ({ id: r.id, discType: r.disc_type, startDate: r.start_date, endDate: r.end_date, rate: r.rate != null ? Number(r.rate) : null, amount: r.amount != null ? Number(r.amount) : null, note: r.note || '' });
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 전체 매출계약 조립 조회. */
export async function listSalesContracts(): Promise<SalesContract[]> {
  const [con, stf, inst, disc] = await Promise.all([
    supabase.from('biz_sales_contract').select('*').order('created_at', { ascending: false }),
    supabase.from('biz_contract_staff').select('*').eq('active', true),
    supabase.from('biz_contract_installment').select('*').order('seq'),
    supabase.from('biz_contract_discount').select('*'),
  ]);
  for (const r of [con, stf, inst, disc]) if (r.error) throw new Error(r.error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const byC = <T,>(rows: any[], map: (r: any) => T & { contractId?: string }, key = 'contract_id') => {
    const m = new Map<string, T[]>();
    for (const raw of rows) { const v = map(raw); (m.get(raw[key]) ?? m.set(raw[key], []).get(raw[key])!).push(v); }
    return m;
  };
  const sM = byC(stf.data as any[], toStaff);
  const iM = byC(inst.data as any[], toInst);
  const dM = byC(disc.data as any[], toDisc);
  return (con.data as any[]).map(toContract).map((c) => ({
    ...c, staff: sM.get(c.id) ?? [], installments: iM.get(c.id) ?? [], discounts: dM.get(c.id) ?? [],
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * 사업장별 '최근 매출계약의 담당직원' — place_id → 담당직원명[].
 * 거래처등록 화면에서 담당직원을 '가장 최근 배정된 계약 담당직원'으로 표시하기 위한 경량 조회.
 * biz_contract_staff.created_at(배정 시각) 최신 배치를 사업장별로 하나 취한다(로그 개념).
 */
export async function listPlaceContractStaff(): Promise<Map<string, string[]>> {
  const [con, stf] = await Promise.all([
    supabase.from('biz_sales_contract').select('id, place_id'),
    supabase.from('biz_contract_staff').select('contract_id, staff_name, created_at').eq('active', true).order('created_at', { ascending: false }),
  ]);
  if (con.error) throw new Error(con.error.message);
  if (stf.error) throw new Error(stf.error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const placeByContract = new Map<string, string>();
  for (const c of con.data as any[]) placeByContract.set(c.id, c.place_id);
  const bestByPlace = new Map<string, string>();     // place_id → 최신 배정 계약 id
  const namesByContract = new Map<string, string[]>();
  for (const s of stf.data as any[]) {                // created_at desc → 사업장별 첫 계약이 최신
    const placeId = placeByContract.get(s.contract_id);
    if (!placeId) continue;
    if (!bestByPlace.has(placeId)) bestByPlace.set(placeId, s.contract_id);
    if (bestByPlace.get(placeId) === s.contract_id && s.staff_name) {
      const arr = namesByContract.get(s.contract_id) ?? [];
      arr.push(s.staff_name);
      namesByContract.set(s.contract_id, arr);
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const result = new Map<string, string[]>();
  for (const [placeId, contractId] of bestByPlace) {
    const names = namesByContract.get(contractId) ?? [];
    if (names.length) result.set(placeId, names);
  }
  return result;
}

export interface ContractInput {
  entityId: string; placeId?: string | null; occurrenceUnit: OccurrenceUnit; billingUnit?: BillingUnit | null;
  team: Team; categoryCode: string; categoryEtcName?: string; includesVat?: boolean; includesWht?: boolean;
  advisoryType?: AdvisoryType | null; parentContractId?: string | null; fiscalYear?: number | null;
  billingCycle: BillingCycle; isInstallment?: boolean; amount: number; cpa?: string;
  contractDate?: string | null; startDate?: string | null; endDate?: string | null; note?: string;
  includedCodes?: string[]; dateEstimated?: boolean;
}
function toRow(c: Partial<ContractInput>): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  const set = (k: string, v: unknown) => { if (v !== undefined) r[k] = v; };
  set('entity_id', c.entityId); set('place_id', c.placeId ?? undefined); set('occurrence_unit', c.occurrenceUnit);
  set('billing_unit', c.billingUnit ?? undefined); set('team', c.team); set('category_code', c.categoryCode);
  set('category_etc_name', c.categoryEtcName); set('includes_vat', c.includesVat); set('includes_wht', c.includesWht);
  set('advisory_type', c.advisoryType ?? undefined); set('parent_contract_id', c.parentContractId ?? undefined);
  set('fiscal_year', c.fiscalYear ?? undefined); set('billing_cycle', c.billingCycle); set('is_installment', c.isInstallment);
  set('amount', c.amount); set('cpa', c.cpa); set('contract_date', c.contractDate ?? undefined);
  set('start_date', c.startDate ?? undefined); set('end_date', c.endDate ?? undefined); set('note', c.note);
  set('included_codes', c.includedCodes); set('date_estimated', c.dateEstimated);
  return r;
}

/** 매출계약코드 베이스(순번 제외) 생성 — 거래처-사업장-자동갱신-유형-팀-시작연도. */
export function contractCodeBase(o: {
  entityCode: string; placeNo: number | null; occurrenceUnit: OccurrenceUnit;
  endDate: string | null; categoryCode: string; team: Team; year: number | string;
}): string {
  const pcode = o.occurrenceUnit === '사업장' ? String(o.placeNo ?? 0).padStart(2, '0') : '00';
  const renew = o.endDate ? 'F' : 'R';
  return `${o.entityCode}-${pcode}-${renew}-${typeMnemonic(o.categoryCode)}-${teamCode(o.team)}-${o.year}`;
}

/** 신규 계약 매출계약코드 자동생성(순번 채번). 거래처/사업장 조회 후 base+seq. */
async function genContractCode(input: ContractInput): Promise<string | undefined> {
  const { data: e } = await supabase.from('biz_entity').select('code').eq('id', input.entityId).single();
  const entityCode = (e as { code?: string } | null)?.code;
  if (!entityCode) return undefined;
  let placeNo: number | null = null;
  if (input.placeId) {
    const { data: p } = await supabase.from('biz_place').select('place_no').eq('id', input.placeId).single();
    placeNo = (p as { place_no?: number } | null)?.place_no ?? null;
  }
  const year = input.startDate?.slice(0, 4) || (input.fiscalYear ? String(input.fiscalYear) : String(new Date().getFullYear()));
  const base = contractCodeBase({ entityCode, placeNo, occurrenceUnit: input.occurrenceUnit, endDate: input.endDate ?? null, categoryCode: input.categoryCode, team: input.team, year });
  const { data: ex } = await supabase.from('biz_sales_contract').select('contract_code').like('contract_code', base + '-%');
  let maxSeq = 0;
  for (const r of (ex as { contract_code?: string }[] | null) ?? []) { const m = /-(\d+)$/.exec(r.contract_code || ''); if (m) maxSeq = Math.max(maxSeq, Number(m[1])); }
  return `${base}-${String(maxSeq + 1).padStart(2, '0')}`;
}

export async function createSalesContract(input: ContractInput): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  const row = toRow(input);
  if (row.contract_code === undefined) row.contract_code = await genContractCode(input);
  if (row.date_estimated === undefined && input.startDate) row.date_estimated = input.startDate < '2026-07';
  const { data, error } = await supabase.from('biz_sales_contract').insert({ ...row, created_by: u.user?.id ?? null }).select('id').single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}
export async function updateSalesContract(id: string, patch: Partial<ContractInput>): Promise<void> {
  const { data, error } = await supabase.from('biz_sales_contract').update(toRow(patch)).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '저장');
}
export async function deleteSalesContract(id: string): Promise<void> {
  const { data, error } = await supabase.from('biz_sales_contract').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '삭제');
}

/** 분할 회차 교체(전체 삭제 후 재삽입). */
export async function saveInstallments(contractId: string, rows: Installment[]): Promise<void> {
  const del = await supabase.from('biz_contract_installment').delete().eq('contract_id', contractId);
  if (del.error) throw new Error(del.error.message);
  if (!rows.length) return;
  const ins = await supabase.from('biz_contract_installment').insert(
    rows.map((x, i) => ({ contract_id: contractId, seq: x.seq || i + 1, label: x.label, amount: x.amount, due_date: x.dueDate || null, condition_note: x.conditionNote || null, billed_at: x.billedAt || null })),
  );
  if (ins.error) throw new Error(ins.error.message);
}

/** 분할 회차 청구완료(확인) 토글 — 알람 CONFIRM. billed=true면 지금 시각 기록, false면 해제. */
export async function setInstallmentBilled(id: string, billed: boolean): Promise<void> {
  const { data, error } = await supabase.from('biz_contract_installment')
    .update({ billed_at: billed ? new Date().toISOString() : null }).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '청구확인');
}
/** 무료/할인 구간 교체. */
export async function saveDiscounts(contractId: string, rows: Discount[]): Promise<void> {
  const del = await supabase.from('biz_contract_discount').delete().eq('contract_id', contractId);
  if (del.error) throw new Error(del.error.message);
  if (!rows.length) return;
  const ins = await supabase.from('biz_contract_discount').insert(
    rows.map((x) => ({ contract_id: contractId, disc_type: x.discType, start_date: x.startDate || null, end_date: x.endDate || null, rate: x.rate, amount: x.amount, note: x.note || null })),
  );
  if (ins.error) throw new Error(ins.error.message);
}
/** 계약 담당직원 교체(활성 전부 삭제 후 재삽입). */
export async function saveContractStaff(contractId: string, staff: { staffId: string; staffName: string }[]): Promise<void> {
  const del = await supabase.from('biz_contract_staff').delete().eq('contract_id', contractId);
  if (del.error) throw new Error(del.error.message);
  if (!staff.length) return;
  const { data: u } = await supabase.auth.getUser();
  const ins = await supabase.from('biz_contract_staff').insert(
    staff.map((s) => ({ contract_id: contractId, staff_id: s.staffId, staff_name: s.staffName, active: true, created_by: u.user?.id ?? null })),
  );
  if (ins.error) throw new Error(ins.error.message);
}
