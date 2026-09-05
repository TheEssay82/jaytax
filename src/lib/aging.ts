// 미수금 나이(aging) 의 **계산 규칙**만 모은 곳.
//
// supabase 를 물지 않는다 — 이 규칙이 테스트로 지켜져야 하기 때문이다.
// 자료를 읽어 오는 일은 agingApi.ts 가 하고, 여기서는 받은 줄을 어떻게 셈하는지만 정한다.

/** 나이 구간 — 경계는 '기준일 − 발행일'의 날수. */
export const BUCKETS = [
  { key: 'b30', label: '30일 이내', min: 0, max: 30 },
  { key: 'b60', label: '31~60일', min: 31, max: 60 },
  { key: 'b90', label: '61~90일', min: 61, max: 90 },
  { key: 'b180', label: '91~180일', min: 91, max: 180 },
  { key: 'over', label: '180일 초과', min: 181, max: 99999 },
] as const;
export type BucketKey = (typeof BUCKETS)[number]['key'];

/** 6개월 = 180일. 이 선을 넘은 잔액이 알림 대상이다. */
export const OVERDUE_DAYS = 180;

export interface AgingItem { date: string; label: string; amount: number; days: number }

/** 두 날짜 사이의 날수. 미래 날짜는 0 으로 본다(나이가 음수일 수는 없다). */
export const daysBetween = (from: string, to: string): number =>
  Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86400000));

/** 날수가 어느 구간에 드는가. */
export function bucketOf(days: number): BucketKey {
  for (const b of BUCKETS) if (days >= b.min && days <= b.max) return b.key;
  return 'over';
}

/**
 * 마이너스 전표(수정·취소)를 같은 거래처의 채권에서 **오래된 것부터** 덜어 낸다.
 *
 * 대장에는 (−)전표가 별개 줄로 남고 어느 청구를 되돌린 것인지 적혀 있지 않다.
 * 그대로 두면 합계가 0인 거래처가 "705일 경과"로 목록에 서는 일이 생긴다(이티머니).
 * 상계 방향을 오래된 쪽으로 잡은 것은 그쪽이 **경고를 부풀리지 않는** 쪽이기 때문이다.
 *
 * 갚고도 남은 마이너스는 선수금이다 — 감추지 않고 가장 최근 자리에 남긴다.
 */
export function settle(items: AgingItem[]): AgingItem[] {
  let credit = items.filter((x) => x.amount < 0).reduce((s, x) => s - x.amount, 0);
  if (!credit) return items.filter((x) => Math.round(x.amount) !== 0);
  const out: AgingItem[] = [];
  for (const x of items) {
    if (x.amount <= 0) continue;
    let amt = x.amount;
    if (credit > 0) { const cut = Math.min(credit, amt); amt -= cut; credit -= cut; }
    if (Math.round(amt) !== 0) out.push({ ...x, amount: amt });
  }
  if (credit > 0.5) {
    const last = items[items.length - 1];
    out.push({ date: last.date, label: '선수금(마이너스 잔액)', amount: -credit, days: last.days });
  }
  return out;
}

/** 남은 줄들을 구간별로 더한다. 합계·연체액도 함께. */
export function summarize(items: AgingItem[]): {
  total: number; overdue: number; buckets: Record<BucketKey, number>;
} {
  const buckets = Object.fromEntries(BUCKETS.map((b) => [b.key, 0])) as Record<BucketKey, number>;
  let total = 0, overdue = 0;
  for (const x of items) {
    total += x.amount;
    buckets[bucketOf(x.days)] += x.amount;
    if (x.days > OVERDUE_DAYS) overdue += x.amount;
  }
  return { total, overdue, buckets };
}

/**
 * 6개월 넘게 남은 채권인가 — **발행일** 기준.
 *
 * 거래처 한 장(ClientCard)에서 「6개월↑ N건」을 셀 때 쓴다.
 * 기준은 대장의 귀속월(YYYY-MM)이고, 그 달의 1일에서 여섯 달을 뺀 날이 자르는 선이다.
 * 발행일을 모르면 **오래된 것으로 보지 않는다** — 모르는 것을 단정하지 않는다.
 */
export function isOver6m(issued: string | null, asOfYm: string): boolean {
  if (!issued) return false;
  const [y, m] = asOfYm.split('-').map(Number);
  const cut = new Date(y, m - 1 - 6, 1);
  return new Date(issued) < cut;
}
