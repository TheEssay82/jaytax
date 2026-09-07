// 강조 표시 가르기. **꺾쇠가 글자로 새어 나오면 안 된다** — 그것이 애초의 버그였다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emphasize, plain } from './emphasis';

test('꺾쇠 안은 강조, 밖은 보통 — 꺾쇠 자체는 사라진다', () => {
  assert.deepEqual(emphasize('앞 <강조> 뒤'), [
    { text: '앞 ', em: false },
    { text: '강조', em: true },
    { text: ' 뒤', em: false },
  ]);
});

test('꺾쇠가 맨 앞이어도 빈 조각을 만들지 않는다', () => {
  assert.deepEqual(emphasize('<처음>이 강조'), [
    { text: '처음', em: true },
    { text: '이 강조', em: false },
  ]);
});

test('꺾쇠가 맨 뒤여도 마찬가지다', () => {
  assert.deepEqual(emphasize('끝이 <강조>'), [
    { text: '끝이 ', em: false },
    { text: '강조', em: true },
  ]);
});

test('여러 번 강조해도 각각 갈린다', () => {
  const got = emphasize('<하나> 사이 <둘> 끝');
  assert.deepEqual(got.filter((p) => p.em).map((p) => p.text), ['하나', '둘']);
  assert.equal(got.length, 4);
});

test('강조가 없으면 통째로 한 조각', () => {
  assert.deepEqual(emphasize('그냥 글'), [{ text: '그냥 글', em: false }]);
});

test('짝이 맞지 않는 꺾쇠는 **건드리지 않는다** — 남은 글이 전부 굵어지면 안 된다', () => {
  assert.deepEqual(emphasize('여는 것만 < 있다'), [{ text: '여는 것만 < 있다', em: false }]);
  assert.deepEqual(emphasize('닫는 것만 > 있다'), [{ text: '닫는 것만 > 있다', em: false }]);
});

test('빈 글·없는 값도 깨지지 않는다', () => {
  assert.deepEqual(emphasize(''), []);
  assert.deepEqual(emphasize(undefined as unknown as string), []);
});

test('실제 개발노트 한 줄 — 꺾쇠가 하나도 남지 않는다', () => {
  const line = '<개발노트에 거래처 이름·금액·직원 이름이 그대로 적혀> 있는데 전 직원이 보고 있었습니다.';
  const got = emphasize(line);
  assert.equal(got[0].em, true);
  assert.equal(got[0].text, '개발노트에 거래처 이름·금액·직원 이름이 그대로 적혀');
  for (const p of got) {
    assert.ok(!p.text.includes('<'), `꺾쇠가 남았다: ${p.text}`);
    assert.ok(!p.text.includes('>'), `꺾쇠가 남았다: ${p.text}`);
  }
});

test('괄호·별표가 섞여 있어도 안쪽 글은 그대로 살린다', () => {
  // v2.60.1 의 실제 문장 — 별표를 글자로 보여 주는 것이 뜻이라 지우면 안 된다.
  const got = emphasize('Supabase 설명에 <별표(**)가 그대로 보이던 것>을 고쳤습니다.');
  assert.equal(got[1].text, '별표(**)가 그대로 보이던 것');
});

test('plain — 강조 표시를 걷어낸 맨 글', () => {
  assert.equal(plain('앞 <강조> 뒤'), '앞 강조 뒤');
  assert.equal(plain('강조 없음'), '강조 없음');
});
