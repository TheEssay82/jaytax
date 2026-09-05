import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drill, drillTotal } from './pivotDrill.ts';

type F = { company: string; ym: string; supply: number; shares: { name: string; share: number }[] };
const f = (company: string, ym: string, supply: number, shares: [string, number][]): F =>
  ({ company, ym, supply, shares: shares.map(([name, share]) => ({ name, share })) });

const staffDim = { split: (x: F) => (x.shares.length
  ? x.shares.map((s) => ({ name: s.name, weight: s.share / 100 }))
  : [{ name: '(미지정)', weight: 1 }]) };
const ymDim = { split: (x: F) => [{ name: x.ym, weight: 1 }] };

const FACTS: F[] = [
  f('㈜오톰', '2026-08', 1000, [['김동주', 100]]),
  f('㈜로티', '2026-08', 2000, [['김동주', 50], ['정남지', 50]]),
  f('㈜퍼플러스', '2026-09', 500, [['김동주', 100]]),
];

test('셀 하나에 담긴 줄을 되찾는다', () => {
  const rows = drill(FACTS, staffDim, ymDim, '김동주', '2026-08');
  assert.deepEqual(rows.map((r) => r.fact.company), ['㈜오톰', '㈜로티']);
});

test('되찾은 합이 셀 값과 같다 — 어긋나면 규칙이 갈라진 것이다', () => {
  // 김동주 × 2026-08 = 1000 + 2000×50% = 2000
  assert.equal(drillTotal(drill(FACTS, staffDim, ymDim, '김동주', '2026-08')), 2000);
  assert.equal(drillTotal(drill(FACTS, staffDim, ymDim, '정남지', '2026-08')), 1000);
});

test('공동담당은 몫만큼만 담긴다 — 합계가 부풀지 않는다', () => {
  const rows = drill(FACTS, staffDim, ymDim, '김동주', '2026-08');
  const 로티 = rows.find((r) => r.fact.company === '㈜로티')!;
  assert.equal(로티.weight, 0.5);
});

test('행만 주면 그 행 합계 — 모든 열이 들어온다', () => {
  const rows = drill(FACTS, staffDim, ymDim, '김동주', null);
  assert.equal(rows.length, 3);
  assert.equal(drillTotal(rows), 1000 + 1000 + 500);
});

test('열만 주면 그 열 합계', () => {
  assert.equal(drillTotal(drill(FACTS, staffDim, ymDim, null, '2026-08')), 3000);
});

test('둘 다 주지 않으면 전체', () => {
  assert.equal(drillTotal(drill(FACTS, staffDim, ymDim, null, null)), 3500);
});

test('맞는 것이 없으면 빈 목록', () => {
  assert.deepEqual(drill(FACTS, staffDim, ymDim, '없는사람', '2026-08'), []);
});

test('몫이 0 인 담당은 담기지 않는다 — 이름만 걸려 있고 배분이 없는 자리', () => {
  const zero = [f('㈜영', '2026-08', 100, [['김동주', 0], ['정남지', 100]])];
  assert.deepEqual(drill(zero, staffDim, ymDim, '김동주', '2026-08'), []);
});
