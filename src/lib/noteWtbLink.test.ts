// 주석 당기 칸 ↔ 올해 정산표 미리 연결(noteWtbLink) · 정산표 시트 빼기(removeSheets)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { linkToWtb, leftoverSheets, type WtbSource } from './noteWtbLink.ts';
import { removeSheets, sheetEntries } from './xlsxTransplant.ts';
import type { SheetPlan, SheetCell } from './noteSheet.ts';
import type { SheetData, CellValue } from './xlsxRead.ts';

const plan = (name: string, cells: SheetCell[]): SheetPlan => ({ name, note: name, cells, lastRow: 20 });
const src = (v: number, f: string, rep = true, pl = false): WtbSource => ({ v, f, what: f, rep, pl });

// 이월한 배치(노란 당기 칸) + 같은 자리에 작년 값이 든 배치
const rolled = [plan('N04 현금및현금성자산', [
  { row: 7, col: 4, text: '당기말', kind: 'head' }, { row: 7, col: 5, text: '취득', kind: 'head' }, { row: 7, col: 6, text: '단수차이', kind: 'head' },
  { row: 8, col: 3, text: '현금및현금성자산', kind: 'text' }, { row: 8, col: 4, text: '', kind: 'input' }, { row: 8, col: 5, text: '', kind: 'input' }, { row: 8, col: 6, text: '', kind: 'input' },
  { row: 9, col: 3, text: '기초', kind: 'text' }, { row: 9, col: 4, text: '', kind: 'input' },
  { row: 10, col: 3, text: '2024년 12월 31일', kind: 'text' }, { row: 10, col: 4, text: '', kind: 'input' },
  { row: 11, col: 3, text: '단기금융상품', kind: 'text' }, { row: 11, col: 4, text: '', kind: 'input' },
])];
const plain = [plan('N04 현금및현금성자산', [
  { row: 8, col: 4, text: '', num: 628601000 }, { row: 8, col: 5, text: '', num: 300000000 }, { row: 8, col: 6, text: '', num: 300000000 },
  { row: 9, col: 4, text: '', num: 628601000 }, { row: 10, col: 4, text: '', num: 628601000 }, { row: 11, col: 4, text: '', num: 844000000 },
])];

test('작년 값이 같은 보고서 줄 하나 → 당기 칸에 수식, 파란 칸', () => {
  const r = linkToWtb(rolled, plain, [src(628600731, "'보고서BS'!B6"), src(300000000, "'보고서BS'!B19")]);
  const c = r.plans[0].cells.find((x) => x.row === 8 && x.col === 4)!;
  assert.equal(c.formula, "'보고서BS'!B6", '천원 주석은 천원에서 반올림해 맞춘다');
  assert.equal(c.kind, 'linked');
  assert.equal(r.links.length, 1);
});

test('흐름(취득)·단수차이·기초·날짜 줄은 잇지 않는다', () => {
  const r = linkToWtb(rolled, plain, [src(628601000, "'보고서BS'!B6"), src(300000000, "'보고서BS'!B19")]);
  const at = (row: number, col: number) => r.plans[0].cells.find((x) => x.row === row && x.col === col)!;
  assert.equal(at(8, 5).formula, undefined, '취득 칸 — 잔액과 우연히 같다');
  assert.equal(at(8, 6).formula, undefined, '단수차이 칸');
  assert.equal(at(9, 4).formula, undefined, '기초 줄');
  assert.equal(at(10, 4).formula, undefined, '날짜가 적힌 줄');
});

test('흐름 칸도 손익 줄과는 잇는다', () => {
  const r = linkToWtb(rolled, plain, [src(300000000, "'WPL'!O40", false, true)]);
  assert.equal(r.plans[0].cells.find((x) => x.row === 8 && x.col === 5)!.formula, "'WPL'!O40");
});

test('같은 금액 줄이 둘이면 비워 두고 센다 · 보고서 줄이 하나면 그것을 고른다 · 부호가 반대면 음수로', () => {
  let r = linkToWtb(rolled, plain, [src(844000000, "'WBS'!T11", false), src(844000000, "'WBS'!T12", false)]);
  assert.equal(r.plans[0].cells.find((x) => x.row === 11)!.formula, undefined);
  assert.equal(r.ambiguous, 1);
  r = linkToWtb(rolled, plain, [src(844000000, "'WBS'!T11", false), src(844000000, "'보고서BS'!B7")]);
  assert.equal(r.plans[0].cells.find((x) => x.row === 11 && x.col === 4)!.formula, "'보고서BS'!B7");
  r = linkToWtb(rolled, plain, [src(-844000000, "'WBS'!T11", false)]);
  assert.equal(r.plans[0].cells.find((x) => x.row === 11 && x.col === 4)!.formula, "-('WBS'!T11)");
});

