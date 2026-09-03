// 직원 인건비(예산) — 급여 자료라 다루는 자리가 좁다.
//
// **김민섭·김동주·정남지는 볼 수 없다.** 자기 급여가 걸린 자리이기 때문이다.
// 판정과 셈법은 supabase 를 물지 않는 staffCost.ts 에 있다(테스트가 돌아야 하므로).
// 여기는 표를 읽고 쓰는 일만 한다.
import { supabase } from './supabase';
import { type StaffCost } from './staffCost';

// 화면들이 여기 한 곳에서 가져다 쓰도록 그대로 내보낸다.
export {
  totalCost, canSeeStaffCost, isCostExempt, COST_HIDDEN_FOR, COST_EXEMPT,
} from './staffCost';
export type { StaffCost } from './staffCost';

/* eslint-disable @typescript-eslint/no-explicit-any */
const toRow = (r: any): StaffCost => ({
  id: r.id, fy: Number(r.fy), staffName: r.staff_name,
  monthly: Number(r.monthly) || 0, annual: Number(r.annual) || 0, bonus: Number(r.bonus) || 0,
  severance: Number(r.severance) || 0, insurance: Number(r.insurance) || 0,
  etcCost: Number(r.etc_cost) || 0, note: r.note || '',
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
  monthly?: number; annual?: number; bonus?: number;
  severance?: number; insurance?: number; etcCost?: number; note?: string;
}

/** 넣거나 고친다. 같은 연도·같은 이름은 하나만 둔다. */
export async function saveStaffCost(input: StaffCostInput): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const row = {
    fy: input.fy, staff_name: input.staffName.trim(),
    monthly: input.monthly ?? 0, annual: input.annual ?? 0, bonus: input.bonus ?? 0,
    severance: input.severance ?? 0, insurance: input.insurance ?? 0, etc_cost: input.etcCost ?? 0,
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
