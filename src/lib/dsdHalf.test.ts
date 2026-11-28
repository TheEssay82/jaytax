import { test } from 'node:test';
import assert from 'node:assert/strict';
import { halfText, halfDate, halfAll, halfHead, isHalfReport } from './dsdHalf.ts';
import { parseNoteBlocks } from './dsdBlocks.ts';
import { layoutNote } from './noteSheet.ts';

test('반기 말 → 기말 말 — 인코어 FY26 반기 보고서에 실제로 든 꼴', () => {
  assert.equal(halfText('당반기'), '당기');
  assert.equal(halfText('당반기말'), '당기말');
  assert.equal(halfText('전반기'), '전기');
  assert.equal(halfText('<당반기>'), '<당기>');
  assert.equal(halfText('반기말'), '기말');
  assert.equal(halfText('제 2 반기'), '제 2 기');
  assert.equal(halfText('제  1 반 기'), '제  1 기');
  assert.equal(halfText('제 2(당) 반기'), '제 2(당) 기');
  assert.equal(halfText('반기재무상태표'), '재무상태표');
  assert.equal(halfText('반 기 재 무 상 태 표'), '재 무 상 태 표');
  assert.equal(halfText('Ⅹ.반기순이익&lt;주석17&gt;'), 'Ⅹ.당기순이익&lt;주석17&gt;');
  assert.equal(halfText('(3) 반기중 당사의 유형자산'), '(3) 당기중 당사의 유형자산');
  assert.equal(halfText('당사의 반기포괄손익계산서 상 포괄손익은 반기순이익(손실)과 동일합니다.'),
    '당사의 포괄손익계산서 상 포괄손익은 당기순이익(손실)과 동일합니다.');
});

test('반기를 뜻하는 이름은 바꾸지 않는다 — 「분ㆍ반기검토」·「일반기업회계기준」', () => {
  assert.equal(halfText('분ㆍ반기검토'), '분ㆍ반기검토');
  assert.equal(halfText('일반기업회계기준'), '일반기업회계기준');
  assert.equal(halfText('제1(전) 기(감사받지 아니한 재무제표)'), '제1(전) 기(감사받지 아니한 재무제표)');
});

test('날짜 — 올해·작년 6월 30일만 12월 31일로, 꼴은 그대로', () => {
  assert.equal(halfDate('2026년 06월 30일', 2026), '2026년 12월 31일');
  assert.equal(halfDate('2025년 6월 30일', 2026), '2025년 12월 31일');
  assert.equal(halfDate('2026.06.30 (당반기말)', 2026), '2026.12.31 (당반기말)');
  assert.equal(halfDate('2025년 02월 10일부터 2025년 06월 30일까지', 2026), '2025년 02월 10일부터 2025년 12월 31일까지');
  // 상환 일정·처분확정일은 그대로
  assert.equal(halfDate('2026.07.01~2027.06.30', 2026), '2026.07.01~2027.06.30');
  assert.equal(halfDate('처분확정일: 2026년 3월 31일', 2026), '처분확정일: 2026년 3월 31일');
  assert.equal(halfAll('제 2(당) 반기 2026년 06월 30일 현재', 2026), '제 2(당) 기 2026년 12월 31일 현재');
});

test('머리 칸 — 당기 · 전반기(흐름) · 전기말(잔액)', () => {
  assert.equal(halfHead('당반기'), 'cur');
  assert.equal(halfHead('당반기말'), 'cur');
  assert.equal(halfHead('제 2(당) 반기'), 'cur');
  assert.equal(halfHead('전반기'), 'flow');
  assert.equal(halfHead('제 1(전) 반기&cr;(감사받지 아니한 재무제표)'), 'flow');
  assert.equal(halfHead('전기말'), 'end');
  assert.equal(halfHead('제 1(전) 기&cr;(감사받지 아니한 재무제표)'), 'end');
  assert.equal(halfHead('구 분'), null);
  assert.equal(isHalfReport('<TITLE>반 기 재 무 상 태 표</TITLE>'), true);
  assert.equal(isHalfReport('<TITLE>재 무 상 태 표</TITLE>'), false);
});

const XML = `<DOCUMENT>
<SECTION-2><TITLE>주석</TITLE>
<P>1. 차입금</P>
<P>당반기 보고기간종료일 현재 차입금은 다음과 같습니다.</P>
<TABLE><TBODY>
<TR><TH>구 분</TH><TH>당반기말</TH><TH>전기말</TH></TR>
<TR><TD>신한은행</TD><TD>5,000,000,000</TD><TD>4,000,000,000</TD></TR>
</TBODY></TABLE>
<P>2. 판매비와관리비</P>
<TABLE><TBODY>
<TR><TH>구 분</TH><TH>당반기</TH><TH>전반기</TH></TR>
<TR><TD>복리후생비</TD><TD>300,000</TD><TD>200,000</TD></TR>
</TBODY></TABLE>
</SECTION-2>
</DOCUMENT>`;

test('반기 틀 배치 — 당기 비움 · 전기말 그대로 · 전반기 비움, 비운 칸에 열쇠', () => {
  const notes = parseNoteBlocks(XML);
  const p1 = layoutNote(notes[0], 'N01', { roll: true, half: 2026 });
  const t1 = (r: number, c: number) => p1.cells.find((x) => x.row === r && x.col === c);
  const para = p1.cells.find((c) => c.kind === 'para')!;
  assert.equal(para.text, '당기 보고기간종료일 현재 차입금은 다음과 같습니다.');
  const heads = p1.cells.filter((c) => c.kind === 'head').map((c) => c.text);
  assert.deepEqual(heads, ['구 분', '당기말', '전기말']);
  const row = p1.cells.find((c) => c.text === '신한은행')!.row;
  assert.equal(t1(row, 4)?.kind, 'input');                     // 당기 — 비움
  assert.equal(t1(row, 5)?.num, 4000000000);                   // 전기말 — 그대로(한 해 밀지 않는다)
  assert.deepEqual(t1(row, 4)?.key, { col: 5, flow: false, to: 'cur' });

  const p2 = layoutNote(notes[1], 'N02', { roll: true, half: 2026 });
  const r2 = p2.cells.find((c) => c.text === '복리후생비')!.row;
  const t2 = (c: number) => p2.cells.find((x) => x.row === r2 && x.col === c);
  assert.equal(t2(4)?.kind, 'input');                          // 당기 — 비움
  assert.equal(t2(5)?.kind, 'input');                          // 전반기 — 비움(기말에 1년 치로)
  assert.deepEqual(t2(4)?.key, { col: 5, flow: true, to: 'cur' });
  assert.deepEqual(t2(5)?.key, { col: 5, flow: true, to: 'prev' });
  assert.deepEqual(p2.cells.filter((c) => c.kind === 'head').map((c) => c.text), ['구 분', '당기', '전기']);
});

test('반기 틀을 끄면 옛 이월 그대로 — 당기가 전기로 내려간다', () => {
  const notes = parseNoteBlocks(XML.replace('당반기말', '당기말').replace('<TH>전기말', '<TH>전기말'));
  const p = layoutNote(notes[0], 'N01', { roll: true });
  const row = p.cells.find((c) => c.text === '신한은행')!.row;
  assert.equal(p.cells.find((x) => x.row === row && x.col === 5)?.num, 5000000000);
});
