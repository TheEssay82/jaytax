// 단계·진행 정도 — 거래처 목록 색.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressOf } from './gwpStage';
test('거래처 목록 진행 정도 — 세팅 전 · 판 없음 · 작성 중 · 1/2/3차 확정(사용자 2026-10-01)', () => {
  assert.equal(progressOf(false, 3, [1]).key, 'none');
  assert.equal(progressOf(true, 0, []).key, 'setup');
  assert.equal(progressOf(true, 2, []).key, 'draft');
  assert.equal(progressOf(true, 6, [1]).key, 'stage1');
  assert.equal(progressOf(true, 9, [1, 2]).key, 'stage2');
  assert.equal(progressOf(true, 12, [1, 2, 3]).key, 'stage3');
  assert.equal(progressOf(true, 9, [2]).key, 'draft');   // 1차가 취소돼 있으면 2차만으로는 진행으로 치지 않는다
});
