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