test('약정·현금흐름 주석은 건너뛴다', () => {
  const r = linkToWtb([{ ...rolled[0], name: 'N19 약정사항', note: 'N19 약정사항' }], plain, [src(844000000, "'보고서BS'!B7")]);
  assert.equal(r.links.length, 0);
});

const sheet = (name: string, cells: Record<string, CellValue>): SheetData => ({ name, cells: new Map(Object.entries(cells)) });
test('남은 시트 — 보고서·정산표 표가 아니고, 남는 시트가 가리키면 뺄 수 없다', () => {
  const book = [
    sheet('보고서BS', { B6: { formula: 'WBS!T7' } }), sheet('WBS', {}), sheet('주석', { C3: { formula: "'보고서BS'!B6" } }),
    sheet('메모', {}), sheet('계산', {}), sheet('A500_FY26', { D5: { formula: '계산!A1' } }),
  ];
  const lo = leftoverSheets(book).filter((x) => !x.core);
  assert.deepEqual(lo.map((x) => x.name), ['주석', '메모', '계산']);
  assert.deepEqual(lo.find((x) => x.name === '계산')!.refBy, ['A500_FY26']);
  assert.deepEqual(lo.find((x) => x.name === '주석')!.refBy, [], '주석이 보고서를 가리키는 것은 상관없다');
});

test('removeSheets — 시트·관계·정의된 이름(localSheetId 다시 매김)·app.xml 을 함께 고친다', () => {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<Types><Override PartName="/xl/worksheets/sheet1.xml" ContentType="x"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="x"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="x"/><Override PartName="/xl/calcChain.xml" ContentType="c"/></Types>'),
    '_rels/.rels': strToU8('<Relationships><Relationship Id="rId1" Type="officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8('<workbook><bookViews><workbookView activeTab="2"/></bookViews><sheets><sheet name="WBS" sheetId="1" r:id="rId1"/><sheet name="주석" sheetId="2" r:id="rId2"/><sheet name="보고서BS" sheetId="3" r:id="rId3"/></sheets>'
      + '<definedNames><definedName name="_xlnm.Print_Area" localSheetId="1">주석!$A$1:$C$9</definedName><definedName name="_xlnm.Print_Area" localSheetId="2">보고서BS!$A$1:$C$9</definedName><definedName name="x">주석!$A$1</definedName><definedName name="y">WBS!$A$1</definedName></definedNames></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="ws" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="ws" Target="worksheets/sheet3.xml"/><Relationship Id="rId9" Type="calc" Target="calcChain.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8('<worksheet/>'), 'xl/worksheets/sheet2.xml': strToU8('<worksheet/>'), 'xl/worksheets/sheet3.xml': strToU8('<worksheet/>'),
    'xl/worksheets/_rels/sheet2.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Type="d" Target="../drawings/drawing1.xml"/></Relationships>'),
    'xl/drawings/drawing1.xml': strToU8('<d/>'), 'xl/calcChain.xml': strToU8('<c/>'),
    'docProps/app.xml': strToU8('<Properties><HeadingPairs><vt:vector size="2"><vt:variant><vt:lpstr>워크시트</vt:lpstr></vt:variant><vt:variant><vt:i4>3</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="3" baseType="lpstr"><vt:lpstr>WBS</vt:lpstr><vt:lpstr>주석</vt:lpstr><vt:lpstr>보고서BS</vt:lpstr></vt:vector></TitlesOfParts></Properties>'),
  };
  const back = unzipSync(zipSync(files));
  assert.deepEqual(removeSheets(back, ['주석']), ['주석']);
  assert.deepEqual(sheetEntries(back).map((e) => e.name), ['WBS', '보고서BS']);
  const wb = strFromU8(back['xl/workbook.xml']);
  assert.match(wb, /localSheetId="1">보고서BS/, '보고서BS 는 2 → 1');
  assert.doesNotMatch(wb, /주석!/, '지운 시트를 가리키는 이름은 지운다');
  assert.match(wb, /name="y"/);
  assert.match(wb, /activeTab="1"/);
  assert.equal(back['xl/worksheets/sheet2.xml'], undefined);
  assert.equal(back['xl/drawings/drawing1.xml'], undefined, '지운 시트에만 딸린 그림도 지운다');
  assert.equal(back['xl/calcChain.xml'], undefined);
  assert.doesNotMatch(strFromU8(back['[Content_Types].xml']), /sheet2/);
  const app = strFromU8(back['docProps/app.xml']);
  assert.match(app, /size="2" baseType/); assert.match(app, /<vt:i4>2<\/vt:i4>/); assert.doesNotMatch(app, />주석</);
});
