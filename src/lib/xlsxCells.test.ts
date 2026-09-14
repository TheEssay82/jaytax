import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setCells, excelSerial } from './xlsxCells.ts';
import { readSheet } from './xlsxRead.ts';

const SHEET = '<worksheet><sheetData>'
  + '<row r="14" spans="1:5"><c r="A14" s="3" t="inlineStr"><is><t>회 사 명</t></is></c><c r="B14" s="4" t="s"><v>7</v></c></row>'
  + '<row r="15"><c r="A15" t="inlineStr"><is><t>결산일</t></is></c><c r="B15" s="9"><v>46022</v></c><c r="D15"><f>B15+1</f><v>46023</v></c></row>'
  + '<row r="17"/>'
  + '</sheetData><mergeCells count="1"><mergeCell ref="B14:E14"/></mergeCells></worksheet>';

test('칸 고치기 — 서식은 그대로, 글자는 인라인, 숫자·수식·비우기', () => {
  const out = setCells(SHEET, [
    { ref: 'B14', text: '명진산업개발주식회사' },
    { ref: 'B15', num: 46387 },
    { ref: 'D15', clear: true },
    { ref: 'C15', formula: 'B15' },
    { ref: 'B17', text: '제19기' },
    { ref: 'B16', text: '끼움' },
    { ref: 'B99', num: 1 },
  ]);
  const cells = readSheet(out, []);
  assert.equal(cells.get('B14')?.text, '명진산업개발주식회사');
  assert.ok(out.includes('<c r="B14" s="4" t="inlineStr">'), '서식 4 를 물려받는다');
  assert.equal(cells.get('B15')?.num, 46387);
  assert.ok(out.includes('<c r="B15" s="9"><v>46387</v></c>'));
  assert.equal(cells.get('D15'), undefined, '비운 칸은 없는 칸이다');
  assert.ok(out.includes('<c r="D15"/>'));
  assert.equal(cells.get('C15')?.formula, 'B15');
  assert.equal(cells.get('B17')?.text, '제19기');
  assert.equal(cells.get('B16')?.text, '끼움');
  assert.equal(cells.get('B99')?.num, 1);
  // 차례가 맞다 — 행 16 은 15 와 17 사이, C15 는 B15 와 D15 사이, 99 는 맨 뒤
  const rows = [...out.matchAll(/<row r="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(rows, [14, 15, 16, 17, 99]);
  const r15 = /<row r="15">([\s\S]*?)<\/row>/.exec(out)![1];
  assert.deepEqual([...r15.matchAll(/<c r="([A-Z]+15)"/g)].map((m) => m[1]), ['A15', 'B15', 'C15', 'D15']);
  assert.ok(out.includes('<mergeCells count="1">'), '나머지는 그대로');
});

test('빈 sheetData 에도 넣는다', () => {
  const out = setCells('<worksheet><sheetData/></worksheet>', [{ ref: 'A1', text: 'x' }]);
  assert.equal(readSheet(out, []).get('A1')?.text, 'x');
});

test('엑셀 날짜 일련번호', () => {
  assert.equal(excelSerial('2025-12-31'), 46022);
  assert.equal(excelSerial('2026-12-31'), 46387);
  assert.equal(excelSerial('2025-04-14'), 45761);
  assert.equal(excelSerial('없음'), null);
});
