// 매출통계 피벗 셈법. 엑셀 시트를 그대로 재현하는 것이 목표라, 엑셀이 세는 방식을 못박는다.
//
// 특히 조심할 곳
//  · 담당직원 배분(share) — 한 줄이 둘로 나뉘어도 **합계가 부풀지 않아야** 한다
//  · 거래처 수 — 더하는 것이 아니라 **세는 것**이다. 소계가 하위 합보다 작을 수 있다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pivotMulti, MEASURES, measuresFor, type PivotFact, type Dim, type Measure } from './revenuePivot';

/** 이 테스트가 쓰는 사실 — 최소 모양(PivotFact)에 회계사를 더한 것. */
type F = PivotFact & { cpa: string };

const one = (n: string) => [{ name: n || '(미지정)', weight: 1 }];
const CPA: Dim<F> = { key: 'cpa', label: '회계사', split: (x) => one(x.cpa) };
const STAFF: Dim<F> = {
  key: 'staff', label: '담당직원',
  split: (x) => (x.shares.length ? x.shares.map((s) => ({ name: s.name, weight: s.share / 100 })) : one('')),
};

const f = (o: Partial<F> & { supply: number }): F => ({
  company: 'A', kind: '기장료', shares: [], cpa: '정우철', ...o,
});
const M = MEASURES as Measure<F>[];
/** 한 달짜리 창구 — 나누지 않은 **날 값**으로 평균 규칙만 본다. */
const M1 = measuresFor(1) as Measure<F>[];
const m = (key: string) => M.filter((x) => x.key === key);

// ── 수입 종류별 갈라 담기 ───────────────────────────────

test('기장료·조정료·기타가 각자 칸에 담기고 합계가 맞는다', () => {
  const t = pivotMulti([
    f({ supply: 100, kind: '기장료' }),
    f({ supply: 200, kind: '세무조정' }),
    f({ supply: 50, kind: '기타' }),
  ], CPA, null, M);
  assert.equal(t.total.book, 100);
  assert.equal(t.total.adj, 200);
  assert.equal(t.total.etc, 50);
  assert.equal(t.total.supply, 350);
});

// ── 담당직원 배분 ───────────────────────────────────────

test('한 줄을 둘이 나눠 맡아도 총계는 부풀지 않는다', () => {
  const t = pivotMulti(
    [f({ supply: 1000, shares: [{ name: '김민섭', share: 60 }, { name: '정남지', share: 40 }] })],
    STAFF, null, M);
  assert.equal(t.rows.find((r) => r.key === '김민섭')!.values.supply, 600);
  assert.equal(t.rows.find((r) => r.key === '정남지')!.values.supply, 400);
  assert.equal(t.total.supply, 1000, '총계는 1000 이어야 한다 — 1600 이 되면 안 된다');
});

test('배분이 없으면 (미지정) 으로 모인다', () => {
  const t = pivotMulti([f({ supply: 500, shares: [] })], STAFF, null, M);
  assert.equal(t.rows[0].key, '(미지정)');
  assert.equal(t.rows[0].values.supply, 500);
});

// ── 2단계 중첩 (엑셀 모양) ──────────────────────────────

test('회계사 > 직원 2단계 — 소계 줄이 먼저, 그 아래 자식 줄', () => {
  const t = pivotMulti([
    f({ supply: 300, cpa: '정우철', shares: [{ name: '김민섭', share: 100 }] }),
    f({ supply: 200, cpa: '정우철', shares: [{ name: '정남지', share: 100 }] }),
    f({ supply: 100, cpa: '조현규', shares: [{ name: '정남지', share: 100 }] }),
  ], CPA, STAFF, M);

  const 정우철 = t.rows.filter((r) => r.key === '정우철');
  assert.equal(정우철[0].isSubtotal, true);
  assert.equal(정우철[0].sub, null);
  assert.equal(정우철[0].values.supply, 500, '소계는 하위 합과 같아야 한다');
  assert.deepEqual(정우철.slice(1).map((r) => [r.sub, r.values.supply]), [['김민섭', 300], ['정남지', 200]]);

  assert.equal(t.total.supply, 600);
});

