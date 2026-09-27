// 단계 마감 — 계획조서(1000·2000번대) 조서목록 작성일·탭 색, 2120A 자산=부채+자본.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeStage, planDate, stagePapers } from './gwpStageClose';
import { balance, type Row2120 } from './gwpPaper2120A';
import { emptyWorkbook } from './gwpAssemble';
import { injectSheets } from './xlsxInject';
import { readWorkbook } from './xlsxRead';
import { buildCatalog } from './gwpCatalog';
import { tabStateOf } from './xlsxMark';
import type { SheetCell } from './noteSheet';

const c = (row: number, col: number, text: string): SheetCell => ({ row, col, text });
function book(): Uint8Array {
  return injectSheets(emptyWorkbook(), [
    { name: '조서목록', cells: [c(9, 2, '조서'), c(9, 4, '작성자'), c(9, 5, '작성일'),
      c(13, 2, '2100 회사의 이해'), c(14, 2, '2700 중요성'), c(14, 4, '김준성'), c(20, 2, '3100 위험대응')], lastRow: 20 },
    { name: '2100(소규모)', cells: [c(2, 1, '2100 기업과 기업 환경에 대한 이해')], lastRow: 2 },
    { name: '2700A-3(소규모)', cells: [c(2, 1, '2700A-3')], lastRow: 2 },
    { name: '3100', cells: [c(2, 1, '3100')], lastRow: 2 },
  ]);
}

test('2110 감사계획일 → 확정 작성일', () => {
  assert.equal(planDate('2026.4.14'), '2026-04-14');
  assert.equal(planDate('2026년 4월 14일'), '2026-04-14');
  assert.equal(planDate('2026.12월 중'), null);
});

test('1차 마감 — 1000·2000번대만, 다른 단계 웹 조서(2700A-3)는 빼고, 비어 있는 작성자·작성일만 채우고, 빨간 탭은 노랑', () => {
  const b = book();
  const cat = buildCatalog(readWorkbook(b));
  assert.deepEqual(stagePapers(cat, 1, ['2700A-3']).map((s) => s.code), ['2100']);
  const r = closeStage(b, 1, { date: '2026-04-14', author: '정우철', exclude: ['2700A-3'] });
  assert.deepEqual(r.dated, ['2100']);
  assert.deepEqual(r.tabbed, ['2100(소규모)']);
  const out = readWorkbook(r.bytes);
  const ix = out.find((s) => s.name === '조서목록')!;
  assert.equal(ix.cells.get('D13')?.text, '정우철');
  assert.equal(ix.cells.get('E13')?.num, 46126);
  assert.equal(ix.cells.get('D14')?.text, '김준성');               // 이미 적힌 것은 둔다
  assert.equal(ix.cells.get('E20'), undefined);                     // 3000번대는 1차가 아니다
  assert.equal(tabStateOf(out.find((s) => s.name === '2100(소규모)')!.tabColor), 'yellow');
  assert.equal(out.find((s) => s.name === '3100')!.tabColor, undefined);
});

test('2120A — 자산 = 부채 + 자본(차감 계정은 음수), 구분이 없으면 검증하지 않는다', () => {
  const r = (sec: Row2120['sec'], cur: number): Row2120 => ({ key: String(Math.random()), label: '', fsli: '', pl: false, prev: null, cur, note: '', sec });
  assert.deepEqual(balance([r('자산', 100), r('자산', -10), r('부채', 60), r('자본', 30)], 'cur'), { asset: 90, liab: 60, equity: 30, diff: 0 });
  assert.equal(balance([r('자산', 100), r('부채', 60)], 'cur')!.diff, 40);
  assert.equal(balance([{ ...r(undefined, 1), sec: undefined }], 'cur'), null);
});
