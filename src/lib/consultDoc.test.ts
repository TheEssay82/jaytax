// 회신 가르기. **옛 기록이 깨지지 않는 것**이 절반이다 — 「한눈에」는 2026-09-10 에 생겼다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bullets, clipLine, parseConsultDoc, summaryLines } from './consultDoc';

const FULL = `# [세무 회신] 장애인고용부담금의 손금 여부

## 한눈에
- 구법(2024년 이전) 발생분은 손금산입입니다.
- 2025.1.1. 이후 발생분은 개정 조문에 걸려 손금불산입입니다.
- 과거 신고분은 경정청구 여지를 살펴보십시오.

## 질의요지
손금으로 인정되는지 물으셨습니다.

## 결론
1. **2024년 이전** — 손금산입.
2. **2025년 이후** — 손금불산입.

## 근거
- **법인세법 제21조 제5호** — "제재로서 부과되는 공과금"
- **대법원 2024두30809** — 소극

## 실무 유의
- 부담금 본세와 가산금을 나눠 집계하십시오.

적용 법령 시행일: 법인세법 2026.01.01

---
※ 본 회신은 AI 보조 자료입니다. 전문가 최종검토 필요.`;

test('여섯 블록을 이름으로 알아본다', () => {
  const d = parseConsultDoc(FULL);
  assert.deepEqual(d.sections.map((s) => s.key), ['한눈에', '질의요지', '결론', '근거', '실무유의']);
});

test('제목·꼬리말·안내를 각자 자리로 보낸다', () => {
  const d = parseConsultDoc(FULL);
  assert.equal(d.title, '[세무 회신] 장애인고용부담금의 손금 여부');
  assert.match(d.applied, /^적용 법령 시행일/);
  assert.match(d.footer, /AI 보조 자료/);
  assert.doesNotMatch(d.sections.at(-1)!.body, /적용 법령/, '꼬리말이 실무유의에 섞이면 안 된다');
});

test('한눈에는 세 줄로 뽑힌다 — 굵게 표시는 벗긴다', () => {
  const d = parseConsultDoc(FULL);
  assert.equal(d.summary.length, 3);
  assert.equal(d.summary[0], '구법(2024년 이전) 발생분은 손금산입입니다.');
});

test('블록 본문에는 제목 줄이 없다', () => {
  const d = parseConsultDoc(FULL);
  const 결론 = d.sections.find((s) => s.key === '결론')!;
  assert.doesNotMatch(결론.body, /^##/m);
  assert.match(결론.body, /손금산입/);
});

test('실무 유의 — 띄어쓰기가 달라도 같은 블록', () => {
  assert.equal(parseConsultDoc('## 실무유의\n- 가').sections[0].key, '실무유의');
  assert.equal(parseConsultDoc('## 실무 유의\n- 가').sections[0].key, '실무유의');
});

test('모르는 블록은 기타로 두되 제목을 남긴다', () => {
  const d = parseConsultDoc('## 참고사항\n내용');
  assert.equal(d.sections[0].key, '기타');
  assert.equal(d.sections[0].title, '참고사항');
});

test('옛 회신 — 한눈에가 없으면 결론에서 세 줄을 만든다', () => {
  const old = `# 제목
## 결론
- 손금산입입니다.
- 다만 시점을 확인하십시오.
## 근거
- 조문`;
  assert.deepEqual(parseConsultDoc(old).summary, [], '없는 것을 지어내지 않는다');
  assert.deepEqual(summaryLines(old), ['손금산입입니다.', '다만 시점을 확인하십시오.']);
});

test('불릿이 없는 결론도 문장으로 세 줄을 만든다', () => {
  const old = `## 결론
1. **첫째** 손금산입.
2. 둘째 확인 필요.`;
  assert.deepEqual(summaryLines(old), ['첫째 손금산입.', '둘째 확인 필요.']);
});

test('형식을 아예 안 지킨 회신도 통째로 보여 준다', () => {
  const plain = '그냥 줄글로 쓴 회신입니다.\n두 번째 줄.';
  const d = parseConsultDoc(plain);
  assert.equal(d.sections.length, 1);
  assert.equal(d.sections[0].key, '기타');
  assert.equal(d.sections[0].body, plain);
});

test('제목과 첫 블록 사이에 낀 글도 버리지 않는다', () => {
  const d = parseConsultDoc('# 제목\n낀 글\n\n## 결론\n답');
  assert.equal(d.sections[0].key, '기타');
  assert.equal(d.sections[0].body, '낀 글');
  assert.equal(d.sections[1].key, '결론');
});

test('빈 입력에도 무너지지 않는다', () => {
  const d = parseConsultDoc('');
  assert.deepEqual(d, { title: '', summary: [], sections: [], applied: '', footer: '' });
  assert.deepEqual(summaryLines(''), []);
});

test('bullets — •, *, - 를 모두 받는다', () => {
  assert.deepEqual(bullets('- 가\n* 나\n• 다\n라'), ['가', '나', '다']);
});

test('clipLine — 첫 문장까지만', () => {
  assert.equal(clipLine('첫 문장입니다. 둘째 문장입니다.'), '첫 문장입니다.');
  assert.equal(clipLine('짧은 줄'), '짧은 줄');
  assert.equal(clipLine(''), '');
});

test('clipLine — 조문 번호의 마침표에서 끊지 않는다', () => {
  assert.equal(
    clipLine('소득세법 제39조제5항.5에 따라 판단합니다. 다음 문장.'),
    '소득세법 제39조제5항.5에 따라 판단합니다.',
  );
});

test('clipLine — 문장이 길면 글자 수로 자르고 말줄임을 붙인다', () => {
  const long = '가'.repeat(200) + '.';
  const s = clipLine(long, 30);
  assert.equal(s.length, 30);
  assert.ok(s.endsWith('…'));
});
