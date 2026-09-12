import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutNote, colName } from './noteSheet.ts';
import type { SheetPlan } from './noteSheet.ts';
import type { SheetData, CellValue } from './xlsxRead.ts';
import { verifyAll, offBy, numOf } from './noteVerify.ts';
import type { NoteBlocks } from './dsdBlocks.ts';

function line(tag: 'TH' | 'TD', slot0: number, ...texts: string[]) {
  return texts.map((text, i) => ({ slot: slot0 + i, text, tag, col: i, colspan: 1, rowspan: 1 }));
}

/** 「사람이 시키는 대로 다 채운 엑셀」을 배치에서 지어낸다 — 여기서 어긋남이 0이어야 한다. */
function asFilled(plan: SheetPlan): SheetData {
  const cells = new Map<string, CellValue>();
  for (const c of plan.cells) {
    const ref = `${colName(c.col)}${c.row}`;
    if (c.formula != null) continue;                 // 수식 칸은 엑셀이 채운다
    if (c.num != null) cells.set(ref, { num: c.num });
    else if (c.text) cells.set(ref, { text: c.text });
  }
  return { name: plan.name, cells };
}

const 재고: NoteBlocks = {
  no: 5, title: '재고자산',
  blocks: [{
    kind: 'table', unit: '원',
    rows: [
      line('TH', 100, '구 분', '당기말', '전기말'),
      line('TD', 110, '제품', '1,000', '900'),
      line('TD', 120, '원재료', '2,000', '1,100'),
      line('TD', 130, '합 계', '3,000', '2,000'),
    ],
  }],
};

test('시킨 대로 채운 엑셀이면 어긋남이 없다', () => {
  const plan = layoutNote(재고, 'N05 재고자산', { roll: true });
  const r = verifyAll([plan], [asFilled(plan)]);
  assert.deepEqual(r.findings.filter((f) => f.level !== '안 채움'), []);
  // 당기 열은 비어 있으니 「안 채움」으로만 잡힌다
  assert.equal(r.filled.total, 3);
  assert.equal(r.filled.done, 0);
});

test('합계가 항목 합과 다르면 잡는다', () => {
  const plan = layoutNote(재고, 'N05 재고자산', { roll: true });
  const sheet = asFilled(plan);
  // 전기 열(E)에는 작년 당기 값 1,000 · 2,000 · 3,000 이 내려와 있다.
  // 합계만 손으로 3,500 으로 바꿨다 치자.
  sheet.cells.set('E7', { num: 3500 });
  const r = verifyAll([plan], [sheet]);
  const foot = r.findings.find((f) => f.kind === '풋팅');
  assert.ok(foot, '풋팅을 못 잡았다');
  assert.equal(foot!.level, '틀림');
  assert.equal(foot!.diff, 500);
  assert.match(foot!.says, /3,500.*3,000/);
});

test('이월한 전기 값을 고치면 잡는다 — 전기는 확정된 숫자다', () => {
  const plan = layoutNote(재고, 'N05 재고자산', { roll: true });
  const sheet = asFilled(plan);
  sheet.cells.set('E5', { num: 1050 });              // 1,000 → 1,050
  const r = verifyAll([plan], [sheet]);
  const f = r.findings.find((x) => x.kind === '전기값');
  assert.ok(f, '전기값 바뀜을 못 잡았다');
  assert.equal(f!.where, 'E5');
  assert.equal(f!.diff, 50);
});

test('전기 값을 지워도 잡는다', () => {
  const plan = layoutNote(재고, 'N05 재고자산', { roll: true });
  const sheet = asFilled(plan);
  sheet.cells.delete('E5');
  const r = verifyAll([plan], [sheet]);
  assert.ok(r.findings.some((x) => x.kind === '전기값' && x.where === 'E5'));
});

