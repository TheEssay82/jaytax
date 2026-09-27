// 질문·기재형 웹 조서(소규모 2520·2530) — 항목 읽기, 초안 채우기, 기재 줄 문구 살려 쓰기.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SheetData, CellValue } from './xlsxRead';
import { PAPER_2530, withDraft, DRAFT_2530, layoutQA } from './gwpPaperQA';

const sheet = (name: string, cells: Record<string, CellValue>): SheetData => ({ name, cells: new Map(Object.entries(cells)) });
const t = (text: string): CellValue => ({ text });
const D = '-상기 파악한 내용의 기재 : \r\n-또는 별도의 조서에서 검토 : 조서번호 ( )';

const S = sheet('2530(소규모)', {
  A7: t('항 목'), E7: t('수 행 자'), F7: t('비 고'),
  A8: t('1. 감사인은 다음에 해당하는 경우, 관련 통제활동의 설계를 평가하고'),
  A9: t('(a) 통제가 효과적으로 운영되고 있다는 기대를 한 경우'), A10: t(D),
  A11: t('(b) 실증절차만으로는 충분하지 않은 경우'), A12: t(D),
  A13: t('2. 정보기술로부터 발생하는 위험'), A14: t(D),
  A15: t('3. 감사중 하나 이상의 내부통제 미비점을 알게 된 경우'),
  A16: t('(1) 유의적 미비점 여부'), A17: t(D),
  A18: t('(2) 커뮤니케이션'), A19: t(D),
});

test('항목 — 질문 줄 뒤 기재 줄을 한 항목으로, (a)(b)·(1)(2) 는 묶음 질문 아래', () => {
  const L = layoutQA(S);
  assert.equal(L.perfCol, 'E');
  const d = PAPER_2530.read(S);
  assert.equal(d.items.length, 5);
  assert.match(d.items[0].group, /^1\. 감사인은/);
  assert.equal(d.items[2].group, '');
  assert.match(d.items[3].group, /^3\. 감사중/);
});

test('초안 — 빈 칸만 채우고 표시, 이미 적은 것은 둔다', () => {
  const d = PAPER_2530.read(S);
  d.items[1] = { ...d.items[1], text: '직접 적음' };
  const x = withDraft(d, DRAFT_2530, '정우철');
  assert.equal(x.items[0].text, DRAFT_2530[0].text);
  assert.equal(x.items[0].ref, '3100');
  assert.equal(x.items[0].draft, true);
  assert.equal(x.items[1].text, '직접 적음');
  assert.equal(x.items[1].draft, false);
  assert.equal(x.items[4].performer, '정우철');
});

test('쓰기 — 기재 줄 문구·줄바꿈은 두고 값만, 수행자는 질문 줄', () => {
  const x = withDraft(PAPER_2530.read(S), DRAFT_2530, '정우철');
  const e = new Map(PAPER_2530.write(S, x).map((y) => [y.ref, y]));
  assert.equal(e.get('A10')?.text, `-상기 파악한 내용의 기재 : ${DRAFT_2530[0].text} \r\n-또는 별도의 조서에서 검토 : 조서번호 ( 3100 )`);
  assert.equal(e.get('E9')?.text, '정우철');
  // 그대로면 기재 줄은 쓰지 않는다
  const same = PAPER_2530.write(S, PAPER_2530.read(S)).filter((y) => y.ref.startsWith('A'));
  assert.deepEqual(same, []);
});
