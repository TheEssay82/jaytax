// 줄 끼워 넣기 — 번호·병합·수식·새 줄 서식.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertRows, shiftFormula } from './xlsxRows';

const XML = '<worksheet><dimension ref="A1:P30"/><sheetData>'
  + '<row r="22" ht="20"><c r="A22" s="3" t="s"><v>1</v></c></row>'
  + '<row r="23" ht="18" customHeight="1"><c r="A23" s="5" t="s"><v>2</v></c><c r="B23" s="6"/><c r="M23" s="7"/></row>'
  + '<row r="24"><c r="A24" s="5"><v>9</v></c></row>'
  + '<row r="29"><c r="A29" s="8"><f>SUM(A23:A24)+B5+\'2120A\'!A24</f><v>0</v></c></row>'
  + '</sheetData><mergeCells count="2"><mergeCell ref="M23:O23"/><mergeCell ref="A29:P29"/></mergeCells>'
  + '<conditionalFormatting sqref="B23:B28"><cfRule><formula>$B23="Y"</formula></cfRule></conditionalFormatting></worksheet>';

test('줄 끼워 넣기 — 아래 줄·병합·수식·조건부 서식이 밀리고, 새 줄은 본뜬 줄의 서식만', () => {
  const out = insertRows(XML, 24, 2, 23);
  assert.match(out, /<row r="24" ht="18" customHeight="1"><c r="A24" s="5"\/><c r="B24" s="6"\/><c r="M24" s="7"\/><\/row><row r="25"/);
  assert.match(out, /<row r="26"><c r="A26" s="5"><v>9<\/v><\/c><\/row>/);
  assert.match(out, /<row r="31"><c r="A31" s="8"><f>SUM\(A23:A26\)\+B5\+'2120A'!A24<\/f>/);
  assert.match(out, /<mergeCell ref="M23:O23"\/><mergeCell ref="A31:P31"\/><mergeCell ref="M24:O24"\/><mergeCell ref="M25:O25"\/>/);
  assert.match(out, /<mergeCells count="4">/);
  assert.match(out, /sqref="B23:B30"/);
  assert.match(out, /<dimension ref="A1:P32"\/>/);
});

test('수식 — 같은 시트 참조만, 글자 속은 두고', () => {
  assert.equal(shiftFormula('A25+Sheet1!A25+"A25"+SUM(B20:B30)', 24, 3), 'A28+Sheet1!A25+"A25"+SUM(B20:B33)');
});