test('2단계에서도 배분 비율이 그대로 곱해진다', () => {
  const t = pivotMulti(
    [f({ supply: 1000, cpa: '정우철', shares: [{ name: '김민섭', share: 70 }, { name: '김동주', share: 30 }] })],
    CPA, STAFF, M);
  const sub = t.rows.filter((r) => r.sub);
  assert.equal(sub.find((r) => r.sub === '김민섭')!.values.supply, 700);
  assert.equal(sub.find((r) => r.sub === '김동주')!.values.supply, 300);
  assert.equal(t.rows[0].values.supply, 1000, '회계사 소계는 나뉘기 전 금액');
});

// ── 거래처 수는 더하지 않고 센다 ────────────────────────

test('같은 거래처가 여러 줄이어도 거래처 수는 1', () => {
  const t = pivotMulti([
    f({ supply: 100, company: '㈜가' }),
    f({ supply: 200, company: '㈜가' }),
    f({ supply: 300, company: '㈜나' }),
  ], CPA, null, M);
  assert.equal(t.total.clients, 2);
  assert.equal(t.total.count, 3, '건수는 3');
  assert.equal(t.total.supply, 600);
});

test('한 거래처를 둘이 나눠 맡으면 소계 거래처 수가 하위 합보다 작다 — 엑셀도 그렇다', () => {
  const t = pivotMulti(
    [f({ supply: 1000, company: '㈜가', cpa: '정우철', shares: [{ name: '김민섭', share: 50 }, { name: '정남지', share: 50 }] })],
    CPA, STAFF, M);
  assert.equal(t.rows[0].values.clients, 1, '회계사 소계는 1곳');
  const sub = t.rows.filter((r) => r.sub);
  assert.equal(sub[0].values.clients, 1);
  assert.equal(sub[1].values.clients, 1, '직원 줄은 각각 1곳 — 더하면 2가 되지만 그것이 맞다');
});

// ── 정렬 ────────────────────────────────────────────────

test('기본은 금액 큰 순, sortByName 이면 이름순', () => {
  const facts = [f({ supply: 100, cpa: '가' }), f({ supply: 900, cpa: '나' })];
  assert.deepEqual(pivotMulti(facts, CPA, null, M).rows.map((r) => r.key), ['나', '가']);
  const byName: Dim<F> = { ...CPA, sortByName: true };
  assert.deepEqual(pivotMulti(facts, byName, null, M).rows.map((r) => r.key), ['가', '나']);
});

// ── 값 고르기 ───────────────────────────────────────────

test('고른 측정값만 계산한다', () => {
  const t = pivotMulti([f({ supply: 100 })], CPA, null, m('supply'));
  assert.deepEqual(Object.keys(t.total), ['supply']);
});

test('자료가 없으면 빈 표', () => {
  const t = pivotMulti([], CPA, STAFF, M);
  assert.deepEqual(t.rows, []);
  assert.equal(t.total.supply, 0);
  assert.equal(t.total.clients, 0);
});

// ── 단가(평균 월기장료) ─────────────────────────────────
//
// 엑셀 「평균 월 기장료」를 옮긴 것이다. 사장님이 쓰시는 자리는 **실적**이다 —
// 지난 달들의 월 단가를 견주어 **유난히 낮은 계약의 원인을 찾는** 것(2026-09-07).
//
// 세 가지가 못박혀야 한다.
//   ① 분자 — 기장뿐 아니라 **월정액 계약 전부**(원천·컨설팅 포함)
//   ② 분모 — 거래처가 아니라 **사업장**. 한 곳이 사업장을 셋 맡기면 셋으로 나뉜다
//   ③ 실적은 **청구가 잡힌 달 수**로 나눈다 — 창구가 열두 달이어도 여섯 달만
//      청구됐으면 6 으로 나눈다. 아니면 「단가가 낮다」와 「몇 달만 했다」가 섞인다

/** 실적용 — 청구된 달 수로 나눈다. */
const MA = measuresFor(12) as Measure<F>[];
/** 예상용 — 창구 개월 수로 나눈다. */
const MF = (n: number) => measuresFor(n, true) as Measure<F>[];
/** 월정액 한 달치 청구 한 줄. */
const mm = (o: Partial<F> & { supply: number }): F =>
  f({ billingCycle: '월', kind: '기장료', ...o });

test('① 분자 — 기장만이 아니라 월정액 계약 전부를 센다', () => {
  const t = pivotMulti([
    mm({ company: 'A', place: 'A', ym: '2026-07', supply: 200_000, kind: '기장료' }),
    mm({ company: 'B', place: 'B', ym: '2026-07', supply: 900_000, kind: '기타' }),   // 원천
  ], CPA, null, MA);
  // 두 사업장, 한 달 → (200,000 + 900,000) ÷ 1달 ÷ 2곳
  assert.equal(t.total.avgBookM, 550_000);
});

