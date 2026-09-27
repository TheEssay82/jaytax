// 자료함 — 파일의 해 알아내기(잘못 올린 것 막기)·정산표 수정전/수정후 열의 중요성 기준 금액.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SheetData, CellValue } from './xlsxRead';
import { wtbPeriodEnd, amountsFromWtb, expectedFy, fitsEngagement, dateCol } from './gwpFiles';

const sheet = (name: string, cells: Record<string, CellValue>): SheetData => ({ name, cells: new Map(Object.entries(cells)) });
const t = (text: string): CellValue => ({ text });
const n = (num: number): CellValue => ({ num });
const D24 = 45657, D25 = 46022;

const WBS = sheet('WBS', {
  T2: n(D24), U2: n(D25), X2: { formula: '46022', num: D25 }, C4: n(78000),     // C4 = 날짜처럼 보이는 금액(2113년) — 머리로 치지 않는다
  B36: t('자산총계'), U36: n(24_462_942_861), X36: n(24_462_905_041),
  B60: t('자본총계'), U60: n(3_171_436_618), X60: n(3_171_398_798),
});
const WPL = sheet('WPL', {
  S2: n(D24), T2: { formula: '46022', num: D25 }, W2: { formula: '46022', num: D25 },
  B3: t('Ⅰ.영업수익'), T3: n(917_513_441), W3: n(917_513_441),
  B52: t('Ⅷ.법인세차감전이익'), T52: n(-247_765_692), W52: n(-300_000_000),
});

test('정산표의 해 — 날짜가 늘어선 머리 줄의 가장 늦은 날(근처 금액을 날짜로 읽지 않는다)', () => {
  assert.equal(wtbPeriodEnd([WBS, WPL]), '2025-12-31');
});

test('파일이 작업 건에 맞는가 — 전기 DSD 는 한 해 앞, 정산표는 같은 해', () => {
  assert.equal(expectedFy('전기DSD', 2026), 2025);
  assert.equal(fitsEngagement('정산표', { fy: 2025 }, 2026), false);
  assert.equal(fitsEngagement('수정전정산표', { fy: 2026 }, 2026), true);
  assert.equal(fitsEngagement('전기DSD', { fy: 2025 }, 2026), true);
  assert.equal(fitsEngagement('정산표', {}, 2026), null);
});

test('정산표 기준 금액 — 수정전은 결산일 가장 왼쪽 열, 수정후는 가장 오른쪽 열(백만원)', () => {
  assert.equal(dateCol(WBS, D25, 'left'), 'U');
  assert.equal(dateCol(WBS, D25, 'right'), 'X');
  const pre = amountsFromWtb([WBS, WPL], '2025-12-31', 'left');
  assert.deepEqual(pre.amounts, { 총자산: 24463, 순자산: 3171, 매출액: 918, 세전계속사업이익: -248 });
  assert.deepEqual(pre.cols, { WBS: 'U', WPL: 'T' });
  const post = amountsFromWtb([WBS, WPL], '2025-12-31', 'right');
  assert.equal(post.amounts.세전계속사업이익, -300);
});
