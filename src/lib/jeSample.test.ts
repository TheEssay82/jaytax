// JET 2차 — 후보 전표 · 회신 읽기 · 신규 계정 시험.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidates, docsFor, parseReply, pickSummary } from './jeSample';
import { runAll, defaultParams, scenNewAccounts, vouchers } from './jeChecks';
import type { JeLine } from './jeParse';

let seq = 0;
const L = (date: string, no: string, acctCode: string, acctName: string, dr: number, cr: number, memo = ''): JeLine =>
  ({ seq: ++seq, date, no, acctCode, acctName, dr, cr, cpCode: null, cpName: '거래처A', memo, side: dr ? '차변' : '대변', vtype: '일반' });

const lines = [
  L('2025-12-31', '7', '501', '원재료비', 5_000_000, 0, '원가 대체'), L('2025-12-31', '7', '153', '원재료', 0, 5_000_000),
  L('2025-06-07', '1', '511', '복리후생비', 300, 0, '식대'), L('2025-06-07', '1', '103', '보통예금', 0, 300),
];

test('후보 — 여러 시나리오에 걸린 전표는 한 줄(B01 중요성 + B09 결산분개), 요청 증빙은 합친다', () => {
  const res = runAll({ lines, balances: null, coa: null, from: '2025-01-01', to: '2025-12-31', bench: { name: '매출', amount: 100_000_000, rate: 0.01, reason: '' }, params: defaultParams() });
  const on = new Set(['B01', 'B08', 'B09']);
  const c = buildCandidates(res, lines, (r) => on.has(r.code));
  const k = c.find((x) => x.no === '7')!;
  assert.deepEqual(k.scenarios.sort(), ['B01', 'B09']);
  assert.equal(k.amount, 5_000_000);
  assert.equal(c.find((x) => x.no === '1')?.scenarios.join(), 'B08'); // 2025-06-07 토요일
  assert.ok(docsFor(k.scenarios).includes('결산조정'));
});

test('회신 읽기 — 우리 증빙요청 엑셀 머리, 빈 줄은 건너뛴다', () => {
  const r = parseReply([
    ['x'], [],
    ['요청No', '전표일자', '전표번호', '주요 계정', '전표금액', '적요', '거래처', '요청 증빙', '회사 설명', '증빙 파일명'],
    [1, '2025-12-31', '7', '원재료비', 5000000, '', '', '', '월말 원가대체', '1_2025-12-31_7.pdf'],
    [2, '2025-06-07', '1', '', 300, '', '', '', '', ''],
  ]);
  assert.deepEqual(r, [{ date: '2025-12-31', no: '7', answer: '월말 원가대체', docs: '1_2025-12-31_7.pdf' }]);
  assert.throws(() => parseReply([['아무', '표']]));
});

test('신규 계정 — 전기 계정에 없는 계정을 쓴 전표', () => {
  const r = scenNewAccounts(lines, vouchers(lines), new Map([['501', '원재료비'], ['153', '원재료'], ['103', '보통예금']]));
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0][5], '복리후생비');
  assert.equal(scenNewAccounts(lines, vouchers(lines), null).status, '자료없음');
});

test('결과 집계', () => {
  assert.deepEqual(pickSummary([{ selected: true, result: '이상없음' }, { selected: true, result: '예외' }, { selected: true, result: null }, { selected: false, result: '예외' }]), { total: 3, ok: 1, exc: 1, pending: 1 });
});
