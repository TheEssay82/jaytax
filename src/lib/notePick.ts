// ① 이 정한 주석 목록과 작년 DSD 를 맞춰 **시트 배치**를 만든다.
//
// ② 만들기와 ③ 검증이 **반드시 같은 결과**를 내야 한다. ③ 은 「어디에 무엇이 있어야 하는가」를
// 다시 지어내서 엑셀과 대 보는 방식이라, 규칙이 한 줄이라도 다르면 온 자리가 어긋난 것처럼 보인다.
// 그래서 고르는 규칙을 한곳에 둔다.
import type { NoteBlocks } from './dsdBlocks';
import { layoutNote, layoutNewNote, sheetName, shiftPlan, type SheetPlan } from './noteSheet';

export interface NoteWant {
  title: string;
  no: number | null;
  enabled: boolean;
}

export interface Picked {
  /** 작년 DSD 에서 찾은 것. 못 찾았으면 null — 새로 넣는 주석이다. */ note: NoteBlocks | null;
  /** ① 에서 정한 제목 */ title: string;
}

/**
 * 엑셀 **시트 구성** — ① 작업 건을 만들 때 정하고, ② ③ ④ 가 함께 읽는다(사용자 결정 2026-09-14).
 *
 *   sheets — 주석마다 시트 한 장. 「N01 회사의 개요」 꼴. 원래 방식이다.
 *   long   — 주석을 **한 시트에 세로로** 내린다. 시트를 오가지 않고 훑어 내려가며 채우는
 *            사람이 있어 내부 의견으로 나왔다.
 *
 * 왜 작업 건에 두는가: 셋이 각자 고르면 시트 이름과 칸 주소가 어긋나 온통 못 찾았다고 나온다.
 * 「여분 행」과 「주석 목록」도 같은 까닭으로 한곳에서 정한다.
 */
export type SheetLayout = 'sheets' | 'long';

/** 종단형에서 주석이 전부 앉는 시트 이름. */
export const LONG_SHEET = '주석(생성)';
/** 종단형에서 주석 사이에 두는 빈 줄 수. */
export const LONG_GAP = 2;

/** 이 이름이 이 구성의 주석 시트인가 — ③ ④ 가 엑셀에서 어느 시트를 읽을지 정한다. */
export function isNoteSheet(name: string, layout: SheetLayout): boolean {
  return layout === 'long' ? name === LONG_SHEET : /^N\d\d /.test(name);
}

/** 구성을 모르고도 주석 시트인가 — 등록된 옛 엑셀을 읽을 때 쓴다. */
export function isAnyNoteSheet(name: string): boolean {
  return isNoteSheet(name, 'sheets') || isNoteSheet(name, 'long');
}

export const LAYOUT_LABEL: Record<SheetLayout, string> = {
  sheets: '주석별 시트',
  long: '한 시트 종단형',
};

/** 켜 둔 주석만, ① 이 정한 제목·차례대로. 제목이 먼저, 없으면 번호로 찾는다. */
export function pickNotes(blocks: NoteBlocks[], want: NoteWant[]): Picked[] {
  const byNo = new Map(blocks.map((b) => [b.no, b]));
  const byTitle = new Map(blocks.map((b) => [b.title.replace(/\s/g, ''), b]));
  return want.filter((x) => x.enabled).map((n) => ({
    note: byTitle.get(n.title.replace(/\s/g, '')) ?? (n.no != null ? byNo.get(n.no) : undefined) ?? null,
    title: n.title,
  }));
}

/**
 * 파일에 든 주석을 **전부** - 다 적힌 DSD 를 그대로 검증할 때 쓴다.
 *
 * ① 의 목록으로 거르지 않는 까닭: 검증 대상이 **그 파일**이지 우리가 세운 계획이 아니다.
 * 남이 지어 준 주석이나 초도감사 보고서는 ① 에 목록이 아직 없을 수도 있다.
 */
export function pickAll(blocks: NoteBlocks[]): Picked[] {
  return blocks.map((b) => ({ note: b, title: b.title }));
}

/**
 * 고른 것을 시트 배치로. 시트 이름은 「N01 회사의 개요」 꼴이고 차례가 곧 주석 번호다.
 *
 * `spare` 는 표마다 깔아 둘 **여분 행** 수다. ② ③ ④ 가 **반드시 같은 값**을 써야 한다 —
 * 여분 행은 아래 행을 밀어내므로, 하나만 달라도 그 표 아래가 통째로 어긋난다.
 *
 * `layout` 이 종단형이면 **주석마다의 배치를 그대로 두고 행만 아래로 민다.** 시트 이름은
 * 모두 `LONG_SHEET` 가 된다. 배치 하나가 주석 하나라는 것은 변하지 않는다 — ③ 이 주석마다
 * 보고하고 ④ 가 주석마다 되돌리는 규칙이 그대로 살아 있어야 하기 때문이다. 시트 XML 로 만들
 * 때만 `sheetsToInject` 로 같은 이름끼리 합친다.
 */
export function planNotes(picked: Picked[], roll: boolean, spare = 0, layout: SheetLayout = 'sheets'): SheetPlan[] {
  const used = new Set<string>();
  const plans = picked.map(({ note, title }, i) => {
    const name = sheetName(`N${String(i + 1).padStart(2, '0')} ${title}`, used);
    return note ? layoutNote({ ...note, title }, name, { roll, spare }) : layoutNewNote(i + 1, title, name);
  });
  if (layout !== 'long') return plans;
  let base = 0;
  return plans.map((p) => {
    const out = shiftPlan(p, base, LONG_SHEET);
    base = out.lastRow + LONG_GAP;
    return out;
  });
}

/**
 * 시트 XML 로 만들 배치 — **같은 이름은 한 장으로** 합친다.
 *
 * 종단형은 주석 열여덟 개가 한 시트를 나눠 쓴다. 따로 넣으면 「주석(생성)(2)」처럼 이름이
 * 붙어 열여덟 장이 된다. 주석별 시트 구성에서는 그대로 돌려준다.
 */
export function sheetsToInject(plans: SheetPlan[]): SheetPlan[] {
  const by = new Map<string, SheetPlan>();
  for (const p of plans) {
    const had = by.get(p.name);
    if (!had) { by.set(p.name, { ...p }); continue; }
    by.set(p.name, {
      name: p.name,
      cells: [...had.cells, ...p.cells],
      merges: [...(had.merges ?? []), ...(p.merges ?? [])],
      lastRow: Math.max(had.lastRow, p.lastRow),
      tables: [...(had.tables ?? []), ...(p.tables ?? [])],
      back: [...(had.back ?? []), ...(p.back ?? [])],
      spares: [...(had.spares ?? []), ...(p.spares ?? [])],
      drops: [...(had.drops ?? []), ...(p.drops ?? [])],
    });
  }
  return [...by.values()];
}
