import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  plain, notesSection, outerParagraphs, noteHeadings, parseNoteList,
  documentName, documentPeriod,
} from './dsdParse.ts';

// 명진산업개발 FY25 감사보고서의 실제 모양을 줄여 옮긴 것.
const XML = `<?xml version="1.0" encoding="utf-8"?>
<DOCUMENT>
<DOCUMENT-HEADER><DOCUMENT-NAME ACODE="00760">감사보고서</DOCUMENT-NAME></DOCUMENT-HEADER>
<SECTION-1><TITLE ATOC="Y">(첨부)재 무 제 표</TITLE>
<TABLE><TBODY><TR>
<TU AUNIT="PERIODFROM2" AUNITVALUE="20250101">2025년 01월 01일</TU>
<TU AUNIT="PERIODTO2" AUNITVALUE="20251231">2025년 12월 31일</TU>
</TR></TBODY></TABLE>
</SECTION-1>
<SECTION-2><TITLE ATOC="Y">주석</TITLE>
<P>1. 회사의 개요</P>
<P>명진산업개발 주식회사(이하 &quot;당사&quot;)은 부동산개발 및 매매업과 부동산컨설팅 등 부동산 관련 사업을 주된 영업으로 영위하고 있습니다.</P>
<TABLE><TBODY>
<TR><TH>구    분</TH><TH>주식수(주)</TH></TR>
<TR><TD>이 종 명</TD><TD>32,000</TD></TR>
<TR><TD><P>2. 표 안의 문단은 주석 제목이 아니다</P></TD><TD>0</TD></TR>
</TBODY></TABLE>
<P>2. 중요한 회계처리방침</P>
<P>2.2 측정기준 재무제표는 아래에서 열거하고 있는 항목을 제외하고는 역사적원가를 기준으로 작성되었습니다.</P>
<P>3. 유의적인 회계정책 당사가 일반기업회계기준에 따라 작성한 재무제표에 적용한 유의적인 회계정책은 다음과 같습니다</P>
<P>(1) 현금및현금성자산 당사는 통화 및 타인발행수표 등을 현금및현금성자산으로 분류합니다.</P>
<P>4. 사용이 제한된 예금 등</P>
<P>5. 재고자산</P>
</SECTION-2>
<SECTION-3><TITLE ATOC="Y">외부감사 실시내용</TITLE>
<P>1. 감사대상업무</P>
</SECTION-3>
</DOCUMENT>`;

test('plain — 태그·엔티티를 걷어낸다', () => {
  assert.equal(plain('<P>가 &quot;나&quot;  다</P>'), '가 "나" 다');
  assert.equal(plain('<P>줄&amp;cr;바꿈</P>'), '줄 바꿈');
  assert.equal(plain(''), '');
});

test('주석 절만 잘라낸다 — 앞뒤 절이 섞이지 않는다', () => {
  const sec = notesSection(XML);
  assert.ok(sec.includes('1. 회사의 개요'));
  assert.ok(!sec.includes('(첨부)재 무 제 표'));
  assert.ok(!sec.includes('1. 감사대상업무'), '뒤의 외부감사 실시내용이 섞이면 안 된다');
});

test('주석이 없는 문서면 빈 문자열', () => {
  assert.equal(notesSection('<DOCUMENT><P>가</P></DOCUMENT>'), '');
  assert.deepEqual(parseNoteList('<DOCUMENT/>'), []);
});

test('표 안의 문단은 세지 않는다', () => {
  const ps = outerParagraphs(notesSection(XML));
  assert.ok(ps.some((p) => p.startsWith('1. 회사의 개요')));
  assert.ok(!ps.some((p) => p.includes('표 안의 문단은')));
});

test('번호가 차례로 올라갈 때만 주석의 머리로 본다', () => {
  const list = parseNoteList(XML);
  assert.deepEqual(list.map((n) => n.no), [1, 2, 3, 4, 5]);
  // 제목과 본문이 한 문단에 붙어 있어도 제목만 뗀다
  assert.equal(list.find((n) => n.no === 3)?.title, '유의적인 회계정책');
  assert.equal(list.find((n) => n.no === 5)?.title, '재고자산');
});

test('두 자리 번호도 이어서 잡는다 — 주석은 보통 18~41개다', () => {
  assert.deepEqual(
    noteHeadings(['9. 자 본', '10. 이익잉여금처분계산서', '11. 법인세비용']).map((n) => n.no),
    [9, 10, 11],
  );
  assert.equal(noteHeadings(['18. 재무제표의 확정일'])[0]?.title, '재무제표의 확정일');
});

test('본문 속 2.2 · (1) 같은 것은 주석으로 오인하지 않는다', () => {
  const titles = parseNoteList(XML).map((n) => n.title);
  assert.ok(!titles.some((t) => t.includes('측정기준')));
  assert.ok(!titles.some((t) => t.includes('현금및현금성자산')));
});

test('번호가 거꾸로 가거나 멀리 뛰면 버린다', () => {
  assert.deepEqual(noteHeadings(['1. 가', '9. 나', '2. 다']).map((n) => n.no), [1, 2]);
  assert.deepEqual(noteHeadings(['3. 가', '1. 나']).map((n) => n.no), [3]);
});

test('문서 종류와 회계기간을 읽는다', () => {
  assert.equal(documentName(XML), '감사보고서');
  assert.deepEqual(documentPeriod(XML), { from: '2025-01-01', to: '2025-12-31' });
  assert.equal(documentPeriod('<DOCUMENT/>'), null);
});
