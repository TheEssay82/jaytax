// billingSchedule 엔진 유닛테스트. 실행: npx tsx --test src/lib/billingSchedule.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyRevenue, periodRevenue, monthlyTotals, monthIndex, indexToMonth, toNet, defaultWindow, type Basis } from './billingSchedule';
import type { SalesContract, BillingCycle, Installment, Discount } from './salesContractApi';

// 최소 계약 팩토리 — 테스트에 필요한 필드만 지정.
function mk(p: Partial<SalesContract> & { billingCycle: BillingCycle; amount: number }): SalesContract {
  return {
    id: 'x', entityId: 'e', placeId: null, occurrenceUnit: '법인', billingUnit: null, team: '감사team',
    categoryCode: '', categoryEtcName: '', includesVat: false, includesWht: false, advisoryType: null,
    parentContractId: null, fiscalYear: null, isInstallment: false, cpa: '', contractDate: null,
    startDate: null, endDate: null, note: '', contractCode: '', includedCodes: [], dateEstimated: false,
    staff: [], installments: [], discounts: [],
    // 필수 필드는 여기서 기본값을 준다 — Partial 만으로는 boolean|undefined 가 되어 타입이 깨진다.
    confirmed: true, billingMonth: null,
    effectiveCpa: '', cpaInherited: false,
    staffHistory: [], effectiveStaff: [], staffInherited: false,
    ...p,
  };
}
const inst = (dueDate: string, amount: number): Installment => ({ seq: 1, label: '', amount, dueDate, conditionNote: '' });
const disc = (p: Partial<Discount> & { discType: '무료' | '할인' }): Discount => ({ startDate: null, endDate: null, rate: null, amount: null, note: '', ...p });

test('월(index) 산술 왕복', () => {
  assert.equal(monthIndex('2026-07'), 2026 * 12 + 6);
  assert.equal(indexToMonth(monthIndex('2026-07')!), '2026-07');
  assert.equal(monthIndex('2026-07-15'), monthIndex('2026-07'));
  assert.equal(monthIndex(''), null);
});

test('순액 환산: 부가세 포함 /1.1', () => {
  assert.equal(toNet(1_100_000), 1_100_000);
  assert.equal(toNet(1_000_000), 1_000_000);
});

test('월 계약(기장·계속): 청구=발생 동일, 창구 안 매월 이벤트', () => {
  const c = mk({ billingCycle: '월', amount: 700_000, startDate: '2026-07' }); // 종료 없음(계속)
  for (const basis of ['billing', 'accrual'] as Basis[]) {
    const rows = monthlyRevenue(c, basis, '2026-07', '2026-09');
    assert.equal(rows.length, 3, basis);
    assert.deepEqual(rows.map((r) => r.month), ['2026-07', '2026-08', '2026-09']);
    assert.ok(rows.every((r) => r.net === 700_000), basis);
  }
  // 계속계약: 1년 창구 = 12개월 × 70만
  assert.equal(periodRevenue(c, 'billing', '2026-07', '2027-06'), 700_000 * 12);
});

test('연 계약(감사): 청구주의=개시월 1회 전액, 발생주의=12개월 균등', () => {
  const c = mk({ billingCycle: '연', amount: 50_000_000, startDate: '2026-01', endDate: '2026-12' });
  const bill = monthlyRevenue(c, 'billing', '2026-01', '2026-12');
  assert.equal(bill.length, 1);
  assert.deepEqual(bill[0], { month: '2026-01', net: 50_000_000 });

  const acc = monthlyRevenue(c, 'accrual', '2026-01', '2026-12');
  assert.equal(acc.length, 12);
  assert.ok(acc.every((r) => r.net === Math.round(50_000_000 / 12)));
  assert.ok(Math.abs(periodRevenue(c, 'accrual', '2026-01', '2026-12') - 50_000_000) <= 12); // 반올림 오차 허용
});

test('분기 계약이 한 달만 있어도 1/3 로 월할한다 — 단발로 보지 않는다', () => {
  const c = mk({ billingCycle: '분기', amount: 3_000_000, startDate: '2026-07-01', endDate: '2026-07-31' });
  assert.equal(periodRevenue(c, 'accrual', '2026-07', '2027-06'), 1_000_000);
});

test('분기 계약: 청구주의는 3개월마다, 발생주의는 매월 1/3', () => {
  const c = mk({ billingCycle: '분기', amount: 3_000_000, startDate: '2026-01', endDate: '2026-12' });
  const bill = monthlyRevenue(c, 'billing', '2026-01', '2026-12');
  assert.deepEqual(bill.map((r) => r.month), ['2026-01', '2026-04', '2026-07', '2026-10']);
  assert.ok(bill.every((r) => r.net === 3_000_000));
  const acc = monthlyRevenue(c, 'accrual', '2026-01', '2026-12');
  assert.equal(acc.length, 12);
  assert.ok(acc.every((r) => r.net === 1_000_000)); // 300만/분기 → 100만/월
});

