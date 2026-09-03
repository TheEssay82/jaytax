// 인건비의 **판정과 셈법**만 모은 곳. supabase 를 물지 않는다(테스트가 돌아야 하므로).
// 표를 읽고 쓰는 일은 staffCostApi.ts 에 있다.

/** 인건비 한 사람 — 엑셀의 인건비 예측표와 같은 칸. */
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

/**
 * 총부담비용 — 엑셀과 같은 셈. 연봉 + 상여 + 퇴직금 + 4대보험 + 기타.
 * **세전(월)은 더하지 않는다** — 연봉을 만들어 내는 참고값일 뿐이다(더하면 이중계상).
 */
export const totalCost = (c: StaffCost): number =>
  c.annual + c.bonus + c.severance + c.insurance + c.etcCost;

/**
 * 자기 급여가 걸려 예산 화면을 볼 수 없는 사람들.
 * **DB 의 can_see_staff_cost() 와 같은 목록이어야 한다** — 한쪽만 고치면 샌다.
 */
export const COST_HIDDEN_FOR = ['김민섭', '김동주', '정남지'] as const;

/** 예산(인건비·손익)을 볼 수 있는 등급. */
const COST_ROLES = ['superuser', 'accountant', 'per_head_accountant', 'team_lead'];

/**
 * 이 사람이 예산(인건비·손익)을 볼 수 있는가 — 화면 쪽 판정.
 *
 * **등급이 아니라 이름으로 막는다.** 세 사람이 team_lead·team_member 로 갈려 있어
 * 등급으로 막으면 막으면 안 되는 사람(송현주 회계사는 accountant)까지 걸리거나 반대로 샌다.
 * 모르는 등급은 기본이 거부다.
 */
export function canSeeStaffCost(role: string, profileName: string): boolean {
  if (COST_HIDDEN_FOR.includes(profileName as typeof COST_HIDDEN_FOR[number])) return false;
  return COST_ROLES.includes(role);
}

/**
 * **성과측정·예산계산의 대상이 아닌 사람** (사용자 확정 2026-09-03).
 *
 * 수입이 잡히더라도 인건비·기여·배수를 따지지 않는다. 표에는 남되 합계에서는 빠진다 —
 * 인건비 없이 수입만 합치면 배수가 부풀려지기 때문이다. 열람 권한과는 별개다(볼 수는 있다).
 *
 * 이 목록은 **마지막 안전망**이다. 애초에 담당으로 잡히지 않는 것이 맞고(파트리지시스템즈
 * 자문료는 김동주 100% 로 바로잡았다), 화면에 「대상 아님」 줄이 보이면 담당 배정을 먼저 봐야 한다.
 */
export const COST_EXEMPT = ['송현주'] as const;

/** 인건비를 따지지 않는 사람인가. */
export const isCostExempt = (name: string): boolean =>
  COST_EXEMPT.includes(name as typeof COST_EXEMPT[number]);