test('아직 엑셀에서 열지 않아 수식에 값이 없으면 넘긴다', () => {
  const plan = layoutNote(재고, 'N05 재고자산', { roll: true });
  const sheet = asFilled(plan);
  sheet.cells.set('E7', { formula: 'SUM(E5:E6)' });   // 값 없는 수식
  const r = verifyAll([plan], [sheet]);
  assert.deepEqual(r.findings.filter((f) => f.level === '틀림'), []);
});

test('노란 칸을 채우면 「안 채움」이 줄어든다', () => {
  const plan = layoutNote(재고, 'N05 재고자산', { roll: true });
  const sheet = asFilled(plan);
  sheet.cells.set('D5', { num: 1200 });
  sheet.cells.set('D6', { num: 2200 });
  sheet.cells.set('D7', { num: 3400 });
  const r = verifyAll([plan], [sheet]);
  assert.equal(r.filled.done, 3);
  assert.equal(r.findings.filter((f) => f.level === '안 채움').length, 0);
});

test('채운 당기 값도 풋팅을 본다', () => {
  const plan = layoutNote(재고, 'N05 재고자산', { roll: true });
  const sheet = asFilled(plan);
  sheet.cells.set('D5', { num: 1200 });
  sheet.cells.set('D6', { num: 2200 });
  sheet.cells.set('D7', { num: 3000 });              // 3,400 이어야 한다
  const r = verifyAll([plan], [sheet]);
  const foot = r.findings.find((f) => f.kind === '풋팅' && f.where.startsWith('D'));
  assert.ok(foot);
  assert.equal(foot!.diff, -400);
});

const 천원: NoteBlocks = {
  no: 7, title: '매출채권',
  blocks: [{
    kind: 'table', unit: '천원',
    rows: [
      line('TH', 200, '구 분', '당기말', '전기말'),
      line('TD', 210, '매출채권', '1,000', '900'),
      line('TD', 220, '대손충당금', '200', '100'),
      line('TD', 230, '합 계', '1,200', '1,000'),
    ],
  }],
};

test('천원 표 — 원 단위 칸을 고치면 표시값과 어긋난 것을 잡는다', () => {
  const plan = layoutNote(천원, 'N07 매출채권', { roll: true });
  const sheet = asFilled(plan);
  // 전기 표시열(E)은 ROUND 수식이라 값이 없다. 엑셀이 계산해 둔 값을 흉내 낸다.
  sheet.cells.set('E5', { formula: 'IF(H5="","",ROUND(H5/1000,0))', num: 1000 });
  // 원 단위 칸(H5)에는 1,000,000 이 이월돼 있다. 여기만 1,050,000 으로 고치면
  // 표시값 1,000 과 어긋난다 — ROUND 수식을 지우고 값을 박아 넣은 꼴이다.
  sheet.cells.set('H5', { num: 1050000 });
  const r = verifyAll([plan], [sheet]);
  assert.ok(r.findings.some((f) => f.kind === '수식' && f.where === 'H5 → E5'), '수식 어긋남을 못 잡았다');
  assert.ok(r.findings.some((f) => f.kind === '전기값' && f.where === 'H5'), '전기값 바뀜을 못 잡았다');
});

test('시트를 못 찾으면 알려 준다', () => {
  const plan = layoutNote(재고, 'N05 재고자산', { roll: true });
  const r = verifyAll([plan], []);
  assert.equal(r.scanned.sheets, 0);
  assert.match(r.findings[0].says, /찾지 못했습니다/);
});

test('한 푼 미만 오차는 어긋남으로 세지 않는다', () => {
  assert.equal(offBy(1000.0000001, 1000), 0);
  assert.equal(offBy(1001, 1000), 1);
  assert.equal(offBy(999, 1000), -1);
});

test('글자로 적힌 숫자도 숫자로 읽는다', () => {
  assert.equal(numOf({ text: '1,234' }), 1234);
  assert.equal(numOf({ num: 5 }), 5);
  assert.equal(numOf({ text: '합 계' }), undefined);
  assert.equal(numOf(undefined), undefined);
});
