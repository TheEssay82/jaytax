// 2026-09-04~05 에 만든 것들 — 화면으로만 확인했던 규칙에 자동 검사를 붙인다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markUnsaved, clearUnsaved, unsavedLabels } from './unsaved.ts';
import { isTop, drop } from './useEscape.ts';
import { heightFor, MIN, GAP } from './fillHeight.ts';
import { isOver6m } from './aging.ts';

// ── 저장 안 한 것 ──────────────────────────────────────────
test('표시한 것만 나온다 — 지우면 사라진다', () => {
  markUnsaved('a', '새 매출계약');
  assert.deepEqual(unsavedLabels(), ['새 매출계약']);
  clearUnsaved('a');
  assert.deepEqual(unsavedLabels(), []);
});

test('두 곳을 고치는 중이면 둘 다 알린다', () => {
  markUnsaved('a', '새 매출계약');
  markUnsaved('b', '대표자 수정');
  assert.deepEqual(unsavedLabels().sort(), ['대표자 수정', '새 매출계약']);
  clearUnsaved('a'); clearUnsaved('b');
});

test('같은 이름이 여러 곳이어도 한 번만 말한다 — 경고문이 길어지면 안 읽는다', () => {
  markUnsaved('a', '기초 미수금 3건');
  markUnsaved('b', '기초 미수금 3건');
  assert.deepEqual(unsavedLabels(), ['기초 미수금 3건']);
  clearUnsaved('a'); clearUnsaved('b');
});

test('없는 것을 지워도 탈이 없다 — 화면이 사라질 때 두 번 불릴 수 있다', () => {
  clearUnsaved('없는것');
  assert.deepEqual(unsavedLabels(), []);
});

// ── 창 닫기(ESC) ───────────────────────────────────────────
test('맨 위 창만 닫는다 — 창 위에 창이 뜬 자리에서 둘 다 닫히면 하던 일을 잃는다', () => {
  const a = Symbol('a'), b = Symbol('b');
  const s = [a, b];
  assert.equal(isTop(b, s), true);
  assert.equal(isTop(a, s), false);
});

test('위 창을 닫으면 아래 창이 맨 위가 된다', () => {
  const a = Symbol('a'), b = Symbol('b');
  const s = [a, b];
  drop(b, s);
  assert.equal(isTop(a, s), true);
});

test('가운데 창이 먼저 닫혀도 순서가 깨지지 않는다', () => {
  const a = Symbol('a'), b = Symbol('b'), c = Symbol('c');
  const s = [a, b, c];
  drop(b, s);
  assert.deepEqual(s, [a, c]);
  assert.equal(isTop(c, s), true);
});

test('없는 창을 빼도 탈이 없다', () => {
  const a = Symbol('a');
  const s = [a];
  drop(Symbol('x'), s);
  assert.deepEqual(s, [a]);
});

// ── 표 높이 ────────────────────────────────────────────────
test('표가 화면 아래 끝까지 찬다 — 창 바닥과의 틈만 남긴다', () => {
  assert.equal(heightFor(300, 1000), 1000 - 300 - GAP);
});

test('너무 낮아지면 최소 높이에서 멈춘다 — 그보다 줄이면 표가 쓸모없어진다', () => {
  assert.equal(heightFor(900, 1000), MIN);
  assert.equal(heightFor(2000, 1000), MIN);   // 표가 화면 아래로 밀려 있어도
});

test('창이 커지면 표도 커진다', () => {
  assert.ok(heightFor(300, 1400) > heightFor(300, 1000));
});

// ── 채권 나이 ──────────────────────────────────────────────
test('6개월이 넘으면 오래된 채권', () => {
  // 기준 2026-08 → 자르는 선은 2026-02-01
  assert.equal(isOver6m('2026-01-31', '2026-08'), true);
  assert.equal(isOver6m('2026-02-01', '2026-08'), false);
  assert.equal(isOver6m('2026-08-01', '2026-08'), false);
});

test('해를 넘겨도 맞는다', () => {
  // 기준 2026-01 → 자르는 선은 2025-07-01
  assert.equal(isOver6m('2025-06-30', '2026-01'), true);
  assert.equal(isOver6m('2025-07-01', '2026-01'), false);
});

test('발행일이 없으면 오래된 것으로 보지 않는다 — 모르는 것을 단정하지 않는다', () => {
  assert.equal(isOver6m(null, '2026-08'), false);
});

// ── 「내 것만」 스위치 ──────────────────────────────────────
// 저장소가 없는 곳(테스트·사생활 보호 창)에서도 화면이 떠야 한다.
test('저장소가 막혀 있어도 켜고 끌 수 있다', async () => {
  const { getMineOnly, setMineOnly } = await import('./mineOnly.ts');
  assert.equal(getMineOnly(), false);          // 처음은 꺼짐
  setMineOnly(true);
  assert.equal(getMineOnly(), true);
  setMineOnly(false);
  assert.equal(getMineOnly(), false);
});

test('같은 값을 다시 넣으면 알리지 않는다 — 화면이 헛되이 다시 그려지지 않게', async () => {
  const { setMineOnly, subscribe } = await import('./mineOnly.ts');
  setMineOnly(false);
  let called = 0;
  const off = subscribe(() => { called += 1; });
  setMineOnly(true);   // 바뀜 → 한 번
  setMineOnly(true);   // 그대로 → 알리지 않음
  setMineOnly(false);  // 바뀜 → 한 번
  off();
  assert.equal(called, 2);
});

test('끊고 나면 더 이상 알리지 않는다 — 사라진 화면에 대고 말하면 안 된다', async () => {
  const { setMineOnly, subscribe } = await import('./mineOnly.ts');
  let called = 0;
  const off = subscribe(() => { called += 1; });
  off();
  setMineOnly(true);
  setMineOnly(false);
  assert.equal(called, 0);
});
