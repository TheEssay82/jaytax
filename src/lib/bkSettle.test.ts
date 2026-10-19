// 기장배분 셈 — 2024.07~2025.06 조현규 결산 엑셀을 원본의 실수 넷을 고쳐 다시 계산한 값(사용자 2026-10-19 확인).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSettle, rollCpa, rollCosts, type CpaRow, type CostCell } from './bkSettle';

const cpa = (c: CpaRow['cpa'], bk_fee: number, tax_bk: number, tax_self: number, advisory_excl: number, ar_open: number, ar_close: number): CpaRow =>
  ({ cpa: c, bk_fee, tax_bk, tax_self, advisory_excl, ar_open, ar_close, writeoff: 0, states: {}, sources: {}, memo: null });
const FY2025 = [
  cpa('조현규', 9075000, 2860000, 49192000, 600000, 4845455, 11550000),
  cpa('김준성', 83502000, 26880000, 46266000, 17424000, 24900000, 11992727),
  cpa('정우철', 107214000, 64414500, 71540700, 0, 56525703, 87742066),
];
const cost = (item: string, amount: number, staff = ''): CostCell => ({ item, staff, amount, state: '확정', source: null, memo: null });
const COSTS = [cost('1) 급여+상여', 133327395), cost('3) 퇴직급여', 11103559), cost('4) 복리후생비(4대보험)', 12905699), cost('5) 임대료 등', 10446278),
  cost('7) 법인/개인카드(기장분)', 4760942), cost('8) 법인카드(정우철/송현주)', 3649178), cost('10) 기장팀 경비 등', 372849), cost('11) 내일채움공제', 2400000), cost('12) 퇴직연금수수료', 147588)];

test('비용 합계·안분대상 — 179,113,488 − 정액 3,600,000', () => {
  const r = computeSettle({ fixed_share: 1200000, common_rate: 0.1 }, FY2025, COSTS);
  assert.equal(r.costTotal, 179113488);
  assert.equal(r.allocTarget, 175513488);
});

test('비율·배분 — 미수금 VAT 제외, 자문은 모두 뺀다', () => {
  const r = computeSettle({ fixed_share: 1200000, common_rate: 0.1 }, FY2025, COSTS);
  const [j, k, w] = r.rows;
  assert.deepEqual(r.rows.map((x) => Math.round(x.ratio * 100000) / 1000), [6.166, 25.956, 67.878]);
  assert.ok(Math.abs(j.share - 10822223) < 3 && Math.abs(k.share - 45556294) < 3 && Math.abs(w.share - 119134972) < 3);
  assert.equal(Math.round(j.share + k.share + w.share), 175513488);
});

test('정산 — 원본과 같은 부가세·공통비 반올림(조현규 회수 61,127,000)', () => {
  const j = computeSettle({ fixed_share: 1200000, common_rate: 0.1 }, FY2025, COSTS).rows[0];
  assert.deepEqual([j.collected, j.vat, j.sales, j.common, j.target], [61127000, 5557000, 55570000, 5557000, 50013000]);
  assert.ok(Math.abs(j.receive - (50013000 - 1200000 - 10822223)) < 3);
});

test('새 해 — 기초 미수금은 지난해 기말, 나머지는 작년값, 퇴사자 비용 줄은 버린다', () => {
  const rolled = rollCpa(FY2025);
  assert.equal(rolled[2].ar_open, 87742066);
  assert.equal(rolled[2].states.ar_open, '확정');
  assert.equal(rolled[2].bk_fee, 107214000);
  assert.equal(rolled[2].states.bk_fee, '작년값');
  assert.equal(rolled[2].ar_close, 0);
  const c = rollCosts([cost('1) 급여+상여', 35620000, '안지연'), cost('1) 급여+상여', 48582728, '정남지'), cost('5) 임대료 등', 10446278)]);
  assert.deepEqual(c.map((x) => `${x.staff}:${x.state}`), ['정남지:작년값', ':작년값']);
});
