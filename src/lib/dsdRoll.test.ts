import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTidyTerm, bumpTermText, restOf, rollStatements } from './dsdRoll.ts';

test('정형인 칸만 민다 — 본문 서술은 건드리지 않는다', () => {
  assert.equal(isTidyTerm('제 18 기'), true);
  assert.equal(isTidyTerm('제 18(당) 기 2025년 12월 31일 현재'), true);
  assert.equal(isTidyTerm('2025년 01월 01일'), true);
  assert.equal(isTidyTerm('2024.12.31(전기말)'), true);
  assert.equal(isTidyTerm('제 17(전) 기 2024년 01월 01일부터'), true);

  assert.equal(isTidyTerm('당사의 설립시 자본금은 520백만원이며, 2015년의 증자를 거쳐'), false);
  assert.equal(isTidyTerm('당사가 2025년 1월 1일로 개시하는 회계기간부터 신규로 적용한'), false);
  assert.equal(isTidyTerm('사채발행일 다음날 (2020년8월15일)로부터 상환만기일 전일까지'), false);
  assert.equal(isTidyTerm('구 분'), false, '기수도 연도도 없으면 대상이 아니다');
});

test('토큰을 빼면 남는 글자가 거의 없다 — 그것이 정형의 뜻', () => {
  assert.equal(restOf('제 18(당) 기 2025년 12월 31일 현재'), '');
  assert.equal(restOf('2024.01.01(전기초)'), '');
});

test('기수와 연도를 한 해 올린다', () => {
  assert.equal(bumpTermText('제 18 기'), '제 19 기');
  assert.equal(bumpTermText('제 18(당) 기'), '제 19(당) 기');
  assert.equal(bumpTermText('제 17(전) 기'), '제 18(전) 기');
  assert.equal(bumpTermText('제11(당)기말'), '제12(당)기말', '원본 띄어쓰기를 지킨다');
  assert.equal(bumpTermText('2025년 12월 31일'), '2026년 12월 31일');
  assert.equal(bumpTermText('2024.12.31'), '2025.12.31');
  assert.equal(bumpTermText('제 18(당) 기 2025년 01월 01일부터'), '제 19(당) 기 2026년 01월 01일부터');
});

const XML = `<DOCUMENT>
<SECTION-1 ACLASS="MANDATORY"><TITLE>(첨부)재 무 제 표</TITLE>
<TABLE><TBODY>
<TR><TD>제 18 기</TD></TR><TR><TD>2025년 01월 01일</TD></TR>
<TR><TD>2025년 12월 31일</TD></TR><TR><TD>제 17 기</TD></TR>
</TBODY></TABLE>
<P>◆click◆『재무상태표』 삽입</P>
<TABLE><THEAD><TR><TH>과 목</TH><TH COLSPAN="2">제 18(당) 기</TH><TH COLSPAN="2">제 17(전) 기</TH></TR></THEAD>
<TBODY>
<TR><TE ADELIM="0">현금및현금성자산</TE><TE ADELIM="1">46,180,910</TE><TE ADELIM="2"></TE><TE ADELIM="3">60,656,226</TE><TE ADELIM="4"></TE></TR>
<TR><TE ADELIM="0">I.유동자산</TE><TE ADELIM="1"></TE><TE ADELIM="2">24,350,610,492</TE><TE ADELIM="3"></TE><TE ADELIM="4">24,387,522,139</TE></TR>
<TR><TE ADELIM="0">비 고</TE><TE ADELIM="1">-</TE><TE ADELIM="2"></TE><TE ADELIM="3">-</TE><TE ADELIM="4"></TE></TR>
</TBODY></TABLE>
</SECTION-1>
<SECTION-2 ACLASS="MANDATORY"><TITLE>주석</TITLE>
<TABLE><TBODY><TR><TD>제 18(당) 기 2025년 01월 01일부터</TD></TR></TBODY></TABLE>
<P>1. 회사의 개요&amp;cr;&amp;cr;당사는 2015년에 증자하였습니다.</P>
</SECTION-2></DOCUMENT>`;

test('재무제표·표지를 밀고, 금액은 전기로 내리고 당기는 비운다', () => {
  const r = rollStatements(XML);
  assert.ok(r.xml.includes('<TD>제 19 기</TD>'));
  assert.ok(r.xml.includes('<TD>제 18 기</TD>'), '제17 은 제18 이 된다');
  assert.ok(r.xml.includes('2026년 01월 01일'));
  assert.ok(r.xml.includes('제 19(당) 기') && r.xml.includes('제 18(전) 기'));
  // 금액 — 전기 열에 작년 당기가 오고 당기는 빈다
  assert.ok(r.xml.includes('<TE ADELIM="3">46,180,910</TE>'), '전기로 내려와야 한다');
  assert.ok(r.xml.includes('<TE ADELIM="1"></TE>'), '당기는 비어야 한다');
  assert.ok(r.xml.includes('<TE ADELIM="4">24,350,610,492</TE>'));
  assert.ok(r.amounts > 0 && r.terms > 0);
});

test('본문 서술의 연도는 건드리지 않는다', () => {
  const r = rollStatements(XML);
  assert.ok(r.xml.includes('당사는 2015년에 증자하였습니다.'), '2016년이 되면 안 된다');
  assert.ok(r.leftovers.some((l) => l.why.includes('서술')));
});

test('④ 가 갈아끼울 자리는 밀지 않는다 — 두 해가 밀린다', () => {
  // 주석 절의 기간 표(자리 번호를 넣어 막아 본다)
  const plain = rollStatements(XML);
  assert.ok(plain.xml.includes('제 19(당) 기 2026년 01월 01일부터'), '막지 않으면 주석 머리도 밀린다');

  const idx = XML.split('<').length; // 넉넉한 자리 수
  const skip = new Set<number>();
  for (let i = 0; i < idx; i += 1) skip.add(i);
  const held = rollStatements(XML, 1, skip);
  assert.equal(held.terms, 0, '모두 막으면 기수를 하나도 밀지 않는다');
});
