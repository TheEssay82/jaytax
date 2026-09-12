import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slots, unescapeXml, escapeXml, splitParts, joinParts, parseNoteBlocks } from './dsdBlocks.ts';

const XML = `<DOCUMENT>
<SECTION-1><TITLE>(첨부)재 무 제 표</TITLE><P>버릴 것</P></SECTION-1>
<SECTION-2><TITLE>주석</TITLE>
<TABLE><TBODY><TR><TD>제 18(당) 기</TD></TR></TBODY></TABLE>
<P>1. 회사의 개요</P>
<P>명진산업개발 주식회사(이하 &quot;당사&quot;)은 부동산 관련 사업을 영위하고 있습니다.</P>
<P>당사의 대표이사는 이종명이며, 주요 주주현황은 다음과 같습니다.</P>
<TABLE><TBODY>
<TR><TH>구    분</TH><TH>주식수(주)</TH></TR>
<TR><TD>이 종 명</TD><TD>32,000</TD></TR>
<TR><TD>합     계</TD><TD>64,000</TD></TR>
</TBODY></TABLE>
<P>2. 재고자산</P>
<P>보고기간종료일 현재 건설용지의 공시지가는 다음과 같습니다.</P>
<TABLE><TBODY><TR><TD>건설용지</TD><TD>15,419,575,880</TD></TR></TBODY></TABLE>
</SECTION-2>
<SECTION-3><TITLE>외부감사 실시내용</TITLE><P>1. 감사대상업무</P></SECTION-3>
</DOCUMENT>`;

test('slots — 글자가 든 자리를 원본 위치와 함께 집는다', () => {
  const sl = slots(XML);
  assert.ok(sl.length > 10);
  for (const s of sl) {
    assert.equal(XML.slice(s.start, s.end), s.raw, '잘라낸 자리가 원문과 같아야 한다');
  }
});

test('escape / unescape — 넣었다 빼도 그대로', () => {
  const raw = '가 "나" & <다> 줄\n바꿈';
  assert.equal(unescapeXml(escapeXml(raw)), raw);
  assert.equal(unescapeXml('&quot;당사&quot;'), '"당사"');
  assert.equal(escapeXml('줄\n바꿈'), '줄&amp;cr;바꿈');
});

test('주석별 블록 — 문단과 표가 나온 순서대로', () => {
  const notes = parseNoteBlocks(XML);
  assert.equal(notes.length, 2);

  const n1 = notes[0];
  assert.equal(n1.no, 1);
  assert.equal(n1.title, '회사의 개요');
  assert.deepEqual(n1.blocks.map((b) => b.kind), ['para', 'para', 'table']);
  assert.ok(n1.blocks[0].kind === 'para' && n1.blocks[0].parts[0].startsWith('명진산업개발'));
  assert.ok(n1.blocks[0].kind === 'para' && n1.blocks[0].parts[0].includes('"당사"'), '엔티티가 풀려야 한다');

  const t = n1.blocks[2];
  assert.ok(t.kind === 'table');
  assert.equal(t.rows.length, 3);
  assert.deepEqual(t.rows[0].map((c) => c.text), ['구    분', '주식수(주)']);
  assert.deepEqual(t.rows[2].map((c) => c.text), ['합     계', '64,000']);
});

test('주석 머리 앞의 것(기간 표)과 다른 절은 들어오지 않는다', () => {
  const notes = parseNoteBlocks(XML);
  const all = JSON.stringify(notes);
  assert.ok(!all.includes('제 18(당) 기'), '첫 주석 앞의 표는 버린다');
  assert.ok(!all.includes('버릴 것'), '재무제표 절은 들어오지 않는다');
  assert.ok(!all.includes('감사대상업무'), '외부감사 실시내용은 들어오지 않는다');
});

test('머리글 문단 자체는 본문에 넣지 않는다 — 제목으로만 쓴다', () => {
  const notes = parseNoteBlocks(XML);
  const bodies = notes.flatMap((n) => n.blocks)
    .flatMap((b) => (b.kind === 'para' ? b.parts : []));
  assert.ok(!bodies.some((t) => t.startsWith('1. 회사의 개요')));
  assert.ok(!bodies.some((t) => t.startsWith('2. 재고자산')));
});

test('자리는 원본 XML 의 자리를 가리킨다 — 나중에 그 자리에 도로 넣는다', () => {
  const notes = parseNoteBlocks(XML);
  const sl = slots(XML);
  const t = notes[1].blocks.find((b) => b.kind === 'table');
  assert.ok(t && t.kind === 'table');
  const cell = t.rows[0][1];
  assert.equal(cell.text, '15,419,575,880');
  assert.equal(XML.slice(sl[cell.slot].start, sl[cell.slot].end), '15,419,575,880');
});

test('한 P 안의 여러 문단을 가른다 — 빈 줄이 문단 경계다', () => {
  // DSD 는 &cr;&cr; 로 문단을 나눈다. 명진 1번 주석은 P 하나에 네 문단이 들어 있었다.
  const xml = `<DOCUMENT><SECTION-2><TITLE>주석</TITLE>
<P>1. 회사의 개요</P>
<P>첫째 문단입니다.&amp;cr;&amp;cr;둘째 문단입니다.&amp;cr;&amp;cr;셋째 문단입니다.</P>
</SECTION-2></DOCUMENT>`;
  const b = parseNoteBlocks(xml)[0].blocks[0];
  assert.ok(b.kind === 'para');
  assert.deepEqual(b.parts, ['첫째 문단입니다.', '둘째 문단입니다.', '셋째 문단입니다.']);
});

test('홑 줄바꿈은 같은 문단 — 가르지 않는다', () => {
  assert.deepEqual(splitParts('2.2 측정기준\n재무제표는 …\n- 파생상품'), ['2.2 측정기준\n재무제표는 …\n- 파생상품']);
  assert.deepEqual(splitParts('가\n\n나'), ['가', '나']);
  assert.deepEqual(splitParts('가\n \n나'), ['가', '나']);
  assert.deepEqual(splitParts('   '), []);
});

test('가른 문단을 도로 잇는다', () => {
  assert.equal(joinParts(['가', '나']), '가\n\n나');
  assert.equal(joinParts(['가', '', '  ', '나']), '가\n\n나');
  const t = '첫째\n\n둘째\n셋째';
  assert.equal(joinParts(splitParts(t)), t);
});

test('주석이 없는 문서면 빈 배열', () => {
  assert.deepEqual(parseNoteBlocks('<DOCUMENT><P>가</P></DOCUMENT>'), []);
  assert.deepEqual(parseNoteBlocks(''), []);
});
