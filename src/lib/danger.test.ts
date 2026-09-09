// 되돌릴 수 없는 확인. **손이 먼저 움직이는 자리**라, 열리고 닫히는 조건을 못박는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canProceed, needsTyping, normalize, splitList, targetLine, wordToType } from './danger';

test('받아 적을 필요가 없으면 언제나 열려 있다', () => {
  assert.equal(needsTyping({ title: 'x' }), false);
  assert.equal(needsTyping({ title: 'x', level: 'delete' }), false);
  assert.equal(needsTyping({ title: 'x', level: 'bulk' }), false);
  assert.equal(canProceed({ title: 'x', level: 'bulk' }, ''), true);
});

test('파기는 글자를 그대로 받아 적어야 열린다', () => {
  const ask = { title: '파기', level: 'purge' as const, target: '홍길동' };
  assert.equal(needsTyping(ask), true);
  assert.equal(canProceed(ask, ''), false);
  assert.equal(canProceed(ask, '홍길'), false);
  assert.equal(canProceed(ask, '홍길동'), true);
});

test('앞뒤 공백과 사이 겹공백은 봐준다 — 공백 하나로 막히면 억울하다', () => {
  const ask = { title: 'x', level: 'purge' as const, target: '주식회사 다온' };
  assert.equal(canProceed(ask, '  주식회사   다온 '), true);
  assert.equal(canProceed(ask, '주식회사다온'), false, '공백을 아예 뺀 것은 다른 글자다');
});

test('받아 적을 글자는 confirmWord → target → 파기 순', () => {
  assert.equal(wordToType({ title: 'x', confirmWord: '전부파기', target: '홍길동' }), '전부파기');
  assert.equal(wordToType({ title: 'x', target: '홍길동' }), '홍길동');
  assert.equal(wordToType({ title: 'x' }), '파기');
});

test('normalize — 빈 값도 문자열로 돌려준다', () => {
  assert.equal(normalize('  가  나 '), '가 나');
  assert.equal(normalize(undefined as unknown as string), '');
});

test('목록은 8건까지 펼치고 나머지는 센다', () => {
  const ten = Array.from({ length: 10 }, (_, i) => `건${i + 1}`);
  const { shown, more } = splitList(ten);
  assert.equal(shown.length, 8);
  assert.equal(more, 2);
  assert.equal(shown[0], '건1');
});

test('빈 이름은 목록에서 세지 않는다', () => {
  const { shown, more } = splitList(['가', '', '  ', '나']);
  assert.deepEqual(shown, ['가', '나']);
  assert.equal(more, 0);
});

test('목록이 적으면 접지 않는다', () => {
  assert.deepEqual(splitList(['가', '나']), { shown: ['가', '나'], more: 0 });
  assert.deepEqual(splitList(undefined), { shown: [], more: 0 });
});

test('제목 아래 한 줄 — 한 건이면 이름, 여럿이면 「외 N건」', () => {
  assert.equal(targetLine({ title: 'x', target: '다온' }), '다온');
  assert.equal(targetLine({ title: 'x', targets: ['다온'] }), '다온');
  assert.equal(targetLine({ title: 'x', targets: ['다온', '정원', '닥터손'] }), '다온 외 2건');
  assert.equal(targetLine({ title: 'x' }), '');
});

test('target 이 있으면 targets 보다 먼저다', () => {
  assert.equal(targetLine({ title: 'x', target: '다온', targets: ['가', '나'] }), '다온');
});
