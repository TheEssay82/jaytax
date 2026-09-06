// 예산(급여) 화면을 누가 열 수 있는가. **틀리면 급여가 새는 자리**라 촘촘히 못박는다.
//
// 화면 쪽 판정(canSeeStaffCost)과 표 쪽 판정(DB 의 can_see_staff_cost())은
// **같은 규칙이어야 한다.** 아래 표는 2026-09-03 에 DB 함수를 사람별로 실제 호출해
// 받은 결과와 한 칸씩 맞춰 둔 것이다.
//
//   정남지 (team_lead)   → false      김민섭 (team_member) → false
//   김동주 (team_member) → false      송현주 (accountant)  → true
//   정우철 (superuser)   → true
//
// 등급이 아니라 **이름**으로 막는 이유: 세 사람이 team_lead·team_member 로 갈려 있어
// 등급으로 막으면 막으면 안 되는 사람(송현주 회계사)까지 걸리거나, 반대로 샌다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canSeeStaffCost, isCostExempt, totalCost, COST_HIDDEN_FOR,
  basicTotal, monthlyTotal, bonusOf, annualOf, deriveCost, raiseOf, yearPay,
  type StaffCost,
} from './staffCost';

// ── 자기 급여가 걸린 세 사람 ────────────────────────────

test('김민섭·김동주·정남지는 어떤 등급을 줘도 못 본다', () => {
  const roles = ['superuser', 'accountant', 'per_head_accountant', 'team_lead', 'team_member'];
  for (const name of COST_HIDDEN_FOR) {
    for (const role of roles) {
      assert.equal(canSeeStaffCost(role, name), false, `${name} / ${role} 가 열려서는 안 된다`);
    }
  }
});

test('정남지는 team_lead 지만 막힌다 — 등급으로 막았다면 샜을 자리', () => {
  assert.equal(canSeeStaffCost('team_lead', '정남지'), false);
  assert.equal(canSeeStaffCost('team_lead', '다른팀장'), true, '같은 등급의 다른 사람은 열려야 한다');
});

// ── 볼 수 있어야 하는 사람 ──────────────────────────────

test('송현주는 accountant 라 열린다 — 이름으로 막지 않는다', () => {
  assert.equal(canSeeStaffCost('accountant', '송현주'), true);
});

test('회계사·관리자 등급은 열린다', () => {
  assert.equal(canSeeStaffCost('superuser', '정우철'), true);
  assert.equal(canSeeStaffCost('accountant', '김준성'), true);
  assert.equal(canSeeStaffCost('per_head_accountant', '아무개'), true);
});

test('그 밖의 등급은 막힌다 — 모르는 등급이 새지 않게 기본이 거부다', () => {
  assert.equal(canSeeStaffCost('team_member', '아무개'), false);
  assert.equal(canSeeStaffCost('viewer', '아무개'), false);
  assert.equal(canSeeStaffCost('', '아무개'), false);
});

// ── 성과측정 제외 ───────────────────────────────────────

test('송현주는 성과측정 대상이 아니다 — 열람 권한과는 별개다', () => {
  assert.equal(isCostExempt('송현주'), true);
  assert.equal(canSeeStaffCost('accountant', '송현주'), true, '볼 수는 있다');
  assert.equal(isCostExempt('김민섭'), false);
  assert.equal(isCostExempt(''), false);
});

// ── 총부담비용 ──────────────────────────────────────────

test('총부담비용 = 연봉+상여+퇴직금+4대보험+기타 (세전 월급은 참고값)', () => {
  const c: StaffCost = {
    id: '', fy: 2026, staffName: 'x', monthly: 4_000_000,
    annual: 48_000_000, bonus: 4_000_000, severance: 4_000_000,
    insurance: 4_800_000, etcCost: 4_800_000, note: '',
  };
  assert.equal(totalCost(c), 65_600_000, '세전(월) 4,000,000 이 더해지면 안 된다');
});

