import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTitle, recipientLabel, stripHonorific } from './honorific.ts';

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

test('직책 칸이 있으면 그것을 쓴다 — 호칭이 님이어도', () => {
  assert.equal(recipientLabel('홍길동', '과장', '님'), '홍길동 과장님');
});

test('직책 칸이 비면 호칭 칸이 직함 노릇을 한다', () => {
  assert.equal(recipientLabel('홍길동', '', '과장'), '홍길동 과장님');
});

test('호칭에 이미 님이 붙어 있어도 두 번 붙지 않는다', () => {
  assert.equal(recipientLabel('홍길동', '', '과장님'), '홍길동 과장님');
  assert.equal(recipientLabel('홍길동', '과장님', '님'), '홍길동 과장님');
});

test('둘이 어긋나면 직책 칸이 이긴다 — 그 일을 하라고 만든 칸이다', () => {
  assert.equal(recipientLabel('홍길동', '팀장', '과장'), '홍길동 팀장님');
});

test('직함이 없으면 「이름 님」', () => {
  assert.equal(recipientLabel('홍길동', '', ''), '홍길동 님');
  assert.equal(recipientLabel('홍길동', '', '님'), '홍길동 님');
});

test('이름에 이미 님이 붙어 있어도 겹치지 않는다', () => {
  assert.equal(recipientLabel('홍길동님', '', '과장'), '홍길동 과장님');
  assert.equal(recipientLabel('홍길동 님', '', ''), '홍길동 님');
});

test('사모님·어머님은 통째로 하나라 님을 덧붙이지 않는다', () => {
  assert.equal(recipientLabel('홍길동', '', '사모님'), '홍길동 사모님');
  assert.equal(recipientLabel('홍길동', '', '어머님'), '홍길동 어머님');
});

test('이름이 없으면 빈 문자열 — 「 님」이 되면 안 된다', () => {
  assert.equal(recipientLabel('', '과장', '님'), '');
  assert.equal(recipientLabel('  ', '', ''), '');
});

test('pickTitle — 님은 직함이 아니다', () => {
  assert.equal(pickTitle('', '님'), '');
  assert.equal(pickTitle('', ''), '');
  assert.equal(pickTitle('과장', ''), '과장');
});
