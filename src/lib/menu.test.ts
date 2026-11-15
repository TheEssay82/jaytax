// 누가 어느 메뉴를 여는가. **사용자가 직접 짚어 준 규칙**이라 한 줄씩 못박는다
// (2026-09-03 확인 요청).
//
//   1. 거래처관리 › 현황및예산조회  — 정남지·김민섭·김동주 차단
//   2. 기장등청구관리 › 매출통계(통계) — 김민섭·김동주 차단 (정남지는 열림)
//   3. 기장등청구관리 › 매출통계의 예산 — 정남지·김민섭·김동주 차단
//
// 3번은 메뉴가 아니라 **서브탭**이라 canSeeStaffCost 가 막는다(staffCost.test.ts 가 본다).
// 여기서는 1·2번과, 숨긴 탭이 주소로도 열리지 않는지를 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MENU_GROUPS, menuAllowed, type MenuItem, tabAllowed } from './menu';
import { canSeeStaffCost } from './staffCost';
import type { Role } from './roles';

/** 메뉴 id 로 항목을 찾는다 — 못 찾으면 테스트가 조용히 통과하지 않도록 던진다. */
function item(id: string): MenuItem {
  for (const g of MENU_GROUPS) {
    for (const it of g.items) {
      if (it.id === id) return it;
      const c = it.children?.find((x) => x.id === id);
      if (c) return c;
    }
  }
  throw new Error(`메뉴 '${id}' 가 없다 — 이름이 바뀌었으면 이 테스트도 고쳐야 한다`);
}

/** 실제 등급 그대로. 등급이 아니라 이름으로 막히는지 보려면 진짜 등급을 써야 한다. */
const 정남지: [Role, string] = ['team_lead', '정남지'];
const 김민섭: [Role, string] = ['team_member', '김민섭'];
const 김동주: [Role, string] = ['team_member', '김동주'];
const 송현주: [Role, string] = ['accountant', '송현주'];
const 정우철: [Role, string] = ['superuser', '정우철'];

const opens = ([r, n]: [Role, string], id: string) => menuAllowed(r, n, item(id));

// ── 1. 현황및예산조회 — 셋 다 차단 ──────────────────────

test('현황및예산조회는 정남지·김민섭·김동주에게 열리지 않는다', () => {
  assert.equal(opens(정남지, 'biz-status'), false);
  assert.equal(opens(김민섭, 'biz-status'), false);
  assert.equal(opens(김동주, 'biz-status'), false);
});

test('현황및예산조회는 회계사·관리자에게는 열린다', () => {
  assert.equal(opens(송현주, 'biz-status'), true);
  assert.equal(opens(정우철, 'biz-status'), true);
});

// ── 2. 매출통계 — 둘만 차단, 정남지는 열림 ──────────────

test('매출통계는 김민섭·김동주에게 열리지 않는다', () => {
  assert.equal(opens(김민섭, 'staff-revenue'), false);
  assert.equal(opens(김동주, 'staff-revenue'), false);
});

test('매출통계는 정남지에게 열린다 — 현황및예산조회와 다르다', () => {
  assert.equal(opens(정남지, 'staff-revenue'), true);
});

// ── 3. 매출통계 안의 예산 서브탭 — 셋 다 차단 ───────────

test('예산 서브탭은 셋 다 막힌다 — 매출통계가 열리는 정남지도 마찬가지', () => {
  assert.equal(opens(정남지, 'staff-revenue'), true, '매출통계는 열리고');
  assert.equal(canSeeStaffCost(...정남지), false, '그 안의 예산은 막힌다');
  assert.equal(canSeeStaffCost(...김민섭), false);
  assert.equal(canSeeStaffCost(...김동주), false);
  assert.equal(canSeeStaffCost(...송현주), true);
  assert.equal(canSeeStaffCost(...정우철), true);
});

// ── 세무조정수수료관리 › 통계도 같은 성격 ───────────────

test('세무조정 통계도 김민섭·김동주에게는 열리지 않는다', () => {
  assert.equal(opens(김민섭, 'stats'), false);
  assert.equal(opens(김동주, 'stats'), false);
  assert.equal(opens(정남지, 'stats'), true);
});

// ── 숨긴 메뉴는 '보이지 않음'이 아니라 '들어갈 수 없음' ──

test('막힌 사람의 접근 가능 탭 목록에 그 id 가 아예 없다', () => {
  // AppShell 이 allowedIds 를 이렇게 만든다 — 여기 없으면 주소로도 못 연다.
  const allowedIds = (r: Role, n: string) => new Set(
    MENU_GROUPS.flatMap((g) => g.items.flatMap((it) => it.children ?? [it]))
      .filter((it) => menuAllowed(r, n, it)).map((it) => it.id),
  );
  const nam = allowedIds(...정남지);
  assert.equal(nam.has('biz-status'), false, '정남지에게 현황및예산조회가 남아 있으면 안 된다');
  assert.equal(nam.has('staff-revenue'), true);

  const min = allowedIds(...김민섭);
  assert.equal(min.has('biz-status'), false);
  assert.equal(min.has('staff-revenue'), false);
  assert.equal(min.has('stats'), false);
});

// ── 감사업무관리(2026-10-05) — 감사 보조 시스템을 일반업무관리에서 옮겼다 ──

