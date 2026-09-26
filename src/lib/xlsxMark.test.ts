// 탭 색·칸 바탕색 — 일반조서 이월의 표시(빨강 탭, 노란 칸).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, strToU8 } from 'fflate';
import { tabStateOf, tabColorOf, setTabColor, highlightCells, TAB } from './xlsxMark';

test('탭 색 → 사무소 관행의 뜻 — 조금 다른 색도 가까운 쪽으로', () => {
  assert.equal(tabStateOf('FFFF0000'), 'red');
  assert.equal(tabStateOf('FFFFFF00'), 'yellow');
  assert.equal(tabStateOf('FF00B050'), 'green');
  assert.equal(tabStateOf('FF92D050'), 'green');   // 연두
  assert.equal(tabStateOf('FF0070C0'), null);      // 파랑 — 모름
  assert.equal(tabStateOf(undefined), null);
});

test('탭 색 읽고 쓰기 — sheetPr 이 없을 때·빈 태그·다른 자식이 있을 때', () => {
  const bare = '<worksheet xmlns="x"><dimension ref="A1"/><sheetData/></worksheet>';
  const a = setTabColor(bare, TAB.red);
  assert.match(a, /<worksheet xmlns="x"><sheetPr><tabColor rgb="FFFF0000"\/><\/sheetPr><dimension/);
  assert.equal(tabColorOf(a), 'FFFF0000');
  const self = setTabColor('<worksheet><sheetPr codeName="S1"/><sheetData/></worksheet>', TAB.red);
  assert.match(self, /<sheetPr codeName="S1"><tabColor rgb="FFFF0000"\/><\/sheetPr>/);
  const inner = setTabColor('<worksheet><sheetPr><tabColor rgb="FF00B050"/><pageSetUpPr fitToPage="1"/></sheetPr></worksheet>', TAB.red);
  assert.match(inner, /<sheetPr><tabColor rgb="FFFF0000"\/><pageSetUpPr fitToPage="1"\/><\/sheetPr>/);
  assert.equal(tabColorOf('<worksheet><sheetPr><tabColor theme="5"/></sheetPr></worksheet>'), 'theme:5');
});

test('칸 바탕색 — 원래 서식을 본뜬 서식을 한 번만 만들고, 없는 칸은 빈 칸으로 끼운다', () => {
  const files: Record<string, Uint8Array> = {
    'xl/styles.xml': strToU8('<styleSheet><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="14" fontId="1" fillId="0" borderId="1" applyNumberFormat="1"/></cellXfs></styleSheet>'),
    'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="3"><c r="B3" s="1"><v>46022</v></c><c r="D3"><v>1</v></c></row><row r="5"><c r="A5"/></row></sheetData></worksheet>'),
  };
  const n = highlightCells(files, 'xl/worksheets/sheet1.xml', ['B3', 'D3', 'C3', 'E4']);
  assert.equal(n, 4);
  const styles = strFromU8(files['xl/styles.xml']);
  assert.match(styles, /<fills count="3">.*<fgColor rgb="FFFFFF00"\/>/);
  assert.match(styles, /<cellXfs count="4">/);                                       // s=1 본뜬 것, s=0 본뜬 것
  assert.match(styles, /<xf numFmtId="14" fontId="1" borderId="1" applyNumberFormat="1" fillId="2" applyFill="1"\/>/);
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.match(sheet, /<c r="B3" s="2"><v>46022<\/v><\/c><c s="3" r="C3"\/><c s="3" r="D3">/); // 자리 순서 지킴
  assert.match(sheet, /<\/row><row r="4"><c s="3" r="E4"\/><\/row><row r="5">/);
  // 두 번째 호출은 같은 서식을 다시 쓴다
  highlightCells(files, 'xl/worksheets/sheet1.xml', ['A5']);
  assert.match(strFromU8(files['xl/styles.xml']), /<cellXfs count="4">/);
});
