// 직원급여산정표. **표를 잘못 옮기면 급여가 틀린다** — 원본 PDF 의 여러 칸을 그대로 찍어 둔다.
//
// 아래 숫자는 지어낸 것이 아니라 인덕회계법인 [개정안] <별표 1> 직원급여산정표
// (2021-09-09)에 인쇄된 값이다. 구간 경계(25·45·60·75·85·90·91·95)를 특히 촘촘히 본다 —
// 오름폭이 바뀌는 자리라 규칙을 잘못 쓰면 여기서 어긋난다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAY_SCALE, stepOf, payOf, nearestStep, splitByStep, locate,
} from './payScale';

test('호봉은 1~100 이고 연간은 월정의 열두 배다', () => {
  assert.equal(PAY_SCALE.length, 100);
  assert.equal(PAY_SCALE[0].step, 1);
  assert.equal(PAY_SCALE[99].step, 100);
  for (const s of PAY_SCALE) assert.equal(s.annual, s.monthly * 12);
});

test('표의 값 — 원본 PDF 와 한 칸씩', () => {
  const want: [number, number][] = [
    [1, 1_800_000], [2, 1_830_000], [10, 2_070_000], [25, 2_520_000],
    [26, 2_570_000], [32, 2_870_000], [35, 3_020_000], [45, 3_520_000],
    [46, 3_600_000], [47, 3_680_000], [49, 3_840_000], [50, 3_920_000],
    [51, 4_000_000], [53, 4_160_000], [60, 4_720_000],
    [61, 4_820_000], [75, 6_220_000],
    [76, 6_370_000], [85, 7_720_000],
    [86, 7_920_000], [90, 8_720_000],
    [91, 9_000_000], [94, 10_500_000], [95, 11_500_000], [100, 16_000_000],
  ];
  for (const [step, monthly] of want) {
    assert.equal(payOf(step), monthly, `${step}호봉`);
  }
});

test('연간기본급여도 표와 같다', () => {
  assert.equal(PAY_SCALE[0].annual, 21_600_000);      // 1호봉
  assert.equal(payOf(50)! * 12, 47_040_000);          // 50호봉
  assert.equal(payOf(100)! * 12, 192_000_000);        // 100호봉
});

test('오름폭이 구간마다 바뀐다 — 등차가 아니다', () => {
  const gap = (a: number, b: number) => payOf(b)! - payOf(a)!;
  assert.equal(gap(1, 2), 30_000);
  assert.equal(gap(25, 26), 50_000);
  assert.equal(gap(45, 46), 80_000);
  assert.equal(gap(60, 61), 100_000);
  assert.equal(gap(75, 76), 150_000);
  assert.equal(gap(85, 86), 200_000);
});

// ── 실제 세 사람이 표 위에 정확히 서 있는가 ──────────────────
//
// 2026-09-06 검산. **기본급 = 기본금 + 수당 + 관리수당**이고, 이 값이 표의 한 칸과
// 같아야 한다. 세 사람 모두 딱 맞는다 — 맞지 않으면 급여정책을 벗어난 것이다.

test('세 사람의 FY2025·FY2026 기본급이 모두 표 위에 있다', () => {
  // 정남지 — 기본금 + **관리수당**이 표의 한 칸이 된다.
  assert.equal(stepOf(3_760_000 + 160_000), 50);   // FY2025 : 3,920,000
  assert.equal(stepOf(3_920_000 + 240_000), 53);   // FY2026 : 4,160,000
  // 김민섭 — 관리수당이 없다.
  assert.equal(stepOf(3_680_000), 47);             // FY2025
  assert.equal(stepOf(3_840_000), 49);             // FY2026
  // 김동주
  assert.equal(stepOf(2_870_000), 32);             // FY2025
  assert.equal(stepOf(3_020_000), 35);             // FY2026
});

test('표에 없는 금액은 없다고 말한다', () => {
  assert.equal(stepOf(3_921_000), null);
  assert.equal(stepOf(0), null);
  assert.equal(payOf(0), null);
  assert.equal(payOf(101), null);
});

// ── 관리수당 가르기 ──────────────────────────────────────

test('정남지 — 호봉을 먼저 정하고 관리수당을 떼어 낸다', () => {
  const s = splitByStep(payOf(53)!, 240_000);
  assert.equal(s.basePay, 3_920_000);
  assert.equal(s.mgmtAllowance, 240_000);
  assert.equal(s.basePay + s.mgmtAllowance, 4_160_000);   // 표의 53호봉과 같다
  assert.equal(s.over, false);
});

test('관리수당이 없으면 호봉 금액이 그대로 기본금이다', () => {
  const s = splitByStep(payOf(49)!, 0);
  assert.equal(s.basePay, 3_840_000);
  assert.equal(s.mgmtAllowance, 0);
});

test('관리수당이 호봉 금액보다 크면 기본금을 음수로 만들지 않는다', () => {
  const s = splitByStep(3_000_000, 4_000_000);
  assert.equal(s.basePay, 0);
  assert.equal(s.mgmtAllowance, 3_000_000);
  assert.equal(s.over, true);
});

// ── 표 위에서 어디쯤인가 ─────────────────────────────────

test('locate — 표에 맞으면 그 호봉, 아니면 가장 가까운 곳과 차이', () => {
  assert.deepEqual(locate(4_160_000), { step: 53, exact: true, diff: 0 });
  const off = locate(4_170_000);
  assert.equal(off.exact, false);
  assert.equal(off.step, 53);
  assert.equal(off.diff, 10_000);
});

test('nearestStep — 같은 거리면 아래 호봉. 실제보다 높게 말하지 않는다', () => {
  // 53호봉 4,160,000 과 54호봉 4,240,000 의 한가운데.
  assert.equal(nearestStep(4_200_000).step, 53);
});

test('표 밖의 큰 금액은 마지막 호봉으로 붙는다', () => {
  assert.equal(nearestStep(99_000_000).step, 100);
  assert.equal(nearestStep(1).step, 1);
});
