// 「내 것만 보기」 — 앱 전체가 함께 보는 스위치 하나.
//
// 왜 필요한가: `내 담당만` 토글이 발행요청 두 화면에만 있었다. 매출계약등록·수금미수금·
// 현황및예산조회에는 없어서, 자기 담당만 보려면 화면마다 다르게 걸러야 했다.
//
// **무엇이 「내 것」인지는 화면마다 다르다.** 감사팀 자리는 담당회계사로, taxteam 자리는
// 담당직원으로 갈린다. 그래서 이 자리는 **켜졌는가만** 들고 있고, 누가 내 것인지는
// 각 화면이 정한다.
//
// 켠 것은 그 사람의 그 브라우저에 남는다 — 매번 다시 켜게 하면 아무도 안 쓴다.
import { useSyncExternalStore } from 'react';

const KEY = 'jaytax.mineOnly';

function read(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

let on = read();
const listeners = new Set<() => void>();

export function getMineOnly(): boolean { return on; }

export function setMineOnly(v: boolean): void {
  if (on === v) return;
  on = v;
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* 저장 못 해도 화면은 돈다 */ }
  for (const f of listeners) f();
}

function subscribe(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

/** 화면에서 쓴다. 스위치를 켜고 끄면 모든 화면이 함께 따라온다. */
export function useMineOnly(): boolean {
  return useSyncExternalStore(subscribe, getMineOnly, () => false);
}
