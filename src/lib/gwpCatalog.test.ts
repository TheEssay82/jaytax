import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeOf, kindOf, isoDate, readHead, readIndex, buildCatalog, sectionOf } from './gwpCatalog.ts';
import type { SheetData, CellValue } from './xlsxRead.ts';

function sheet(name: string, cells: Record<string, CellValue>, hidden = false): SheetData {
  return { name, cells: new Map(Object.entries(cells)), hidden };
}

test('시트 이름 → 조서 코드 — 「(소규모)」·공백을 빼고, 꼬리가 붙으면 꼬리까지', () => {
  assert.equal(codeOf('1100(소규모)'), '1100');
  assert.equal(codeOf('2700A (소규모)'), '2700A');
  assert.equal(codeOf('2110-2'), '2110-2');
  assert.equal(codeOf('2700A-1(적용지침)'), '2700A-1(적용지침)');
  assert.equal(codeOf('8500(별첨1)'), '8500(별첨1)');
  assert.equal(codeOf('3650A 신규'), '3650A신규');
  assert.equal(codeOf('2531A(소규모)'), '2531A');
  assert.equal(codeOf('8110ARP_BS'), null, '자체 시트');
  assert.equal(codeOf('특수관계자검토25'), null);
  assert.equal(codeOf('조서목록'), null);
  assert.equal(codeOf('kick-off meeting 회의록'), null);
});

test('시트 종류', () => {
  assert.equal(kindOf('조서목록'), 'index');
  assert.equal(kindOf('조서표지(공통사항)'), 'cover');
  assert.equal(kindOf('감사조서철 작성 및 보존'), 'cover');
  assert.equal(kindOf('2301'), 'paper');
  assert.equal(kindOf('특수관계자검토25'), 'extra');
});

test('엑셀 날짜', () => {
  assert.equal(isoDate({ num: 45761 }), '2025-04-14');
  assert.equal(isoDate({ text: '2025-12-31 00:00:00' }), '2025-12-31');
  assert.equal(isoDate({ text: '2025. 4. 14' }), '2025-04-14');
  assert.equal(isoDate({ text: '조현규' }), '조현규');
  assert.equal(isoDate(undefined), '');
});

test('조서 머리 — 라벨 오른쪽 첫 값. 일자는 작성자 줄 것', () => {
  const s = sheet('2511', {
    A2: { text: '2511  통 제 환 경 이 해 와 평 가' },
    A5: { text: '회사명' }, B5: { formula: "'2302'!B5", text: '명진산업개발주식회사' },
    D5: { text: '작성자' }, E5: { formula: '조서목록!D18', text: '정우철' },
    F5: { text: '일자' }, G5: { formula: '조서목록!E18', num: 45761 },
    A6: { text: '결산일' }, B6: { formula: "'2302'!B6", num: 46022 },
    D6: { text: '검토자' }, E6: { formula: "'2302'!F6", text: '조현규' },
    F6: { text: '일자' }, G6: { formula: 'G5', num: 45761 },
    A8: { text: '※ 작성요령' },
  });
  assert.deepEqual(readHead(s), {
    company: '명진산업개발주식회사', closing: '2025-12-31', author: '정우철', reviewer: '조현규', date: '2025-04-14',
  });
});

test('조서 머리 — 「회 사 명 :」 꼴과 수식만 있고 값이 없는 칸', () => {
  const s = sheet('8700', {
    A4: { text: '회 사 명 :' }, B4: { formula: "'8100'!B4" }, D4: { text: '작 성 자' }, E4: { formula: "'8600'!D4" },
    H4: { text: '일 자' }, I4: { formula: "'8600'!F4" },
    A5: { text: '결 산 일 :' }, B5: { formula: "'8100'!B5", num: 46022 }, D5: { text: '검 토 자' }, E5: { text: '조현규' },
  });
  const h = readHead(s);
  assert.equal(h.company, '', '값이 없으면 빈 글자');
  assert.equal(h.author, '');
  assert.equal(h.closing, '2025-12-31');
  assert.equal(h.reviewer, '조현규');
});

test('조서목록 — 코드·제목·수행여부·작성자·작성일', () => {
  const s = sheet('조서목록', {
    B2: { text: '일반조서목록(General File Index)' },
    B7: { text: '감사계약(1000)' }, C7: { text: '수 행 여 부' },
    B8: { text: '1100 계약전 위험평가 및 업무조건의 합의' }, C8: { text: 'O' }, D8: { text: '정우철' }, E8: { num: 45761 },
    B9: { text: '1200 독립성, 윤리규정 및 품질관리기준의 준수' }, C9: { text: 'O' }, D9: { text: '정우철' }, E9: { num: 45761 },
    B27: { text: '3100 위험에 대한 대응' },
    B28: { text: '2700A-1(적용지침) 중요성 적용지침' },
    B55: { text: '(주) 본 목록은 예시적으로 열거된 것이므로 필요시 추가하여야 함.' },
  });
  const rows = readIndex(s);
  assert.equal(rows.length, 4);
  assert.equal(rows[3].code, '2700A-1(적용지침)');
  assert.equal(rows[3].title, '중요성 적용지침');
  assert.deepEqual(rows[0], { row: 8, code: '1100', title: '계약전 위험평가 및 업무조건의 합의', performed: true, author: '정우철', date: '2025-04-14' });
  assert.equal(rows[2].performed, false);
  assert.equal(rows[2].author, '');
});

test('워크북 목록 — 표지에서 회사·결산일, 시트마다 종류·코드·숨김', () => {
  const cat = buildCatalog([
    sheet('감사조서철 작성 및 보존', { B3: { text: '감사조서철 작성 및 보존' } }),
    sheet('조서표지(공통사항)', {
      A14: { text: '회 사 명' }, B14: { text: '명진산업개발주식회사' },
      A15: { text: '결산일' }, B15: { num: 46022 },
      A16: { text: '대상기간' }, B16: { text: '제18기 2025년 1월 1일 ～ 2025년 12월 31일' },
      A17: { text: '감사보고서일' },
    }),
    sheet('조서목록', { B8: { text: '1100 계약전 위험평가' }, C8: { text: 'O' } }),
    sheet('1100(소규모)', { A2: { text: '1100 계약전 위험평가' }, A5: { text: '회사명' }, B5: { text: '명진' } }),
    sheet('3900', { A2: { text: '3900 핵심감사사항' } }, true),
    sheet('특수관계자검토25', { A1: { text: 'x' }, B1: { formula: 'A1' } }),
  ]);
  assert.equal(cat.company, '명진산업개발주식회사');
  assert.equal(cat.closing, '2025-12-31');
  assert.equal(cat.period, '제18기 2025년 1월 1일 ～ 2025년 12월 31일');
  assert.equal(cat.reportDate, '');
  assert.equal(cat.index.length, 1);
  assert.deepEqual(cat.sheets.map((s) => [s.kind, s.code, s.hidden]), [
    ['cover', null, false], ['cover', null, false], ['index', null, false],
    ['paper', '1100', false], ['paper', '3900', true], ['extra', null, false],
  ]);
  assert.equal(cat.sheets[3].head.company, '명진');
  assert.equal(cat.sheets[5].formulas, 1);
});

test('묶음', () => {
  assert.equal(sectionOf('1100'), '감사계약');
  assert.equal(sectionOf('2700A-1'), '위험평가');
  assert.equal(sectionOf('3500B'), '위험에 대한 대응');
  assert.equal(sectionOf('8700'), '감사완결');
  assert.equal(sectionOf('9310'), '내부회계관리제도');
});
