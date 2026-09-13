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

// ── 행 늘리고 줄이기 ──────────────────────────────────────────
// 거래처가 해마다 늘고 준다. 엑셀에서 행을 직접 끼워 넣으면 아래 자리가 밀려 되돌릴 수
// 없으므로, **빈 줄을 미리 깔아 두고** 첫 열에 적으면 ④ 가 `<TR>` 을 하나 짓는다.

const ROWS = `<DOCUMENT><SECTION-2><TITLE>주석</TITLE>
<P>1. 매출채권</P>
<TABLE><TBODY>
<TR><TH>거래처</TH><TH>당기말</TH></TR>
<TR ACOPY="Y"><TD>가나상사</TD><TD ALIGN="RIGHT">1,000</TD></TR>
<TR ACOPY="Y"><TD>다라물산</TD><TD ALIGN="RIGHT">2,000</TD></TR>
<TR><TD>합 계</TD><TD ALIGN="RIGHT">3,000</TD></TR>
</TBODY></TABLE>
</SECTION-2></DOCUMENT>`;

function rowPlan(spare: number) {
  const picked = pickNotes(parseNoteBlocks(ROWS), [{ title: '매출채권', no: 1, enabled: true }]);
  return planNotes(picked, false, spare);
}

const trCount = (x: string) => (x.match(/<TR\b/g) ?? []).length;

test('여분 행은 합계 바로 위에 깔린다 — 아래 행은 그만큼 밀린다', () => {
  const p0 = rowPlan(0)[0];
  const p3 = rowPlan(3)[0];
  assert.equal(p0.spares?.length ?? 0, 0);
  assert.equal(p3.spares?.length, 3);
  // 합계 행이 세 줄 내려간다
  assert.equal(p3.tables![0].totalRow! - p0.tables![0].totalRow!, 3);
});

test('천원 표는 합계 수식이 여분 행까지 덮는다 — 새 거래처를 적으면 합계가 따라온다', () => {
  // 원 단위 표에는 합계 수식을 걸지 않는다(원본 숫자를 그대로 둔다). 거기서는 합계를 손으로
  // 고쳐야 하고, 안 고치면 ③ 검증의 풋팅이 잡는다.
  const 천원표 = ROWS.replace('<P>1. 매출채권</P>',
    '<P>1. 매출채권</P><TABLE><TBODY><TR><TD>(단위: 천원)</TD></TR></TBODY></TABLE>');
  const picked = pickNotes(parseNoteBlocks(천원표), [{ title: '매출채권', no: 1, enabled: true }]);
  const p = planNotes(picked, false, 3)[0];
  const t = p.tables!.find((x) => !x.isUnitMark)!;
  assert.equal(t.factor, 1000, '천원 표로 잡혀야 한다');
  const sum = p.cells.find((c) => c.row === t.totalRow && c.formula?.includes('SUM'));
  assert.ok(sum, `합계 수식이 있어야 한다: ${JSON.stringify(p.cells.filter((c) => c.row === t.totalRow))}`);
  // 마지막 항목 행이 아니라 **여분 세 줄 뒤**까지 더한다
  const last = Number(/:\D+(\d+)\)/.exec(sum!.formula!)?.[1]);
  assert.equal(last, t.totalRow! - 1, '합계 바로 윗줄까지 덮어야 한다');
});

test('손대지 않으면 원본과 한 글자도 다르지 않다 — 여분을 깔아도', () => {
  const plans = rowPlan(3);
  const r = writeNotes(ROWS, plans, sheetsFromPlans(plans));
  assert.equal(r.xml, ROWS);
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.removed, []);
});

test('여분 행 첫 열에 적으면 행이 하나 생긴다 — 속성까지 본보기 그대로', () => {
  const plans = rowPlan(3);
  const sheets = sheetsFromPlans(plans);
  const sp = plans[0].spares![0];
  for (const c of sp.cells) {
    sheets[0].cells.set(c.at, c.at === sp.labelAt ? { text: '마바기업' } : { num: 500 });
  }
  const r = writeNotes(ROWS, plans, sheets);
  assert.deepEqual(r.added, ['마바기업']);
  assert.equal(trCount(r.xml), trCount(ROWS) + 1);
  assert.match(r.xml, /<TR ACOPY="Y"><TD>마바기업<\/TD><TD ALIGN="RIGHT">500<\/TD><\/TR>/);
  // 합계 행 **위**에 들어간다
  assert.ok(r.xml.indexOf('마바기업') < r.xml.indexOf('합 계'), '합계 위에 와야 한다');
});

test('여분을 여럿 채우면 적은 차례대로 붙는다', () => {
  const plans = rowPlan(3);
  const sheets = sheetsFromPlans(plans);
  plans[0].spares!.slice(0, 2).forEach((sp, k) => {
    for (const c of sp.cells) {
      sheets[0].cells.set(c.at, c.at === sp.labelAt ? { text: `새거래처${k}` } : { num: 100 });
    }
  });
  const r = writeNotes(ROWS, plans, sheets);
  assert.deepEqual(r.added, ['새거래처0', '새거래처1']);
  assert.ok(r.xml.indexOf('새거래처0') < r.xml.indexOf('새거래처1'), '차례가 맞아야 한다');
  assert.equal(trCount(r.xml), trCount(ROWS) + 2);
});

test('첫 열을 지우면 그 행이 없어진다 — 덜 채운 것과 헷갈리지 않는다', () => {
  const plans = rowPlan(3);
  const sheets = sheetsFromPlans(plans);
  const d = plans[0].drops!.find((x) => x.origLabel === '가나상사')!;
  sheets[0].cells.delete(d.labelAt);
  const r = writeNotes(ROWS, plans, sheets);
  assert.deepEqual(r.removed, ['가나상사']);
  assert.equal(trCount(r.xml), trCount(ROWS) - 1);
  assert.ok(!r.xml.includes('가나상사'), '행이 통째로 없어져야 한다');
  assert.ok(r.xml.includes('다라물산'), '남은 행은 그대로');
});

test('머리 행과 합계 행은 없앨 수 없다', () => {
  const drops = rowPlan(0)[0].drops ?? [];
  assert.deepEqual(drops.map((d) => d.origLabel).sort(), ['가나상사', '다라물산']);
});

test('늘리기와 줄이기를 한꺼번에 해도 어긋나지 않는다', () => {
  const plans = rowPlan(3);
  const sheets = sheetsFromPlans(plans);
  const sp = plans[0].spares![0];
  for (const c of sp.cells) {
    sheets[0].cells.set(c.at, c.at === sp.labelAt ? { text: '마바기업' } : { num: 500 });
  }
  sheets[0].cells.delete(plans[0].drops!.find((x) => x.origLabel === '가나상사')!.labelAt);
  const r = writeNotes(ROWS, plans, sheets);
  assert.deepEqual(r.added, ['마바기업']);
  assert.deepEqual(r.removed, ['가나상사']);
  assert.equal(trCount(r.xml), trCount(ROWS));
  assert.equal((r.xml.match(/<\/TR>/g) ?? []).length, trCount(r.xml), '여는 태그와 닫는 태그가 맞아야 한다');
});