test('분할 우선: 연 계약이라도 회차 due월·금액으로 청구', () => {
  const c = mk({
    billingCycle: '연', amount: 50_000_000, startDate: '2026-01', endDate: '2026-12', isInstallment: true,
    installments: [inst('2026-03-31', 20_000_000), inst('2026-09-30', 30_000_000)],
  });
  const bill = monthlyRevenue(c, 'billing', '2026-01', '2026-12');
  assert.deepEqual(bill, [{ month: '2026-03', net: 20_000_000 }, { month: '2026-09', net: 30_000_000 }]);
});

// ── 단발 계약: 월할하지 않는다 ──────────────────────────
//   금액이 '주기당'이 아니라 **그 건의 총액**인 계약들. 월할하면 예상이 1/12 로 쪼그라든다.

test("주기 '건': 개시월에 전액 — 청구·발생 둘 다", () => {
  const c = mk({ billingCycle: '건', amount: 5_000_000, startDate: '2026-05', endDate: '2026-06' });
  for (const basis of ['billing', 'accrual'] as Basis[]) {
    assert.deepEqual(monthlyRevenue(c, basis, '2026-01', '2026-12'), [{ month: '2026-05', net: 5_000_000 }], basis);
  }
});

test("주기 '건': 분할이 있으면 분할이 우선 — due월에 회차금액", () => {
  const c = mk({ billingCycle: '건', amount: 5_000_000, startDate: '2026-05', isInstallment: true, installments: [inst('2026-08-10', 5_000_000)] });
  assert.deepEqual(monthlyRevenue(c, 'billing', '2026-01', '2026-12'), [{ month: '2026-08', net: 5_000_000 }]);
  assert.deepEqual(monthlyRevenue(c, 'accrual', '2026-01', '2026-12'), [{ month: '2026-08', net: 5_000_000 }]);
});

test("'발생시'는 그대로 스케줄 없음 — 언제 몇 번 일어날지 모른다", () => {
  const c = mk({ billingCycle: '발생시', amount: 5_000_000, startDate: '2026-05', endDate: '2026-06' });
  assert.equal(monthlyRevenue(c, 'billing', '2026-01', '2026-12').length, 0);
  assert.equal(monthlyRevenue(c, 'accrual', '2026-01', '2026-12').length, 0);
});

test('연 계약은 기간이 짧아도 단발로 넘겨짚지 않는다 — 종료일 오타가 12배가 되면 안 된다', () => {
  // 한때 '기간 < 한 주기'를 단발로 추론했다. 그 추론은 종료일 오타를 12배 과대계상으로
  // 키운다 — 연 12,000,000 의 종료일을 잘못 눌러 1개월이 되면 전액이 한 달에 잡혔다.
  // 단발은 주기 '건' 으로 **명시**하기로 했으므로(사용자 확정 2026-09-03) 추론을 뺐다.
  const c = mk({ billingCycle: '연', amount: 12_000_000, startDate: '2026-07-01', endDate: '2026-07-31' });
  assert.equal(periodRevenue(c, 'accrual', '2026-07', '2027-06'), 1_000_000, '전액(12,000,000)이 잡히면 안 된다');
  // 청구주의는 원래 개시월 1회 전액이다(현금이 그때 들어오므로) — 이건 그대로.
  assert.equal(periodRevenue(c, 'billing', '2026-07', '2027-06'), 12_000_000);
});

test('그 단발을 제대로 넣는 법은 주기 「건」 이다', () => {
  const c = mk({ billingCycle: '건', amount: 500_000, startDate: '2026-07-01', endDate: '2026-07-31' });
  assert.equal(periodRevenue(c, 'accrual', '2026-07', '2027-06'), 500_000);
  assert.equal(periodRevenue(c, 'billing', '2026-07', '2027-06'), 500_000);
});

test('연 계약이 12개월이면 종전대로 월할 — 단발로 오인하지 않는다', () => {
  const c = mk({ billingCycle: '연', amount: 1_200_000, startDate: '2026-07', endDate: '2027-06' });
  assert.equal(monthlyRevenue(c, 'accrual', '2026-07', '2027-06').length, 12);
  assert.equal(periodRevenue(c, 'accrual', '2026-07', '2026-07'), 100_000);
});

test('종료일이 없는 계속계약은 단발이 아니다', () => {
  const c = mk({ billingCycle: '연', amount: 1_200_000, startDate: '2026-07' });
  assert.equal(monthlyRevenue(c, 'accrual', '2026-07', '2027-06').length, 12);
});

