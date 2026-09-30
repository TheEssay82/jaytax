// 올해 양식에 있는데 파일에 없는 조서 — 3000번대만 미리 체크, 일부러 숨긴 번호대는 빼고(사용자 2026-09-30 에이치앤아비즈).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingPapers } from './gwpAddPapers';
import type { Catalog } from './gwpCatalog';
import type { TemplateCatalog } from './gwpTemplate';
import { from2110Small } from './gwpPaper2110';

const book = (sheets: [string, boolean][]) => ({ sheets: sheets.map(([code, hidden]) => ({ code, hidden, name: code })) }) as unknown as Catalog;
const tpl = (codes: string[]) => ({ files: [], skipped: [], sheets: codes.map((c) => ({ file: 'f', name: c, code: c, hidden: false })) }) as TemplateCatalog;

test('빠진 조서 — 3000번대 추천, 숨긴 딸림(3150-1)·확장(3650→3650A)은 빼고 3300A 가 숨어도 3300 은 추천', () => {
  const m = missingPapers(book([['2110', false], ['3150-1', true], ['3300A', true], ['3650', true], ['8100', false]]),
    tpl(['2110', '3150', '3200', '3300', '3650A신규', '7100', '8550']));
  const sug = m.filter((x) => x.suggested).map((x) => x.code);
  assert.deepEqual(sug, ['3200', '3300']);
  assert.deepEqual(m.map((x) => x.code), ['3150', '3200', '3300', '3650A신규', '7100', '8550']);
});

test('2110 소규모 → 일반 — 일정은 결산연도에 맞추고(이월 때 이미 올라간 결산일을 또 올리지 않음), 조서번호 칸의 이름은 버린다', () => {
  const small = {
    team: [{ label: '1.업무수행이사 및 다른 핵심 업무팀원', performer: '정우철', text: '', ref: '' },
      { label: '2. 감사인 측 전문가의 참여를 고려한다', performer: '정우철', text: '해당사항없음', ref: '' }],
    contractPerformer: '정우철', scope: '일반' as const,
    schedule: [{ label: '감사계획', value: '2025.4.11' }, { label: '재고 실사입회', value: '2026.12.31 내외' }, { label: '기말감사', value: '2026년 3월중' }],
    sites: [{ label: '본사', value: '경기도 용인시' }], reportDue: '', copiesKo: '10', copiesEn: '-',
  };
  const general = {
    team: [{ label: '1.업무수행이사 및 다른 핵심 업무팀원', performer: '', text: '예시', ref: '정우철' },
      { label: '2 업무품질관리검토자가 지정되었는지', performer: '', text: '김품감', ref: '' },
      { label: '3 감사인 측 전문가의 참여를 고려한다', performer: '', text: '', ref: '2131' }],
    contractPerformer: '', scope: '' as const, scopeText: '유가증권상장', consolidated: '여',
    schedule: [{ label: '감사계획', value: '2020년 9월' }, { label: '재고 실사입회', value: '' }, { label: '기말감사', value: '' }, { label: '연결감사', value: 'x' }],
    sites: [{ label: '본사', value: '서울특별시 서초구 XXX' }], reportDue: '', copiesKo: '50', copiesEn: '10',
  };
  const d = from2110Small(small, general, 2026);
  assert.deepEqual(d.schedule.map((x) => x.value), ['2026.4.11', '2026.12.31 내외', '2027년 3월중', 'N/A']);
  assert.equal(d.team[0].ref, '');            // 「정우철」은 조서번호가 아니다
  assert.equal(d.team[2].ref, '2131');
  assert.equal(d.team[2].text, '해당사항없음');
  assert.equal(d.team[1].text, '');           // 김품감(예시)은 남기지 않는다
  assert.equal(d.scopeText, '일반외감'); assert.equal(d.sites[0].value, '경기도 용인시'); assert.equal(d.copiesKo, '10');
});

import { unscaledFormat } from './xlsxMark';
test('천 단위 표시 풀기 — 끝 쉼표만 떼고, 「백만원」 글자 서식은 둔다', () => {
  assert.equal(unscaledFormat('#,##0,'), '#,##0');
  assert.equal(unscaledFormat('#,##0,;[Red]\(#,##0,\);"-"'), '#,##0;[Red]\(#,##0\);"-"');
  assert.equal(unscaledFormat('_-* #,##0,_-;\-* #,##0,_-;_-* "-"_-;_-@_-'), '_-* #,##0_-;\-* #,##0_-;_-* "-"_-;_-@_-');
  assert.equal(unscaledFormat('#,##0'), null);
  assert.equal(unscaledFormat('#,##0,, "백만원"'), null);
  assert.equal(unscaledFormat(String.raw`#,##0,,\ \백\만\원`), null);
  assert.equal(unscaledFormat(String.raw`#,##0,,_""백""만""원";[Red]\(#,##0,,\);\-\ `), null);   // 평안정공 실물
  assert.equal(unscaledFormat(String.raw`#,##0,_);[Red]\(#,##0,\);\-\ \ `), String.raw`#,##0_);[Red]\(#,##0\);\-\ \ `);
  assert.equal(unscaledFormat('0.00%'), null);
});
