import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asNumber, sheetName, addrOf, parseAddr, layoutNote, layoutIndex } from './noteSheet.ts';
import type { NoteBlocks } from './dsdBlocks.ts';

test('표 안의 값 — 숫자는 숫자로, 퍼센트·글자는 그대로', () => {
  assert.equal(asNumber('32,000'), 32000);
  assert.equal(asNumber('15,419,575,880'), 15419575880);
  assert.equal(asNumber('(57,670)'), -57670);
  assert.equal(asNumber('0.5'), 0.5);
  assert.equal(asNumber('50%'), undefined);
  assert.equal(asNumber('-'), undefined);
  assert.equal(asNumber('이 종 명'), undefined);
  assert.equal(asNumber(''), undefined);
});

test('시트 이름 — 금지 글자와 31자 제한, 겹치면 번호', () => {
  const used = new Set<string>();
  assert.equal(sheetName('재고자산', used), '재고자산');
  assert.equal(sheetName('재고자산', used), '재고자산(2)');
  assert.equal(sheetName('현금흐름/표', used), '현금흐름 표');
  const long = sheetName('금융부채의 유동성 위험관리 방법 및 종류별 만기 분석 그리고 더', used);
  assert.ok(long.length <= 31, long);
  assert.equal(sheetName('', used), '주석');
});

test('자리표 — 넣었다 빼도 같다', () => {
  assert.equal(addrOf(176), '176');
  assert.equal(addrOf(176, 2), '176#2');
  assert.deepEqual(parseAddr('176'), { slot: 176, part: null });
  assert.deepEqual(parseAddr('176#2'), { slot: 176, part: 2 });
  assert.equal(parseAddr('가나다'), null);
  assert.equal(parseAddr(null), null);
});

const NOTE: NoteBlocks = {
  no: 1,
  title: '회사의 개요',
  blocks: [
    { kind: 'para', slot: 176, parts: ['첫째 문단.', '둘째 문단.'] },
    {
      kind: 'table',
      rows: [
        [{ slot: 177, text: '구    분' }, { slot: 178, text: '주식수(주)' }],
        [{ slot: 179, text: '이 종 명' }, { slot: 180, text: '32,000' }],
      ],
    },
    { kind: 'para', slot: 190, parts: ['표 뒤 문단.'] },
  ],
};

test('배치 — 정산표가 쓰던 모양 그대로', () => {
  const p = layoutNote(NOTE, '회사의 개요');
  const at = (row: number, col: number) => p.cells.find((c) => c.row === row && c.col === col);

  assert.equal(at(2, 2)?.text, '주석명');
  assert.equal(at(2, 3)?.text, '1. 회사의 개요');

  // 문단은 C열에 붙여서
  assert.equal(at(3, 3)?.text, '첫째 문단.');
  assert.equal(at(4, 3)?.text, '둘째 문단.');

  // 표 앞에 빈 줄 → 5행은 비고 6행부터 표
  assert.equal(at(5, 3), undefined);
  assert.equal(at(6, 3)?.text, '구    분');
  assert.equal(at(6, 4)?.text, '주식수(주)');
  assert.equal(at(7, 4)?.num, 32000, '표 안의 숫자는 숫자로 들어간다');

  // 표 뒤에도 한 줄 띄운다
  assert.equal(at(8, 3), undefined);
  assert.equal(at(9, 3)?.text, '표 뒤 문단.');
  assert.equal(p.lastRow, 9);
});

test('자리표가 A열에 숨어 따라간다', () => {
  const p = layoutNote(NOTE, 'x');
  const a = (row: number) => p.cells.find((c) => c.row === row && c.col === 1)?.text;
  assert.equal(a(3), '176#0', '한 P 안의 여러 문단은 몇 번째인지까지 적는다');
  assert.equal(a(4), '176#1');
  assert.equal(a(6), '177 178', '표는 한 줄의 칸들을 나란히');
  assert.equal(a(9), '190', '문단이 하나뿐이면 번호를 안 붙인다');
});

test('주석 목록 시트 — 정산표의 「주석번호·주석제목·사용여부」', () => {
  const p = layoutIndex([
    { no: 1, title: '회사의 개요', enabled: true, sheet: '회사의 개요' },
    { no: null, title: '쓰지 않음', enabled: false, sheet: '쓰지 않음' },
  ]);
  const at = (row: number, col: number) => p.cells.find((c) => c.row === row && c.col === col);
  assert.equal(at(2, 2)?.text, '주석번호');
  assert.equal(at(3, 4)?.text, 'O');
  assert.equal(at(4, 4)?.text, 'X');
  assert.equal(at(4, 2), undefined, '꺼진 주석은 번호가 없다');
  assert.equal(p.lastRow, 4);
});
