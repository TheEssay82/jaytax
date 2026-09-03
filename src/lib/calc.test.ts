// 수수료 계산 — 원본 HTML(ver.4.6)에서 옮겨 온 로직이라 **숫자가 바뀌면 안 된다**.
//
// 여기 적힌 값은 "이렇게 되면 좋겠다"가 아니라 **지금 실제로 나오는 값**을 못박은 것이다.
// 앞으로 이 파일을 고쳐 값이 달라지면 테스트가 먼저 알려 준다 —
// 청구서가 나간 뒤에 아는 것보다 낫다.
//
// 특히 조심할 곳
//  · 구간 경계 (정확히 1억·2억일 때 누진이 붙는가)
//  · 천원 단위 반올림이 어느 시점에 걸리는가 (C 단계)
//  · 할인·협의조정이 부가세 **앞**에서 빠지는가
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcBase, calcS, fm, pct } from './calc';
import { DEFAULT_CONFIG } from './constants';
import type { WizardState } from '../types';

/** 업무량·상담을 모두 0으로 둔 최소 상태 — 기준수수료만 남는다. */
const bare = (over: Partial<WizardState> = {}): WizardState => ({
  selClientId: null, bizType: '법인', companyName: '', tradeName: '', taxId: '',
  repName: '', manager: '', managerId: null, revenue: '0', fiscalYear: 2026,
  isModel: false, bankAccount: '', issuedDate: '', payMonth: '', payDay: '',
  visitCount: '없음', visitDiff: '해당없음', phoneCount: '없음', phoneDiff: '해당없음',
  장부P: 'X', 장부A: 'X', 장부D: '해당없음',
  결산P: 'X', 결산A: 'X', 결산D: '해당없음',
  조정P: 'X', 조정A: 'X', 조정D: '해당없음',
  원가P: 'X', 원가A: 'X', 원가D: '해당없음', 원가T: '',
  evCount: '없음', otherContent: '', otherAmt: '', penaltyContent: '', penaltyAmt: '',
  discContent: '', discAmt: '',
  ...over,
} as WizardState);

// ── 기준수수료 누진 (calcBase) ──────────────────────────

test('1억 이하는 정액만 — 법인 50만, 개인 40만', () => {
  assert.deepEqual(calcBase(0, true, DEFAULT_CONFIG), { baseFee: 500000, scale: 0, A: 500000 });
  assert.deepEqual(calcBase(1e8, true, DEFAULT_CONFIG), { baseFee: 500000, scale: 0, A: 500000 });
  assert.deepEqual(calcBase(1e8, false, DEFAULT_CONFIG), { baseFee: 400000, scale: 0, A: 400000 });
});

test('구간 경계 — 정확히 1억에서는 누진이 붙지 않고, 1원만 넘어도 붙는다', () => {
  assert.equal(calcBase(1e8, true).scale, 0);
  assert.equal(calcBase(1e8 + 1, true).scale, 0.0018);   // 1원 × 0.18%
});

test('2억·3억 — 구간을 넘을 때마다 그 구간 요율로만 더한다', () => {
  // 법인 2억 = 50만 + (1억 × 0.18%) = 68만
  assert.equal(calcBase(2e8, true).A, 680000);
  // 법인 3억 = 68만 + (1억 × 0.16%) = 84만
  assert.equal(calcBase(3e8, true).A, 840000);
  // 개인 3억 = 40만 + (1억 × 0.17%) + (1억 × 0.15%) = 72만
  assert.equal(calcBase(3e8, false).A, 720000);
});

test('구간 중간값도 그 구간 요율로 잘린다', () => {
  // 법인 2.5억 = 68만 + (0.5억 × 0.16%) = 76만
  assert.equal(calcBase(2.5e8, true).A, 760000);
});

test('마지막 구간은 상한이 없다 — 500억을 넘어도 계산된다', () => {
  const a = calcBase(1e11, true).A;   // 1000억
  assert.ok(Number.isFinite(a) && a > 0, String(a));
  // 500억까지의 누적 + (500억 초과분 × 0.01%)
  assert.equal(a, calcBase(5e10, true).A + (1e11 - 5e10) * 0.0001);
});

test('매출이 음수여도 정액만 나온다 (NaN 이 되지 않는다)', () => {
  const r = calcBase(-1e8, true);
  assert.equal(r.A, 500000);
  assert.ok(Number.isFinite(r.A));
});

// ── 청구서 전체 (calcS) ─────────────────────────────────

test('업무량이 모두 0이면 합계는 기준수수료 + 부가세뿐', () => {
  const r = calcS(bare({ revenue: '100,000,000', bizType: '법인' }), DEFAULT_CONFIG);
  assert.equal(r.A, 500000);
  assert.equal(r.Btot, 0);
  assert.equal(r.C, 500000);
  assert.equal(r.D, 500000);
  assert.equal(r.VAT, 50000);
  assert.equal(r.grand, 550000);
});

