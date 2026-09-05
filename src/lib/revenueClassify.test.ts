import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revenueKind, typeTopFromErp } from './revenueClassify.ts';

test('수입 종류 — 세무조정·기장료·기타', () => {
  assert.equal(revenueKind('세무조정수입'), '세무조정');
  assert.equal(revenueKind('기장대리수입'), '기장료');
  assert.equal(revenueKind('회계감사수입'), '기타');
  assert.equal(revenueKind(''), '기타');
});

// ── 계약 없는 청구의 대분류 ────────────────────────────────
test('계약이 없어도 ERP 계정으로 칸을 정한다 — 파인즈플래닝 (−)수정 3건이 그랬다', () => {
  assert.equal(typeTopFromErp('기장대리수입'), '기장');
});

test('계정별 대분류', () => {
  assert.equal(typeTopFromErp('세무조정수입'), '신고');
  assert.equal(typeTopFromErp('회계감사수입'), '감사');
  assert.equal(typeTopFromErp('임의감사수입'), '감사');
  assert.equal(typeTopFromErp('기업진단수입'), '진단');
  assert.equal(typeTopFromErp('기타용역수입'), '컨설팅');
  assert.equal(typeTopFromErp('경영자문수입'), '컨설팅');
});

test('계정도 비어 있으면 빈 값 — 모르는 것을 지어내지 않는다', () => {
  assert.equal(typeTopFromErp(''), '');
  assert.equal(typeTopFromErp('   '), '');
});
