// 말풍선 단계 안내 — 지금 할 단계는 안 끝난 첫 단계 하나뿐(사용자 2026-11-28).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentStep } from './CoachBubble.tsx';

test('지금 할 단계 — 안 끝난 첫 단계, 건너뛸 단계는 빼고, 다 끝나면 없음', () => {
  assert.equal(currentStep([{ id: 'a', done: true }, { id: 'b', done: false }, { id: 'c', done: false }]), 'b');
  assert.equal(currentStep([{ id: 'a', done: true }, { id: 'b', done: false, skip: true }, { id: 'c', done: false }]), 'c');
  assert.equal(currentStep([{ id: 'a', done: true }, { id: 'b', done: true }]), null);
});
