// 담당직원 판정 규칙. **2026-09-03 에 실제로 사고가 난 자리**라 촘촘히 못박는다.
//
//   증상: 「사업장에 담당이 2명」이라 읽고 불일치 8건을 만들어 냈다. 앱은 1명만 보고 있었다.
//   원인: 점검 SQL 이 **active 조건을 빠뜨렸다**. biz_place_staff 는 이력 테이블이라
//         해제된 담당이 active=false 로 남아 있다.
//   대가: 그 '2명'을 정리한다며 이력 6줄을 지웠다. 되돌릴 수 없었다.
//
// 그래서 첫 테스트가 active 다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  staffActiveOn, buildStaffIndex, resolveStaff, staffMismatch,
  type ContractStaffRow, type PlaceRef, type PlaceStaffRow,
} from './contractStaff';

const cs = (name: string, p: Partial<ContractStaffRow> = {}): ContractStaffRow =>
  ({ staffId: `id-${name}`, staffName: name, active: true, fromMonth: null, toMonth: null, ...p });

const place = (id: string, entityId: string, hq = false): PlaceRef =>
  ({ id, entityId, isHeadquarters: hq });

const ps = (placeId: string, name: string, active = true): PlaceStaffRow =>
  ({ placeId, staffId: `id-${name}`, staffName: name, active });

const names = (r: { staff: { staffName: string }[] }) => r.staff.map((s) => s.staffName);

// ── active — 사고가 난 자리 ─────────────────────────────

test('해제된 사업장 담당(active=false)은 세지 않는다 — 이력이지 현재가 아니다', () => {
  const idx = buildStaffIndex([place('p1', 'e1', true)], [ps('p1', '김민섭'), ps('p1', '김동주', false)]);
  const r = resolveStaff({ entityId: 'e1', placeId: null, staff: [] }, idx, '2026-09');
  assert.deepEqual(names(r), ['김민섭'], '해제된 김동주가 섞이면 매출이 반으로 쪼개진다');
  assert.equal(r.inherited, true);
});

test('해제된 계약 담당(active=false)도 세지 않는다', () => {
  const idx = buildStaffIndex([], []);
  const r = resolveStaff({ entityId: 'e1', placeId: null, staff: [cs('정남지', { active: false })] }, idx, '2026-09');
  assert.deepEqual(names(r), []);
});

test('active 를 안 주면 유효한 것으로 본다 — 옛 자료에 컬럼이 없을 수 있다', () => {
  const idx = buildStaffIndex([place('p1', 'e1')], [{ placeId: 'p1', staffId: 'x', staffName: '김민섭' }]);
  assert.deepEqual(names(resolveStaff({ entityId: 'e1', placeId: null, staff: [] }, idx, '2026-09')), ['김민섭']);
});

// ── 계약이 사업장을 이긴다 ──────────────────────────────

test('계약에 담당이 있으면 사업장은 보지 않는다', () => {
  const idx = buildStaffIndex([place('p1', 'e1', true)], [ps('p1', '김동주')]);
  const r = resolveStaff({ entityId: 'e1', placeId: 'p1', staff: [cs('정남지')] }, idx, '2026-09');
  assert.deepEqual(names(r), ['정남지']);
  assert.equal(r.inherited, false, '상속이 아니라 계약에 직접 적힌 것');
});

test('계약 담당이 그 달에 끝났으면 사업장에서 물려받는다', () => {
  const idx = buildStaffIndex([place('p1', 'e1', true)], [ps('p1', '김동주')]);
  const ended = { entityId: 'e1', placeId: 'p1', staff: [cs('정남지', { toMonth: '2026-06-01' })] };
  assert.deepEqual(names(resolveStaff(ended, idx, '2026-09')), ['김동주']);
  assert.deepEqual(names(resolveStaff(ended, idx, '2026-05')), ['정남지'], '끝나기 전 달은 그대로');
});

// ── 상속 순서 ───────────────────────────────────────────

