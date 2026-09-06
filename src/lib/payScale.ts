// 인덕회계법인 **직원급여산정표**(2021-09-09 개정) — 호봉 1~100.
//
// 회사의 기본급은 이 표에서 나온다. 여기에 **비과세급여(식대)**를 더한 것이 월급이고,
// **상여의 기준은 이 표의 금액**이다(사용자 확정 2026-09-06).
//
// ⚠️ 「기본급」은 **기본금 + 수당 + 관리수당**의 합이다 — 한 칸이 아니다.
//    정남지 님은 관리수당(사용자가 신설)을 따로 두었는데, **기본금 + 관리수당이
//    이 표의 한 칸과 정확히 같아야 한다.** 법인의 급여정책을 어길 수 없기 때문이다.
//    그래서 화면은 **호봉을 먼저 고르고**, 그 금액에서 관리수당을 뺀 나머지를 기본금으로 둔다.
//
// 표는 등차가 아니다 — 구간마다 오름폭이 다르다(30,000 → 50,000 → 80,000 → …).
// 그래서 아래 구간 규칙으로 만들고, 원본과 맞는지는 테스트가 여러 칸을 찍어 확인한다.

export interface PayStep {
  /** 호봉. 1~100. */
  step: number;
  /** 월정급여 — 표의 왼쪽 칸. 이것이 「기본급」이다. */
  monthly: number;
  /** 연간기본급여 — 월정급여 × 12. 표에 함께 인쇄되어 있다. */
  annual: number;
}

/** 구간마다 오름폭이 다르다. [끝 호봉, 한 칸 오름폭]. */
const BANDS: [number, number][] = [
  [25, 30_000],
  [45, 50_000],
  [60, 80_000],
  [75, 100_000],
  [85, 150_000],
  [90, 200_000],
];

/** 91호봉부터는 규칙이 끊긴다 — 표에 적힌 값을 그대로 쓴다. */
const TOP: Record<number, number> = {
  91: 9_000_000, 92: 9_500_000, 93: 10_000_000, 94: 10_500_000, 95: 11_500_000,
  96: 12_500_000, 97: 13_500_000, 98: 14_500_000, 99: 15_500_000, 100: 16_000_000,
};

function build(): PayStep[] {
  const out: PayStep[] = [];
  let m = 1_800_000;                       // 1호봉
  for (let step = 1; step <= 100; step += 1) {
    if (step in TOP) {
      m = TOP[step];
    } else if (step > 1) {
      const band = BANDS.find(([end]) => step <= end);
      m += band ? band[1] : 0;
    }
    out.push({ step, monthly: m, annual: m * 12 });
  }
  return out;
}

export const PAY_SCALE: PayStep[] = build();

/** 그 금액이 표의 몇 호봉인가. 표에 없는 금액이면 null — **없는 것을 있다고 하지 않는다.** */
export function stepOf(monthly: number): number | null {
  return PAY_SCALE.find((s) => s.monthly === monthly)?.step ?? null;
}

/** 호봉으로 금액을 찾는다. 범위 밖이면 null. */
export function payOf(step: number): number | null {
  return PAY_SCALE.find((s) => s.step === step)?.monthly ?? null;
}

/**
 * 표에 없는 금액일 때 **가장 가까운 호봉**. 옛 급여를 표에 얹어 볼 때 쓴다.
 * 같은 거리면 아래 호봉을 준다 — 실제보다 높게 말하지 않는다.
 */
export function nearestStep(monthly: number): PayStep {
  return PAY_SCALE.reduce((best, s) => (
    Math.abs(s.monthly - monthly) < Math.abs(best.monthly - monthly) ? s : best
  ), PAY_SCALE[0]);
}

/**
 * 호봉의 금액을 **기본금과 관리수당으로 가른다.**
 *
 * 정남지 님을 위한 것이다 — 관리수당은 사용자가 신설한 칸이지만 법인의 급여정책은
 * 어길 수 없으므로, **둘의 합이 표의 한 칸과 같아야** 한다. 그래서 호봉을 먼저 정하고
 * 관리수당을 떼어 낸 나머지를 기본금으로 둔다(그 반대가 아니다).
 *
 * 관리수당이 호봉 금액보다 크면 기본금이 음수가 되므로 0 으로 막고 그 사실을 알린다.
 */
export function splitByStep(stepMonthly: number, mgmtAllowance: number): {
  basePay: number; mgmtAllowance: number; over: boolean;
} {
  const mgmt = Math.max(0, mgmtAllowance);
  if (mgmt > stepMonthly) return { basePay: 0, mgmtAllowance: stepMonthly, over: true };
  return { basePay: stepMonthly - mgmt, mgmtAllowance: mgmt, over: false };
}

/**
 * 지금 급여가 표의 어디에 서 있는지 한 줄로. **기본급 = 기본금+수당+관리수당**을 넣는다.
 * 표에 딱 맞으면 exact, 아니면 가장 가까운 호봉과 차이를 알려 준다.
 */
export function locate(basicTotal: number): { step: number; exact: boolean; diff: number } {
  const hit = stepOf(basicTotal);
  if (hit != null) return { step: hit, exact: true, diff: 0 };
  const near = nearestStep(basicTotal);
  return { step: near.step, exact: false, diff: basicTotal - near.monthly };
}