test('단발에도 할인·무료가 그대로 먹는다', () => {
  const c = mk({
    billingCycle: '건', amount: 1_000_000, startDate: '2026-05',
    discounts: [disc({ discType: '할인', rate: 30 })],
  });
  assert.deepEqual(monthlyRevenue(c, 'accrual', '2026-01', '2026-12'), [{ month: '2026-05', net: 700_000 }]);
});

test('회계감사(AUD.AUDIT): 매출은 회계연도(fy-07~fy+1-06) 월할, 청구는 개시월 그대로', () => {
  const c = mk({ categoryCode: 'AUD.AUDIT', billingCycle: '연', amount: 12_000_000, fiscalYear: 2026, startDate: '2026-01', endDate: '2026-12' });
  // 발생(매출): 회계연도 2026-07~2027-06에 걸쳐 12개월 균등 → 대상연도 상반기(1~6월)엔 0
  assert.equal(periodRevenue(c, 'accrual', '2026-01', '2026-06'), 0);
  assert.equal(periodRevenue(c, 'accrual', '2026-07', '2027-06'), 12_000_000);
  assert.equal(monthlyRevenue(c, 'accrual', '2026-08', '2026-08')[0].net, 1_000_000); // 8월분 1/12
  // 청구(현금): remap 없음 → 개시월 2026-01에 전액
  assert.deepEqual(monthlyRevenue(c, 'billing', '2026-01', '2027-06'), [{ month: '2026-01', net: 12_000_000 }]);
});

// includesVat/includesWht 는 '기장에 부가세·원천세 신고업무가 포함되는가'라는 업무 범위 표시다.
// 금액과는 무관하다 — 계약금액은 언제나 공급가액이므로 그대로 나와야 한다.
test('기장 포함(부가세·원천세) 표시는 금액을 바꾸지 않는다', () => {
  const c = mk({ billingCycle: '월', amount: 1_100_000, includesVat: true, includesWht: true, startDate: '2026-07', endDate: '2026-09' });
  const rows = monthlyRevenue(c, 'billing', '2026-01', '2026-12');
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.net === 1_100_000));
});

test('무료 구간은 0, 할인율은 감액', () => {
  const c = mk({
    billingCycle: '월', amount: 1_000_000, startDate: '2026-01', endDate: '2026-12',
    discounts: [disc({ discType: '무료', startDate: '2026-02-01', endDate: '2026-02-28' }), disc({ discType: '할인', startDate: '2026-03-01', endDate: '2026-03-31', rate: 50 })],
  });
  const by = new Map(monthlyRevenue(c, 'billing', '2026-01', '2026-03').map((r) => [r.month, r.net]));
  assert.equal(by.get('2026-01'), 1_000_000);
  assert.equal(by.get('2026-02'), 0);          // 무료
  assert.equal(by.get('2026-03'), 500_000);    // 50% 할인
});

test('정액 할인: 총액에서 차감', () => {
  const c = mk({ billingCycle: '월', amount: 1_000_000, startDate: '2026-01', endDate: '2026-01', discounts: [disc({ discType: '할인', amount: 300_000 })] });
  assert.equal(monthlyRevenue(c, 'billing', '2026-01', '2026-01')[0].net, 700_000);
});

test('창구 밖 이벤트는 제외 / 계속계약은 상한까지', () => {
  const c = mk({ billingCycle: '월', amount: 100_000, startDate: '2026-01' }); // 계속
  const rows = monthlyRevenue(c, 'billing', '2026-06', '2026-08');
  assert.deepEqual(rows.map((r) => r.month), ['2026-06', '2026-07', '2026-08']);
});

test('monthlyTotals: 여러 계약 월별 합산', () => {
  const a = mk({ billingCycle: '월', amount: 100_000, startDate: '2026-07', endDate: '2026-08' });
  const b = mk({ billingCycle: '월', amount: 200_000, startDate: '2026-08', endDate: '2026-08' });
  const t = monthlyTotals([a, b], 'billing', '2026-07', '2026-08');
  assert.equal(t.get('2026-07'), 100_000);
  assert.equal(t.get('2026-08'), 300_000);
});

test('defaultWindow: 최이른 개시 ~ max(최종종료, 오늘), 경과분 상한', () => {
  const cs = [mk({ billingCycle: '연', amount: 1, startDate: '2025-01', endDate: '2025-12' }), mk({ billingCycle: '월', amount: 1, startDate: '2026-07' })];
  assert.deepEqual(defaultWindow(cs, '2026-08'), { from: '2025-01', to: '2026-08' });
  assert.deepEqual(defaultWindow(cs, '2026-08', true), { from: '2025-01', to: '2026-08' }); // 상한=오늘
  // 미래 종료가 있어도 경과분 캡이면 오늘까지
  const future = [mk({ billingCycle: '연', amount: 1, startDate: '2026-01', endDate: '2027-12' })];
  assert.deepEqual(defaultWindow(future, '2026-08', true), { from: '2026-01', to: '2026-08' });
});
