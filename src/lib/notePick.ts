// ① 이 정한 주석 목록과 작년 DSD 를 맞춰 **시트 배치**를 만든다.
//
// ② 만들기와 ③ 검증이 **반드시 같은 결과**를 내야 한다. ③ 은 「어디에 무엇이 있어야 하는가」를
// 다시 지어내서 엑셀과 대 보는 방식이라, 규칙이 한 줄이라도 다르면 온 자리가 어긋난 것처럼 보인다.
// 그래서 고르는 규칙을 한곳에 둔다.
import type { NoteBlocks } from './dsdBlocks';
import { layoutNote, layoutNewNote, sheetName, type SheetPlan } from './noteSheet';

export interface NoteWant {
  title: string;
  no: number | null;
  enabled: boolean;
}

export interface Picked {
  /** 작년 DSD 에서 찾은 것. 못 찾았으면 null — 새로 넣는 주석이다. */ note: NoteBlocks | null;
  /** ① 에서 정한 제목 */ title: string;
}

/** 켜 둔 주석만, ① 이 정한 제목·차례대로. 제목이 먼저, 없으면 번호로 찾는다. */
export function pickNotes(blocks: NoteBlocks[], want: NoteWant[]): Picked[] {
  const byNo = new Map(blocks.map((b) => [b.no, b]));
  const byTitle = new Map(blocks.map((b) => [b.title.replace(/\s/g, ''), b]));
  return want.filter((x) => x.enabled).map((n) => ({
    note: byTitle.get(n.title.replace(/\s/g, '')) ?? (n.no != null ? byNo.get(n.no) : undefined) ?? null,
    title: n.title,
  }));
}

/** 고른 것을 시트 배치로. 시트 이름은 「N01 회사의 개요」 꼴이고 차례가 곧 주석 번호다. */
export function planNotes(picked: Picked[], roll: boolean): SheetPlan[] {
  const used = new Set<string>();
  return picked.map(({ note, title }, i) => {
    const name = sheetName(`N${String(i + 1).padStart(2, '0')} ${title}`, used);
    return note ? layoutNote({ ...note, title }, name, { roll }) : layoutNewNote(i + 1, title, name);
  });
}
