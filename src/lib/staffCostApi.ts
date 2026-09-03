// 직원 인건비(예산) — 급여 자료라 다루는 자리가 좁다.
//
// **김민섭·김동주·정남지는 볼 수 없다.** 자기 급여가 걸린 자리이기 때문이다.
// 등급으로 막지 않는 이유 — 세 사람은 team_lead·team_member 로 갈려 있고,
// 같은 등급에 막으면 안 되는 사람(송현주 회계사는 accountant)까지 걸린다.
// 그래서 **이름으로** 막고, 화면과 표(RLS) 양쪽에 같은 규칙을 둔다.
import { supabase } from './supabase';

/** 자기 급여가 걸려 볼 수 없는 사람들. DB 의 can_see_staff_cost() 와 같은 목록이어야 한다. */
export const COST_HIDDEN_FOR = ['김민섭', '김동주', '정남지'] as const;

/** 이 사람이 예산(인건비·손익)을 볼 수 있는가 — 화면 쪽 판정. */
export function canSeeStaffCost(role: string, profileName: string): boolean {
  if (COST_HIDDEN_FOR.includes(profileName as typeof COST_HIDDEN_FOR[number])) return false;
  return ['superuser', 'accountant', 'per_head_accountant', 'team_lead'].includes(role);
}

export interface StaffCost {
  id: string;
  fy: number;
  staffName: string;
  monthly: number;    // 세전 월급
  annual: number;     // 연봉
  bonus: number;      // 상여
  severance: number;  // 퇴직금
  insurance: number;  // 4대보험
  etcCost: number;    // 기타 지출비용
  note: string;
}

/** 총부담비용 — 엑셀과 같은 셈. 연봉 + 상여 + 퇴직금 + 4대보험 + 기타. 세전(월)은 참고값이다. */
export const totalCost = (c: StaffCost): number =>
  c.annual + c.bonus + c.severance + c.insurance + c.etcCost;

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
