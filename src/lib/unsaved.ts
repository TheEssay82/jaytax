// 「저장 안 한 것이 있다」를 앱 전체가 함께 아는 자리.
//
// 왜 필요한가: 매출계약 폼에 반쯤 입력하고 다른 메뉴를 누르면 **말없이 사라졌다.**
// 화면을 옮기는 일은 AppShell 이 하고, 무엇을 고치는 중인지는 각 폼만 안다.
// 그 둘을 잇는다.
//
// 폼이 떠 있다고 다 세지 않는다 — **손을 댄 것만** 센다. 열어만 보고 나가는 것까지
// 붙잡으면 경고가 잦아져 아무도 안 읽게 된다.
import { useEffect } from 'react';

const marks = new Map<string, string>();   // id → 사람이 읽을 이름
const listeners = new Set<() => void>();

function notify() { for (const f of listeners) f(); }

export function markUnsaved(id: string, label: string): void {
  if (marks.get(id) === label) return;
  marks.set(id, label);
  notify();
}
export function clearUnsaved(id: string): void {
  if (marks.delete(id)) notify();
}
/** 지금 저장 안 한 것들의 이름. 비었으면 나가도 된다. */
export function unsavedLabels(): string[] {
  return [...new Set(marks.values())];
}
export function onUnsavedChange(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

/**
 * 폼에서 쓴다. `dirty` 가 true 인 동안만 표시하고, 화면이 사라질 때 스스로 지운다.
 * 지우지 않으면 이미 없는 폼 때문에 영영 못 나가게 된다.
 */
export function useUnsaved(id: string, dirty: boolean, label: string): void {
  useEffect(() => {
    if (dirty) markUnsaved(id, label); else clearUnsaved(id);
  }, [id, dirty, label]);
  useEffect(() => () => clearUnsaved(id), [id]);
}

/** 브라우저를 닫거나 새로고침할 때도 묻는다. */
export function useBeforeUnloadGuard(): void {
  useEffect(() => {
    const on = (e: BeforeUnloadEvent) => {
      if (unsavedLabels().length === 0) return;
      e.preventDefault();
      e.returnValue = '';       // 브라우저 기본 문구가 뜬다(문구는 못 바꾼다)
    };
    window.addEventListener('beforeunload', on);
    return () => window.removeEventListener('beforeunload', on);
  }, []);
}
