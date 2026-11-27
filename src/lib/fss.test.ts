// 금감원 자료 검색어 — PostgREST or() 에 넣을 수 있게(2026-11-28).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fssTerms } from './fss';

test('검색어는 공백으로 나누고 or() 를 깨는 기호는 뺀다', () => {
  assert.deepEqual(fssTerms(' 리스  변경 '), ['리스', '변경']);
  assert.deepEqual(fssTerms('수익(진행기준),1115*'), ['수익', '진행기준', '1115']);
  assert.deepEqual(fssTerms(''), []);
  assert.equal(fssTerms('a b c d e f g').length, 5);
});