/* ────────────────────────────────────────────────────────────────────────────
 * 급여 구성요소 → 총부담비용.
 *
 * 아래 숫자는 **지어낸 것이 아니다** — 엑셀(기장사업부현황정리_20260630기준)의
 * 「기장담당자 현황」 시트 30~38 행에 있는 세 사람의 실제 급여표다. 그 표의
 * 「연봉」·「인상금액」 칸과 한 칸씩 맞춰 두었으므로, 식을 잘못 고치면 여기가 먼저 깨진다.
 * ────────────────────────────────────────────────────────────────────────── */
test('엑셀 급여표 — 정남지 FY2026(인상 후)', () => {
  const p = { basePay: 3_920_000, allowance: 0, mgmtAllowance: 240_000, meal: 200_000 };
  assert.equal(basicTotal(p), 4_160_000);      // 기본급합계 — 식대는 빠진다
  assert.equal(monthlyTotal(p), 4_360_000);    // 월급합계
  assert.equal(bonusOf(p), 4_160_000);         // 상여 100%
  assert.equal(annualOf(p), 56_480_000);       // 엑셀 「연봉」
  const d = deriveCost(p);
  assert.equal(d.annual, 52_320_000);          // 저장 칸의 annual 은 상여를 뺀 열두 달치
  assert.equal(d.bonus, 4_160_000);
  assert.equal(d.severance, 4_706_667);
  assert.equal(d.insurance, 5_648_000);
  assert.equal(d.etcCost, 5_648_000);
  assert.equal(d.total, 72_482_667);           // DB staff_cost 의 합과 같다
});

test('엑셀 급여표 — 김민섭·김동주 FY2026(인상 후)', () => {
  const ms = { basePay: 3_840_000, allowance: 0, mgmtAllowance: 0, meal: 200_000 };
  assert.equal(annualOf(ms), 52_320_000);
  assert.equal(deriveCost(ms).total, 67_144_000);

  const dj = { basePay: 3_020_000, allowance: 0, mgmtAllowance: 0, meal: 200_000 };
  assert.equal(annualOf(dj), 41_660_000);
  assert.equal(deriveCost(dj).total, 53_463_667);
});

test('총부담은 연봉의 1.28333 배 — 퇴직 1/12 + 보험 10% + 기타 10%', () => {
  const p = { basePay: 3_000_000, allowance: 0, mgmtAllowance: 0, meal: 0 };
  const d = deriveCost(p);
  assert.equal(annualOf(p), 39_000_000);
  assert.equal(d.total, Math.round(39_000_000 * (1 + 1 / 12 + 0.1 + 0.1)));
});

test('비율은 바꿀 수 있고, 퇴직금 0 은 나누지 않는다', () => {
  const p = { basePay: 1_200_000, allowance: 0, mgmtAllowance: 0, meal: 0 };
  const d = deriveCost(p, { severanceDiv: 0, insuranceRate: 0, etcRate: 0 });
  assert.equal(d.severance, 0);
  assert.equal(d.total, annualOf(p));
});

test('인상 — 엑셀의 인상금액·인상률과 같다', () => {
  const 정남지 = raiseOf(53_360_000, 56_480_000);
  assert.equal(정남지?.amount, 3_120_000);
  assert.equal((정남지!.rate * 100).toFixed(2), '5.85');

  const 김민섭 = raiseOf(50_240_000, 52_320_000);
  assert.equal(김민섭?.amount, 2_080_000);
  assert.equal((김민섭!.rate * 100).toFixed(2), '4.14');

  const 김동주 = raiseOf(39_710_000, 41_660_000);
  assert.equal(김동주?.amount, 1_950_000);
  assert.equal((김동주!.rate * 100).toFixed(2), '4.91');
});

test('지난 해가 없으면 인상률은 0% 가 아니라 없음이다', () => {
  assert.equal(raiseOf(0, 50_000_000), null);
});

test('yearPay — 저장된 줄에서 엑셀 「연봉」을 되돌린다', () => {
  assert.equal(yearPay({ annual: 52_320_000, bonus: 4_160_000 }), 56_480_000);
});
