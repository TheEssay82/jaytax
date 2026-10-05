// 권한 세 단계 표(permissions.ts) — 메뉴가 빠짐없이 적혔는가, 쓰기가 접근보다 넓지 않은가, can() 과 어긋나지 않는가.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MENU_GROUPS, ICON_ITEMS, menuAllowed, groupAllowed } from './menu';
import { MENU_PERMS, levels } from './permissions';
import { ROLES, can, type Role } from './roles';

const leaves = () => {
  const out: { id: string; group?: (typeof MENU_GROUPS)[number] }[] = [];
  for (const g of MENU_GROUPS) for (const it of g.items) { if (!it.children) out.push({ id: it.id, group: g }); for (const c of it.children ?? []) out.push({ id: c.id, group: g }); }
  for (const it of ICON_ITEMS) out.push({ id: it.id });
  return out;
};
const find = (id: string) => {
  for (const g of MENU_GROUPS) for (const it of g.items) { if (it.id === id) return { it, g }; const c = it.children?.find((x) => x.id === id); if (c) return { it: c, g }; }
  const ic = ICON_ITEMS.find((x) => x.id === id); return ic ? { it: ic, g: undefined } : null;
};
const L = (id: string, role: Role) => { const f = find(id)!; const access = (!f.g || groupAllowed(role, f.g)) && menuAllowed(role, '', f.it); return levels(id, role, access); };

test('모든 메뉴(끝 메뉴·아이콘)가 권한 표에 적혀 있다', () => {
  for (const l of leaves()) assert.ok(MENU_PERMS[l.id], `권한 표에 없음: ${l.id}`);
});

test('접근이 없으면 이용·쓰기도 없다', () => {
  for (const l of leaves()) for (const r of ROLES) {
    const v = L(l.id, r);
    if (!v.access) assert.deepEqual([v.use, v.write], [false, false], `${l.id}/${r}`);
  }
});

test('can() 과 같은 선 — 청구서 작성·일반조서·발송처리', () => {
  assert.equal(L('wizard', 'team_member').write, '일부: 임시저장만(확정은 팀장 이상)');
  assert.equal(can('team_member', 'finalizeInvoice'), false);
  for (const r of ROLES) {
    const g = L('gwp', r);
    assert.equal(g.write === true, can(r, 'viewAuditPapers'), `gwp/${r}`);
  }
  assert.equal(L('doc-send-work', 'accountant').write, '일부: 발송요청만(처리는 조회)');
  assert.equal(can('accountant', 'processDispatch'), false);
});

test('감사업무관리 — 인당회계사 전부 쓰기, 기장팀은 조회서만', () => {
  for (const id of ['conf-register', 'conf-dispatch', 'conf-collect', 'conf-status', 'dsd', 'gwp']) assert.equal(L(id, 'per_head_accountant').write, true, id);
  assert.equal(L('conf-dispatch', 'team_member').write, true);
  assert.equal(L('dsd', 'team_member').access, false);
});
