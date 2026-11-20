// 매출계약 종료일 — 「연-월」 → 그 달 말일(사용자 2026-11-20).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contractEndDate, pickTaxFilingContract } from './fiscalYear';

test('종료일은 그 달 말일로', () => {
  assert.equal(contractEndDate('2027-06'), '2027-06-30');
  assert.equal(contractEndDate('2027-06-01'), '2027-06-30');
  assert.equal(contractEndDate('2028-02-01'), '2028-02-29');
  assert.equal(contractEndDate('2026-12'), '2026-12-31');
  assert.equal(contractEndDate('2027-06-30'), '2027-06-30');
  assert.equal(contractEndDate('2027-06-15'), '2027-06-15');
  assert.equal(contractEndDate(null), null);
  assert.equal(contractEndDate(''), null);
});

test('종료월 안의 확정일도 계약기간 안(3월 결산 법인 6월 확정)', () => {
  const rows = [{ id: 'a', contract_code: 'x', amount: 0, fiscal_year: null, start_date: '2026-07-01', end_date: '2027-06-30', note: null }];
  assert.equal(pickTaxFilingContract(rows as never, '2027-06-20')?.id, 'a');
});
