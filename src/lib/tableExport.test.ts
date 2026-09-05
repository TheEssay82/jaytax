import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toTsv, stamp } from './tableExport.ts';

test('머리글과 줄을 탭으로 가른다', () => {
  assert.equal(toTsv(['코드', '금액'], [['L0077', 10000]]), '코드\t금액\nL0077\t10000');
});

test('칸 안의 탭·줄바꿈은 공백으로 — 넣어 두면 칸이 밀린다', () => {
  assert.equal(toTsv(['적요'], [['가\t나']]), '적요\n가 나');
  assert.equal(toTsv(['적요'], [['가\n나']]), '적요\n가 나');
});

test('빈 값과 0 을 가린다 — 0 은 값이라 지우면 안 된다', () => {
  assert.equal(toTsv(['a', 'b'], [[0, '']]), 'a\tb\n0\t');
});

test('줄이 없으면 머리글만', () => {
  assert.equal(toTsv(['a', 'b'], []), 'a\tb');
});

test('날짜 도장은 여덟 자리', () => {
  assert.equal(stamp(new Date(2026, 8, 5)), '20260905');
  assert.equal(stamp(new Date(2026, 0, 1)), '20260101');
});
