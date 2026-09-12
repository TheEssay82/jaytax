// DSD 본문에서 **주석을 블록(문단·표) 단위로** 읽는다. 목록만 읽는 dsdParse 의 다음 단계다.
//
// 왜 「자리(slot)」를 함께 들고 다니는가: 나중에 엑셀에서 고친 값을 **DSD 의 제자리에 도로
// 넣어야** 하기 때문이다. 원본 XML 을 틀로 두고 글자만 갈아끼우면 표 너비·정렬 같은 속성이
// 하나도 상하지 않는다(2026-09-12 실측 — 읽고 그대로 다시 쓰면 원본과 바이트 단위로 같았다).
import { plain, notesSection, noteHeadings } from './dsdParse';

/** 글자가 든 자리 하나. start/end 는 원본 XML 안의 위치다. */
export interface Slot { start: number; end: number; tag: string; raw: string }

/** 안쪽에 태그가 더 없는 잎사귀 요소 — 여기에만 글자가 있다. */
const LEAF = /<(P|TD|TH|TU)\b([^>]*)>([^<>]*)<\/\1>/g;

export function slots(xml: string): Slot[] {
  const out: Slot[] = [];
  for (const m of (xml ?? '').matchAll(LEAF)) {
    // 글자는 여는 태그 끝과 닫는 태그 사이에 있다. 뒤에서부터 재면 속성 길이와 무관하다.
    const start = m.index! + m[0].length - `</${m[1]}>`.length - m[3].length;
    out.push({ start, end: start + m[3].length, tag: m[1], raw: m[3] });
  }
  return out;
}

export function unescapeXml(s: string): string {
  return (s ?? '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&amp;cr;/g, '\n')
    .replace(/&amp;/g, '&');
}

export function escapeXml(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/\n/g, '&amp;cr;');
}

/**
 * 문단 덩이 하나 = DSD 의 `<P>` 하나.
 *
 * **한 `<P>` 안에 눈에 보이는 문단이 여럿 들어 있다.** 「&cr;&cr;」(빈 줄)로 나뉜다 —
 * 명진 1번 주석은 `<P>` 하나에 네 문단이 들어 있었다. 엑셀에는 칸마다 하나씩 담아야
 * 읽고 고치기 쉬우므로 `parts` 로 갈라 둔다. DSD 로 되돌릴 때는 다시 빈 줄로 잇는다.
 *
 * 홑 「&cr;」는 같은 문단 안의 줄바꿈이라 가르지 않는다(예: 「2.2 측정기준」 다음 줄).
 */
export type Block =
  | { kind: 'para'; slot: number; parts: string[] }
  | { kind: 'table'; rows: { slot: number; text: string }[][] };

/** 한 문단 덩이를 눈에 보이는 문단으로 가른다. */
export function splitParts(text: string): string[] {
  return (text ?? '').split(/\n[ \t]*\n+/).map((t) => t.trim()).filter(Boolean);
}

/** 엑셀에서 고친 문단들을 DSD 한 칸에 도로 담는다 — 가른 것을 그대로 되붙인다. */
export function joinParts(parts: string[]): string {
  return parts.filter((p) => p != null).map((p) => String(p).trim()).filter(Boolean).join('\n\n');
}

export interface NoteBlocks { no: number; title: string; blocks: Block[] }

/** 어느 구간에 속하는지 — 표/행의 범위를 찾는다. */
function owner(pos: number, spans: [number, number][]): number {
  for (let i = 0; i < spans.length; i += 1) {
    if (spans[i][0] <= pos && pos < spans[i][1]) return i;
  }
  return -1;
}

/**
 * 주석 절을 블록으로 가르고, 주석별로 묶는다.
 *
 * 표 안의 글자는 표 블록으로, 표 밖의 <P> 는 문단 블록으로 간다. 주석의 경계는 dsdParse 의
 * 머리글 규칙(번호가 차례로 올라갈 때만)을 그대로 쓴다 — 두 곳이 다르면 ①에서 본 목록과
 * 여기서 만드는 시트가 어긋난다.
 */
export function parseNoteBlocks(xml: string): NoteBlocks[] {
  const s = xml ?? '';
  const sec = notesSection(s);
  if (!sec) return [];
  const a0 = s.indexOf(sec);
  const a1 = a0 + sec.length;

  const tables: [number, number][] = [];
  for (const m of s.matchAll(/<TABLE\b[\s\S]*?<\/TABLE>/g)) {
    const i = m.index!;
    if (i >= a0 && i < a1) tables.push([i, i + m[0].length]);
  }
  const trs: [number, number][] = [];
  for (const m of s.matchAll(/<TR\b[\s\S]*?<\/TR>/g)) {
    const i = m.index!;
    if (i >= a0 && i < a1) trs.push([i, i + m[0].length]);
  }

  // 주석 머리로 쓰이는 문단의 자리 — 목록 규칙과 같은 결과를 쓰려고 제목 문단을 먼저 찾는다.
  const paraSlots: { slot: number; text: string; pos: number }[] = [];
  const all = slots(s);
  all.forEach((sl, i) => {
    if (sl.start < a0 || sl.start >= a1) return;
    if (sl.tag !== 'P') return;
    if (owner(sl.start, tables) !== -1) return;
    paraSlots.push({ slot: i, text: plain(sl.raw), pos: sl.start });
  });
  const heads = noteHeadings(paraSlots.map((p) => p.text));
  const headPos = new Map<number, { no: number; title: string }>();
  let hi = 0;
  for (const p of paraSlots) {
    if (hi >= heads.length) break;
    const m = /^\s*(\d{1,2})\s*\./.exec(p.text);
    if (m && Number(m[1]) === heads[hi].no) {
      headPos.set(p.slot, heads[hi]);
      hi += 1;
    }
  }
  if (!headPos.size) return [];

  const notes: NoteBlocks[] = [];
  let cur: NoteBlocks | null = null;
  let curTbl = -1;
  let curTr = -1;
  let rows: { slot: number; text: string }[][] = [];
  let row: { slot: number; text: string }[] = [];

  const flushTable = () => {
    if (row.length) { rows.push(row); row = []; }
    if (rows.length && cur) cur.blocks.push({ kind: 'table', rows });
    rows = []; curTbl = -1; curTr = -1;
  };

  all.forEach((sl, i) => {
    if (sl.start < a0 || sl.start >= a1) return;
    const t = owner(sl.start, tables);
    const head = headPos.get(i);
    if (head) {
      flushTable();
      cur = { no: head.no, title: head.title, blocks: [] };
      notes.push(cur);
      return;                                   // 머리글 자체는 제목으로 쓰고 본문에 넣지 않는다
    }
    if (!cur) return;                           // 첫 주석 앞의 것(기간·회사명 표)은 버린다
    if (t === -1) {
      flushTable();
      if (sl.tag === 'P') {
        const parts = splitParts(unescapeXml(sl.raw));
        if (parts.length) cur.blocks.push({ kind: 'para', slot: i, parts });
      }
      return;
    }
    if (t !== curTbl) { flushTable(); curTbl = t; curTr = owner(sl.start, trs); }
    const r = owner(sl.start, trs);
    if (r !== curTr) { if (row.length) rows.push(row); row = []; curTr = r; }
    row.push({ slot: i, text: unescapeXml(sl.raw).trim() });
  });
  flushTable();

  return notes;
}
