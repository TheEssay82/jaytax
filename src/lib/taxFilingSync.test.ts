// 세무조정 확정 → 매출계약 매칭. 확정일이 정산기간 끝(6/30)에 몰리는 것이 핵심이라 그 경계를 지킨다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTaxFilingContract, type TaxFilingRow } from './fiscalYear';

const fy2026: TaxFilingRow = {
  id: 'c26', contract_code: 'L0138-00-F-CT-T-2026-01', amount: 0,
  fiscal_year: 2026, start_date: '2026-07-01', end_date: '2027-06-01',   // 관행상 종료일이 06-01 이다
};
const fy2025: TaxFilingRow = {
  id: 'c25', contract_code: 'L0138-00-F-CT-T-2025-01', amount: 3000000,
  fiscal_year: 2025, start_date: '2025-07-01', end_date: '2026-06-01',
};

test('FY2026 세무조정은 3월말·5월말·6월말 확정이 모두 FY2026 계약으로 간다', () => {
  for (const d of ['2027-03-31', '2027-05-31', '2027-06-30']) {
    assert.equal(pickTaxFilingContract([fy2025, fy2026], d)?.id, 'c26', d);
  }
});

test('종료일(06-01)을 넘긴 6/30 확정도 놓치지 않는다 — 기간이 아니라 정산연도로 맞춘다', () => {
  assert.ok(fy2026.end_date! < '2027-06-30');            // 기간으로 맞췄다면 떨어졌을 날
  assert.equal(pickTaxFilingContract([fy2026], '2027-06-30')?.id, 'c26');
});

test('7/1 부터는 다음 정산연도다 — FY2026 계약에 넣지 않는다', () => {
  assert.equal(pickTaxFilingContract([fy2025, fy2026], '2027-07-01'), null);
});

test('금액이 이미 있는 계약보다 비어 있는 자리를 먼저 채운다', () => {
  const filled = { ...fy2026, id: 'filled', amount: 1200000 };
  assert.equal(pickTaxFilingContract([filled, fy2026], '2027-03-31')?.id, 'c26');
});

test('fiscal_year 가 없는 옛 계약은 기간 포함으로 보조 판정한다', () => {
  const legacy: TaxFilingRow = {
    id: 'old', contract_code: null, amount: 0,
    fiscal_year: null, start_date: '2026-07-01', end_date: '2027-06-01',
  };
  assert.equal(pickTaxFilingContract([legacy], '2027-03-31')?.id, 'old');
  assert.equal(pickTaxFilingContract([legacy], '2027-06-30'), null);   // 기간 밖 — 옛 계약은 한계가 있다
});
