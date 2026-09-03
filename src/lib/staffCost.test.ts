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
import { canSeeStaffCost, isCostExempt, totalCost, COST_HIDDEN_FOR, type StaffCost } from './staffCost';

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