test('감사업무관리에 조회서 발송관리·정산표·주석·DSD·일반조서·감사이슈 LOG·Journal Entry·1118 월결산이 있고, 일반업무관리에는 없다', () => {
  const audit = MENU_GROUPS.find((g) => g.id === 'audit')!;
  const general = MENU_GROUPS.find((g) => g.id === 'general')!;
  assert.equal(audit.label, '감사업무관리');
  assert.deepEqual(audit.items.map((i) => i.id), ['inquiry-send', 'wtb', 'dsd', 'gwp', 'issue', 'schedule', 'je', 'ifrs18']);
  for (const id of ['inquiry-send', 'wtb', 'dsd', 'gwp', 'issue', 'schedule', 'je', 'ifrs18']) assert.equal(general.items.some((i) => i.id === id), false);
});

test('Journal Entry 는 일반조서처럼 감사팀만', () => {
  assert.equal(opens(송현주, 'je'), true);
  assert.equal(opens(정남지, 'je'), false);
});

test('감사업무관리 — 인당회계사는 모두, 기장팀은 조회서 발송관리만(2026-10-05)', () => {
  const 인당: [Role, string] = ['per_head_accountant', '조현규'];
  for (const id of ['inquiry-send', 'conf-register', 'conf-dispatch', 'conf-collect', 'conf-status', 'dsd', 'gwp', 'je']) assert.equal(opens(인당, id), true, id);
  for (const p of [정남지, 김민섭]) {
    for (const id of ['inquiry-send', 'conf-register', 'conf-dispatch', 'conf-collect', 'conf-status']) assert.equal(opens(p, id), true, id);
    for (const id of ['dsd', 'gwp', 'je']) assert.equal(opens(p, id), false, id);
  }
  assert.equal(menuAllowed('external', '외부', item('dsd')), true);   // 외부인 시연은 그대로
});

test('1118 월결산 — 감사팀과 회사 담당자(외부인)가 열고, 기장팀은 열지 않는다(2026-11-09)', () => {
  assert.equal(opens(송현주, 'ifrs18'), true);
  assert.equal(opens(['per_head_accountant', '조현규'], 'ifrs18'), true);
  assert.equal(opens(정남지, 'ifrs18'), false);
  assert.equal(menuAllowed('external', '넵튠 담당', item('ifrs18')), true);
});

test('홈 바로가기 — 메뉴와 같은 사람에게만(tabAllowed)', () => {
  assert.equal(tabAllowed('team_lead', '정남지', 'je'), false);
  assert.equal(tabAllowed('team_lead', '정남지', 'bk-settle'), false);
  assert.equal(tabAllowed('accountant', '송현주', 'je'), true);
  assert.equal(tabAllowed('accountant', '송현주', 'expense'), true);
  assert.equal(tabAllowed('superuser', '정우철', 'bk-settle'), true);
  assert.equal(tabAllowed('superuser', '정우철', 'invoice-request'), true);
  assert.equal(tabAllowed('superuser', '정우철', '없는-탭'), false);
});

// ── 📊 경영(2026-11-15) — 보는 사람용 화면을 모았다. 누가 보는지는 그대로 ──

test('경영 대분류에 현황및예산조회·매출통계·팀결산·AI 사용량이 있고, 세무조정 통계는 제자리', () => {
  const mgmt = MENU_GROUPS.find((g) => g.id === 'mgmt')!;
  assert.deepEqual(mgmt.items.map((i) => i.id), ['biz-status', 'staff-revenue', 'team-settle', 'ai-usage']);
  for (const g of MENU_GROUPS.filter((x) => x.id !== 'mgmt')) {
    for (const id of ['biz-status', 'staff-revenue', 'team-settle', 'ai-usage']) assert.equal(g.items.some((i) => i.id === id), false, `${g.id} ${id}`);
  }
  assert.equal(MENU_GROUPS.find((g) => g.id === 'billing')!.items.some((i) => i.id === 'stats'), true);
});

test('경영 — 인당회계사 조현규는 팀결산을 계속 연다(일반업무관리에서 옮긴 뒤에도)', () => {
  const 인당: [Role, string] = ['per_head_accountant', '조현규'];
  assert.equal(opens(인당, 'expense'), true);
  assert.equal(opens(인당, 'bk-settle'), true);
});

// ── ⚙ 관리(2026-11-15) — 관리·설정 화면을 단추 하나에 묶었다 ──

test('⚙ 관리 — 관리 아이콘 5개와 기초 미수금 입력이 묶이고, 업데이트요청은 아이콘으로 남는다', async () => {
  const { ICON_ITEMS } = await import('./menu');
  assert.deepEqual(ICON_ITEMS.filter((i) => i.admin).map((i) => i.id), ['users', 'access-log', 'retention', 'backlog', 'service-limits', 'receivable-opening']);
  assert.deepEqual(ICON_ITEMS.filter((i) => !i.admin).map((i) => i.id), ['requests']);
  for (const g of MENU_GROUPS) assert.equal(g.items.some((i) => i.id === 'receivable-opening'), false, g.id);
  assert.equal(MENU_GROUPS.find((g) => g.id === 'billing')!.items.some((i) => i.id === 'settings'), true, '세무조정 설정은 제자리');
});

test('기초 미수금 입력은 여전히 정우철만', async () => {
  const { ICON_ITEMS, menuAllowed } = await import('./menu');
  const it = ICON_ITEMS.find((i) => i.id === 'receivable-opening')!;
  assert.equal(menuAllowed('superuser', '정우철', it), true);
  assert.equal(menuAllowed('accountant', '송현주', it), false);
  assert.equal(menuAllowed('team_member', '정남지', it), false);
});
