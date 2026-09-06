// **계약갱신 대상** — 앞 해에는 매출이 잡혔는데 이번 해에는 잡히지 않는 계약.
//
// 법인세조정·종합소득세처럼 **해마다 새 계약 줄이 필요한 일**은, 갱신을 잊으면 아무 표시 없이
// 예상매출만 조용히 낮아진다. 2026-09-06 에 실제로 그런 자리가 드러났다 — FY2025 에 있던
// 연 계약 8건이 FY2026 으로 넘어오지 않았고, 그중 문지훈 님 종합소득세는 계속해야 할 건이었다.
//
// ⚠️ **여기서 계약을 만들지 않는다.** 사장님 지시(2026-09-06) — 매출계약등록은 그대로 두고,
//    **예산에서만 체크로 반영**한다. 예산은 "이렇게 될 것 같다"를 세는 자리라 계약이 아직
//    없어도 넣을 수 있어야 하고, 계약등록은 실제로 맺은 것만 담아야 하기 때문이다.
//    그래서 체크는 계약을 건드리지 않고 budget_renewal 표에만 남는다.
//
// supabase 를 물지 않는다(테스트가 돌아야 하므로). 표를 읽고 쓰는 일은 budgetRenewalApi.ts.

/** 갱신 대상을 가릴 때 필요한 최소한의 계약 모양. */
export interface RenewalContract {
  id: string;
  entityId: string;
  categoryCode: string;
  team: string;
  fiscalYear: number | null;
  billingCycle: string;
  amount: number;
  endDate: string | null;
  cpa: string;
  company: string;
  staff: { name: string }[];
}

/** 화면에 내놓을 한 줄 — 앞 해 계약과 그것을 이번 해에 넣을지. */
export interface RenewalCandidate {
  /** 앞 해 계약의 id — 체크를 기억하는 열쇠다. */
  prevId: string;
  company: string;
  categoryCode: string;
  team: string;
  cpa: string;
  staff: string[];
  /** 앞 해 금액. 이번 해 금액을 따로 적지 않으면 이 값을 쓴다. */
  prevAmount: number;
  billingCycle: string;
}

/** 사람이 예산에 넣기로 한 것. */
export interface RenewalPick {
  prevId: string;
  include: boolean;
  /** 금액을 고쳐 넣었으면 그 값. null 이면 앞 해 금액 그대로. */
  amount: number | null;
}

/**
 * 갱신 대상 가리기 — **같은 거래처 · 같은 매출유형**으로 이번 해 계약이 하나도 없는 앞 해 계약.
 *
 * 왜 (거래처 + 매출유형)인가: 한 거래처가 기장·법인세조정·원천을 함께 맡길 수 있고, 그중
 * 하나만 끊길 수 있다. 거래처 단위로만 보면 "기장은 계속하니 괜찮다"고 넘겨짚어 조정료 누락을
 * 놓친다. 실제로 문지훈 님이 그런 자리였다(사업자는 종료, 종합소득세는 계속).
 *
 * **월 주기처럼 종료일 없이 계속 굴러가는 계약은 대상이 아니다** — 갱신이라는 개념이 없다.
 * 앞 해에 이미 끝난(종료일이 있는) 계약만 본다.
 */
export function renewalCandidates(
  prev: RenewalContract[], cur: RenewalContract[], team?: string,
): RenewalCandidate[] {
  const has = new Set(cur.map((c) => `${c.entityId}|${c.categoryCode}`));
  const out: RenewalCandidate[] = [];
  const seen = new Set<string>();
  for (const c of prev) {
    if (team && c.team !== team) continue;
    if (!c.endDate) continue;                       // 계속 굴러가는 계약 — 갱신 대상이 아니다
    const key = `${c.entityId}|${c.categoryCode}`;
    if (has.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({
      prevId: c.id,
      company: c.company,
      categoryCode: c.categoryCode,
      team: c.team,
      cpa: c.cpa,
      staff: c.staff.map((s) => s.name),
      prevAmount: c.amount,
      billingCycle: c.billingCycle,
    });
  }
  return out.sort((a, b) => b.prevAmount - a.prevAmount || a.company.localeCompare(b.company, 'ko'));
}

/** 체크한 것의 이번 해 금액 — 고쳐 넣은 값이 있으면 그것, 없으면 앞 해 금액. */
export function renewalAmount(c: RenewalCandidate, pick?: RenewalPick): number {
  if (!pick?.include) return 0;
  return pick.amount == null ? c.prevAmount : pick.amount;
}

/** 체크된 것들의 합 — 화면 위쪽에 "예산에 더해진 금액"으로 적는다. */
export function pickedTotal(cs: RenewalCandidate[], picks: Map<string, RenewalPick>): number {
  return cs.reduce((s, c) => s + renewalAmount(c, picks.get(c.prevId)), 0);
}
