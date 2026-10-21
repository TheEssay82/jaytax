// JET — 검사 규칙 시험. 숫자는 실물(세원 · 나래 FY2025)의 모양을 줄여 만든 것.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOpening, reconOpening, groupDiffs, scenMateriality, scenGaps, scenSalesPartner, vouchers, checkBalance, defaultParams, guessSide, balancesFromTb } from './jeChecks';
import { detectJournal, parseBalanceRows, toDate, type JeLine } from './jeParse';

let seq = 0;
const L = (date: string, no: string, acctCode: string, acctName: string, dr: number, cr: number, memo = ''): JeLine =>
  ({ seq: ++seq, date, no, acctCode, acctName, dr, cr, cpCode: null, cpName: null, memo, side: dr ? '차변' : '대변', vtype: '일반' });

test('기초잔액 대사 — 차변 계정 G = F − D + E, 대변 계정 G = F + D − E, 차이 0', () => {
  const lines = [L('2025-03-02', '1', '103', '보통예금', 500, 0), L('2025-03-02', '1', '251', '외상매입금', 0, 500), L('2025-04-01', '1', '251', '외상매입금', 200, 0), L('2025-04-01', '1', '103', '보통예금', 0, 200)];
  const r = checkOpening(lines, [
    { acctCode: '103', acctName: '보통예금', open: 1000, close: 1300 },
    { acctCode: '251', acctName: '외상매입금', open: 700, close: 1000 },
  ]);
  assert.equal(r.status, '통과');
  assert.deepEqual(r.rows.map((x) => [x[6], x[8], x[9]]), [[1000, 0, '차'], [700, 0, '대']]);
});

test('기초잔액 대사 — 원장 계정 하나가 공시과목 여럿(감가상각누계액 → 건물 · 기계장치)이면 묶음으로 상쇄', () => {
  const lines = [L('2025-12-31', '1', '818', '감가상각비', 300, 0), L('2025-12-31', '1', '203', '감가상각누계액', 0, 300)];
  // 회사 재무제표는 누계액을 자산군별로 음수로 적는다. 분개 합계는 첫 줄에만.
  const bal = [
    { acctCode: '203', acctName: '감가상각누계액(건물)', open: -1000, close: -1200, group: '누계액', side: 1 as const },
    { acctCode: '203', acctName: '감가상각누계액(기계장치)', open: -500, close: -600, group: '누계액', side: 1 as const },
  ];
  const rows = reconOpening(lines, bal);
  assert.deepEqual(rows.map((r) => r.diff), [100, -100]);
  assert.equal(groupDiffs(rows).get('누계액'), 0);
  assert.equal(checkOpening(lines, bal).status, '통과');
});

test('기초잔액 대사 — 방향을 안 적은 줄은 기말 − 기초와 분개 증감으로 방향을 찾고, 남는 차이는 예외', () => {
  const lines = [L('2025-05-01', '1', '260', '단기차입금', 0, 400), L('2025-05-01', '1', '103', '보통예금', 400, 0)];
  const ok = checkOpening(lines, [{ acctCode: '260', acctName: '단기차입금', open: 100, close: 500 }, { acctCode: '103', acctName: '보통예금', open: 0, close: 400 }]);
  assert.equal(ok.status, '통과');
  const bad = checkOpening(lines, [{ acctCode: '260', acctName: '단기차입금', open: 100, close: 450 }, { acctCode: '103', acctName: '보통예금', open: 0, close: 400 }]);
  assert.equal(bad.status, '예외');
});

test('잔액 방향 짐작 — 더존 3자리 · 영림원 5자리 · 충당금은 차변(음수로 들어옴)', () => {
  assert.deepEqual([guessSide('103'), guessSide('251'), guessSide('20100', '토지'), guessSide('30100', '단기차입금'), guessSide('10900', '대손충당금'), guessSide('29500', '퇴직급여충당부채')], [1, -1, 1, -1, 1, 1]);
  // 영림원 원장은 잔액이 정상 방향 + — 기말 = 기초 + 차 − 대 면 차변 계정.
  const b = balancesFromTb([{ acctCode: '10900', acctName: '대손충당금', open: 30, dr: 0, cr: 721, close: 751 }, { acctCode: '10300', acctName: '보통예금', open: 100, dr: 50, cr: 20, close: 130 }]);
  assert.deepEqual(b.map((x) => x.side), [-1, 1]);
});

