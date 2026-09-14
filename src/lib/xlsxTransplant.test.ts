import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import {
  sheetEntries, parseStyles, mergeStyles, sharedItems, usedStyleIds, rewriteSheet,
  transplantSheet, dropCalcChain, setSheetHidden,
} from './xlsxTransplant.ts';
import { readWorkbook } from './xlsxRead.ts';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** 시트 몇 장짜리 워크북. sheets: [이름, 시트 XML 속(worksheet 안)]. */
function book(sheets: [string, string, string?][], styles: string, shared: string[] = [], extra: Record<string, string> = {}) {
  const files: Record<string, Uint8Array> = {};
  const overrides: string[] = [];
  const rels: string[] = [];
  const list: string[] = [];
  sheets.forEach(([name, inner, state], i) => {
    const p = `xl/worksheets/sheet${i + 1}.xml`;
    files[p] = strToU8(`<?xml version="1.0"?><worksheet xmlns="${NS}" xmlns:r="${R}">${inner}</worksheet>`);
    overrides.push(`<Override PartName="/${p}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    rels.push(`<Relationship Id="rId${i + 1}" Type="${R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`);
    list.push(`<sheet name="${name}" sheetId="${i + 1}"${state ? ` state="${state}"` : ''} r:id="rId${i + 1}"/>`);
  });
  files['[Content_Types].xml'] = strToU8(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${overrides.join('')}<Override PartName="/xl/styles.xml" ContentType="x"/></Types>`);
  files['xl/workbook.xml'] = strToU8(`<?xml version="1.0"?><workbook xmlns="${NS}" xmlns:r="${R}"><sheets>${list.join('')}</sheets><definedNames><definedName name="이름" localSheetId="0">A!$A$1</definedName></definedNames></workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}<Relationship Id="rId99" Type="${R}/styles" Target="styles.xml"/></Relationships>`);
  files['xl/styles.xml'] = strToU8(styles);
  if (shared.length) {
    files['xl/sharedStrings.xml'] = strToU8(`<sst xmlns="${NS}" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((s) => `<si>${s}</si>`).join('')}</sst>`);
  }
  for (const [k, v] of Object.entries(extra)) files[k] = strToU8(v);
  return files;
}

const SRC_STYLES = `<styleSheet xmlns="${NS}">`
  + '<numFmts count="1"><numFmt numFmtId="176" formatCode="#,##0_);(#,##0)"/></numFmts>'
  + '<fonts count="3"><font><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><name val="맑은 고딕"/></font><font><u/><color rgb="FF0070C0"/><sz val="10"/><name val="맑은 고딕"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill></fills>'
  + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" wrapText="1"/></xf>'
  + '<xf numFmtId="176" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/></cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '<dxfs count="1"><dxf><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf></dxfs>'
  + '</styleSheet>';

const TGT_STYLES = `<styleSheet xmlns="${NS}">`
  + '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0_);(#,##0)"/></numFmts>'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="맑은 고딕"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';

const SRC_SHEET = '<sheetPr codeName="Sheet7"><tabColor rgb="FF00B050"/></sheetPr><dimension ref="A1:D5"/>'
  + '<sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>'
  + '<cols><col min="1" max="1" width="30" style="3" customWidth="1"/></cols>'
  + '<sheetData>'
  + '<row r="1" s="1" customFormat="1"><c r="A1" s="1" t="s"><v>0</v></c><c r="B1" s="2"><v>1234</v></c></row>'
  + '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" s="3"><f>[1]TB!A1</f><v>7</v></c><c r="C2"><f>A1&amp;"x"</f><v>0</v></c><c r="D2" s="2"/></row>'
  + '</sheetData>'
  + '<mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>'
  + '<conditionalFormatting sqref="B1"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>0</formula></cfRule></conditionalFormatting>'
  + '<dataValidations count="1"><dataValidation type="list" sqref="C2"><formula1>"Y,N,N/A"</formula1></dataValidation></dataValidations>'
  + '<hyperlinks><hyperlink ref="A2" r:id="rId9"/><hyperlink ref="B2" location="\'조서목록\'!A1" display="목록"/></hyperlinks>'
  + '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
  + '<pageSetup paperSize="9" orientation="landscape" r:id="rId8"/>'
  + '<legacyDrawing r:id="rId7"/>'
  + '<tableParts count="1"><tablePart r:id="rId6"/></tableParts>'
  + '<extLst><ext uri="x"><x14:foo/></ext></extLst>';

const SHARED = [
  '<t>회사명</t>',
  '<r><t>기준서 </t></r><r><rPr><b/><color rgb="FF0070C0"/></rPr><t>315</t></r><rPh sb="0" eb="1"><t>ハ</t></rPh>',
];

function source() { return book([['2301', SRC_SHEET]], SRC_STYLES, SHARED); }
function target() { return book([['조서목록', '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>목록</t></is></c></row></sheetData>'], ['2301', '<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>', 'hidden'], ['8700', '<sheetData/>']], TGT_STYLES, [], { 'xl/calcChain.xml': '<calcChain/>', 'xl/worksheets/_rels/sheet2.xml.rels': '<Relationships/>' }); }

test('시트 목록 — 이름·번호·부품·숨김', () => {
  const e = sheetEntries(target());
  assert.deepEqual(e.map((x) => [x.name, x.sheetId, x.part, x.state]), [
    ['조서목록', 1, 'xl/worksheets/sheet1.xml', undefined], ['2301', 2, 'xl/worksheets/sheet2.xml', 'hidden'], ['8700', 3, 'xl/worksheets/sheet3.xml', undefined],
  ]);
});

test('서식표 읽기', () => {
  const s = parseStyles(SRC_STYLES);
  assert.equal(s.fonts.length, 3);
  assert.equal(s.fills.length, 3);
  assert.equal(s.borders.length, 2);
  assert.equal(s.cellXfs.length, 4);
  assert.equal(s.dxfs.length, 1);
  assert.equal(s.numFmts.get(176), '#,##0_);(#,##0)');
});

test('서식 합치기 — 있는 것은 재사용, 없는 것은 뒤에 붙이고 번호를 바꿔 단다', () => {
  const r = mergeStyles(TGT_STYLES, parseStyles(SRC_STYLES), new Set([1, 2, 3]), new Set([0]));
  const t = parseStyles(r.xml);
  // 굵은 맑은고딕은 대상에 이미 있다(fontId 1) — 글꼴은 밑줄 파랑·보통 둘만 늘어야 한다
  assert.equal(t.fonts.length, 4, `fonts=${t.fonts.length}`);
  assert.equal(t.fills.length, 3, '노랑 하나');
  assert.equal(t.borders.length, 2, '얇은 테두리 하나');
  assert.equal(t.cellXfs.length, 5, 'xf 셋');
  assert.equal(t.dxfs.length, 1);
  // 사용자 숫자꼴 176 은 대상의 164 와 formatCode 가 같다 — 새로 안 만들고 164 를 쓴다
  assert.equal(t.numFmts.size, 1);
  const xf1 = t.cellXfs[r.xfMap.get(1)!];
  assert.ok(/fontId="1"/.test(xf1) && /fillId="2"/.test(xf1) && /borderId="1"/.test(xf1), xf1);
  assert.ok(xf1.includes('<alignment horizontal="center" wrapText="1"/>'), '정렬은 그대로');
  const xf2 = t.cellXfs[r.xfMap.get(2)!];
  assert.ok(/numFmtId="164"/.test(xf2), xf2);
  assert.ok(/count="5"/.test(/<cellXfs[^>]*>/.exec(r.xml)![0]), 'count 를 올린다');
  assert.ok(/<dxfs count="1">/.test(r.xml), '없던 dxfs 묶음을 만든다');
  assert.ok(r.xml.indexOf('<dxfs') > r.xml.indexOf('</cellStyles>'), 'dxfs 는 cellStyles 뒤');
});

test('시트 손질 — 공유문자열 인라인(서식 조각 유지·발음 제거) · 서식 번호 교체 · 외부수식 값만 · 그림 제거', () => {
  const xfMap = new Map([[1, 4], [2, 3], [3, 2]]);
  const out = rewriteSheet(`<worksheet>${SRC_SHEET}</worksheet>`, sharedItems(`<sst><si>${SHARED[0]}</si><si>${SHARED[1]}</si></sst>`), xfMap, new Map([[0, 0]]));
  assert.ok(out.includes('<c r="A1" s="4" t="inlineStr"><is><t>회사명</t></is></c>'), out);
  assert.ok(out.includes('<c r="A2" t="inlineStr"><is><r><t>기준서 </t></r><r><rPr><b/><color rgb="FF0070C0"/></rPr><t>315</t></r></is></c>'), '서식 조각은 남고 발음은 빠진다');
  assert.ok(out.includes('<c r="B2" s="2"><v>7</v></c>'), '외부 링크 수식은 값만');
  assert.ok(out.includes('<c r="C2"><f>A1&amp;"x"</f><v>0</v></c>'), '보통 수식은 그대로');
  assert.ok(out.includes('<c r="D2" s="3"/>'));
  assert.ok(out.includes('<row r="1" s="4" customFormat="1">'));
  assert.ok(out.includes('<col min="1" max="1" width="30" style="2" customWidth="1"/>'));
  assert.ok(!out.includes('legacyDrawing') && !out.includes('tableParts') && !out.includes('extLst'), '그림·표·확장은 뺀다');
  assert.ok(out.includes('<pageSetup paperSize="9" orientation="landscape"/>'), 'pageSetup 의 r:id 만 뺀다');
  assert.ok(!out.includes('rId9') && out.includes('location="\'조서목록\'!A1"'), '외부 하이퍼링크만 뺀다');
  assert.ok(!out.includes('tabSelected') && !out.includes('codeName'));
  assert.ok(out.includes('<mergeCells count="1">') && out.includes('<dataValidations'), '병합·드롭다운은 남는다');
  assert.equal(usedStyleIds(`<worksheet>${SRC_SHEET}</worksheet>`).xf.size, 3);
});

test('이식 — 같은 이름 시트를 제자리에 갈아끼운다(숨김·번호·차례 유지, 옛 부품 제거)', () => {
  const t = target();
  const r = transplantSheet(t, source(), '2301', { replace: true });
  dropCalcChain(t);
  assert.equal(r.part, 'xl/worksheets/gwp1.xml');
  assert.equal(t['xl/worksheets/sheet2.xml'], undefined, '옛 부품을 지운다');
  assert.equal(t['xl/worksheets/_rels/sheet2.xml.rels'], undefined);
  assert.equal(t['xl/calcChain.xml'], undefined);
  const wb = strFromU8(t['xl/workbook.xml']);
  const names = [...wb.matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(names, ['조서목록', '2301', '8700'], '차례가 그대로다');
  assert.ok(/<sheet name="2301" sheetId="2" state="hidden" r:id="rId100"\/>/.test(wb), wb);
  assert.ok(wb.includes('localSheetId="0"'), '정의된 이름은 손대지 않는다');
  const types = strFromU8(t['[Content_Types].xml']);
  assert.ok(!types.includes('sheet2.xml') && types.includes('gwp1.xml'));
  const rels = strFromU8(t['xl/_rels/workbook.xml.rels']);
  assert.ok(!rels.includes('Id="rId2"') && rels.includes('Target="worksheets/gwp1.xml"'));
  // 다시 읽힌다
  const read = readWorkbook(zipSync(t));
  const s = read.find((x) => x.name === '2301')!;
  assert.equal(s.hidden, true);
  assert.equal(s.cells.get('A1')?.text, '회사명');
  assert.equal(s.cells.get('A2')?.text, '기준서 315');
  assert.equal(s.cells.get('B2')?.num, 7);
});

test('이식 — 새 이름으로 뒤에 붙인다', () => {
  const t = target();
  transplantSheet(t, source(), '2301', { as: '2301(신)' });
  const names = sheetEntries(t).map((e) => e.name);
  assert.deepEqual(names, ['조서목록', '2301', '8700', '2301(신)']);
  assert.equal(sheetEntries(t)[3].sheetId, 4);
  assert.throws(() => transplantSheet(t, source(), '2301', { as: '8700' }), /이미 있습니다/);
  assert.throws(() => transplantSheet(t, source(), '없는시트'), /없습니다/);
});

test('숨김 바꾸기', () => {
  const t = target();
  assert.ok(setSheetHidden(t, '2301', false));
  assert.equal(sheetEntries(t).find((e) => e.name === '2301')!.state, undefined);
  assert.ok(setSheetHidden(t, '8700', true));
  assert.equal(sheetEntries(t).find((e) => e.name === '8700')!.state, 'hidden');
  assert.ok(!setSheetHidden(t, '없음', true));
  assert.equal(unzipSync(zipSync(t))['xl/workbook.xml'].length > 0, true);
});
