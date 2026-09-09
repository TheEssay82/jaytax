// 거래처 저장 오류 말바꿈. **원문을 잃지 않는 것**이 요점이다 — 잃으면 나중에 못 고친다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bizErr } from './bizErrors';

test('사업자등록번호가 겹치면 무엇을 하라는지 말해 준다', () => {
  const s = bizErr(new Error('duplicate key value violates unique constraint "uniq_place_biz_reg"'));
  assert.match(s, /사업자등록번호/);
  assert.doesNotMatch(s, /duplicate key/, '원문 영어가 그대로 새어 나오면 안 된다');
});

test('같은 거래처의 같은 사업장 이름', () => {
  assert.match(bizErr(new Error('... "uniq_place_entity_name"')), /사업장 이름/);
});

test('본사는 하나뿐', () => {
  assert.match(bizErr(new Error('... "uniq_place_hq"')), /본사/);
});

test('거래처 코드 겹침 — 채번 문제임을 알린다', () => {
  assert.match(bizErr(new Error('duplicate key value violates unique constraint "biz_entity_code_key"')), /채번/);
});

test('모르는 겹침이면 겹쳤다는 사실 + 원문', () => {
  const s = bizErr(new Error('duplicate key value violates unique constraint "무언가_새로운_키"'));
  assert.match(s, /이미 등록된 값/);
  assert.match(s, /무언가_새로운_키/, '모르는 것은 원문을 남겨야 고칠 수 있다');
});

test('겹침이 아닌 오류는 원문 그대로', () => {
  assert.equal(bizErr(new Error('네트워크 연결 실패')), '네트워크 연결 실패');
});

test('Error 가 아닌 것도 문자열로 받는다', () => {
  assert.equal(bizErr('그냥 문자열'), '그냥 문자열');
  assert.equal(bizErr(null), '알 수 없는 오류입니다.');
  assert.equal(bizErr(undefined), '알 수 없는 오류입니다.');
});
