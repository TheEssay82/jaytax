import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayName, stripHonorific } from './honorific.ts';

test('「님」은 한 번만 — 이름에 이미 있으면 덧붙이지 않는다', () => {
  assert.equal(displayName('공나영 대표님', '님'), '공나영 대표님');
  assert.equal(displayName('신가영 님', '님'), '신가영 님');
});

test('직책까지 적혀 있으면 붙여 쓴다 — 「공나영 대표 님」은 어색하다', () => {
  assert.equal(displayName('공나영 대표', '님'), '공나영 대표님');
  assert.equal(displayName('김은지 과장', '님'), '김은지 과장님');
});

test('이름만 있으면 띄어 쓴다', () => {
  assert.equal(displayName('신가영', '님'), '신가영 님');
});

test('호칭이 비어 있으면 이름만 — 「어머님」처럼 통호칭인 자료가 그렇다', () => {
  assert.equal(displayName('박은정 어머님', ''), '박은정 어머님');
  assert.equal(displayName('황영훈 아버님', ''), '황영훈 아버님');
});

test('빈 이름은 빈 문자열', () => {
  assert.equal(displayName('', '님'), '');
  assert.equal(displayName('   ', '님'), '');
});

test('「귀하」 같은 다른 호칭에도 같은 규칙', () => {
  assert.equal(displayName('홍길동', '귀하'), '홍길동 귀하');
  assert.equal(displayName('홍길동 귀하', '귀하'), '홍길동 귀하');
});

// ── 떼기 ───────────────────────────────────────────────────
test('이름 끝의 님을 뗀다', () => {
  assert.equal(stripHonorific('공나영 대표님'), '공나영 대표');
  assert.equal(stripHonorific('신가영 님'), '신가영');
});

test('어머님·아버님·사모님은 통째로 하나의 호칭이라 떼지 않는다', () => {
  assert.equal(stripHonorific('박은정 어머님'), '박은정 어머님');
  assert.equal(stripHonorific('황영훈 아버님'), '황영훈 아버님');
  assert.equal(stripHonorific('나유리 사모님'), '나유리 사모님');
});

test('님이 없으면 그대로', () => {
  assert.equal(stripHonorific('홍길동'), '홍길동');
});

test('띄어쓰기가 없어도 직책으로 끝나면 붙여 쓴다 — 「강성제매니저 님」은 어색하다', () => {
  assert.equal(displayName('강성제매니저', '님'), '강성제매니저님');
  assert.equal(displayName('정선희실장', '님'), '정선희실장님');
});

test('직책이 아닌 이름은 띄어 쓴다', () => {
  assert.equal(displayName('강필승', '님'), '강필승 님');
  assert.equal(displayName('김효주', '님'), '김효주 님');
});
