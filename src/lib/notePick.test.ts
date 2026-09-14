import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planNotes, sheetsToInject, isNoteSheet, isAnyNoteSheet, LONG_SHEET, LONG_GAP } from './notePick.ts';
import type { NoteBlocks } from './dsdBlocks.ts';

function line(tag: 'TH' | 'TD', slot0: number, ...texts: string[]) {
  return texts.map((text, i) => ({ slot: slot0 + i, text, tag, col: i, colspan: 1, rowspan: 1 }));
}

const A: NoteBlocks = {
  no: 1, title: '회사의 개요',
  blocks: [{ kind: 'para', slot: 10, from: 0, parts: ['당사는 …'] }],
};
const B: NoteBlocks = {
  no: 2, title: '재고자산', blocks: [{
    kind: 'table', unit: '원',
    rows: [line('TH', 20, '구분', '당기', '전기'), line('TD', 23, '상품', '100', '90'), line('TD', 26, '합계', '100', '90')],
  }],
};
const picked = [{ note: A, title: '회사의 개요' }, { note: B, title: '재고자산' }];

test('주석별 시트 — 이름은 N01·N02, 행은 각자 2행부터', () => {
  const p = planNotes(picked, true, 0);
  assert.deepEqual(p.map((x) => x.name), ['N01 회사의 개요', 'N02 재고자산']);
  assert.ok(p.every((x) => x.cells.find((c) => c.kind === 'title')?.row === 2));
  assert.equal(sheetsToInject(p).length, 2, '그대로 두 장');
});

test('종단형 — 시트는 하나, 주석은 겹치지 않고 아래로 이어진다', () => {
  const p = planNotes(picked, true, 0, 'long');
  assert.ok(p.every((x) => x.name === LONG_SHEET));
  assert.deepEqual(p.map((x) => x.note), ['회사의 개요', '재고자산'], '배치 하나가 주석 하나다');
  const t1 = p[0].cells.find((c) => c.kind === 'title')!.row;
  const t2 = p[1].cells.find((c) => c.kind === 'title')!.row;
  assert.equal(t1, 2);
  assert.equal(t2, p[0].lastRow + LONG_GAP + 2, '앞 주석 끝 + 빈 줄 뒤에 시작한다');
  const minRow2 = Math.min(...p[1].cells.map((c) => c.row));
  assert.ok(minRow2 > p[0].lastRow, '앞 주석의 행을 침범하지 않는다');
  // 표 구조도 밀렸다
  const tbl = p[1].tables![0];
  assert.ok(tbl.headRows[0] > p[0].lastRow);
  assert.equal(tbl.totalRow, tbl.bodyRows[tbl.bodyRows.length - 1]);
  // 시트 XML 로는 한 장
  const merged = sheetsToInject(p);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].cells.length, p[0].cells.length + p[1].cells.length);
  assert.equal(merged[0].lastRow, p[1].lastRow);
  assert.equal(merged[0].tables!.length, 1);
});

test('종단형과 주석별은 같은 주석에 같은 상대 배치를 낸다 — 규칙이 두 벌이 아니다', () => {
  const a = planNotes(picked, true, 2)[1];
  const b = planNotes(picked, true, 2, 'long')[1];
  const off = b.cells.find((c) => c.kind === 'title')!.row - 2;
  assert.ok(off > 0);
  assert.deepEqual(
    b.cells.map((c) => [c.row - off, c.col, c.text, c.kind]),
    a.cells.map((c) => [c.row, c.col, c.text, c.kind]),
  );
  assert.deepEqual(b.tables![0].itemRows.map((r) => r - off), a.tables![0].itemRows);
  assert.equal(b.spares!.length, a.spares!.length);
});

test('어느 시트가 주석인가 — 구성마다 다르다', () => {
  assert.ok(isNoteSheet('N01 회사의 개요', 'sheets'));
  assert.ok(!isNoteSheet('N01 회사의 개요', 'long'));
  assert.ok(isNoteSheet(LONG_SHEET, 'long'));
  assert.ok(!isNoteSheet('주석목록(생성)', 'sheets'));
  assert.ok(!isNoteSheet('대사표', 'long'));
  assert.ok(isAnyNoteSheet('N07 차입금') && isAnyNoteSheet(LONG_SHEET) && !isAnyNoteSheet('TB'));
});
