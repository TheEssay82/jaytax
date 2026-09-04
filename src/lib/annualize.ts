// 연환산 — 주기가 다른 계약을 **1년치로 맞춰** 견줄 수 있게 한다.
//
// 한 곳에 둔다. 현황및예산조회와 거래처 요약 카드가 같은 값을 보여야 하는데,
// 규칙이 두 곳에 흩어지면 언젠가 어긋난다(담당 배분에서 이미 겪었다).
import type { BillingCycle, SalesContract } from './salesContractApi';

/** 주기 → 1년에 몇 번 청구하는가. 「발생시」·「건」은 한 번 일어난 것이라 1로 본다. */
export const CYCLE_MULT: Record<BillingCycle, number> = {
  월: 12, 분기: 4, 반기: 2, 연: 1, 발생시: 1, 건: 1,
};

/** 이 계약이 1년이면 얼마인가. */
export function annualize(c: Pick<SalesContract, 'amount' | 'billingCycle'>): number {
  return (c.amount || 0) * (CYCLE_MULT[c.billingCycle] ?? 1);
}

/** 여럿의 연환산 합계. */
export function annualTotal(cs: Pick<SalesContract, 'amount' | 'billingCycle'>[]): number {
  return cs.reduce((s, c) => s + annualize(c), 0);
}
