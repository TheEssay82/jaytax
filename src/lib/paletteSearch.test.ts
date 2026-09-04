import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hit, initials, isChoQuery, norm, digitsHit } from './paletteSearch.ts';

// ── 초성이 가운데서 걸리면 안 된다 (실제로 겪은 일) ─────────
test('「ㅇㅌ」은 앞글자가 맞는 것만 — 나이스앱텍은 걸리지 않는다', () => {
  assert.equal(hit('오톰', 'ㅇㅌ'), true);
  assert.equal(hit('㈜오톰', 'ㅇㅌ'), true);
  assert.equal(hit('나이스앱텍', 'ㅇㅌ'), false);   // ㄴㅇㅅㅇㅌ — 가운데
  assert.equal(hit('대양이티에스', 'ㅇㅌ'), false); // ㄷㅇㅇㅌㅇㅅ — 가운데
});

test('이모지가 앞에 붙어도 초성은 글자에서 시작한다', () => {
  assert.equal(norm('📄 매출계약등록'), '매출계약등록');
  assert.equal(hit('📄 매출계약등록', 'ㅁㅊ'), true);
});

test('질의에 자모가 아닌 글자가 섞이면 초성으로 보지 않는다', () => {
  assert.equal(isChoQuery('ㅇㅌ'), true);
  assert.equal(isChoQuery('오톰'), false);
  assert.equal(isChoQuery('ㅇ톰'), false);
});

// ── 보통 검색 ───────────────────────────────────────────────
test('이름 가운데 글자로도 찾는다', () => {
  assert.equal(hit('㈜오톰', '톰'), true);
  assert.equal(hit('㈜오톰', '오톰'), true);
});

test('괄호·㈜·가운뎃점·공백은 무시한다', () => {
  assert.equal(hit('㈜ 오톰', '오톰'), true);
  assert.equal(hit('에이엘티(Alt)', 'alt'), true);
  assert.equal(hit('수금·미수금', '수금미수금'), true);
});

test('영문은 대소문자를 가리지 않는다', () => {
  assert.equal(hit('taxteam', 'TAX'), true);
});

test('빈 질의는 모두 통과 — 아무것도 치지 않으면 전부 보인다', () => {
  assert.equal(hit('무엇이든', ''), true);
});

// ── 사업자번호 ─────────────────────────────────────────────
test('사업자번호는 하이픈을 지우고 견준다', () => {
  assert.equal(digitsHit('123-45-67890', '1234567890'), true);
  assert.equal(digitsHit('123-45-67890', '45-678'), true);
  assert.equal(digitsHit('123-45-67890', '99999'), false);
});

test('숫자가 없는 질의로는 사업자번호가 걸리지 않는다', () => {
  assert.equal(digitsHit('123-45-67890', '오톰'), false);
});

// ── initials 자체 ──────────────────────────────────────────
test('초성 변환 — 한글이 아닌 글자는 그대로 둔다', () => {
  assert.equal(initials('오톰A1'), 'ㅇㅌA1');
  assert.equal(initials('짐티피'), 'ㅈㅌㅍ');
});
