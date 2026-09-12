import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { colName, sheetXml, injectSheets } from './xlsxInject.ts';
import type { SheetPlan } from './noteSheet.ts';

/** 최소한의 엑셀 한 개 — 원본이 상하는지 보려고 표식을 넣어 둔다. */
function makeBook(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/>'
      + '</Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<sheets><sheet name="TB" sheetId="1" r:id="rId1"/></sheets>'
      + '<definedNames><definedName name="소중한이름">TB!$A$1</definedName></definedNames>'
      + '</workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/>'
      + '</Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>'),
    'xl/calcChain.xml': strToU8('<calcChain/>'),
    'xl/media/image1.png': new Uint8Array([1, 2, 3, 4]),
  });
}

const PLAN: SheetPlan = {
  name: '재고자산',
  lastRow: 4,
  cells: [
    { row: 2, col: 2, text: '주석명' },
    { row: 2, col: 3, text: '5. 재고자산' },
    { row: 3, col: 1, text: '176' },
    { row: 3, col: 3, text: '보고기간종료일 현재 <건설용지> & 공시지가' },
    { row: 4, col: 3, text: '건설용지' },
    { row: 4, col: 4, text: '15,419,575,880', num: 15419575880 },
  ],
};

test('열 이름', () => {
  assert.equal(colName(1), 'A');
  assert.equal(colName(3), 'C');
  assert.equal(colName(26), 'Z');
  assert.equal(colName(27), 'AA');
});

test('워크시트 XML — 글자는 inlineStr, 숫자는 값, 특수문자는 escape', () => {
  const xml = sheetXml(PLAN);
  assert.ok(xml.includes('<c r="B2" t="inlineStr"><is><t xml:space="preserve">주석명</t></is></c>'));
  assert.ok(xml.includes('<c r="D4"><v>15419575880</v></c>'), '숫자는 값으로');
  assert.ok(xml.includes('&lt;건설용지&gt; &amp; 공시지가'), 'XML 특수문자를 막는다');
  assert.ok(xml.includes('hidden="1"'), 'A열(자리표)은 숨긴다');
});

test('원본은 한 바이트도 상하지 않는다', () => {
  const src = makeBook();
  const out = injectSheets(src, [PLAN]);
  const a = unzipSync(src);
  const b = unzipSync(out);

  // 손대기로 한 네 군데 + 지우기로 한 calcChain 말고는 그대로여야 한다
  const touched = new Set(['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', '[Content_Types].xml', 'xl/calcChain.xml']);
  for (const name of Object.keys(a)) {
    if (touched.has(name)) continue;
    assert.deepEqual([...b[name]], [...a[name]], `${name} 이 바뀌었다`);
  }
  assert.deepEqual([...b['xl/media/image1.png']], [1, 2, 3, 4], '그림이 그대로 있다');
});

test('정의된 이름과 기존 시트가 살아 있다', () => {
  const b = unzipSync(injectSheets(makeBook(), [PLAN]));
  const wb = strFromU8(b['xl/workbook.xml']);
  assert.ok(wb.includes('소중한이름'), '정의된 이름을 잃지 않는다');
  assert.ok(wb.includes('name="TB"'), '원래 시트가 남아 있다');
  assert.ok(wb.includes('name="재고자산"'), '새 시트가 들어갔다');
});

test('계산 순서 캐시는 지운다 — 엑셀이 다시 만든다', () => {
  const b = unzipSync(injectSheets(makeBook(), [PLAN]));
  assert.equal(b['xl/calcChain.xml'], undefined);
  assert.ok(!strFromU8(b['[Content_Types].xml']).includes('calcChain'));
  assert.ok(!strFromU8(b['xl/_rels/workbook.xml.rels']).includes('calcChain'));
});

test('시트 이름이 이미 있으면 겹치지 않게 붙인다', () => {
  const b = unzipSync(injectSheets(makeBook(), [{ ...PLAN, name: 'TB' }]));
  const wb = strFromU8(b['xl/workbook.xml']);
  assert.ok(wb.includes('name="TB"'));
  assert.ok(wb.includes('name="TB(2)"'), '원래 TB 를 덮지 않는다');
});

test('여러 장을 한 번에 — 번호가 겹치지 않는다', () => {
  const b = unzipSync(injectSheets(makeBook(), [PLAN, { ...PLAN, name: '유형자산' }, { ...PLAN, name: '차입금' }]));
  const wb = strFromU8(b['xl/workbook.xml']);
  const ids = [...wb.matchAll(/sheetId="(\d+)"/g)].map((m) => m[1]);
  const rids = [...wb.matchAll(/r:id="(rId\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'sheetId 가 겹치면 엑셀이 못 연다');
  assert.equal(new Set(rids).size, rids.length);
  assert.equal(Object.keys(b).filter((n) => n.startsWith('xl/worksheets/')).length, 4);
});

test('엑셀이 아닌 파일은 알아듣게 거절한다', () => {
  const junk = zipSync({ 'a.txt': strToU8('hello') });
  assert.throws(() => injectSheets(junk, [PLAN]), /엑셀 파일 구조/);
});
