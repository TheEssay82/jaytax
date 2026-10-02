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
