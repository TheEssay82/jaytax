// 표가 화면 아래 끝까지 차게 한다.
//
// 왜 필요한가: `.tbl-scroll` 의 높이가 화면마다 **어림값**이었다 — 58vh · 56vh · 62vh ·
// calc(100vh - 250px). 표 위에 무엇이 얼마나 오는지는 화면마다 다른데 상수로 잡아 두니
// 13인치(1366×768)에서 수금·미수금 표 바닥이 창 밖으로 38px 나갔고, **페이지 스크롤과
// 표 스크롤이 둘 다** 생겼다. 표를 굴리려는데 페이지가 먼저 움직이는 그 불편함이다.
//
// 표가 화면 어디쯤에서 시작하는지는 **브라우저만 아는 값**이라 CSS 로는 쓸 수 없다.
// 그래서 재서 넣는다. 건드리는 것은 maxHeight 하나뿐이고, 일부러 낮게 둔 곳은
// `data-fixed-h` 를 붙여 두면 건너뛴다.
import { useLayoutEffect } from 'react';

/** 이보다 작아지면 차라리 페이지를 굴리는 편이 낫다. */
export const MIN = 220;
/** 창 바닥과의 숨 쉴 틈. */
export const GAP = 18;

/**
 * 표에 줄 높이 — 셈만 따로 뺀다(브라우저 없이 검사할 수 있게).
 * `top` 은 문서 맨 위에서 표까지, `viewport` 는 창 높이.
 */
export function heightFor(top: number, viewport: number, gap = GAP, min = MIN): number {
  return Math.max(min, Math.round(viewport - top - gap));
}

/** 같은 값이면 쓰지 않는다 — 쓰면 다시 크기가 바뀌고, 관찰자가 또 불려 맴돈다. */
function set(el: HTMLElement, px: number): void {
  const want = `${Math.max(MIN, Math.round(px))}px`;
  if (el.style.maxHeight !== want) el.style.maxHeight = want;
}

/** 창에 붙어 뜨는 것(모달) 안쪽인가 — 그 안은 페이지 스크롤과 무관해 계산이 어긋난다. */
function inFixed(el: HTMLElement): boolean {
  for (let p: HTMLElement | null = el; p && p !== document.body; p = p.parentElement) {
    if (getComputedStyle(p).position === 'fixed') return true;
  }
  return false;
}

export function fitTableHeights(): void {
  const els = [...document.querySelectorAll<HTMLElement>('.tbl-scroll')]
    .filter((e) => e.dataset.fixedH === undefined && !inFixed(e));
  if (els.length === 0) return;

  const y = window.scrollY;
  for (const el of els) set(el, heightFor(el.getBoundingClientRect().top + y, window.innerHeight));

  // 표 **아래**에 남는 것(카드 안쪽 여백·카드 아래 여백·본문 아래 패딩)은 화면마다 다르고
  // CSS 로는 알 수 없다. 그래서 실제로 얼마나 넘쳤는지를 보고 그만큼 한 번 더 조인다.
  // 다 조이고 나면 넘침이 0 이 되어 더 쓰지 않으므로 맴돌지 않는다.
  const over = document.documentElement.scrollHeight - window.innerHeight;
  if (over > 0) for (const el of els) set(el, el.getBoundingClientRect().height - over);
}

/** 화면이 바뀌거나 내용이 늘고 줄 때마다 다시 잰다. */
export function useFitTableHeights(dep: unknown): void {
  useLayoutEffect(() => {
    fitTableHeights();
    const on = () => fitTableHeights();
    window.addEventListener('resize', on);
    const ro = new ResizeObserver(on);
    ro.observe(document.body);
    return () => { window.removeEventListener('resize', on); ro.disconnect(); };
  }, [dep]);
}
