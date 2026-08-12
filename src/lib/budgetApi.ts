// 예산(차기연도 projection) — 연단위 계약 갱신 가정 라인 CRUD. biz_budget_renewal.
//   계속계약(기장 월 등)은 엔진 자동 projection이라 저장 안 함. 여기 저장하는 건 연단위(감사·조정료 등) 갱신 가정뿐.
import { supabase, assertWrote } from './supabase';
import type { Team } from './salesContractTaxonomy';

export interface BudgetRenewal {
  id: string;
  targetYear: number;
  sourceContractId: string | null;
  team: Team;
  entityId: string | null;
  categoryCode: string;
  label: string;
  amount: number;      // 갱신 가정 예산(공급가액·순액)
  active: boolean;
  note: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const toRenewal = (r: any): BudgetRenewal => ({
  id: r.id, targetYear: r.target_year, sourceContractId: r.source_contract_id,
  team: r.team, entityId: r.entity_id, categoryCode: r.category_code || '',
  label: r.label || '', amount: r.amount != null ? Number(r.amount) : 0,
  active: !!r.active, note: r.note || '',
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 대상 정산연도의 저장된 갱신 예산라인 조회. */
export async function listBudgetRenewals(targetYear: number): Promise<BudgetRenewal[]> {
  const { data, error } = await supabase.from('biz_budget_renewal').select('*').eq('target_year', targetYear);
  if (error) throw new Error(error.message);
  return (data as unknown[]).map(toRenewal);
}

export interface BudgetRenewalInput {
  targetYear: number;
  sourceContractId?: string | null;
  team: Team;
  entityId?: string | null;
  categoryCode?: string;
  label?: string;
  amount: number;
  active?: boolean;
  note?: string;
}
function toRow(i: Partial<BudgetRenewalInput>): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  const set = (k: string, v: unknown) => { if (v !== undefined) r[k] = v; };
  set('target_year', i.targetYear); set('source_contract_id', i.sourceContractId ?? undefined);
  set('team', i.team); set('entity_id', i.entityId ?? undefined); set('category_code', i.categoryCode);
  set('label', i.label); set('amount', i.amount); set('active', i.active); set('note', i.note);
  return r;
}

/** 갱신 예산라인 생성. 신규 id 반환. */
export async function createBudgetRenewal(input: BudgetRenewalInput): Promise<string> {
  const { data, error } = await supabase.from('biz_budget_renewal').insert(toRow(input)).select('id').single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}
/** 갱신 예산라인 수정(id 기준). */
export async function updateBudgetRenewal(id: string, patch: Partial<BudgetRenewalInput>): Promise<void> {
  const { data, error } = await supabase.from('biz_budget_renewal').update(toRow(patch)).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '예산 저장');
}
/** 갱신 예산라인 삭제. */
export async function deleteBudgetRenewal(id: string): Promise<void> {
  const { data, error } = await supabase.from('biz_budget_renewal').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '예산 삭제');
}
