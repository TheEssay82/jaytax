import { useEffect } from 'react';

// 전역 UX: 숫자(금액) 입력칸에서 '+'(키패드 포함)를 누르면 커서 위치에 '000'을 넣는다.
// 천단위 빠른 입력용. 값이 숫자·콤마로만 이뤄진 칸에서만 동작하므로 이름·비고 등 문자칸은 영향 없다.
// 앱 루트에서 1회 호출.
export function useNumericPlusKey() {
  useEffect(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const SKIP_TYPES = new Set(['password', 'email', 'date', 'month', 'time', 'datetime-local', 'url', 'color', 'file', 'checkbox', 'radio', 'range']);

    function onKey(e: KeyboardEvent) {
      if (e.key !== '+' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (!el || el.tagName !== 'INPUT') return;
      const input = el as HTMLInputElement;
      if (SKIP_TYPES.has((input.type || 'text').toLowerCase()) || input.readOnly || input.disabled) return;
      const v = input.value;
      if (!/^[\d,]+$/.test(v)) return; // 숫자·콤마만(비었거나 문자 포함이면 무시 → 문자칸 보호)
      e.preventDefault();
      const start = input.selectionStart ?? v.length;
      const end = input.selectionEnd ?? start;
      const next = v.slice(0, start) + '000' + v.slice(end);
      // React 제어 컴포넌트에도 반영되도록 네이티브 setter + input 이벤트 디스패치
      if (valueSetter) valueSetter.call(input, next); else input.value = next;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const pos = start + 3;
      requestAnimationFrame(() => { try { input.setSelectionRange(pos, pos); } catch { /* ignore */ } });
    }
    document.addEventListener('keydown', onKey, true); // capture — 기본 '+' 입력 전에 가로챔
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);
}
