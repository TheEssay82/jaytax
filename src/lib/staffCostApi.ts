// 직원 인건비(예산) — 급여 자료라 다루는 자리가 좁다.
//
// **김민섭·김동주·정남지는 볼 수 없다.** 자기 급여가 걸린 자리이기 때문이다.
// 판정과 셈법은 supabase 를 물지 않는 staffCost.ts 에 있다(테스트가 돌아야 하므로).
// 여기는 표를 읽고 쓰는 일만 한다.
import { supabase } from './supabase';
import { deriveCost, type StaffCost } from './staffCost';
import { stepOf } from './payScale';

// 화면들이 여기 한 곳에서 가져다 쓰도록 그대로 내보낸다.
export {
  totalCost, canSeeStaffCost, isCostExempt, COST_HIDDEN_FOR, COST_EXEMPT,
  basicTotal, monthlyTotal, bonusOf, annualOf, deriveCost, raiseOf, yearPay, DEFAULT_RATES,
} from './staffCost';
export type { StaffCost, PayParts, CostRates } from './staffCost';
// 급여산정표 — 화면이 한 곳에서 가져다 쓰도록 여기서도 내보낸다.
export { PAY_SCALE, stepOf, payOf, nearestStep, splitByStep, locate } from './payScale';
export type { PayStep } from './payScale';

/* eslint-disable @typescript-eslint/no-explicit-any */
const toRow = (r: any): StaffCost => ({
  id: r.id, fy: Number(r.fy), staffName: r.staff_name,
  monthly: Number(r.monthly) || 0, annual: Number(r.annual) || 0, bonus: Number(r.bonus) || 0,
  severance: Number(r.severance) || 0, insurance: Number(r.insurance) || 0,
  etcCost: Number(r.etc_cost) || 0, note: r.note || '',
  basePay: Number(r.base_pay) || 0, allowance: Number(r.allowance) || 0,
  mgmtAllowance: Number(r.mgmt_allowance) || 0, meal: Number(r.meal) || 0,
  severanceDiv: r.severance_div == null ? 12 : Number(r.severance_div),
  insuranceRate: r.insurance_rate == null ? 0.1 : Number(r.insurance_rate),
  etcRate: r.etc_rate == null ? 0.1 : Number(r.etc_rate),
  payStep: r.pay_step == null ? null : Number(r.pay_step),
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listStaffCost(fy: number): Promise<StaffCost[]> {
  const { data, error } = await supabase.from('staff_cost').select('*').eq('fy', fy).order('staff_name');
  if (error) throw new Error(error.message);
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  return ((data as any[]) ?? []).map(toRow);
}

export interface StaffCostInput {
  fy: number; staffName: string;
  /** 구성요소 — 이것만 주면 나머지는 **계산해서** 채운다. */
  basePay?: number; allowance?: number; mgmtAllowance?: number; meal?: number;
  severanceDiv?: number; insuranceRate?: number; etcRate?: number;
  /** 호봉. 넣지 않으면 기본급으로 **표에서 찾아** 붙인다(딱 맞을 때만). */
  payStep?: number | null;
  monthly?: number; annual?: number; bonus?: number;
  severance?: number; insurance?: number; etcCost?: number; note?: string;
}

/**
 * 넣거나 고친다. 같은 연도·같은 이름은 하나만 둔다.
 *
 * **구성요소(기본금 등)가 있으면 결과값은 계산해서 덮는다** — 사람이 다섯 칸을 다시
 * 셈해 넣지 않도록. 식은 staffCost.ts 의 deriveCost 한 곳에만 있다.
 * 구성요소가 통째로 비어 있으면(옛 줄을 그대로 옮길 때) 넘어온 결과값을 그대로 쓴다.
 */
export async function saveStaffCost(input: StaffCostInput): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const parts = {
    basePay: input.basePay ?? 0, allowance: input.allowance ?? 0,
    mgmtAllowance: input.mgmtAllowance ?? 0, meal: input.meal ?? 0,
  };
  const rates = {
    severanceDiv: input.severanceDiv ?? 12,
    insuranceRate: input.insuranceRate ?? 0.1,
    etcRate: input.etcRate ?? 0.1,
  };
  const hasParts = parts.basePay + parts.allowance + parts.mgmtAllowance + parts.meal > 0;
  const d = hasParts ? deriveCost(parts, rates) : null;
  const row = {
    fy: input.fy, staff_name: input.staffName.trim(),
    base_pay: parts.basePay, allowance: parts.allowance,
    mgmt_allowance: parts.mgmtAllowance, meal: parts.meal,
    severance_div: rates.severanceDiv, insurance_rate: rates.insuranceRate, etc_rate: rates.etcRate,
    // 호봉을 주지 않았으면 기본급으로 표에서 찾는다. 표에 없는 금액이면 null 로 둔다 —
    // 가까운 호봉으로 어림잡으면 틀린 호봉이 사실처럼 남는다.
    pay_step: input.payStep !== undefined ? input.payStep
      : stepOf(parts.basePay + parts.allowance + parts.mgmtAllowance),
    monthly: d ? d.monthly : input.monthly ?? 0,
    annual: d ? d.annual : input.annual ?? 0,
    bonus: d ? d.bonus : input.bonus ?? 0,
    severance: d ? d.severance : input.severance ?? 0,
    insurance: d ? d.insurance : input.insurance ?? 0,
    etc_cost: d ? d.etcCost : input.etcCost ?? 0,
    note: input.note ?? null, updated_by: u.user?.id ?? null, updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('staff_cost').upsert(row, { onConflict: 'fy,staff_name' });
  if (error) throw new Error(error.message);
}

export async function deleteStaffCost(id: string): Promise<void> {
  const { error } = await supabase.from('staff_cost').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** 앞 연도의 인건비를 그대로 가져와 시작점으로 삼는다. */
export async function copyStaffCostFrom(fromFy: number, toFy: number): Promise<number> {
  const prev = await listStaffCost(fromFy);
  if (!prev.length) return 0;
  for (const c of prev) {
    await saveStaffCost({ ...c, fy: toFy, note: `FY${fromFy} 에서 복사` });
  }
  return prev.length;
}
