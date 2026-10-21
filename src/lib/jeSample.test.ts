// JET 2차 — 후보 전표 · 회신 읽기 · 신규 계정 시험.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidates, coverage, docsFor, parseReply, pickSummary, plainReason, recommendPicks } from './jeSample';
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

test('권장 선정 — 중요성 이상 + B07 · B14 는 금액 무관, REF 로 끝낸 전표 제외', () => {
  const c = [
    { key: 'a', amount: 5_000_000, scenarios: ['B01'] },
    { key: 'b', amount: 100, scenarios: ['B07'] },
    { key: 'c', amount: 100, scenarios: ['B09'] },
    { key: 'd', amount: 9_000_000, scenarios: ['B09'] },
    { key: 'e', amount: 200, scenarios: ['B14', 'B09'] },
  ];
  assert.deepEqual(recommendPicks(c, 1_000_000, (k) => k === 'd').map((x) => x.key), ['a', 'b', 'e']);
  assert.deepEqual(recommendPicks(c, 0, () => false).map((x) => x.key), ['b', 'e']);
  assert.equal(plainReason(['B09', 'B01', 'B09']), '결산(월말 · 기말) 조정 분개 / 금액이 큰 거래');
});

test('질문 메모 기본 문장 — 작성일 · 담당자', async () => {
  const { defaultMemo } = await import('./jeExport');
  assert.match(defaultMemo({ preparedOn: '2026-02-26', contacts: [{ name: '김재무', dept: '재무팀장', phone: '', email: '' }] }), /^2026-02-26 회사의 재무보고 관여자\(김재무 재무팀장\)에게 .*240 문단 32 \(1\)/);
  assert.match(defaultMemo({ preparedOn: null, contacts: [] }), /^\(작성일\) .*\(재무 담당자\)/);
});

test('확인 현황 — 추출 전표 = REF + 회사 증빙 + 그 밖', () => {
  const r = (code: string, rows: string[][]) => ({ code, status: '예외', rows } as unknown as import('./jeChecks').CheckResult);
  const res = [r('B01', [['2025-12-31', '1'], ['2025-12-31', '2']]), r('B09', [['2025-12-31', '2'], ['2025-12-31', '3'], ['2025-12-31', '4']]), r('B10', [['2025-12-31', '9']])];
  const P = (vno: string, selected: boolean, evidence: string | null) => ({ vdate: '2025-12-31', vno, selected, evidence, result: null });
  const c = coverage(res, () => true, [P('1', false, '4100'), P('3', true, null)]);
  assert.deepEqual({ total: c.total, ref: c.ref, sel: c.sel, left: c.left, by: c.leftBy }, { total: 4, ref: 1, sel: 1, left: 2, by: { B01: 1, B09: 2 } });
});