test('계약에 달린 사업장이 본사보다 먼저다', () => {
  const idx = buildStaffIndex(
    [place('hq', 'e1', true), place('br', 'e1')],
    [ps('hq', '김동주'), ps('br', '김민섭')]);
  assert.deepEqual(names(resolveStaff({ entityId: 'e1', placeId: 'br', staff: [] }, idx, '2026-09')), ['김민섭']);
});

test('계약에 사업장이 없으면 본사부터 — 등록 순서와 무관하다', () => {
  const idx = buildStaffIndex(
    [place('br', 'e1'), place('hq', 'e1', true)],   // 지점이 먼저 들어와도
    [ps('br', '김민섭'), ps('hq', '김동주')]);
  assert.deepEqual(names(resolveStaff({ entityId: 'e1', placeId: null, staff: [] }, idx, '2026-09')), ['김동주']);
});

test('담당이 있는 첫 사업장 하나만 쓴다 — 여러 사업장을 합치지 않는다', () => {
  const idx = buildStaffIndex(
    [place('hq', 'e1', true), place('br', 'e1')],
    [ps('hq', '김동주'), ps('br', '김민섭')]);
  const r = resolveStaff({ entityId: 'e1', placeId: null, staff: [] }, idx, '2026-09');
  assert.deepEqual(names(r), ['김동주'], '합치면 한 거래처 매출이 사람 수만큼 쪼개진다');
});

test('본사에 담당이 없으면 다음 사업장으로 넘어간다', () => {
  const idx = buildStaffIndex([place('hq', 'e1', true), place('br', 'e1')], [ps('br', '김민섭')]);
  assert.deepEqual(names(resolveStaff({ entityId: 'e1', placeId: null, staff: [] }, idx, '2026-09')), ['김민섭']);
});

test('아무 데도 담당이 없으면 빈 목록 — (미지정)으로 잡힌다', () => {
  const idx = buildStaffIndex([place('p1', 'e1', true)], []);
  assert.deepEqual(names(resolveStaff({ entityId: 'e1', placeId: 'p1', staff: [] }, idx, '2026-09')), []);
});

test('한 사업장에 둘이면 둘 다 — 실제로 나눠 맡는 경우다', () => {
  const idx = buildStaffIndex([place('p1', 'e1', true)], [ps('p1', '김동주'), ps('p1', '김민섭')]);
  assert.deepEqual(names(resolveStaff({ entityId: 'e1', placeId: null, staff: [] }, idx, '2026-09')), ['김동주', '김민섭']);
});

// ── 기간 판정 ───────────────────────────────────────────

test('담당 기간 경계 — 시작월·종료월은 포함이다', () => {
  const s = cs('김민섭', { fromMonth: '2026-07-01', toMonth: '2026-09-01' });
  assert.equal(staffActiveOn(s, '2026-06'), false);
  assert.equal(staffActiveOn(s, '2026-07'), true);
  assert.equal(staffActiveOn(s, '2026-09'), true);
  assert.equal(staffActiveOn(s, '2026-10'), false);
});

// ── 불일치 판정 ─────────────────────────────────────────

test('같은 사람들이면 순서가 달라도 일치', () => {
  assert.equal(staffMismatch(['김동주', '김민섭'], ['김민섭', '김동주']), false);
});

test('한 명 대 두 명은 불일치 — 파트리지·린치핀이 이 모양이었다', () => {
  assert.equal(staffMismatch(['김동주', '송현주'], ['김동주']), true);
});

test('아예 다른 사람이면 불일치', () => {
  assert.equal(staffMismatch(['송현주'], ['김민섭']), true);
});

test('한쪽이 비면 불일치로 보지 않는다 — 감사팀은 담당직원 개념이 없다', () => {
  assert.equal(staffMismatch([], ['김민섭']), false);
  assert.equal(staffMismatch(['김민섭'], []), false);
  assert.equal(staffMismatch([], []), false);
});

test('빈 이름은 걸러낸다 — 쉼표로 자른 찌꺼기가 불일치를 만들면 안 된다', () => {
  assert.equal(staffMismatch(['김민섭', ''], ['김민섭']), false);
});
