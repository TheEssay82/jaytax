// 2110A 업무분장표 — 소규모(3열) → 일반(7열)은 칸 자리가 아니라 열 이름으로(에이치앤아비즈 2026-09-30).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SheetData, CellValue } from './xlsxRead';
import { PAPER_2110A } from './gwpPaper2110A';

const sheet = (name: string, cells: Record<string, CellValue>, hidden = false): SheetData => ({ name, hidden, cells: new Map(Object.entries(cells)) });
const t = (text: string): CellValue => ({ text });

// 작년 소규모: D 중간감사 · E 기말감사 · F 검토
const SMALL = sheet('2110A(소규모)', {
  A5: t('감 사 절 차'), D5: t('중간감사'), E5: t('기말감사'), F5: t('검토'),
  A7: t('(1) 감사계획의 수립'), D7: t('정우철'), E7: t('정우철'), F7: t('조현규'),
  A8: t('(2) 위험평가'),
  A9: t('1) 회사의 사업등에 대한 이해'), D9: t('정우철'), E9: t('정우철'), F9: t('조현규'),
  A11: t('3) 통제환경에 대한 이해 및 평가'), D11: t('정우철'), E11: t('정우철'), F11: t('조현규'),
  A14: t('(3) 통제테스트'), D14: t('정우철'), E14: t('정우철'), F14: t('조현규'),
  A15: t('(4) 계정별 실증절차'),
  A18: t('파생상품'), D18: t('N/A'), E18: t('N/A'), F18: t('N/A'),
  A19: t('매출채권(장단기)'), D19: t('정우철'), E19: t('정우철'), F19: t('조현규'),
}, true);
// 올해 일반 — 칸 자리로 옮겨져 D·E·F 에 들어가 버린 모양(v1 실물)
const GENERAL = sheet('2110A', {
  A5: t('감 사 절 차'), C5: t('1분기검토'), D5: t('반기검토'), E5: t('3분기검토'), F5: t('중간감사'), G5: t('기말감사'), H5: t('1차검토'), I5: t('2차검토'),
  A7: t('(1) 위험평가'),
  A8: t('1) 회사의 사업등에 대한 이해'), D8: t('정우철'), E8: t('정우철'), F8: t('조현규'),
  A10: t('3) 통제환경, 위험평가, 모니터링에 대한 이해 및 평'),
  A13: t('6) 전반감사계획의 수립'),
  A14: t('7) '),
  A15: t('(2) 위험에 대한 대응'),
  A16: t('(3) 계정별 입증감사절차'),
  A19: t('파생상품'), B19: t('DER'), D19: t('N/A'), E19: t('N/A'), F19: t('N/A'),
  A20: t('매출채권(장단기)'), B20: t('C'), D20: t('정우철'), E20: t('정우철'), F20: t('조현규'),
});

const row = (d: ReturnType<typeof PAPER_2110A.read>, label: string) => d.rows.find((r) => r.label.startsWith(label))!.vals;

test('2110A — 소규모에서 칸 자리로 밀린 판은 열 이름으로 다시 짓는다', () => {
  const d = PAPER_2110A.readBook!([SMALL, GENERAL]);
  assert.deepEqual(d.cols, ['1분기검토', '반기검토', '3분기검토', '중간감사', '기말감사', '1차검토', '2차검토']);
  assert.deepEqual(row(d, '1) 회사의'), ['N/A', 'N/A', 'N/A', '정우철', '정우철', '조현규', '조현규']);
  assert.deepEqual(row(d, '매출채권'), ['N/A', 'N/A', 'N/A', '정우철', '정우철', '조현규', '조현규']);
  assert.deepEqual(row(d, '파생상품'), ['N/A', 'N/A', 'N/A', 'N/A', 'N/A', 'N/A', 'N/A']);
  // 이름이 다른 줄 — 감사계획의 수립 → 전반감사계획의 수립, 통제테스트 → 위험에 대한 대응, 통제환경… → 통제환경, 위험평가…
  assert.deepEqual(row(d, '6) 전반'), ['N/A', 'N/A', 'N/A', '정우철', '정우철', '조현규', '조현규']);
  assert.deepEqual(row(d, '(2) 위험에'), ['N/A', 'N/A', 'N/A', '정우철', '정우철', '조현규', '조현규']);
  assert.deepEqual(row(d, '3) 통제환경'), ['N/A', 'N/A', 'N/A', '정우철', '정우철', '조현규', '조현규']);
  // 소제목·빈 번호 줄은 비워 둔다
  assert.ok(row(d, '(3) 계정별').every((v) => !v));
  assert.ok(row(d, '7)').every((v) => !v));
});

test('2110A — 쓰면 중간감사는 F, 1차·2차검토는 H·I, 옛 D·E 자리는 N/A', () => {
  const d = PAPER_2110A.readBook!([SMALL, GENERAL]);
  const e = new Map(PAPER_2110A.write(GENERAL, d).map((x) => [x.ref, x.text ?? '(지움)']));
  assert.equal(e.get('F8'), '정우철'); assert.equal(e.get('G8'), '정우철');
  assert.equal(e.get('H8'), '조현규'); assert.equal(e.get('I8'), '조현규');
  assert.equal(e.get('D8'), 'N/A'); assert.equal(e.get('C8'), 'N/A');
});

test('2110A — 원래 일반인 판(알티스트)은 그대로 두고 빈 분기·반기 열만 N/A', () => {
  const ALT = sheet('2110A', {
    A5: t('감 사 절 차'), C5: t('1분기검토'), D5: t('반기검토'), E5: t('3분기검토'), F5: t('중간감사'), G5: t('기말감사'), H5: t('1차검토'), I5: t('2차검토'),
    A8: t('1) 회사의 사업등에 대한 이해'), F8: t('정우철'), G8: t('정우철'), H8: t('조현규'), I8: t('조현규'),
  });
  const d = PAPER_2110A.readBook!([ALT]);
  assert.deepEqual(row(d, '1) 회사의'), ['N/A', 'N/A', 'N/A', '정우철', '정우철', '조현규', '조현규']);
});

test('2110A — 분기 검토를 실제로 하는 회사(열에 이름이 있음)는 N/A 로 덮지 않는다', () => {
  const Q = sheet('2110A', {
    A5: t('감 사 절 차'), C5: t('1분기검토'), D5: t('반기검토'), E5: t('3분기검토'), F5: t('중간감사'), G5: t('기말감사'), H5: t('1차검토'), I5: t('2차검토'),
    A8: t('1) 회사의 사업등에 대한 이해'), D8: t('김준성'), F8: t('정우철'), G8: t('정우철'), H8: t('조현규'), I8: t('조현규'),
    A9: t('2) 감사위험의 평가'), F9: t('정우철'), G9: t('정우철'), H9: t('조현규'), I9: t('조현규'),
  });
  const d = PAPER_2110A.readBook!([Q]);
  assert.deepEqual(row(d, '2) 감사'), ['N/A', '', 'N/A', '정우철', '정우철', '조현규', '조현규']);
});

test('2110A — 소규모 양식끼리(명진)는 예전처럼 3열 그대로', () => {
  const d = PAPER_2110A.readBook!([{ ...SMALL, hidden: false }]);
  assert.deepEqual(d.cols, ['중간감사', '기말감사', '검토']);
  assert.deepEqual(row(d, '1) 회사의'), ['정우철', '정우철', '조현규']);
});