test('① 월정액이 아닌 계약은 단가에 넣지 않는다 — 조정료는 한 해에 한 번이다', () => {
  const t = pivotMulti([
    mm({ company: 'A', place: 'A', ym: '2026-07', supply: 200_000 }),
    f({ company: 'B', place: 'B', ym: '2026-07', supply: 5_000_000, kind: '세무조정', billingCycle: '연' }),
  ], CPA, null, MA);
  assert.equal(t.total.avgBookM, 200_000);
});

test('② 분모는 **사업장** — 한 거래처가 사업장을 셋 맡기면 셋으로 나뉜다', () => {
  // 시파사가 그런 자리다(야키니쿠리·야키토리리·방배직영점 각 월 200,000).
  const t = pivotMulti([
    mm({ company: '시파사', place: '야키니쿠리', ym: '2026-07', supply: 200_000 }),
    mm({ company: '시파사', place: '야키토리리', ym: '2026-07', supply: 200_000 }),
    mm({ company: '시파사', place: '방배직영점', ym: '2026-07', supply: 200_000 }),
  ], CPA, null, MA);
  assert.equal(t.total.book, 600_000);
  assert.equal(t.total.avgBookM, 200_000);      // 거래처로 나눴다면 600,000 이 된다
});

test('② 사업장이 비어 있으면 거래처로 갈음한다', () => {
  const t = pivotMulti([mm({ company: 'A', ym: '2026-07', supply: 150_000 })], CPA, null, MA);
  assert.equal(t.total.avgBookM, 150_000);
});

test('③ 실적 — 열두 달 청구면 12 로, 여섯 달만 청구했으면 6 으로 나눈다', () => {
  const twelve = Array.from({ length: 12 }, (_, i) =>
    mm({ company: 'A', place: 'A', ym: `2026-${String(i + 1).padStart(2, '0')}`, supply: 300_000 }));
  const t1 = pivotMulti(twelve, CPA, null, MA);
  assert.equal(t1.total.book, 3_600_000);
  assert.equal(t1.total.avgBookM, 300_000);

  // 같은 단가인데 여섯 달만 청구된 사업장. **단가는 그대로 300,000 이어야 한다.**
  const six = twelve.slice(0, 6);
  const t2 = pivotMulti(six, CPA, null, MA);
  assert.equal(t2.total.book, 1_800_000);
  assert.equal(t2.total.avgBookM, 300_000);
});

test('③ 사업장마다 청구된 달이 달라도 각자의 달 수로 나눈다', () => {
  const t = pivotMulti([
    mm({ company: 'A', place: 'A', ym: '2026-07', supply: 300_000 }),
    mm({ company: 'A', place: 'A', ym: '2026-08', supply: 300_000 }),
    mm({ company: 'B', place: 'B', ym: '2026-07', supply: 100_000 }),
  ], CPA, null, MA);
  // 달 집합 {07,08} = 2, 사업장 {A,B} = 2 → 700,000 ÷ 2 ÷ 2
  assert.equal(t.total.avgBookM, 175_000);
  // 사업장별로 보면 각자의 단가가 그대로 나온다.
  const byPlace: Dim<F> = { key: 'place', label: '사업장', split: (x) => one(x.place ?? '') };
  const t2 = pivotMulti([
    mm({ company: 'A', place: 'A', ym: '2026-07', supply: 300_000 }),
    mm({ company: 'A', place: 'A', ym: '2026-08', supply: 300_000 }),
    mm({ company: 'B', place: 'B', ym: '2026-07', supply: 100_000 }),
  ], byPlace, null, MA);
  assert.equal(t2.rows.find((r) => r.key === 'A')!.values.avgBookM, 300_000);
  assert.equal(t2.rows.find((r) => r.key === 'B')!.values.avgBookM, 100_000);
});

test('예상 — 한 줄에 기간 전체가 담기므로 창구의 개월 수로 나눈다', () => {
  // 예상은 귀속월을 한 달에 몰아 넣으므로 「청구된 달 수」로 나눌 수 없다.
  const t = pivotMulti([
    mm({ company: 'A', place: 'A', ym: '2026-07', supply: 3_600_000 }),   // 12달치 한 줄
    mm({ company: 'B', place: 'B', ym: '2026-07', supply: 1_200_000 }),
  ], CPA, null, MF(12));
  assert.equal(t.total.avgBookM, 200_000);      // (4,800,000 ÷ 12) ÷ 2곳
});

