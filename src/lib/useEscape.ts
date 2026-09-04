// 창을 ESC 로 닫는다.
//
// 왜 필요한가: 창이 스물 몇 개인데 ESC 로 닫히는 것은 **어디서든 찾기(Ctrl+K)** 하나뿐이었다.
// 나머지는 「닫기」 단추를 눈으로 찾아 눌러야 했다. 바깥을 눌러도 닫히지만, 창이 크면
// 바깥이 안 보인다.
//
// **가장 나중에 뜬 창만** 닫는다. 창 위에 창이 뜬 자리(제안 → 발행요청)에서 ESC 한 번에
// 둘 다 닫히면 하던 일을 통째로 잃는다.
import { useEffect } from 'react';

/** 지금 떠 있는 창들. 마지막이 맨 위. */
const stack: symbol[] = [];

export function useEscape(onClose: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    const me = Symbol('modal');
    stack.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (stack[stack.length - 1] !== me) return;   // 내 위에 다른 창이 있다
      e.stopPropagation();
      onClose();
    };
    // capture 로 받는다 — 창 안의 입력칸이 ESC 를 먼저 삼키지 않게.
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      const i = stack.indexOf(me);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [onClose, active]);
}
