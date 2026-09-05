import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketOf, splitIssued, balanceOf, hasAnything } from './receivableCalc.ts';

const m = (status: string, total: number) => ({ status, total });

// ── 어느 칸에 담기는가 ─────────────────────────────────────
test('발행완료는 발행, (−)수정발행은 취소', () => {
  assert.equal(bucketOf(m('발행완료', 100)), 'issued');
  assert.equal(bucketOf(m('수정발행', -100)), 'cancelled');
});

test('요청만 된 건은 아직 채권이 아니다', () => {
  assert.equal(bucketOf(m('요청', 100)), null);
});

test('요청 단계에서 취소한 건은 세금계산서가 나간 적이 없어 채권이 아니다', () => {
  // 이것을 「취소」 칸에 넣으면 나가지도 않은 돈을 빼게 된다.
  assert.equal(bucketOf(m('취소', 100)), null);
});

test('발행과 취소를 가른다 — 취소는 양수로 담는다', () => {
  const r = splitIssued([m('발행완료', 1000), m('수정발행', -300), m('취소', 500), m('요청', 200)]);
  assert.deepEqual(r, { issued: 1000, cancelled: 300 });
});

// ── 미수금 셈 ──────────────────────────────────────────────
test('미수금 = 기초 + 발행 − 취소 − 입금 − 대손', () => {
  assert.equal(balanceOf({ opening: 1000, issued: 500, cancelled: 100, paid: 200, writeoff: 50 }), 1150);
});

test('대손이 0 이면 지금까지와 같은 값 — 옛 계산과 어긋나지 않는다', () => {
  assert.equal(balanceOf({ opening: 7480000, issued: 7700000, cancelled: 0, paid: 15180000, writeoff: 0 }), 0);
});

test('취소가 발행보다 크면 음수가 된다 — 감춰서는 안 되는 신호다', () => {
  assert.equal(balanceOf({ opening: 0, issued: 100, cancelled: 300, paid: 0, writeoff: 0 }), -200);
});

test('장기미수를 대손 처리하면 미수금이 0 이 된다', () => {
  assert.equal(balanceOf({ opening: 880000, issued: 0, cancelled: 0, paid: 0, writeoff: 880000 }), 0);
});

// ── 표에 세울지 ────────────────────────────────────────────
test('움직임이 하나도 없으면 표에 세우지 않는다', () => {
  assert.equal(hasAnything({ opening: 0, issued: 0, cancelled: 0, paid: 0, writeoff: 0 }), false);
});

test('대손만 있어도 표에 세운다 — 대손이 있었다는 사실이 보여야 한다', () => {
  assert.equal(hasAnything({ opening: 0, issued: 0, cancelled: 0, paid: 0, writeoff: 100 }), true);
});

test('취소만 있어도 표에 세운다', () => {
  assert.equal(hasAnything({ opening: 0, issued: 0, cancelled: 100, paid: 0, writeoff: 0 }), true);
});

// ── 수정발행의 부호 (2026-09-06 실제 사고) ─────────────────
test('(+)수정발행「되살리기」는 채권을 늘린다 — 취소가 아니다', () => {
  // ㈜제이엠스토리: 「(−)크레딧 소멸분 되살리기」 +165,000 을 취소로 세어
  // 미수금이 0 이어야 하는데 −330,000 으로 나왔다.
  assert.equal(bucketOf(m('수정발행', 165000)), 'issued');
  assert.equal(bucketOf(m('수정발행', -165000)), 'cancelled');
});

test('제이엠스토리 실제 값 — 미수금이 0 이 된다', () => {
  const { issued, cancelled } = splitIssued([
    m('수정발행', 165000),   // 2026-06 되살리기
    m('발행완료', 165000),   // 2026-07
    m('취소', 165000),       // 2026-08 요청 취소 — 채권 아님
  ]);
  assert.deepEqual({ issued, cancelled }, { issued: 330000, cancelled: 0 });
  assert.equal(balanceOf({ opening: 2530000, issued, cancelled, paid: 2860000, writeoff: 0 }), 0);
});

test('0 원 수정발행은 발행 쪽 — 음수일 때만 취소다', () => {
  assert.equal(bucketOf(m('수정발행', 0)), 'issued');
});
