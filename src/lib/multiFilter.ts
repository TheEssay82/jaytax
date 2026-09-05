// 여럿 고르기 · 특정 값 빼기 — 엑셀 피벗의 체크박스 필터와 같은 규칙.
//
// 왜 필요한가: 지금까지는 필터가 **값 하나**여서 「전체」 아니면 「정우철만」이었다.
// 엑셀에서 늘 하시는 「모두 켠 뒤 정우철만 끄기」가 안 됐다(2026-09-06 지시).
//
// 담는 방법: 고른 값들의 **묶음**과 「이것을 빼는가 넣는가」 한 가지.
//  · mode='include' → 묶음에 든 것만 보인다(비어 있으면 전체).
//  · mode='exclude' → 묶음에 든 것만 뺀다.
// 「전체 켜고 하나만 끄기」는 exclude 로 담아야 **나중에 값이 늘어도 저절로 포함**된다 —
// include 로 담으면 새 담당자가 생겼을 때 조용히 빠진다.

export type FilterMode = 'include' | 'exclude';

export interface MultiFilter {
  mode: FilterMode;
  /** 고른 값들. 비어 있으면 거르지 않는다. */
  picked: string[];
}

export const EMPTY_FILTER: MultiFilter = { mode: 'include', picked: [] };

/** 거르는 것이 없는가 — 화면에서 「전체」로 보일지 정한다. */
export function isAll(f: MultiFilter): boolean {
  return f.picked.length === 0;
}

/** 이 값이 필터를 통과하는가. */
export function passes(f: MultiFilter, value: string): boolean {
  if (isAll(f)) return true;
  const has = f.picked.includes(value);
  return f.mode === 'exclude' ? !has : has;
}

/**
 * 여러 값 중 하나라도 통과하면 통과(담당직원처럼 한 건에 여럿이 붙는 자리).
 * 값이 하나도 없으면 「(미지정)」 한 건으로 보고 판단한다 — 조용히 빠지면 합계가 어긋난다.
 */
export function passesAny(f: MultiFilter, values: string[]): boolean {
  if (isAll(f)) return true;
  const vs = values.length ? values : [''];
  return vs.some((v) => passes(f, v));
}

/** 값 하나를 켜고 끈다. */
export function toggle(f: MultiFilter, value: string): MultiFilter {
  const has = f.picked.includes(value);
  return { ...f, picked: has ? f.picked.filter((v) => v !== value) : [...f.picked, value] };
}

/** 화면에 적을 한 줄 — 「전체」·「정우철 외 1」·「정우철 제외」. */
export function label(f: MultiFilter, allCount: number): string {
  if (isAll(f)) return '전체';
  const head = f.picked[0] || '(빈 값)';
  const rest = f.picked.length - 1;
  const body = rest > 0 ? `${head} 외 ${rest}` : head;
  if (f.mode === 'exclude') return `${body} 제외`;
  // 다 고른 것과 전체는 같다 — 굳이 「외 N」으로 적지 않는다.
  return f.picked.length === allCount ? '전체' : body;
}

/** 지금 실제로 보이는 값들 — 「전체 켜고 하나 끄기」를 화면 체크 상태로 옮길 때 쓴다. */
export function selectedSet(f: MultiFilter, all: string[]): Set<string> {
  if (isAll(f)) return new Set(all);
  return f.mode === 'exclude'
    ? new Set(all.filter((v) => !f.picked.includes(v)))
    : new Set(f.picked.filter((v) => all.includes(v)));
}

/**
 * 화면의 체크 상태를 필터로 되돌린다.
 * **적게 적히는 쪽**을 고른다 — 하나만 끈 것은 exclude 로, 하나만 켠 것은 include 로.
 * 그래야 나중에 값이 늘었을 때 「전체에서 하나 뺀 것」이 그대로 유지된다.
 */
export function fromSelection(selected: Set<string>, all: string[]): MultiFilter {
  const on = all.filter((v) => selected.has(v));
  if (on.length === all.length) return EMPTY_FILTER;              // 전부 켜짐 = 전체
  const off = all.filter((v) => !selected.has(v));
  return off.length < on.length
    ? { mode: 'exclude', picked: off }
    : { mode: 'include', picked: on };
}
