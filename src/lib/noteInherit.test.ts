import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oldNotes, inheritFormulas, sheetsInFormula } from './noteInherit.ts';
import type { SheetPlan } from './noteSheet.ts';
import type { SheetData, CellValue } from './xlsxRead.ts';

function sheet(name: string, cells: Record<string, CellValue>): SheetData {
  return { name, cells: new Map(Object.entries(cells)) };
}

/** 올해 배치 — 재고자산 표 하나. 당기(D)는 노란 칸, 전기(E)는 값. 「기타」가 둘이다. */
const PLAN: SheetPlan = {
  name: 'N05 재고자산', note: '재고자산', lastRow: 12,
  cells: [
    { row: 2, col: 2, text: '주석명', kind: 'label' },
    { row: 2, col: 3, text: '5. 재고자산', kind: 'title' },
    { row: 5, col: 3, text: '구분', kind: 'head' }, { row: 5, col: 4, text: '당기', kind: 'head' },
    { row: 6, col: 3, text: '상품', kind: 'text' }, { row: 6, col: 4, text: '', kind: 'input' },
    { row: 7, col: 3, text: '기타', kind: 'text' }, { row: 7, col: 4, text: '', kind: 'input' },
    { row: 8, col: 3, text: '기타', kind: 'text' }, { row: 8, col: 4, text: '', kind: 'input' },
    { row: 9, col: 3, text: '신규품목', kind: 'text' }, { row: 9, col: 4, text: '', kind: 'input' },
    { row: 10, col: 3, text: '', kind: 'input' }, { row: 10, col: 4, text: '', kind: 'input' },   // 여분 행
  ],
};

/** 작년 등록본 — 행이 한 줄 위에 있었고(자리로 맞추면 틀린다), 첫 「기타」만 수식이다. */
const OLD_SHEETS = sheet('N04 재고자산', {
  B2: { text: '주석명' }, C2: { text: '4. 재고자산' },
  C4: { text: '구분' }, D4: { text: '당기' },
  C5: { text: '상품' }, D5: { formula: "'BS'!D12", num: 100 },
  C6: { text: '기타' }, D6: { formula: 'TB!F30+TB!F31', num: 5 },
  C7: { text: '기 타' }, D7: { num: 7 },
});

test('옛 엑셀에서 주석의 자리를 가른다 — 시트별이든 종단형이든 「주석명」 라벨로', () => {
  const one = oldNotes([OLD_SHEETS]);
  assert.equal(one.length, 1);
  assert.deepEqual([one[0].title, one[0].from, one[0].to], ['재고자산', 2, 7]);

  const long = sheet('주석(생성)', {
    B2: { text: '주석명' }, C2: { text: '1. 회사의 개요' }, C3: { text: '당사는' },
    B9: { text: '주석명' }, C9: { text: '2. 재고자산' }, C11: { text: '상품' }, D11: { formula: 'X!A1' },
  });
  const two = oldNotes([long]);
  assert.deepEqual(two.map((s) => [s.title, s.from, s.to]), [['회사의개요', 2, 8], ['재고자산', 9, 11]]);
});

test('수식을 이어받는다 — 제목·행 라벨·열로 짝짓고, 값은 안 가져오며, 같은 라벨은 몇 번째인지로', () => {
  const r = inheritFormulas([PLAN], [OLD_SHEETS], new Set(['BS', 'N05 재고자산']));
  const at = (row: number) => r.plans[0].cells.find((c) => c.row === row && c.col === 4)!;
  assert.equal(at(6).formula, "'BS'!D12", '행이 밀려도 라벨로 찾는다');
  assert.equal(at(6).kind, 'input', '여전히 노란 칸이다');
  assert.equal(at(7).formula, 'TB!F30+TB!F31', '첫 「기타」');
  assert.equal(at(8).formula, undefined, '둘째 「기타」는 작년에 값이라 안 가져온다');
  assert.equal(at(9).formula, undefined, '작년에 없던 줄');
  assert.equal(at(10).formula, undefined, '여분 행은 라벨이 없다');
  assert.equal(r.got, 2);
  assert.equal(r.want, 6);
  assert.equal(r.notes, 1);
  assert.deepEqual(r.unknownSheets, ['TB'], '올해 정산표에 없는 시트를 알려 준다');
});

test('제목이 안 맞으면 손대지 않는다', () => {
  const other = { ...PLAN, note: '유형자산' };
  const r = inheritFormulas([other], [OLD_SHEETS]);
  assert.equal(r.got, 0);
  assert.equal(r.notes, 0);
  assert.equal(r.plans[0], other, '배치 그대로');
});

test('수식이 가리키는 시트 이름', () => {
  assert.deepEqual(sheetsInFormula("'N05 재고자산'!H9+'It''s'!A1+TB!B2*2"), ['N05 재고자산', "It's", 'TB']);
  assert.deepEqual(sheetsInFormula('SUM(D9:D12)'), []);
});