test('콤마가 있든 없든 같은 금액으로 읽는다', () => {
  const a = calcS(bare({ revenue: '300,000,000' })).A;
  const b = calcS(bare({ revenue: '300000000' })).A;
  assert.equal(a, b);
});

test('업무 배율은 기준수수료(A)에 곱해 더한다', () => {
  // 장부 O(0.1) + 업무량 보통(0.05) + 난이도 보통(0.1) = 0.25 → r4
  const r = calcS(bare({ revenue: '100,000,000', 장부P: 'O', 장부A: '보통', 장부D: '보통' }));
  assert.equal(r.r4, 0.25);
  assert.equal(r.f4, 500000 * 0.25);
  assert.equal(r.Btot, 125000);
  assert.equal(r.C, 625000);
});

test('원가는 r5, 조정은 r6 으로 따로 잡힌다', () => {
  const r = calcS(bare({ revenue: '100,000,000', 원가P: 'O', 조정P: 'O' }));
  assert.equal(r.r5, 0.1);
  assert.equal(r.r6, 0.1);
  assert.equal(r.r4, 0);
});

test('천원 단위 반올림은 C 에서 한 번만 — 할인·부가세는 그 뒤다', () => {
  // A=500,000 · 증빙 2회이하 10,000 → 510,000 (이미 천원 단위)
  const r0 = calcS(bare({ revenue: '100,000,000', evCount: '2회이하' }));
  assert.equal(r0.C, 510000);
  // 기타금액 1,499 를 더하면 511,499 → 511,000 으로 내림
  const r1 = calcS(bare({ revenue: '100,000,000', evCount: '2회이하', otherAmt: '1499' }));
  assert.equal(r1.C, 511000);
  // 1,500 이면 512,000 으로 올림
  const r2 = calcS(bare({ revenue: '100,000,000', evCount: '2회이하', otherAmt: '1500' }));
  assert.equal(r2.C, 512000);
});

test('할인과 협의조정은 부가세 앞에서 빠진다 — 부가세도 함께 줄어든다', () => {
  const r = calcS(bare({ revenue: '100,000,000', discAmt: '100,000', penaltyAmt: '50,000' }));
  assert.equal(r.C, 500000);
  assert.equal(r.disc, 100000);
  assert.equal(r.penFee, 50000);
  assert.equal(r.D, 350000);        // 50만 − 10만 − 5만
  assert.equal(r.VAT, 35000);       // 35만의 10%
  assert.equal(r.grand, 385000);
});

test('협의조정은 ⑦(증빙·기타)에 들어가지 않는다 — 별도로 차감된다', () => {
  const r = calcS(bare({ revenue: '100,000,000', otherAmt: '30,000', penaltyAmt: '20,000' }));
  assert.equal(r.f7, 30000);        // 기타만
  assert.equal(r.penFee, 20000);
  assert.equal(r.C, 530000);
  assert.equal(r.D, 510000);
});

test('성실신고 기본수수료 세 가지 — 기본·직접입력·없음', () => {
  const base = { revenue: '100,000,000', isModel: true } as Partial<WizardState>;
  assert.equal(calcS(bare({ ...base, modelFeeMode: 'default' } as Partial<WizardState>)).modelFee, 2000000);
  assert.equal(calcS(bare({ ...base, modelFeeMode: 'custom', modelFeeAmt: '1,200,000' } as Partial<WizardState>)).modelFee, 1200000);
  assert.equal(calcS(bare({ ...base, modelFeeMode: 'none' } as Partial<WizardState>)).modelFee, 0);
});

test('성실신고가 아니면 모드와 무관하게 0', () => {
  const r = calcS(bare({ revenue: '100,000,000', isModel: false, modelFeeMode: 'default' } as Partial<WizardState>));
  assert.equal(r.modelFee, 0);
});

test('빈 값·공백은 0 으로 읽는다 (NaN 이 새지 않는다)', () => {
  const r = calcS(bare({ revenue: '', otherAmt: '', discAmt: '', penaltyAmt: '', evCount: '없음' }));
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), `${k} 가 숫자가 아니다: ${v}`);
  }
  assert.equal(r.grand, 550000);   // 법인 정액 50만 + 부가세
});

test('할인이 청구액보다 크면 합계가 음수가 된다 — 막지 않으므로 화면이 걸러야 한다', () => {
  const r = calcS(bare({ revenue: '100,000,000', discAmt: '600,000' }));
  assert.equal(r.D, -100000);
  assert.equal(r.grand, -110000);
});

// ── 표시 헬퍼 ───────────────────────────────────────────

test('금액 표시는 반올림 + 천단위 쉼표', () => {
  assert.equal(fm(1234567), '1,234,567');
  assert.equal(fm(1234.6), '1,235');
});

test('비율 표시 — 0 은 그냥 0%', () => {
  assert.equal(pct(0), '0%');
  assert.equal(pct(0.25), '25.0%');
  assert.equal(pct(0.005), '0.5%');
});
