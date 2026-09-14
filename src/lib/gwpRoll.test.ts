import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  labelCells, compareSheets, migrateInputs, headRefs, headEdits, renameSheetRefs, bumpPeriodText,
} from './gwpRoll.ts';
import type { SheetData, CellValue } from './xlsxRead.ts';

function sheet(name: string, cells: Record<string, CellValue>): SheetData {
  return { name, cells: new Map(Object.entries(cells)) };
}

const TPL = sheet('1200', {
  A2: { text: '1200  독립성, 윤리규정 및 품질관리기준의 준수' },
  A5: { text: '회사명' }, C5: { text: '작성자' }, E5: { text: '일자' },
  A6: { text: '결산일' }, C6: { text: '검토자' }, E6: { text: '일자' },
  A8: { text: '항 목' }, D8: { text: '수 행 자' }, E8: { text: '비 고' },
  A9: { text: '1.업무수행이사는 감사업무의 전 과정에 걸쳐' },
  A10: { text: '2.업무수행이사는 회계법인등의 품질관리시스템' },
  A11: { text: '(신설) 3.감사팀은 새 요구사항을' },
  A12: { text: '기타' }, A13: { text: '기타' },
  A15: { text: '결론' },
});

const PRIOR = sheet('1200(소규모)', {
  A2: { text: '1200  독립성, 윤리규정 및 품질관리기준의 준수' },
  A5: { text: '회사명' }, B5: { formula: "'1100(소규모)'!B5", text: '명진' }, C5: { text: '작성자' }, D5: { formula: '조서목록!D9', text: '정우철' },
  E5: { text: '일자' }, F5: { formula: '조서목록!E9', num: 45761 },
  A6: { text: '결산일' }, B6: { num: 46022 }, C6: { text: '검토자' }, D6: { text: '조현규' }, E6: { text: '일자' }, F6: { formula: 'F5', num: 45761 },
  A8: { text: '항 목' }, D8: { text: '수 행 자' }, E8: { text: '비 고' },
  A9: { text: '1.업무수행이사는 감사업무의 전 과정에 걸쳐' }, D9: { text: 'ERP' }, E9: { text: '식별된 이슈 없음' },
  A10: { text: '2.업무수행이사는 회계법인등의 품질관리시스템' }, D10: { text: 'N/A' },
  A11: { text: '기타' }, D11: { text: 'V' },
  A12: { text: '기타' }, D12: { num: 3 },
  A13: { text: '사람이 넣은 줄' }, D13: { text: 'x' },
  A14: { text: '결론' }, B14: { text: '문제 없음' },
  A20: { text: '홀로 있는 값' },
});

test('라벨 칸 — 수식·숫자·빈칸은 아니다', () => {
  const l = labelCells(PRIOR);
  assert.ok(l.has('A9') && l.has('D9') && !l.has('B5') && !l.has('B6') && !l.has('D12'));
});

test('양식 대조 — 같은 자리 같은 글자의 비율', () => {
  const c = compareSheets(TPL, PRIOR);
  assert.equal(c.total, 16);
  // 다른 자리: A11(신설)·A13(기타↔사람이 넣은 줄)·A15(결론 자리가 14로 밀림) — 셋
  assert.equal(c.same, 13);
  assert.deepEqual(c.differ, ['A11', 'A13', 'A15']);
  assert.ok(c.score < 0.98);
  assert.equal(compareSheets(TPL, TPL).score, 1);
});

