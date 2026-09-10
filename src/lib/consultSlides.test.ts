// 슬라이드 자르기. **한 장에 들어가는 양이 정해져 있다**는 것이 이 모듈의 존재 이유다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BULLETS_PER_SLIDE, chunk, packBullets, packProse, splitBullet, toSlides } from './consultSlides';

const FULL = `# [세무 회신] 접대비 한도초과액의 손금불산입과 귀속시기

## 한눈에
- 한도초과액은 전액 손금불산입입니다.
- 귀속시기는 접대행위가 있은 날입니다.
- 법인카드 전표를 월별로 모아 두십시오.

## 질의요지
접대비 한도와 귀속시기를 물으셨습니다.

## 결론
1. **한도초과액** — 손금불산입.
2. **귀속시기** — 접대행위일.

## 근거
- **법인세법 제25조 (시행 2026.01.01)** — "손금에 산입하지 아니한다" (→ 풀이: 한도 계산은 수입금액 기준)
- **법인세법 시행령 제42조** — 한도 계산식
- 국세청 서면-2021-법인-1234 — 귀속시기는 접대행위일
- 조심 2025서1111 — 기각
- 대법원 2020두1234 — 상고기각
- 추가 근거 여섯째

## 실무 유의
- 법인카드 전표를 월별로 모으십시오.

적용 법령 시행일: 법인세법 2026.01.01

---
※ 본 회신은 AI 보조 자료입니다.`;

test('표지·한눈에로 시작하고 마무리로 끝난다', () => {
  const s = toSlides(FULL, '2026-09-10');
  assert.equal(s[0].kind, 'cover');
  assert.equal(s[1].kind, 'glance');
  assert.equal(s.at(-1)!.kind, 'end');
});

test('질의요지는 슬라이드로 만들지 않는다 — 내가 쓴 질문이다', () => {
  const labels = toSlides(FULL).map((x) => ('label' in x ? x.label : x.kind));
  assert.ok(!labels.includes('질의요지'));
});

test('짧은 근거 여섯 줄은 한 장에 들어간다 — 개수만 세던 때는 괜히 쪼갰다', () => {
  const ev = toSlides(FULL).filter((x) => x.kind === 'bullets' && x.label === '근거');
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].part, ev[0].parts], [1, 1]);
  assert.equal((ev[0] as { items: unknown[] }).items.length, BULLETS_PER_SLIDE);
});

test('긴 불릿은 개수가 적어도 길이에서 끊긴다 — 판 밖으로 넘쳐 잘리면 안 된다', () => {
  const long = (n: number) => ({ lead: '조문' + n, rest: '가'.repeat(240) });
  const pages = packBullets([long(1), long(2), long(3)]);
  assert.equal(pages.length, 2, '244자 짜리는 두 개까지만');
  assert.equal(pages[0].length, 2);
  assert.equal(pages[1].length, 1);
});

test('예산보다 긴 한 줄은 버리지 않고 혼자 한 장을 쓴다', () => {
  const huge = { lead: '조문', rest: '가'.repeat(900) };
  const pages = packBullets([huge, { lead: '짧은 줄', rest: '' }]);
  assert.deepEqual(pages.map((p) => p.length), [1, 1]);
});

test('짧은 줄은 개수 상한까지 담는다', () => {
  const short = Array.from({ length: 9 }, (_, i) => ({ lead: '줄' + i, rest: '' }));
  assert.deepEqual(packBullets(short).map((p) => p.length), [BULLETS_PER_SLIDE, 3]);
});

test('packBullets — 빈 목록이면 빈 결과', () => {
  assert.deepEqual(packBullets([]), []);
});

test('한 장짜리 블록도 part/parts 를 갖는다', () => {
  const note = toSlides(FULL).find((x) => x.kind === 'bullets' && x.label === '실무 유의')!;
  assert.deepEqual([note.part, note.parts], [1, 1]);
});

test('splitBullet — 굵게 표시가 앞머리가 된다', () => {
  assert.deepEqual(
    splitBullet('**법인세법 제25조** — "손금에 산입하지 아니한다"'),
    { lead: '법인세법 제25조', rest: '"손금에 산입하지 아니한다"' },
  );
});

test('splitBullet — 굵게가 없으면 긴 줄표에서 가른다', () => {
  assert.deepEqual(
    splitBullet('조심 2025서1111 — 기각'),
    { lead: '조심 2025서1111', rest: '기각' },
  );
});

test('splitBullet — 가를 데가 없으면 통째로 앞머리', () => {
  assert.deepEqual(splitBullet('그냥 한 줄'), { lead: '그냥 한 줄', rest: '' });
});

test('splitBullet — 앞머리가 지나치게 길면 가르지 않는다', () => {
  const long = '가'.repeat(80) + ' — 뒤';
  assert.equal(splitBullet(long).rest, '', '80자짜리 앞머리는 앞머리가 아니다');
});

test('packProse — 문단 경계에서만 자른다', () => {
  const t = ['가'.repeat(200), '나'.repeat(200), '다'.repeat(200)].join('\n\n');
  const pages = packProse(t, 420);
  assert.equal(pages.length, 2);
  assert.ok(pages[0].includes('가') && pages[0].includes('나'));
  assert.equal(pages[1], '다'.repeat(200));
});

test('packProse — 문단 하나가 목표보다 크면 혼자 한 장을 쓴다', () => {
  const pages = packProse('가'.repeat(900), 420);
  assert.deepEqual(pages, ['가'.repeat(900)]);
});

test('불릿이 없는 블록은 줄글 슬라이드가 된다', () => {
  const md = '## 결론\n첫 문단입니다.\n\n둘째 문단입니다.';
  const s = toSlides(md);
  assert.equal(s.length, 1);
  assert.equal(s[0].kind, 'prose');
});

test('옛 회신 — 한눈에가 없으면 그 장을 만들지 않는다', () => {
  const md = '# 제목\n## 결론\n- 답입니다.';
  const kinds = toSlides(md).map((x) => x.kind);
  assert.deepEqual(kinds, ['cover', 'bullets']);
});

test('빈 입력이면 슬라이드도 없다', () => {
  assert.deepEqual(toSlides(''), []);
});

test('chunk — 딱 떨어지지 않아도 마지막 조각을 남긴다', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
});