test('중요성 — 손익 계정 줄 중 |금액| ≥ 매출 × 1%, 재무상태표 계정 · 제외 계정은 빼고 줄 단위로', () => {
  const lines = [
    L('2025-01-31', '1', '501', '원재료비', 3_000_000, 0), L('2025-01-31', '1', '153', '원재료', 0, 3_000_000),
    L('2025-02-01', '2', '401', '제품매출', 0, 9_000_000), L('2025-02-01', '2', '108', '외상매출금', 9_000_000, 0),
    L('2025-02-02', '3', '511', '복리후생비', 900_000, 0), L('2025-02-02', '3', '103', '보통예금', 0, 900_000),
  ];
  const r = scenMateriality(lines, { name: '매출', amount: 100_000_000, rate: 0.01, reason: '' }, ['401']);
  assert.equal(r.stats?.threshold, 1_000_000);
  assert.deepEqual(r.rows.map((x) => x[4]), ['원재료비']);
  assert.ok(r.method.some((m) => m.includes('제품매출')));
});

test('결번 — 날마다 1부터, 더존 매입매출(5xxxx)은 따로', () => {
  const vs = vouchers([L('2025-01-02', '1', '103', 'a', 1, 0), L('2025-01-02', '3', '103', 'a', 1, 0), L('2025-01-02', '50001', '103', 'a', 1, 0), L('2025-01-02', '50002', '103', 'a', 1, 0)]);
  const r = scenGaps(vs);
  assert.equal(r.stats?.missing, 1);
  assert.equal(r.rows[0][4], '2');
});

test('매출 상대계정 — 현금성 · 채권 · 부가세예수금이 없는 매출 전표만', () => {
  const vs = vouchers([
    L('2025-03-01', '1', '404', '제품매출', 0, 100), L('2025-03-01', '1', '108', '외상매출금', 110, 0), L('2025-03-01', '1', '255', '부가세예수금', 0, 10),
    L('2025-03-02', '1', '404', '제품매출', 0, 500), L('2025-03-02', '1', '206', '기계장치', 500, 0),
  ]);
  const r = scenSalesPartner(vs, defaultParams());
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0][0], '2025-03-02');
});

test('차대 — 전표별 합계 차이', () => {
  const r = checkBalance(vouchers([L('2025-01-01', '1', '103', 'a', 100, 0), L('2025-01-01', '1', '251', 'b', 0, 90)]));
  assert.equal(r.status, '예외');
  assert.equal(r.stats?.bad, 1);
});

test('읽기 — 더존 · 영림원 머리 알아보기, 날짜, 잔액표', () => {
  assert.deepEqual(detectJournal([['전표일자', '월', '전표번호', '구분', 'Code', '계정과목', '차변(대변)', '차변', '대변', '거래처', 'Code', '적요']]), { erp: '더존', head: 0 });
  assert.deepEqual(detectJournal([['구 분[기표]', '', '차 변', '', '대 변', '', '적요'], ['년/월/일', '번호', '금액', '계정과목', '계정과목', '금액', '']]), { erp: '영림원', head: 0 });
  assert.deepEqual([toDate('2025/01/02'), toDate('2025-1-2'), toDate('합계'), toDate(45658)], ['2025-01-02', '2025-01-02', null, '2025-01-01']);
  const b = parseBalanceRows([['묶음', '계정코드', '계정명', '차대', '전기말(기초)', '당기말(기말)'], ['누계액', '203', '감가상각누계액(건물)', '차', '-1,000', '-1,200'], ['', '', '자산총계', '', 1, 1]]);
  assert.deepEqual(b, [{ acctCode: '203', acctName: '감가상각누계액(건물)', open: -1000, close: -1200, group: '누계액', side: 1 }]);
});

test('중요성 — 차변만 고르면 대체 분개의 맞은편(대변) 줄은 빠진다', () => {
  const lines = [L('2025-01-31', '9', '501', '원재료비', 3_000_000, 0), L('2025-01-31', '9', '501', '원재료비', 0, 3_000_000), L('2025-01-31', '9', '454', '제조', 3_000_000, 0)];
  const b = { name: '매출', amount: 100_000_000, rate: 0.01, reason: '' };
  assert.equal(scenMateriality(lines, b).rows.length, 3);
  assert.equal(scenMateriality(lines, b, [], '차변만').rows.length, 2);
});