test('예상 — 기간이 석 달이면 3 으로 나눈다', () => {
  const t = pivotMulti([mm({ company: 'A', place: 'A', ym: '2026-07', supply: 900_000 })],
    CPA, null, MF(3));
  assert.equal(t.total.avgBookM, 300_000);
});

test('0 원 줄은 분모를 늘리지 않는다', () => {
  const t = pivotMulti([
    mm({ company: 'A', place: 'A', ym: '2026-07', supply: 300_000 }),
    mm({ company: 'B', place: 'B', ym: '2026-07', supply: 0 }),
  ], CPA, null, MA);
  assert.equal(t.total.avgBookM, 300_000);
});

test('빈 값은 나누지 않는다 — 0으로 나눠 NaN 이 나오면 표가 깨진다', () => {
  const t = pivotMulti([mm({ supply: 0, ym: '2026-07' })], CPA, null, MA);
  assert.equal(t.total.avgBookM, 0);
  assert.ok(Number.isFinite(t.total.avgAdj));
});

test('단가는 사람마다 따로 — 합계가 큰 사람이 단가도 높은 것은 아니다', () => {
  const t = pivotMulti([
    mm({ cpa: '정우철', company: 'A', place: 'A', ym: '2026-07', supply: 100_000 }),
    mm({ cpa: '정우철', company: 'B', place: 'B', ym: '2026-07', supply: 100_000 }),
    mm({ cpa: '정우철', company: 'C', place: 'C', ym: '2026-07', supply: 100_000 }),
    mm({ cpa: '김준성', company: 'D', place: 'D', ym: '2026-07', supply: 250_000 }),
  ], CPA, null, MA);
  const 정 = t.rows.find((r) => r.key === '정우철')!;
  const 김 = t.rows.find((r) => r.key === '김준성')!;
  assert.equal(정.values.book, 300_000);        // 합계는 정우철이 크지만
  assert.equal(정.values.avgBookM, 100_000);
  assert.equal(김.values.avgBookM, 250_000);    // 단가는 김준성이 높다
});

test('거래처당 조정료·합계는 달로 나누지 않는다', () => {
  const t = pivotMulti([
    f({ company: 'A', place: 'A', ym: '2026-07', supply: 500, kind: '세무조정', billingCycle: '연' }),
    f({ company: 'B', place: 'B', ym: '2026-07', supply: 300, kind: '세무조정', billingCycle: '연' }),
  ], CPA, null, MA);
  assert.equal(t.total.avgAdj, 400);
  assert.equal(t.total.avgClient, 400);
});

test('청구주기가 없는 옛 실적 자료는 **매출계정**으로 월정액을 가린다', () => {
  // FY2025 이전 실적(biz_revenue_actual)은 계약에 연결되어 있지 않아 청구주기가 없다.
  // 기장·컨설팅·원천은 달마다 받는 돈이고, 세무조정·신고대리는 한 해에 한 번이다.
  const t = pivotMulti([
    f({ company: 'A', ym: '2025-07', supply: 200_000, kind: '기장료', erpAccount: '기장' }),
    f({ company: 'B', ym: '2025-07', supply: 900_000, kind: '기타', erpAccount: '원천' }),
    f({ company: 'C', ym: '2025-07', supply: 700_000, kind: '기타', erpAccount: '컨설팅' }),
    f({ company: 'D', ym: '2025-07', supply: 5_000_000, kind: '세무조정', erpAccount: '세무조정' }),
    f({ company: 'E', ym: '2025-07', supply: 400_000, kind: '기타', erpAccount: '신고대리' }),
  ], CPA, null, measuresFor(12) as Measure<F>[]);
  // 월정액 세 곳만: (200,000 + 900,000 + 700,000) ÷ 1달 ÷ 3곳
  assert.equal(t.total.avgBookM, 600_000);
});

test('청구주기가 있으면 그것이 먼저다 — 계정으로 넘겨짚지 않는다', () => {
  // 기장 계정이라도 연 계약이면 월정액이 아니다.
  const t = pivotMulti([
    f({ company: 'A', ym: '2026-07', supply: 1_200_000, kind: '기장료', erpAccount: '기장', billingCycle: '연' }),
  ], CPA, null, measuresFor(12) as Measure<F>[]);
  assert.equal(t.total.avgBookM, 0);
});
