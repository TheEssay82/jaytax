// 화면과 화면 사이로 **검색어를 넘기는 자리**.
//
// 왜 필요한가: 「㈜오톰 계약을 보자」 하면 지금까지는 거래처관리 → 매출계약등록 →
// 필터에 입력, 세 동작이었다. Ctrl+K 로 한 번에 가려면 고른 거래처 이름을
// 목적 화면의 검색칸까지 들고 가야 한다.
//
// 화면은 탭을 옮길 때마다 새로 뜨므로(AppShell 의 reloadKey), 뜰 때 한 번 집어 가면 된다.
// **한 번만** 집어 간다 — 남겨 두면 다음에 그 화면에 들어갈 때도 옛 검색어가 걸린다.

let pending: { tab: string; q: string } | null = null;

/** Ctrl+K 에서 목적 화면과 검색어를 걸어 둔다. */
export function setNavQuery(tab: string, q: string): void {
  pending = q ? { tab, q } : null;
}

/** 화면이 뜰 때 제 몫이면 집어 간다(그리고 비운다). */
export function takeNavQuery(tab: string): string {
  if (pending?.tab !== tab) return '';
  const q = pending.q;
  pending = null;
  return q;
}
