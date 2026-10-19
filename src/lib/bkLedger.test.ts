// 기장배분 — 원장 모으기(선입선출로 입금 성격 정하기) 시험. 숫자는 2026-10-19 감사팀 원장의 모양을 줄여 만든 것.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateLedger, sumByCpa, type LedgerLine } from './bkLedger';

const L = (acct: string, slip: string, dr: number, cr: number, code = 'A', name = '가회사'): LedgerLine => ({ acct, slip, code, name, dr, cr });

test('감사팀 — 지난해 감사보수 미수금을 먼저 받고, 그 해 세무조정 청구를 나중에 받으면 세무조정은 그 청구액만', () => {
  const lines = [
    L('외상매출금', '25-0710-0001', 0, 13420000),          // 지난해 미수금 입금
    L('외상매출금', '26-0331-0001', 3300000, 0),          // 세무조정 청구(VAT 포함)
    L('세무조정수입(법인)', '26-0331-0001', 0, 3000000),
    L('외상매출금', '26-0415-0001', 0, 3300000),
  ];
  const [c] = aggregateLedger(lines, '감사팀');
  assert.deepEqual([c.cash, c.cash_tax, c.cash_other, c.billed_tax, c.tax_mode], [16720000, 3300000, 13420000, 3000000, '자가']);
});

test('기장팀 — 기장 청구가 있으면 기장수행, 대손 전표의 대변은 입금이 아니다, 자문 비율로 기장에서 뗀다', () => {
  const lines = [
    L('외상매출금', '25-0801-0001', 1100000, 0), L('기장대리수입', '25-0801-0001', 0, 1000000),
    L('외상매출금', '25-0810-0001', 0, 1100000),
    L('외상매출금', '26-0331-0002', 2200000, 0), L('세무조정수입(법인)', '26-0331-0002', 0, 2000000),
    L('외상매출금', '26-0410-0001', 0, 2200000),
    L('외상매출금', '26-0630-1169', 0, 660000), L('대손상각비', '26-0630-1169', 660000, 0),
  ];
  const [c] = aggregateLedger(lines, '기장팀', new Map([['A', 0.5]]));
  assert.deepEqual([c.cash, c.cash_bk, c.cash_adv, c.cash_tax, c.writeoff, c.tax_mode], [3300000, 1100000, 550000, 2200000, 660000, '기장수행']);
  const s = sumByCpa([{ ...c, cpa: '정우철' }]);
  assert.deepEqual([s.byCpa.정우철.bk_fee, s.byCpa.정우철.tax_bk, s.byCpa.정우철.advisory_excl, s.byCpa.정우철.writeoff], [1100000, 2200000, 550000, 600000]);
});

test('감사팀 — 세무조정과 상관없는 거래처(감사·용역만)는 빼고, 담당 없는 거래처는 따로 모은다', () => {
  const lines = [
    L('외상매출금', '25-0901-0001', 11000000, 0, 'B', '감사만'), L('외감법감사수입(일반)', '25-0901-0001', 0, 10000000, 'B', '감사만'),
    L('외상매출금', '26-0331-0003', 1100000, 0, 'C', '세무'), L('세무조정수입(법인)', '26-0331-0003', 0, 1000000, 'C', '세무'),
    L('외상매출금', '26-0401-0003', 0, 1100000, 'C', '세무'),
  ];
  const rows = aggregateLedger(lines, '감사팀');
  assert.deepEqual(rows.map((r) => r.code), ['C']);
  assert.equal(sumByCpa([{ ...rows[0], cpa: null }]).loose.cash, 1100000);
});

test('미수금대장 — invoiceNo 는 원장 적요의 거래#, 감사 계약 청구서의 세무조정 보수는 원장 수입 계정으로 가른다', async () => {
  const { readArFlow, aggregateArFlow, slipKindsByName, applyWriteoffs, writeoffsByName } = await import('./bkLedger');
  const raw = [
    ['부서별 미수금현황'], ['회사명 : 인덕회계법인부서코드/명 : 2본부5팀 [0205] | 기간 : 2025-07-01 ~ 2026-06-30'],
    ['계정명', '거래처', 'invoiceNo', '청구액', '기초이월액', '당기입금액', '당기대손액', '잔금', '계약번호', '청구구분', '계약구분', '회계사', '비고'],
    ['외상매출금', '(주)백련', '26-0331-0716', 5698000, 0, 5698000, 0, 0, '', '잔금', '감사 및 검토', '정우철', ''],
    ['외상매출금', '(주)백련', '26-0331-0719', 4400000, 0, 4400000, 0, 0, '', '잔금', '용역', '조현규', ''],
  ];
  const flow = readArFlow(raw)!;
  assert.deepEqual([flow.dept, flow.from, flow.to, flow.items.length], ['감사팀', '2025-07-01', '2026-06-30', 2]);
  const lines = [
    { acct: '외상매출금', slip: '26-0331-1071', code: '02183', name: '(주)백련', dr: 5698000, cr: 0, sum: '2025 회계감사 잔금 (거래#:26-0331-0716)' },
    { acct: '외감법감사수입(일반)', slip: '26-0331-1071', code: '02183', name: '(주)백련', dr: 0, cr: 5000000 },
    { acct: '외상매출금', slip: '26-0331-1074', code: '02183', name: '(주)백련', dr: 4400000, cr: 0, sum: '2025 세무조정보수 총액 (거래#:26-0331-0719)' },
    { acct: '세무조정수입(법인)', slip: '26-0331-1074', code: '02183', name: '(주)백련', dr: 0, cr: 4000000 },
  ];
  const [c] = applyWriteoffs(aggregateArFlow(flow, '감사팀', () => '02183', new Map(), slipKindsByName(lines)), flow, writeoffsByName(lines));
  assert.deepEqual([c.cash_tax, c.cash_other, c.billed_tax, c.erp_cpa], [4400000, 5698000, 4000000, '조현규']);
});
