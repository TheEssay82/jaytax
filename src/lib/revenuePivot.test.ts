// 매출통계 피벗 셈법. 엑셀 시트를 그대로 재현하는 것이 목표라, 엑셀이 세는 방식을 못박는다.
//
// 특히 조심할 곳
//  · 담당직원 배분(share) — 한 줄이 둘로 나뉘어도 **합계가 부풀지 않아야** 한다
//  · 거래처 수 — 더하는 것이 아니라 **세는 것**이다. 소계가 하위 합보다 작을 수 있다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pivotMulti, MEASURES, type PivotFact, type Dim, type Measure } from './revenuePivot';

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

// ── 거래처당 평균(단가) ─────────────────────────────────
//
// 엑셀 「담당cpa별 월기장료평균」을 옮긴 것이다(2026-09-06). 합계는 많이 맡은 사람이
// 크지만, 평균은 **한 곳당 얼마를 받는가**를 말한다 — 둘은 다른 질문이다.

test('거래처당 평균 = 금액 ÷ 그 금액이 잡힌 거래처 수', () => {
  const t = pivotMulti([
    f({ company: 'A', supply: 300, kind: '기장료' }),
    f({ company: 'B', supply: 100, kind: '기장료' }),
  ], CPA, null, M);
  assert.equal(t.total.book, 400);
  assert.equal(t.total.avgBook, 200);      // 400 ÷ 2곳
  assert.equal(t.total.avgClient, 200);
});

test('한 거래처가 여러 건이어도 분모는 **거래처 수**다', () => {
  const t = pivotMulti([
    f({ company: 'A', supply: 100, kind: '기장료' }),
    f({ company: 'A', supply: 200, kind: '기장료' }),
    f({ company: 'B', supply: 300, kind: '기장료' }),
  ], CPA, null, M);
  assert.equal(t.total.count, 3);
  assert.equal(t.total.avgBook, 300);      // 600 ÷ 2곳 — 건수 3 으로 나누지 않는다
});

test('기장료 평균의 분모에 **기장료 없는 거래처**는 들어가지 않는다', () => {
  // 신고대리만 하는 곳(기장료 0)이 분모에 끼면 단가가 실제보다 낮게 보인다.
  const t = pivotMulti([
    f({ company: 'A', supply: 300, kind: '기장료' }),
    f({ company: 'B', supply: 500, kind: '세무조정' }),
  ], CPA, null, M);
  assert.equal(t.total.clients, 2);
  assert.equal(t.total.avgBook, 300);      // 300 ÷ 1곳 (B 는 빠진다)
  assert.equal(t.total.avgAdj, 500);
  assert.equal(t.total.avgClient, 400);    // 전체 평균은 두 곳 다 센다
});

test('0 원 줄은 분모를 늘리지 않는다', () => {
  const t = pivotMulti([
    f({ company: 'A', supply: 300, kind: '기장료' }),
    f({ company: 'B', supply: 0, kind: '기장료' }),
  ], CPA, null, M);
  assert.equal(t.total.avgBook, 300);
});

test('평균은 사람마다 따로 — 합계가 큰 사람이 단가도 높은 것은 아니다', () => {
  const t = pivotMulti([
    f({ cpa: '정우철', company: 'A', supply: 100, kind: '기장료' }),
    f({ cpa: '정우철', company: 'B', supply: 100, kind: '기장료' }),
    f({ cpa: '정우철', company: 'C', supply: 100, kind: '기장료' }),
    f({ cpa: '김준성', company: 'D', supply: 250, kind: '기장료' }),
  ], CPA, null, M);
  const 정 = t.rows.find((r) => r.key === '정우철')!;
  const 김 = t.rows.find((r) => r.key === '김준성')!;
  assert.equal(정.values.book, 300);       // 합계는 정우철이 크지만
  assert.equal(정.values.avgBook, 100);
  assert.equal(김.values.book, 250);
  assert.equal(김.values.avgBook, 250);    // 단가는 김준성이 높다
});

test('배분된 줄도 평균의 분모는 거래처 하나다', () => {
  // 한 거래처를 둘이 나눠 맡으면 금액은 반씩, 거래처는 각자 한 곳으로 센다.
  const t = pivotMulti([
    f({ company: 'A', supply: 400, kind: '기장료', shares: [{ name: '갑', share: 50 }, { name: '을', share: 50 }] }),
  ], STAFF, null, M);
  const 갑 = t.rows.find((r) => r.key === '갑')!;
  assert.equal(갑.values.book, 200);
  assert.equal(갑.values.avgBook, 200);
  assert.equal(t.total.avgBook, 400);      // 총계에서는 한 곳에 400
});

test('빈 값은 나누지 않는다 — 0으로 나눠 NaN 이 나오면 표가 깨진다', () => {
  const t = pivotMulti([f({ supply: 0, kind: '기장료' })], CPA, null, M);
  assert.equal(t.total.avgBook, 0);
  assert.ok(Number.isFinite(t.total.avgAdj));
});
