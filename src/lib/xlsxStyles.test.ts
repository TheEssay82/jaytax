import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addNoteStyles, MINIMAL_STYLES } from './xlsxStyles.ts';

/** 원본 비슷하게 — 이미 여러 개가 들어 있는 styles.xml */
const EXISTING = '<?xml version="1.0"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="2"><numFmt numFmtId="176" formatCode="#,##0"/><numFmt numFmtId="177" formatCode="0.0%"/></numFmts>'
  + '<fonts count="3"><font><sz val="11"/></font><font><b/></font><font><i/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="2"><border/><border><left style="thick"/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="4">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="176" fontId="1" fillId="0" borderId="1" xfId="0"/>'
  + '<xf numFmtId="0" fontId="2" fillId="1" borderId="0" xfId="0"/>'
  + '<xf numFmtId="177" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '</cellXfs></styleSheet>';

test('원본 서식은 앞에 그대로 남고 우리 것은 뒤에 붙는다', () => {
  const { xml, ids } = addNoteStyles(EXISTING);
  // 원본 셀들이 가리키던 번호(0~3)가 그대로여야 한다
  assert.ok(xml.includes('<xf numFmtId="176" fontId="1" fillId="0" borderId="1" xfId="0"/>'));
  assert.ok(ids.label >= 4, `우리 것은 4번부터: ${ids.label}`);
  assert.deepEqual(
    [ids.label, ids.title, ids.para, ids.head, ids.text, ids.num, ids.input],
    [4, 5, 6, 7, 8, 9, 10],
  );
});

test('개수(count)를 함께 올린다 — 안 올리면 엑셀이 못 연다', () => {
  const { xml } = addNoteStyles(EXISTING);
  const count = (tag: string) => Number(new RegExp(`<${tag}[^>]*count="(\\d+)"`).exec(xml)![1]);
  assert.equal(count('numFmts'), 3);        // 2 + 1
  assert.equal(count('fonts'), 6);          // 3 + 3
  assert.equal(count('fills'), 4);          // 2 + 2(머리 음영·입력 노랑)
  assert.equal(count('borders'), 3);        // 2 + 1
  assert.equal(count('cellXfs'), 11);       // 4 + 7
});

test('숫자꼴 번호가 이미 쓰는 것과 겹치지 않는다', () => {
  const { xml } = addNoteStyles(EXISTING);
  const ids = [...xml.matchAll(/<numFmt numFmtId="(\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, '겹치면 엑셀이 서식을 뒤섞는다');
  assert.ok(ids.includes('178'), `176·177 다음 번호를 쓴다: ${ids.join(',')}`);
});

test('천단위 쉼표와 음수 괄호 — 가독성 지적을 받은 자리', () => {
  const { xml } = addNoteStyles(EXISTING);
  assert.ok(xml.includes('#,##0;(#,##0)'), '「1,234」·음수는 「(1,234)」');
});

test('표가 표로 보이게 — 테두리와 머리 음영', () => {
  const { xml } = addNoteStyles(EXISTING);
  assert.ok(xml.includes('style="thin"'), '얇은 테두리를 더한다');
  assert.ok(xml.includes('fgColor rgb="FFEDF0F5"'), '머리행 음영을 더한다');
  assert.ok(xml.includes('fgColor rgb="FFFFF2B2"'), '채워 넣을 칸은 노랗게');
});

test('numFmts 가 없는 파일이면 fonts 앞에 새로 만든다 — 차례를 지켜야 한다', () => {
  const { xml } = addNoteStyles(MINIMAL_STYLES);
  const nf = xml.indexOf('<numFmts');
  const ft = xml.indexOf('<fonts');
  assert.ok(nf > 0 && nf < ft, '스키마가 정한 차례(numFmts → fonts)');
});

test('알아볼 수 없는 파일이면 알려 준다', () => {
  assert.throws(() => addNoteStyles('<styleSheet></styleSheet>'), /fonts/);
});
