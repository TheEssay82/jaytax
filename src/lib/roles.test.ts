// 권한 매트릭스. **틀리면 조용히 새는 자리**라 등급별로 못박는다.
//
// 화면을 고치다 보면 매트릭스를 함께 손대게 되는데, 한 줄만 잘못 넣어도
// 그 등급 전체가 열리거나 막힌다. 그걸 여기서 잡는다.
//
// 규칙은 하나가 아니다 — 등급(여기)·이름(예산은 이름으로 막는다, staffCost.test.ts)·
// 표(RLS)가 각각 따로 있고, 셋이 같은 뜻이어야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  can, normalizeRole, ROLES, ROLE_LABELS,
  PER_HEAD_ALLOWED_GROUPS, PER_HEAD_HIDDEN_TABS, EXTERNAL_ALLOWED_TABS,
  type Role, type Capability,
} from './roles';

const EVERY_ROLE = ROLES;

/** 그 권한을 가진 등급을 모아 본다 — 매트릭스를 한눈에 견주려고. */
const holders = (cap: Capability): Role[] => EVERY_ROLE.filter((r) => can(r, cap));

// ── 최고관리자 전용 ─────────────────────────────────────

test('사용자 관리·AI 사용량은 최고관리자만', () => {
  assert.deepEqual(holders('manageUsers'), ['superuser']);
  assert.deepEqual(holders('viewAiUsage'), ['superuser']);
});

// ── 외부인은 아무 권한도 없다 ───────────────────────────

test('외부인은 어떤 권한도 갖지 않는다', () => {
  const caps: Capability[] = [
    'saveInvoice', 'finalizeInvoice', 'viewClients', 'manageClients', 'manageTargets',
    'deleteBilling', 'viewAllBilling', 'viewAllStats', 'changeSettings', 'manageUsers',
    'viewAiUsage', 'finalizeConsult', 'viewDispatch', 'processDispatch',
  ];
  for (const c of caps) assert.equal(can('external', c), false, `외부인에게 ${c} 가 열려 있다`);
});

test('외부인이 볼 수 있는 것은 정해진 탭뿐이다', () => {
  assert.ok(EXTERNAL_ALLOWED_TABS.size > 0);
  assert.equal(EXTERNAL_ALLOWED_TABS.has('users'), false, '사용자 관리가 열리면 안 된다');
  assert.equal(EXTERNAL_ALLOWED_TABS.has('staff-revenue'), false, '매출통계가 열리면 안 된다');
});

// ── 팀원과 팀장의 경계 ──────────────────────────────────

test('팀원은 임시저장까지, 확정은 팀장부터', () => {
  assert.equal(can('team_member', 'saveInvoice'), true);
  assert.equal(can('team_member', 'finalizeInvoice'), false, '팀원이 확정하면 매출이 굳어 버린다');
  assert.equal(can('team_lead', 'finalizeInvoice'), true);
});

test('팀원은 거래처를 보되 등록·삭제는 못 한다', () => {
  assert.equal(can('team_member', 'viewClients'), true);
  assert.equal(can('team_member', 'manageClients'), false);
  assert.equal(can('team_lead', 'manageClients'), true);
});

test('청구기록 전체조회는 팀원도, 통계 전체조회는 팀장부터 — 둘은 다른 권한이다', () => {
  assert.equal(can('team_member', 'viewAllBilling'), true);
  assert.equal(can('team_member', 'viewAllStats'), false);
});

test('청구기록 삭제는 팀장부터', () => {
  assert.equal(can('team_member', 'deleteBilling'), false);
  assert.deepEqual(holders('deleteBilling'), ['superuser', 'accountant', 'team_lead']);
});

// ── 인당회계사 — 조회는 넓고 쓰기는 막힌다 ──────────────

test('인당회계사는 세무조정 대상선정을 보되 거래처를 고치지는 못한다', () => {
  assert.equal(can('per_head_accountant', 'viewClients'), true);
  assert.equal(can('per_head_accountant', 'manageClients'), false);
});

test('인당회계사는 발송요청 처리에서 조회도 쓰기도 막힌다', () => {
  assert.equal(can('per_head_accountant', 'viewDispatch'), false);
  assert.equal(can('per_head_accountant', 'processDispatch'), false);
});

test('인당회계사가 볼 수 있는 대분류는 정해져 있고, 숨김 탭이 그 안에서 또 빠진다', () => {
  assert.ok(PER_HEAD_ALLOWED_GROUPS.size > 0);
  for (const tab of PER_HEAD_HIDDEN_TABS) {
    assert.equal(typeof tab, 'string');
  }
  assert.equal(PER_HEAD_HIDDEN_TABS.has('stats'), true, '세무조정 통계는 인당회계사에게 숨긴다');
});

// ── 발송요청 처리 — 조회와 쓰기가 다르다 ────────────────

test('회계사는 발송요청 처리를 보되 손대지는 못한다', () => {
  assert.equal(can('accountant', 'viewDispatch'), true, '조회는 된다');
  assert.equal(can('accountant', 'processDispatch'), false, '상태변경은 안 된다');
});

test('발송요청을 실제로 처리하는 것은 최고관리자·기장팀장·기장팀원', () => {
  assert.deepEqual(holders('processDispatch'), ['superuser', 'team_lead', 'team_member']);
});

// ── 최고관리자는 모든 것을 할 수 있다 ───────────────────

test('최고관리자는 모든 권한을 갖는다 — 새 권한을 넣고 빠뜨리는 것을 막는다', () => {
  const caps: Capability[] = [
    'saveInvoice', 'finalizeInvoice', 'viewClients', 'manageClients', 'manageTargets',
    'deleteBilling', 'viewAllBilling', 'viewAllStats', 'changeSettings', 'manageUsers',
    'viewAiUsage', 'finalizeConsult', 'viewDispatch', 'processDispatch',
  ];
  for (const c of caps) assert.equal(can('superuser', c), true, `최고관리자에게 ${c} 가 막혀 있다`);
});

// ── 등급 정규화 — 모르는 값은 가장 낮은 쪽으로 ──────────

test('모르는 등급은 팀원으로 떨어진다 — 새는 쪽이 아니라 막히는 쪽', () => {
  assert.equal(normalizeRole('superuser'), 'superuser');
  assert.equal(normalizeRole('admin'), 'team_member', '없는 이름이 최고관리자가 되면 안 된다');
  assert.equal(normalizeRole(''), 'team_member');
  assert.equal(normalizeRole(null), 'team_member');
  assert.equal(normalizeRole(undefined), 'team_member');
});

test('등급마다 한글 이름이 있다 — 화면에 코드값이 새어 나오지 않게', () => {
  for (const r of ROLES) {
    assert.equal(typeof ROLE_LABELS[r], 'string');
    assert.ok(ROLE_LABELS[r].length > 0, `${r} 의 이름이 비어 있다`);
  }
});
