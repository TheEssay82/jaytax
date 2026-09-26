// 이월 때 해가 바뀌는 칸 — 날짜 올리기와 전기 이동.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateRules, bumpDatesInText, bumpSheetDates, findPeriodColumns, carryForward, serialOf } from './gwpCarry';
import type { SheetData, CellValue } from './xlsxRead';

const R = dateRules({ closing: '2025-12-31', term: 18 })!;
const sheet = (cells: Record<string, CellValue>): SheetData => ({ name: 't', cells: new Map(Object.entries(cells)) });

test('글자 속 기간 날짜·기수·FY·분기를 한 해 올린다', () => {
  assert.equal(bumpDatesInText('2025년 12월 31일 현재', R), '2026년 12월 31일 현재');
  assert.equal(bumpDatesInText('2025.01.01 ~ 2025.12.31', R), '2026.01.01 ~ 2026.12.31');
  assert.equal(bumpDatesInText('제18기(당기)·제17기(전기)', R), '제19기(당기)·제18기(전기)');
  assert.equal(bumpDatesInText('FY2025 감사 · FY24 비교', R), 'FY2026 감사 · FY25 비교');
  assert.equal(bumpDatesInText('BS: 2023_4Q', R), 'BS: 2024_4Q');
  assert.equal(bumpDatesInText('2025년 말 잔액', R), '2026년 말 잔액');
});

test('기간과 상관없는 날짜는 건드리지 않는다 — 설립일·계약일·오래된 연도', () => {
  assert.equal(bumpDatesInText('2019년 3월 5일 설립', R), '2019년 3월 5일 설립');
  assert.equal(bumpDatesInText('2025년 4월 14일 계약', R), '2025년 4월 14일 계약');
  assert.equal(bumpDatesInText('제5기', R), '제5기');
  assert.equal(bumpDatesInText('2019년도', R), '2019년도');
});

test('날짜 칸 — 결산일·개시일(두 해치)만 올리고, 수식 칸은 두고, 고친 칸을 돌려준다', () => {
  const s = sheet({
    B3: { num: serialOf(2025, 12, 31) },
    B4: { num: serialOf(2024, 12, 31) },
    B5: { num: serialOf(2025, 1, 1) },
    B6: { num: serialOf(2025, 4, 14) },                 // 작성일 — 기간 날짜가 아니다
    B7: { num: serialOf(2025, 12, 31), formula: 'X!B1' }, // 수식
    C1: { text: '2025년 12월 31일 현재' },
    C2: { num: 65094587 },
  });
  const r = bumpSheetDates(s, R);
  assert.deepEqual(r.refs.sort(), ['B3', 'B4', 'B5', 'C1']);
  assert.equal(r.edits.find((e) => e.ref === 'B3')!.num, serialOf(2026, 12, 31));
  assert.equal(r.edits.find((e) => e.ref === 'B4')!.num, serialOf(2025, 12, 31));
});

test('전기 이동 — 2120A 모양: 당기 숫자를 전기로, 당기는 비우고, 수식 줄은 둔다, 머리 연도는 올린다', () => {
  const s = sheet({
    E12: { text: 'BS: 2023_4Q\nPL: 2023' }, F12: { text: 'BS: 2024_4Q\nPL: 2024' }, G12: { text: '전기대비증감' },
    E15: { num: 65094587 }, F15: { num: 60656226 }, G15: { formula: 'F15-E15', num: -4438361 },
    E16: { num: 2000000 }, F16: { num: 2000000 },
    E17: { num: 1479129 },                                   // 작년 당기가 비어 있던 줄 — 전기 자리를 비운다
    E20: { formula: 'SUM(E15:E16)' }, F20: { formula: 'SUM(F15:F16)' },
  });
  const pc = findPeriodColumns(s)!;
  assert.deepEqual([pc.headerRow, pc.prevCol, pc.curCol], [12, 'E', 'F']);
  const r = carryForward(s, pc);
  assert.equal(r.moved, 2);
  assert.equal(r.edits.find((e) => e.ref === 'E15')!.num, 60656226);
  assert.equal(r.edits.find((e) => e.ref === 'F15')!.clear, true);
  assert.equal(r.edits.find((e) => e.ref === 'E17')!.clear, true);
  assert.equal(r.edits.find((e) => e.ref === 'E12')!.text, 'BS: 2024_4Q\nPL: 2024');
  assert.equal(r.edits.find((e) => e.ref === 'F12')!.text, 'BS: 2025_4Q\nPL: 2025');
  assert.ok(!r.refs.includes('E20') && !r.refs.includes('G15'));
});

test('전기 이동 — 8110ARP 모양: 날짜 숫자 머리(당기가 왼쪽), 당기 링크 수식은 두고 계산값을 전기로', () => {
  const s = sheet({
    B3: { num: serialOf(2025, 12, 31) }, E3: { num: serialOf(2026, 3, 24) },   // 결산일·작성일 — 한 해 차이지만 머리가 아니다
    D23: { num: serialOf(2025, 12, 31) }, E23: { num: serialOf(2024, 12, 31) }, F23: { text: '증감' },
    D25: { formula: '[98]WBS!X6', num: 2399066 }, E25: { num: 3433266 },
    D26: { formula: 'SUM(D25:D25)', num: 2399066 }, E26: { formula: 'SUM(E25:E25)', num: 3433266 },
  });
  const pc = findPeriodColumns(s)!;
  assert.deepEqual([pc.headerRow, pc.prevCol, pc.curCol], [23, 'E', 'D']);
  const r = carryForward(s, pc);
  assert.equal(r.moved, 1);
  assert.equal(r.edits.find((e) => e.ref === 'E25')!.num, 2399066);
  assert.ok(!r.edits.some((e) => e.ref === 'D25'));        // 링크 수식은 그대로
  assert.ok(!r.refs.includes('E26'));
});

test('전기 이동 — 기간 열을 못 찾으면 null(억지로 옮기지 않는다)', () => {
  assert.equal(findPeriodColumns(sheet({ A1: { text: '계정과목' }, B1: { text: '금액' } })), null);
  const pc = findPeriodColumns(sheet({ C3: { text: '전기' }, D3: { text: '당기' } }))!;
  assert.deepEqual([pc.prevCol, pc.curCol], ['C', 'D']);
});
