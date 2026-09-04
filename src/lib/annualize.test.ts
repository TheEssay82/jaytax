import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annualize, annualTotal, CYCLE_MULT } from './annualize.ts';

const c = (amount: number, billingCycle: keyof typeof CYCLE_MULT) => ({ amount, billingCycle });

test('월 계약은 열두 배', () => {
  assert.equal(annualize(c(300_000, '월')), 3_600_000);
});

test('분기·반기·연', () => {
  assert.equal(annualize(c(1_000_000, '분기')), 4_000_000);
  assert.equal(annualize(c(1_000_000, '반기')), 2_000_000);
  assert.equal(annualize(c(1_000_000, '연')), 1_000_000);
});

test('건별·발생시는 한 번 일어난 것이라 그대로 — 열두 배로 부풀리지 않는다', () => {
  assert.equal(annualize(c(10_000_000, '건')), 10_000_000);
  assert.equal(annualize(c(10_000_000, '발생시')), 10_000_000);
});

test('금액이 0이면 0 — 종속계약(청구금액 0)은 합계에 영향이 없다', () => {
  assert.equal(annualize(c(0, '월')), 0);
});

test('합계는 주기가 섞여도 각자 환산해 더한다', () => {
  assert.equal(annualTotal([c(300_000, '월'), c(1_000_000, '연'), c(5_000_000, '건')]), 9_600_000);
});

test('빈 목록은 0', () => {
  assert.equal(annualTotal([]), 0);
});
