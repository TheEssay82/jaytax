import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNoteBlocks } from './dsdBlocks.ts';
import { pickNotes, planNotes } from './notePick.ts';
import { numText, splitRaw, writeNotes, sheetsFromPlans } from './dsdWrite.ts';
import { colName } from './noteSheet.ts';
import type { SheetData, CellValue } from './xlsxRead.ts';

const XML = `<DOCUMENT><SECTION-2><TITLE>주석</TITLE>
<P>1. 회사의 개요&amp;cr;&amp;cr;당사는 부동산업을 합니다. &amp;cr;&amp;cr;자본금은 640,000,000 원입니다.</P>
<TABLE><THEAD><TR><TH>구 분</TH><TH>당기말</TH><TH>전기말</TH></TR></THEAD>
<TBODY>
<TR><TD>이 종 명</TD><TD>32,000</TD><TD>32,000</TD></TR>
<TR><TD>합 계</TD><TD>64,000</TD><TD>(1,500)</TD></TR>
</TBODY></TABLE>
</SECTION-2></DOCUMENT>`;

/** 배치를 그대로 채운 엑셀 — 아무것도 안 고친 상태. */
function asFilled(plans: ReturnType<typeof planNotes>): SheetData[] {
  return plans.map((p) => {
    const cells = new Map<string, CellValue>();
    for (const c of p.cells) {
      if (c.formula != null) continue;
      const ref = `${colName(c.col)}${c.row}`;
      if (c.num != null) cells.set(ref, { num: c.num });
      else if (c.text) cells.set(ref, { text: c.text });
    }
    return { name: p.name, cells };
  });
}

function build() {
  const blocks = parseNoteBlocks(XML);
  const picked = pickNotes(blocks, blocks.map((b) => ({ title: b.title, no: b.no, enabled: true })));
  const plans = planNotes(picked, false);
  return { plans, sheets: asFilled(plans) };
}

test('아무것도 안 고치면 원본과 **글자 하나까지** 같다', () => {
  const { plans, sheets } = build();
  const r = writeNotes(XML, plans, sheets);
  assert.equal(r.changed, 0);
  assert.equal(r.skipped.length, 0);
  assert.equal(r.xml, XML, '무손실이어야 한다');
});

test('표 칸을 고치면 그 자리만 바뀐다', () => {
  const { plans, sheets } = build();
  const back = plans[0].back!.find((b) => b.orig === '32,000')!;
  sheets[0].cells.set(back.at, { num: 33000 });
  const r = writeNotes(XML, plans, sheets);
  assert.equal(r.changed, 1);
  assert.ok(r.xml.includes('<TD>33,000</TD>'));
  assert.equal(r.xml.length, XML.length, '「32,000」 → 「33,000」 은 길이가 같다');
});

test('음수는 원본이 괄호로 적었으면 괄호로 쓴다', () => {
  const { plans, sheets } = build();
  const back = plans[0].back!.find((b) => b.orig === '(1,500)')!;
  sheets[0].cells.set(back.at, { num: -2500 });
  const r = writeNotes(XML, plans, sheets);
  assert.ok(r.xml.includes('(2,500)'), '괄호 모양을 이어받아야 한다');
});

test('서술을 고치면 그 문단만 바뀌고 앞뒤는 그대로', () => {
  const { plans, sheets } = build();
  const back = plans[0].back!.filter((b) => b.part != null);
  const mid = back.find((b) => b.orig.startsWith('당사는'))!;
  sheets[0].cells.set(mid.at, { text: '당사는 부동산업과 임대업을 합니다.' });
  const r = writeNotes(XML, plans, sheets);
  assert.equal(r.changed, 1);
  assert.ok(r.xml.includes('부동산업과 임대업을 합니다. &amp;cr;&amp;cr;자본금은'), '끝 공백과 경계가 살아야 한다');
  assert.ok(r.xml.includes('1. 회사의 개요&amp;cr;&amp;cr;당사는'), '제목은 그대로');
});

test('numText — 원본이 적던 모양을 본뜬다', () => {
  assert.equal(numText(1234567, '1,234,567'), '1,234,567');
  assert.equal(numText(-5000, '(1,500)'), '(5,000)');
  assert.equal(numText(-5000, '-1,500'), '-5,000');
  assert.equal(numText(0, '-'), '-');
  assert.equal(numText(0, '0'), '0');
  assert.equal(numText(100, '100.00'), '100.00', '소수 자릿수를 지킨다');
  assert.equal(numText(1422.22, '1,363.98'), '1,422.22');
});

test('splitRaw — 자르지 않고 조각과 경계를 그대로 돌려준다', () => {
  const raw = '첫째. &amp;cr;&amp;cr;둘째.&amp;cr;&amp;cr; 셋째.';
  const parts = splitRaw(raw);
  assert.equal(parts.join(''), raw, '이어 붙이면 원본이어야 한다');
  // 경계 정규식이 뒤따르는 공백까지 먹으므로 조각은 공백 없이 시작한다 — 이어 붙이면 원본이다.
  assert.deepEqual([parts[0], parts[2], parts[4]], ['첫째. ', '둘째.', '셋째.']);
  assert.deepEqual([parts[1], parts[3]], ['&amp;cr;&amp;cr;', '&amp;cr;&amp;cr; ']);
});

test('엑셀 없이 — 배치 자체를 값으로 쓰면 작년 것을 한 해 민 빈 서식이 된다', () => {
  const blocks = parseNoteBlocks(XML);
  const picked = pickNotes(blocks, blocks.map((b) => ({ title: b.title, no: b.no, enabled: true })));
  const rolled = planNotes(picked, true);
  const r = writeNotes(XML, rolled, sheetsFromPlans(rolled));
  assert.equal(r.skipped.length, 0);
  // 당기 열은 비고 전기 열에 작년 당기가 내려온다
  assert.ok(r.xml.includes('<TD></TD><TD>32,000</TD>'), '당기 빈칸 · 전기에 작년 당기');
  assert.ok(!r.xml.includes('<TD>64,000</TD><TD>'), '당기 합계도 비어야 한다');
});
