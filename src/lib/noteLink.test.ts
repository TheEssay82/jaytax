import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLinks, layoutTieSheet, sheetRef } from './noteLink.ts';
import type { SheetPlan } from './noteSheet.ts';

/** 표 하나짜리 배치를 손으로 짓는다 — bodyRows 안의 숫자 칸만 짝이 된다. */
function plan(name: string, nums: [number, number, number][]): SheetPlan {
  return {
    name,
    cells: nums.map(([row, col, num]) => ({ row, col, text: '', num, kind: 'num' as const })),
    lastRow: 20,
    tables: [{
      headRows: [4], bodyRows: nums.map(([r]) => r), totalRow: null, itemRows: [],
      numCols: [4], srcBase: null, diffCol: null, factor: null, carried: new Map(),
    }],
  };
}

test('서로 다른 주석에 같은 숫자가 있으면 짝으로 본다', () => {
  const links = findLinks([
    plan('N07 차입금', [[5, 4, 19867692975], [6, 4, 13810000000]]),
    plan('N14 금융부채', [[5, 4, 19867692975]]),
  ]);
  assert.equal(links.length, 1);
  assert.equal(links[0].value, 19867692975);
  assert.deepEqual(links[0].spots.map((s) => `${s.group}!${s.at}`), ['N07 차입금!D5', 'N14 금융부채!D5']);
});

test('한 주석 안에서만 되풀이되는 숫자는 짝이 아니다 — 표 안의 이월이다', () => {
  const links = findLinks([
    plan('N13 자본', [[5, 4, 6082825000], [6, 4, 6082825000], [7, 4, 6082825000]]),
  ]);
  assert.deepEqual(links, []);
});

test('한 주석에서는 한 자리만 쓴다', () => {
  const links = findLinks([
    plan('N13 자본', [[5, 4, 6082825000], [6, 4, 6082825000]]),
    plan('N18 특수관계자', [[5, 4, 6082825000]]),
  ]);
  assert.equal(links.length, 1);
  assert.equal(links[0].spots.filter((s) => s.at).length, 2, '같은 시트에서 두 자리를 걸면 안 된다');
});

test('작은 값은 우연히 같을 수 있어 짝으로 보지 않는다', () => {
  const links = findLinks([
    plan('N01 개요', [[5, 4, 5000]]),
    plan('N02 방침', [[5, 4, 5000]]),
  ]);
  assert.deepEqual(links, []);
});

test('재무제표는 이름표로만 곁든다 — 엑셀 자리가 둘이어야 잴 수 있다', () => {
  const fs = [{ statement: '재무상태표', label: '단기차입금', notes: [7], cur: 19867692975, level: 2, at: 0 }];
  const only = findLinks([plan('N07 차입금', [[5, 4, 19867692975]])], fs);
  assert.deepEqual(only, [], '주석 자리가 하나뿐이면 엑셀에서 잴 수 없다');

  const both = findLinks([
    plan('N07 차입금', [[5, 4, 19867692975]]),
    plan('N14 금융부채', [[5, 4, 19867692975]]),
  ], fs);
  assert.equal(both.length, 1);
  assert.ok(both[0].spots.some((s) => !s.at && s.group === '재무상태표'), '재무제표가 이름표로 붙어야 한다');
});

test('대사표 — 자리를 수식으로 걸고 차이를 잰다', () => {
  const links = findLinks([
    plan('N07 차입금', [[5, 4, 19867692975]]),
    plan('N14 금융부채', [[9, 4, 19867692975]]),
  ]);
  const sheet = layoutTieSheet(links);
  assert.equal(sheet.name, '대사표');
  const at = (row: number, col: number) => sheet.cells.find((c) => c.row === row && c.col === col);
  assert.equal(at(6, 2)?.text, 'N07 차입금 ↔ N14 금융부채');
  assert.equal(at(6, 3)?.num, 19867692975);
  assert.equal(at(6, 4)?.formula, "'N07 차입금'!D5");
  assert.equal(at(6, 5)?.formula, "'N14 금융부채'!D9");
  assert.match(at(6, 8)!.formula!, /MAX\(D6:G6\)-MIN\(D6:G6\)/);
});

test('시트 이름에 공백이 있으면 홑따옴표로 감싼다', () => {
  assert.equal(sheetRef('N07차입금'), 'N07차입금');
  assert.equal(sheetRef('N07 차입금'), "'N07 차입금'");
  assert.equal(sheetRef("이름'따옴표"), "'이름''따옴표'");
});
