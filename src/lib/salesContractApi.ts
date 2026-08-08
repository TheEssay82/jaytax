// 매출계약(biz_sales_contract) + 위성(담당직원·분할·할인) 데이터 접근 레이어. 거래처관리 2.0.0 step2.
import { supabase, assertWrote } from './supabase';
import type { Team } from './salesContractTaxonomy';

export type OccurrenceUnit = '사업장' | '법인' | '개인';
export type BillingUnit = '사업장' | '법인' | '개인' | '건';
export type BillingCycle = '월' | '분기' | '반기' | '연' | '발생시' | '건';
export type AdvisoryType = '일반' | '전문';
export const BILLING_CYCLES: BillingCycle[] = ['월', '분기', '반기', '연', '발생시', '건'];
// 팀별 담당직원 후보(#10) · 담당CPA 후보. 입사·변경 시 여기만 수정.
export const AUDIT_STAFF = ['정우철', '김준성', '조현규', '송현주'] as const;   // 감사team 담당직원=CPA
export const TAX_STAFF = ['정남지', '김민섭', '김동주', '송현주'] as const;      // taxteam 담당직원=기장팀
export const CPA_LIST = ['정우철', '조현규', '김준성', '송현주'] as const;       // 담당CPA 후보
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
export interface Installment { id?: string; seq: number; label: string; amount: number; dueDate: string | null; conditionNote: string }
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
  staff: [], installments: [], discounts: [], createdAt: r.created_at, updatedAt: r.updated_at,
});
const toStaff = (r: any): ContractStaff => ({ id: r.id, contractId: r.contract_id, staffId: r.staff_id, staffName: r.staff_name || '', active: !!r.active });
const toInst = (r: any): Installment => ({ id: r.id, seq: r.seq ?? 1, label: r.label || '', amount: r.amount != null ? Number(r.amount) : 0, dueDate: r.due_date, conditionNote: r.condition_note || '' });
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

export interface ContractInput {
  entityId: string; placeId?: string | null; occurrenceUnit: OccurrenceUnit; billingUnit?: BillingUnit | null;
  team: Team; categoryCode: string; categoryEtcName?: string; includesVat?: boolean; includesWht?: boolean;
  advisoryType?: AdvisoryType | null; parentContractId?: string | null; fiscalYear?: number | null;
  billingCycle: BillingCycle; isInstallment?: boolean; amount: number; cpa?: string;
  contractDate?: string | null; startDate?: string | null; endDate?: string | null; note?: string;
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
  return r;
}

export async function createSalesContract(input: ContractInput): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('biz_sales_contract').insert({ ...toRow(input), created_by: u.user?.id ?? null }).select('id').single();
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
    rows.map((x, i) => ({ contract_id: contractId, seq: x.seq || i + 1, label: x.label, amount: x.amount, due_date: x.dueDate || null, condition_note: x.conditionNote || null })),
  );
  if (ins.error) throw new Error(ins.error.message);
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
