import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clauseNo, splitClauses, clipArticle } from './lawClip.ts';

const 조문 = [
  '제26조의8(통합고용세액공제)',
  '① 소비성서비스업을 말한다.',
  '② 상시근로자란 다음 각 호를 제외한 근로자를 말한다.',
  '③ 최소고용증가인원수란 중견기업 5명을 말한다.',
  '④ 청년등상시근로자란 34세 이하인 사람을 말한다.',
  '⑤ 삭제',
  '⑥ 계산방법은 제11조의2제8항을 준용한다.',
  '⑦ 출산전후휴가 대체인력은 제외한다.',
  '⑧ 창업한 내국인은 제23조제13항을 준용한다.',
].join('\n');

test('clauseNo — 항 머리글자만 번호로 읽는다', () => {
  assert.equal(clauseNo('① 가나다'), 1);
  assert.equal(clauseNo('⑧ 창업'), 8);
  assert.equal(clauseNo('제26조의8(제목)'), 0);
  assert.equal(clauseNo(''), 0);
});

test('splitClauses — 제목 한 덩이 + 항마다 한 덩이', () => {
  const parts = splitClauses(조문);
  assert.equal(parts.length, 9);
  assert.equal(clauseNo(parts[0]), 0);
  assert.equal(clauseNo(parts[8]), 8);
});

test('splitClauses — 항 표시가 없으면 통째로 하나', () => {
  assert.deepEqual(splitClauses('제1조(목적) 이 법은 …'), ['제1조(목적) 이 법은 …']);
  assert.deepEqual(splitClauses('   '), []);
});

test('상한 안에 들면 손대지 않는다', () => {
  assert.equal(clipArticle(조문, 9999), 조문.trim());
});

test('항 경계에서 자르고 빠진 항을 밝힌다', () => {
  const out = clipArticle(조문, 120);
  assert.ok(out.includes('② 상시근로자란'), '남은 항은 통째로 남는다');
  assert.ok(!out.includes('⑧ 창업한'), '상한을 넘은 항은 빠진다');
  assert.ok(/…\(제\d+항부터 제8항까지 생략/.test(out), out.slice(-120));
  assert.ok(out.includes('"없다"고 단정하지 않는다'));
});

test('항 하나만 빠지면 "제N항 생략"', () => {
  const out = clipArticle(조문, 조문.length - 20);
  assert.ok(out.includes('(제8항 생략'), out.slice(-80));
});

test('첫 덩이부터 상한을 넘으면 글자 수로 자르되 생략을 밝힌다', () => {
  const out = clipArticle(조문, 10);
  assert.ok(out.length < 200);
  assert.ok(out.includes('생략'));
});

test('항이 없는 긴 조문도 잘렸다고 밝힌다', () => {
  const 긴글 = '가'.repeat(500);
  const out = clipArticle(긴글, 100);
  assert.ok(out.startsWith('가'.repeat(100)));
  assert.ok(out.includes('(뒷부분 생략'));
});