test('입력값 옮기기 — 행 라벨 → 열, 같은 라벨은 몇 번째인지로, 못 옮긴 것은 까닭과 함께', () => {
  const m = migrateInputs(PRIOR, TPL);
  const to = new Map(m.moved.map((x) => [x.from, x.to]));
  assert.equal(to.get('D9'), 'D9');
  assert.equal(to.get('E9'), 'E9');
  assert.equal(to.get('D10'), 'D10');
  assert.equal(to.get('D11'), 'D12', '첫 「기타」는 양식의 첫 「기타」(12행)로');
  assert.equal(to.get('D12'), 'D13', '둘째 「기타」는 13행으로');
  assert.equal(to.get('B14'), 'B15', '결론은 밀린 자리로');
  assert.ok(m.edits.some((e) => e.ref === 'D13' && e.num === 3), '숫자는 숫자로');
  const left = new Map(m.left.map((x) => [x.from, x.why]));
  assert.ok(left.get('D13')?.includes('줄이 없습니다'), '사람이 넣은 줄의 값');
  assert.ok(left.has('A13'), '사람이 넣은 줄의 라벨 자체도 알려 준다');
  assert.ok(left.get('A20')?.includes('라벨이 없습니다'));
  assert.ok(!to.has('D5') && !to.has('B5'), '머리는 안 옮긴다');
  assert.ok(!m.moved.some((x) => x.from === 'A9'), '라벨은 안 옮긴다');
});

test('머리 주소와 링크 — 회사명·결산일은 표지로, 작성자·일자는 조서목록 줄로, 검토자는 이름', () => {
  const refs = headRefs(TPL);
  assert.deepEqual(refs, { company: 'B5', closing: 'B6', author: 'D5', reviewer: 'D6', dates: ['F5', 'F6'] });
  const e = headEdits(refs, '조서표지(공통사항)', '조서목록', 9, '조현규');
  assert.deepEqual(e, [
    { ref: 'B5', formula: "'조서표지(공통사항)'!B14" },
    { ref: 'B6', formula: "'조서표지(공통사항)'!B15" },
    { ref: 'D5', formula: 'IF(조서목록!D9="","",조서목록!D9)' },
    { ref: 'D6', text: '조현규' },
    { ref: 'F5', formula: 'IF(조서목록!E9="","",조서목록!E9)' },
    { ref: 'F6', formula: 'IF(F5="","",F5)' },
  ]);
  const none = headEdits(refs, '조서표지(공통사항)', '조서목록', null, '');
  assert.ok(none.some((x) => x.ref === 'D5' && x.clear) && none.some((x) => x.ref === 'F5' && x.clear));
});

test('머리 주소 — 라벨이 붙어 있는 꼴(회 사 명 : │ B4) 과 값 칸이 비어 목록에 없는 꼴', () => {
  const refs = headRefs(sheet('8700', {
    A4: { text: '회 사 명 :' }, D4: { text: '작 성 자' }, H4: { text: '일 자' },
    A5: { text: '결 산 일 :' }, D5: { text: '검 토 자' }, H5: { text: '일 자' },
  }));
  assert.deepEqual(refs, { company: 'B4', closing: 'B5', author: 'E4', reviewer: 'E5', dates: ['I4', 'I5'] });
});

test('수식 속 시트 이름 바꾸기', () => {
  const map = new Map([['2700', '2700(소규모)'], ['1200', '1200'], ['조서목록', '조서목록']]);
  const xml = '<c r="B4"><f>\'2700\'!B4+2700!C4+A2700+X!2700</f></c><c r="B5"><f>조서목록!D8</f></c>';
  const out = renameSheetRefs(xml, map);
  assert.ok(out.includes("<f>'2700(소규모)'!B4+'2700(소규모)'!C4+A2700+X!2700</f>"), out);
  assert.ok(out.includes('<f>조서목록!D8</f>'));
});

test('기수·연도 올리기', () => {
  assert.equal(bumpPeriodText('제18기 2025년 1월 1일 ～ 2025년 12월 31일'), '제19기 2026년 1월 1일 ～ 2026년 12월 31일');
  assert.equal(bumpPeriodText('2025-12-31'), '2026-12-31');
  assert.equal(bumpPeriodText('제 7 기 2025.01.01 ~ 2025.12.31'), '제8기 2026.01.01 ~ 2026.12.31');
});
