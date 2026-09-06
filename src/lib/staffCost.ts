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
  // ── 급여의 구성요소. 2026-09-06 에 붙였다(아래 PayParts 설명 참고).
  //    옛 줄은 0 이라 화면이 결과값을 그대로 보여 준다.
  basePay: number;        // 기본금
  allowance: number;      // 수당
  mgmtAllowance: number;  // 관리수당
  meal: number;           // 식대
  severanceDiv: number;   // 퇴직금 = 연봉 ÷ 이 값
  insuranceRate: number;  // 4대보험 = 연봉 × 이 값
  etcRate: number;        // 기타 = 연봉 × 이 값
  /**
   * 직원급여산정표의 호봉(1~100). null 이면 아직 표에 얹지 않은 줄이다.
   * **기본금+수당+관리수당이 그 호봉의 월정급여와 같아야 한다** — payScale.ts 참고.
   */
  payStep: number | null;
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

/* ────────────────────────────────────────────────────────────────────────────
 * 급여의 **구성요소**와 그로부터 나오는 값들.
 *
 * 2026-09-06 에 엑셀(기장사업부현황정리)의 급여표를 그대로 옮겼다. 그전에는 결과값
 * (연봉·상여·퇴직금·4대보험·기타)만 손으로 박아 두었는데, 급여가 바뀔 때마다 사람이
 * 다섯 칸을 다시 계산해 넣어야 했다. **엑셀이 쓰던 식이 실제로 있었으므로** 그 식을
 * 코드로 옮기고, 사람은 기본금·수당·식대만 넣게 한다.
 *
 * 세 사람의 FY2026 값으로 검산한 식 —
 *   월급합계 = 기본금 + 수당 + 관리수당 + 식대
 *   기본급합계 = 기본금 + 수당 + 관리수당            (식대는 빠진다)
 *   상여100% = 기본급합계
 *   연봉      = 월급합계 × 12 + 상여
 *   퇴직금    = 연봉 ÷ 12
 *   4대보험   = 연봉 × 10%
 *   기타      = 연봉 × 10%
 * ────────────────────────────────────────────────────────────────────────── */

/** 사람이 넣는 칸 — 엑셀 급여표의 왼쪽 절반. */
export interface PayParts {
  basePay: number;        // 기본금
  allowance: number;      // 수당
  mgmtAllowance: number;  // 관리수당
  meal: number;           // 식대
}

/** 부대비용 비율. 엑셀이 쓰던 값이 기본값이다. */
export interface CostRates {
  /** 퇴직금 — 연봉의 몇 분의 일인가. 엑셀은 1/12. */
  severanceDiv: number;
  /** 4대보험 — 연봉 대비. */
  insuranceRate: number;
  /** 기타 지출 — 연봉 대비. */
  etcRate: number;
}

export const DEFAULT_RATES: CostRates = { severanceDiv: 12, insuranceRate: 0.1, etcRate: 0.1 };

/** 기본급합계 — **식대는 빼고** 센다. 상여의 바탕이 되는 값이다. */
export const basicTotal = (p: PayParts): number => p.basePay + p.allowance + p.mgmtAllowance;

/** 월급합계 — 식대까지 더한, 매달 나가는 돈. */
export const monthlyTotal = (p: PayParts): number => basicTotal(p) + p.meal;

/** 상여 100% — 기본급합계와 같다. */
export const bonusOf = (p: PayParts): number => basicTotal(p);

/** 연봉 — 월급합계 열두 달에 상여를 더한 것. 엑셀의 「연봉」 칸과 같다. */
export const annualOf = (p: PayParts): number => monthlyTotal(p) * 12 + bonusOf(p);

/**
 * 구성요소에서 총부담비용까지 한 번에. 화면과 저장이 **같은 식**을 쓰도록 여기 한 곳에 둔다.
 * 반올림은 마지막에 한 번만 한다 — 칸마다 반올림하면 합계가 어긋난다.
 */
export function deriveCost(p: PayParts, rates: CostRates = DEFAULT_RATES): {
  monthly: number; annual: number; bonus: number;
  severance: number; insurance: number; etcCost: number; total: number;
} {
  const monthly = monthlyTotal(p);
  const bonus = bonusOf(p);
  const annual = monthly * 12;        // 저장 칸의 annual 은 **상여를 뺀** 열두 달치다
  const base = annual + bonus;        // 엑셀의 「연봉」
  const severance = rates.severanceDiv > 0 ? base / rates.severanceDiv : 0;
  const insurance = base * rates.insuranceRate;
  const etcCost = base * rates.etcRate;
  return {
    monthly, annual, bonus,
    severance: Math.round(severance),
    insurance: Math.round(insurance),
    etcCost: Math.round(etcCost),
    total: Math.round(base + severance + insurance + etcCost),
  };
}

/**
 * 인상 — 지난 해와 견준다. 엑셀 급여표의 「인상금액」·오른쪽 비율 칸이다.
 * 지난 해가 없으면 비교할 것이 없으므로 null 을 준다(0% 라고 말하면 거짓이다).
 */
export function raiseOf(prevAnnual: number, curAnnual: number): { amount: number; rate: number } | null {
  if (!prevAnnual) return null;
  return { amount: curAnnual - prevAnnual, rate: (curAnnual - prevAnnual) / prevAnnual };
}

/** 저장된 한 줄에서 엑셀의 「연봉」을 되돌린다 — annual 칸은 상여를 뺀 값이라 혼자서는 못 읽는다. */
export const yearPay = (c: Pick<StaffCost, 'annual' | 'bonus'>): number => c.annual + c.bonus;
