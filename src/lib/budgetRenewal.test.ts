// 계약갱신 대상 가리기. **놓치면 예산이 조용히 낮아지는 자리**라 규칙을 못박는다.
//
// 아래 상황은 2026-09-06 에 실제로 있었던 것이다 — FY2025 연 계약 8건이 FY2026 으로
// 넘어오지 않았고, 그중 문지훈 님(사업자는 종료, 종합소득세는 계속)이 진짜 누락이었다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renewalCandidates, renewalAmount, pickedTotal,
  type RenewalContract, type RenewalPick,
} from './budgetRenewal';

const c = (o: Partial<RenewalContract> & { id: string; entityId: string }): RenewalContract => ({
  categoryCode: 'TAX.FILING.INCOME', team: 'taxteam', fiscalYear: 2025,
  billingCycle: '연', amount: 1_000_000, endDate: '2026-06-01', cpa: '정우철',
  company: '아무개', staff: [], ...o,
});

test('앞 해에 있고 이번 해에 없으면 갱신 대상', () => {
  const got = renewalCandidates([c({ id: 'a', entityId: 'E1', company: '문지훈', amount: 1_200_000 })], []);
  assert.equal(got.length, 1);
  assert.equal(got[0].company, '문지훈');
  assert.equal(got[0].prevAmount, 1_200_000);
});

test('이번 해에 같은 거래처·같은 유형이 있으면 대상이 아니다', () => {
  const prev = [c({ id: 'a', entityId: 'E1' })];
  const cur = [c({ id: 'b', entityId: 'E1', fiscalYear: 2026 })];
  assert.equal(renewalCandidates(prev, cur).length, 0);
});

test('같은 거래처라도 **유형이 다르면** 대상이다 — 기장은 잇고 조정료만 빠지는 자리', () => {
  // 문지훈 님 자리: 사업자(기장)는 종료하고 종합소득세만 이어 가야 했다.
  const prev = [
    c({ id: 'book', entityId: 'E1', categoryCode: 'TAX.BOOK' }),
    c({ id: 'inc', entityId: 'E1', categoryCode: 'TAX.FILING.INCOME', amount: 1_200_000 }),
  ];
  const cur = [c({ id: 'book26', entityId: 'E1', categoryCode: 'TAX.BOOK', fiscalYear: 2026 })];
  const got = renewalCandidates(prev, cur);
  assert.equal(got.length, 1);
  assert.equal(got[0].categoryCode, 'TAX.FILING.INCOME');
});

test('종료일이 없는 계약은 대상이 아니다 — 갱신이라는 개념이 없다', () => {
  // 월 기장처럼 계속 굴러가는 계약. 끝나지 않았으므로 갱신할 것도 없다.
  const prev = [c({ id: 'a', entityId: 'E1', billingCycle: '월', endDate: null })];
  assert.equal(renewalCandidates(prev, []).length, 0);
});

test('팀으로 좁힐 수 있다', () => {
  const prev = [
    c({ id: 'a', entityId: 'E1', team: 'taxteam' }),
    c({ id: 'b', entityId: 'E2', team: '감사team' }),
  ];
  assert.equal(renewalCandidates(prev, [], 'taxteam').length, 1);
  assert.equal(renewalCandidates(prev, [], '감사team').length, 1);
  assert.equal(renewalCandidates(prev, []).length, 2);
});

test('같은 거래처·유형이 앞 해에 여러 줄이어도 한 번만 내놓는다', () => {
  const prev = [
    c({ id: 'a', entityId: 'E1', amount: 500_000 }),
    c({ id: 'b', entityId: 'E1', amount: 300_000 }),
  ];
  assert.equal(renewalCandidates(prev, []).length, 1);
});

test('금액이 큰 것부터 — 먼저 볼 것이 위에 온다', () => {
  const prev = [
    c({ id: 'a', entityId: 'E1', company: '작은곳', amount: 100_000 }),
    c({ id: 'b', entityId: 'E2', company: '큰곳', amount: 900_000 }),
  ];
  assert.deepEqual(renewalCandidates(prev, []).map((x) => x.company), ['큰곳', '작은곳']);
});

// ── 체크와 금액 ──────────────────────────────────────────

test('체크하지 않으면 0 — 예산을 건드리지 않는다', () => {
  const [cand] = renewalCandidates([c({ id: 'a', entityId: 'E1', amount: 1_200_000 })], []);
  assert.equal(renewalAmount(cand, undefined), 0);
  assert.equal(renewalAmount(cand, { prevId: 'a', include: false, amount: null }), 0);
});

test('체크하면 앞 해 금액이 들어가고, 고쳐 넣으면 그 값이 들어간다', () => {
  const [cand] = renewalCandidates([c({ id: 'a', entityId: 'E1', amount: 1_200_000 })], []);
  assert.equal(renewalAmount(cand, { prevId: 'a', include: true, amount: null }), 1_200_000);
  assert.equal(renewalAmount(cand, { prevId: 'a', include: true, amount: 1_500_000 }), 1_500_000);
});

test('금액을 0 으로 적으면 0 이다 — 빈 값(null)과 다르다', () => {
  const [cand] = renewalCandidates([c({ id: 'a', entityId: 'E1', amount: 1_200_000 })], []);
  assert.equal(renewalAmount(cand, { prevId: 'a', include: true, amount: 0 }), 0);
});

test('체크된 것들의 합', () => {
  const cands = renewalCandidates([
    c({ id: 'a', entityId: 'E1', amount: 1_200_000 }),
    c({ id: 'b', entityId: 'E2', amount: 800_000 }),
    c({ id: 'c', entityId: 'E3', amount: 500_000 }),
  ], []);
  const picks = new Map<string, RenewalPick>([
    ['a', { prevId: 'a', include: true, amount: null }],
    ['b', { prevId: 'b', include: true, amount: 900_000 }],
    ['c', { prevId: 'c', include: false, amount: null }],
  ]);
  assert.equal(pickedTotal(cands, picks), 2_100_000);
});

test('아무것도 체크하지 않으면 합은 0', () => {
  const cands = renewalCandidates([c({ id: 'a', entityId: 'E1' })], []);
  assert.equal(pickedTotal(cands, new Map()), 0);
});
