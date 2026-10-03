// 정산표 이월 — 시산표 읽기·줄 끼우기 참조(사용자 2026-10-03).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SheetData } from './xlsxRead';
import { tbFromSheet } from './wtbRoll';
import { shiftRowsInRef } from './xlsxCols';

test('더존 합계잔액시산표 — 부분·유동, 차변잔액 − 대변잔액, 머리 줄은 뺀다', () => {
  const cells = new Map<string, { text?: string; num?: number }>([
    ['A7', { text: '차    변' }], ['C7', { text: '계 정 과 목' }], ['D7', { text: '대    변' }],
    ['C9', { text: '<< 자          산 >>' }], ['C10', { text: '[ 유  동    자  산 ]' }],
    ['A12', { num: 3495683 }], ['C12', { text: '보통예금' }],
    ['C26', { text: '[ 비  유 동  자 산 ]' }], ['C34', { text: '감가상각누계액' }], ['E34', { num: 321810611 }],
    ['C49', { text: '<< 부          채 >>' }], ['C62', { text: '장기차입금' }], ['E62', { num: 25000000000 }],
    ['C73', { text: '<< 손          익 >>' }], ['C75', { text: '임대매출(신사동)' }], ['E75', { num: 752000000 }],
    ['C114', { text: '합      계' }], ['A114', { num: 1 }],
  ]);
  const tb = tbFromSheet({ name: '시산표', cells } as unknown as SheetData);
  assert.deepEqual(tb.map((t) => [t.name, t.section, t.current, t.bal]), [
    ['보통예금', '자산', true, 3495683],
    ['감가상각누계액', '자산', false, -321810611],
    ['장기차입금', '부채', true, -25000000000],
    ['임대매출(신사동)', '손익', undefined, -752000000],
  ]);
});

test('줄 끼우기 — 다른 시트의 범위: 뒤는 밀고, 끼운 줄 바로 위에서 끝나는 범위는 늘린다', () => {
  assert.equal(shiftRowsInRef('$B$11:$B$97', 13, 1), '$B$11:$B$98');
  assert.equal(shiftRowsInRef('$B$11:$B$13', 13, 1), '$B$11:$B$14');
  assert.equal(shiftRowsInRef('J85', 13, 1), 'J86');
  assert.equal(shiftRowsInRef('J5', 13, 1), 'J5');
});

test('재무제표 시트 — 들여 쓴 계정 줄만, 안쪽 열 먼저, 차감 계정은 음수, 부채·수익은 시산표 부호로', async () => {
  const { fsFromSheet } = await import('./wtbRoll');
  const bs = new Map<string, { text?: string; num?: number }>([
    ['A8', { text: '과    목' }], ['B8', { text: '제 11 (당)기' }], ['D8', { text: '제 10 (전)기' }],
    ['A10', { text: ' 자             산 ' }], ['A11', { text: ' Ⅰ. 유  동    자  산  ' }], ['C11', { num: 100 }],
    ['A13', { text: '      보통예금' }], ['C13', { num: 3495683 }],
    ['A27', { text: ' Ⅱ. 비  유  동  자  산  ' }],
    ['A33', { text: '      건물' }], ['B33', { num: 2913327108 }],
    ['A34', { text: '      감가상각누계액' }], ['B34', { num: 321810611 }], ['C34', { num: 2591516497 }],
    ['A50', { text: ' 부             채 ' }], ['A63', { text: '      장기차입금' }], ['C63', { num: 25000000000 }],
    ['A67', { text: '부    채    총    계' }], ['C67', { num: 1 }],
  ]);
  const t = fsFromSheet({ name: '재무상태표', cells: bs } as unknown as SheetData, 'BS');
  assert.deepEqual(t.map((x) => [x.name, x.section, x.current, x.bal]), [
    ['보통예금', '자산', true, 3495683], ['건물', '자산', false, 2913327108], ['감가상각누계액', '자산', false, -321810611],
    ['장기차입금', '부채', true, -25000000000],
  ]);
  const pl = new Map<string, { text?: string; num?: number }>([
    ['A7', { text: '과목' }], ['B7', { text: '제 11 (당)기' }],
    ['A9', { text: 'Ⅰ  . 매      출      액' }], ['C9', { num: 1 }], ['A10', { text: '      임대매출(신사동)' }], ['B10', { num: 752000000 }],
    ['A28', { text: 'Ⅳ  . 판  매  관  리  비' }], ['A29', { text: '      직원급여' }], ['B29', { num: 100533336 }],
  ]);
  assert.deepEqual(fsFromSheet({ name: '손익계산서', cells: pl } as unknown as SheetData, 'PL').map((x) => [x.name, x.bal]), [['임대매출(신사동)', -752000000], ['직원급여', 100533336]]);
});
