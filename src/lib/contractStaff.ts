// 「이 계약의 담당직원은 누구인가」 — 그 규칙 **한 곳**. supabase 를 물지 않는다(테스트가 돌아야 하므로).
//
// 규칙이 listSalesContracts 안에 흩어져 있던 탓에 2026-09-03 에 실제로 사고가 났다.
// 점검 SQL 이 **active 조건을 빠뜨려** 「사업장에 담당이 2명」이라고 잘못 읽었고,
// 앱은 처음부터 1명만 보고 있었는데 있지도 않은 불일치 8건을 만들어 냈다.
// 그러다 이력(active=false) 6줄을 지웠다 — 되돌릴 수 없었다.
//
// 그래서 규칙을 여기 모으고 테스트로 못박는다. **다시 셀 일이 있으면 SQL 을 새로 짜지 말고
// 이 함수를 쓴다.**

/** 계약에 직접 붙은 담당 한 줄(이력 포함). */
export interface ContractStaffRow {
  staffId: string;
  staffName: string;
  /** false = 해제된 이력. **세지 않는다.** */
  active: boolean;
  /** 담당 시작 귀속월(YYYY-MM-01). null=처음부터 */
  fromMonth: string | null;
  /** 담당 종료 귀속월(YYYY-MM-01, 포함). null=현재까지 */
  toMonth: string | null;
}

/** 사업장에 붙은 담당 한 줄. biz_place_staff 는 **이력 테이블**이다(해제는 active=false). */
export interface PlaceStaffRow {
  placeId: string;
  staffId: string;
  staffName: string;
  /** false = 해제된 이력. **세지 않는다.** */
  active?: boolean;
}

export interface PlaceRef {
  id: string;
  entityId: string;
  isHeadquarters: boolean;
}

export interface StaffRef { staffId: string; staffName: string }

/**
 * 그 달(YYYY-MM)에 유효한 담당인가.
 * `active=false` 는 **해제된 이력**이라 어느 달에도 유효하지 않다.
 */
export function staffActiveOn(s: ContractStaffRow, month: string): boolean {
  if (!s.active) return false;
  const m = `${month}-01`;
  if (s.fromMonth && s.fromMonth > m) return false;
  if (s.toMonth && s.toMonth < m) return false;
  return true;
}

/** 사업장 담당을 place 별로 모은 색인. **active 인 것만** 담는다. */
export interface StaffIndex {
  staffByPlace: Map<string, StaffRef[]>;
  /** 거래처 → 사업장 id (본사가 앞) */
  placesOfEntity: Map<string, string[]>;
}

export function buildStaffIndex(places: PlaceRef[], placeStaff: PlaceStaffRow[]): StaffIndex {
  const staffByPlace = new Map<string, StaffRef[]>();
  for (const r of placeStaff) {
    if (r.active === false) continue;              // 해제된 이력은 세지 않는다
    const list = staffByPlace.get(r.placeId) ?? [];
    list.push({ staffId: r.staffId, staffName: r.staffName });
    staffByPlace.set(r.placeId, list);
  }
  const placesOfEntity = new Map<string, string[]>();
  for (const p of places) {
    const list = placesOfEntity.get(p.entityId) ?? [];
    if (p.isHeadquarters) list.unshift(p.id); else list.push(p.id);
    placesOfEntity.set(p.entityId, list);
  }
  return { staffByPlace, placesOfEntity };
}

export interface ResolvedStaff {
  staff: StaffRef[];
  /** 계약에 직접 없어 사업장에서 물려받았는가. */
  inherited: boolean;
}

/**
 * 이 계약의 **현재 담당직원**.
 *
 *   ① 계약에 직접 붙은 담당 중 그 달에 유효한 것 — 있으면 그것으로 끝(계약이 사업장을 이긴다)
 *   ② 없으면 사업장에서 물려받는다: **계약에 달린 사업장 → 본사 → 나머지** 순으로
 *      담당이 있는 **첫 사업장 하나**를 통째로 쓴다(여러 사업장을 합치지 않는다)
 *
 * 어느 경로든 `active=false` 는 세지 않는다.
 */
export function resolveStaff(
  c: { entityId: string; placeId: string | null; staff: ContractStaffRow[] },
  index: StaffIndex,
  month: string,
): ResolvedStaff {
  const current = c.staff.filter((s) => staffActiveOn(s, month));
  if (current.length) {
    return { staff: current.map((s) => ({ staffId: s.staffId, staffName: s.staffName })), inherited: false };
  }
  const ofEntity = index.placesOfEntity.get(c.entityId) ?? [];
  const order = c.placeId ? [c.placeId, ...ofEntity] : ofEntity;
  for (const pid of order) {
    const hit = index.staffByPlace.get(pid);
    if (hit?.length) return { staff: hit, inherited: true };
  }
  return { staff: [], inherited: false };
}

/**
 * 계약 담당과 청구 담당이 어긋나는가 — **이름 집합**으로만 본다(순서·중복 무시).
 *
 * 어긋남이 늘 오류는 아니다. 청구는 그때의 담당을 굳혀 둔 기록이라, 그 뒤에 담당이 바뀌면
 * 당연히 달라진다. 다만 **바뀐 적 없는데 다른** 것은 예산·성과 숫자를 기준마다 흔들리게 한다.
 * 한쪽이 비어 있으면(감사팀처럼 담당직원 개념이 없는 경우) 어긋남으로 보지 않는다.
 */
export function staffMismatch(contractStaff: string[], requestStaff: string[]): boolean {
  const a = new Set(contractStaff.filter(Boolean));
  const b = new Set(requestStaff.filter(Boolean));
  if (!a.size || !b.size) return false;
  if (a.size !== b.size) return true;
  for (const x of a) if (!b.has(x)) return true;
  return false;
}
