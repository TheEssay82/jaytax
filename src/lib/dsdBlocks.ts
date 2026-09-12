// DSD 본문에서 **주석을 블록(문단·표) 단위로** 읽는다. 목록만 읽는 dsdParse 의 다음 단계다.
//
// 왜 「자리(slot)」를 함께 들고 다니는가: 나중에 엑셀에서 고친 값을 **DSD 의 제자리에 도로
// 넣어야** 하기 때문이다. 원본 XML 을 틀로 두고 글자만 갈아끼우면 표 너비·정렬 같은 속성이
// 하나도 상하지 않는다(2026-09-12 실측 — 읽고 그대로 다시 쓰면 원본과 바이트 단위로 같았다).
import {
  notesSection, noteHeadings, headingCandidate,
  unescapeXml, escapeXml, splitParts, joinParts,
} from './dsdParse';

// 글 다루는 공용 함수는 dsdParse 에 모여 있다. 여기서도 쓸 수 있게 그대로 내보낸다.
export { unescapeXml, escapeXml, splitParts, joinParts };

/** 글자가 든 자리 하나. start/end 는 원본 XML 안의 위치다. */
export interface Slot { start: number; end: number; tag: string; raw: string; attrs: string }

/** 안쪽에 태그가 더 없는 잎사귀 요소 — 여기에만 글자가 있다. */
const CELL_RE = /<(T[DH])\b([^>]*)>[\s\S]*?<\/\1>/g;

const LEAF = /<(P|TD|TH|TU)\b([^>]*)>([^<>]*)<\/\1>/g;

export function slots(xml: string): Slot[] {
  const out: Slot[] = [];
  for (const m of (xml ?? '').matchAll(LEAF)) {
    // 글자는 여는 태그 끝과 닫는 태그 사이에 있다. 뒤에서부터 재면 속성 길이와 무관하다.
    const start = m.index! + m[0].length - `</${m[1]}>`.length - m[3].length;
    out.push({ start, end: start + m[3].length, tag: m[1], raw: m[3], attrs: m[2] });
  }
  return out;
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
  | { kind: 'para'; slot: number; parts: string[]; lead?: string }
  | {
    kind: 'table';
    rows: TableCell[][];
    /** 이 표에 적용되는 표시 단위(천원·원·주 …). 앞선 「(단위: …)」 표에서 온다. */
    unit?: string;
    /** 이 표 자체가 「(단위: …)」 표지판인가. */
    isUnitMark?: boolean;
    /** 이 표가 당기 자료인가 전기 자료인가 — 「<당기>」 표지판에서 온다. */
    period?: '당기' | '전기';
  };

/**
 * 표의 칸 하나. `tag` 가 TH 면 표 머리다 — 엑셀에서 음영을 줄 자리다.
 *
 * `col` 은 **격자에서의 열 번호**다. 칸 순서가 아니다 — DSD 표는 COLSPAN·ROWSPAN 을 쓰므로
 * 「세 번째 칸」이 「세 번째 열」이 아니다. 명진 5. 재고자산이 그랬다(2026-09-13):
 *   구 분(ROWSPAN 2) │ 총보유면적(COLSPAN 2) │ 당기(COLSPAN 2) │ 전기(COLSPAN 2)
 * 칸 순서로 보면 당기가 세 번째지만 실제 열은 4~5 다. 그걸 모르고 이월하면 값이 옆으로 샌다.
 */
export interface TableCell {
  slot: number; text: string; tag: string;
  col: number; colspan: number; rowspan: number;
  /** 한 칸에 `<P>` 가 여럿일 때의 나머지 자리 — 되돌릴 때 다 찾아가야 한다. */
  extra?: number[];
}

function attrNum(attrs: string, name: string): number {
  const m = new RegExp(`${name}="(\\d+)"`, 'i').exec(attrs ?? '');
  const v = m ? Number(m[1]) : 1;
  return Number.isFinite(v) && v >= 1 ? v : 1;
}

/**
 * 칸마다 격자 열 번호를 매긴다. 앞 줄에서 내려온 ROWSPAN 자리는 건너뛴다.
 */
export function assignGrid(rows: TableCell[][]): void {
  const held = new Map<number, number>();          // 열 → 남은 줄 수
  for (const line of rows) {
    let c = 0;
    for (const cell of line) {
      while ((held.get(c) ?? 0) > 0) c += 1;
      cell.col = c;
      for (let k = 0; k < cell.colspan; k += 1) {
        if (cell.rowspan > 1) held.set(c + k, cell.rowspan);
      }
      c += cell.colspan;
    }
    for (const [k, v] of [...held]) {
      if (v <= 1) held.delete(k);
      else held.set(k, v - 1);
    }
  }
}

/** 표의 열 개수 — 가장 오른쪽 칸이 끝나는 자리. */
export function gridWidth(rows: TableCell[][]): number {
  let w = 0;
  for (const line of rows) for (const c of line) w = Math.max(w, c.col + c.colspan);
  return w;
}

/**
 * 제목 글자들을 앞에서 소비하고 **남은 글**을 돌려준다. 못 맞추면 null.
 *
 * 제목은 공백을 다듬은 것이라 원문과 띄어쓰기가 다르다(「자    본」 → 「자 본」).
 * 그래서 공백은 건너뛰며 글자만 맞춰 본다.
 */
export function afterTitle(text: string, title: string): string | null {
  let i = 0;
  let j = 0;
  const t = text ?? '';
  const h = title ?? '';
  while (j < h.length) {
    if (/\s/.test(h[j])) { j += 1; continue; }
    while (i < t.length && /\s/.test(t[i])) i += 1;
    if (t[i] !== h[j]) return null;
    i += 1; j += 1;
  }
  return t.slice(i);
}

/**
 * 머리글 문단에서 **제목과 본문을 가른다.**
 *
 * 왜 필요한가: DSD 는 제목과 본문을 한 칸에 같이 담는다(2026-09-13 지적).
 *   `<P>4. 사용이 제한된 예금 등&cr;&cr;보고기간종료일 현재 … 없습니다.</P>`
 * 제목만 떼고 나머지를 버리면 **서술이 통째로 사라진다.** 실제로 명진 4·8·9·11번 주석의
 * 서술이 그렇게 빠졌다.
 *
 * 빈 줄로 나뉜 경우와, 「3. 유의적인 회계정책 당사가 …」처럼 한 덩이에 붙은 경우를 모두 본다.
 * `lead` 는 원문에 적힌 제목 부분 그대로다 — DSD 로 되돌릴 때 앞에 도로 붙인다.
 */
export function headingBody(text: string, title: string): { lead: string; body: string[] } {
  const parts = splitParts(text);
  if (!parts.length) return { lead: (text ?? '').trim(), body: [] };
  const first = parts[0];
  const rest = parts.slice(1);

  const m = /^\s*\d{1,2}\s*\.\s*/.exec(first);
  if (m) {
    const tail = afterTitle(first.slice(m[0].length), title);
    if (tail != null && tail.trim()) {
      return { lead: first.slice(0, first.length - tail.length).trimEnd(), body: [tail.trim(), ...rest] };
    }
  }
  return { lead: first, body: rest };
}

export interface NoteBlocks { no: number; title: string; blocks: Block[] }

/**
 * 표지판에 적힌 **기간**. 「<당기>」·「(전기)」처럼 표 위에 놓인다.
 *
 * 알티스트 N10 퇴직급여가 그렇다 — 같은 표를 「<당기>」와 「<전기>」로 두 벌 둔다.
 * 이월할 때 어느 표를 비우고 어느 표에 옮겨 담을지 가르는 열쇠다.
 */
export function periodMark(rows: TableCell[][]): '당기' | '전기' | null {
  const flat = rows.flat().map((c) => c.text).join(' ');
  if (flat.length > 40) return null;
  if (/[<〈(（[]\s*당\s*기\s*[>〉)）\]]/.test(flat)) return '당기';
  if (/[<〈(（[]\s*전\s*기\s*[>〉)）\]]/.test(flat)) return '전기';
  return null;
}

/** 「(단위: 천원)」 표지판이면 그 단위를, 아니면 null. */
const UNIT_MARK = /\(\s*단\s*위\s*[:：]?\s*([^)]{1,30})\)/;
/**
 * 문단 하나가 기간 표지판인가 — 「1) 당기」·「② 전기말」·「(2) 전기」.
 *
 * 「<당기>」 처럼 표로 적는 회사도 있고 문단으로 적는 회사도 있다. 넵튠 FY25 는 문단이
 * 28곳이다(2026-09-13 실측). 놓치면 전기 표가 당기 표에서 값을 못 받아, 이월할 때
 * 작년 값이 통째로 지워진다.
 *
 * 「(1) 당기법인세」처럼 뒤에 말이 더 붙으면 표지판이 아니다 — 딱 기간만 있을 때다.
 */
const PERIOD_PARA =
  /^\s*(?:[([]?\s*\d{1,2}\s*[).\]]|[\u2460-\u246E\u3260-\u327B\u24DB]|[-·▪])?\s*[<〈([]?\s*(당기|전기|당분기|전분기)(?:말)?\s*[>〉)\]]?\s*$/;
export function periodPara(text: string): '당기' | '전기' | null {
  const m = PERIOD_PARA.exec((text ?? '').replace(/\u00a0/g, ' '));
  if (!m) return null;
  return m[1].startsWith('당') ? '당기' : '전기';
}

export function unitMark(rows: TableCell[][]): string | null {
  const flat = rows.flat().map((c) => c.text).join(' ').trim();
  const m = UNIT_MARK.exec(flat);
  if (!m) return null;
  // 표지판은 그 말 말고는 거의 비어 있다. 알티스트처럼 「<당기>」가 같은 줄에 오기도 하므로
  // 짧은 나머지는 봐준다. 긴 문장 안에 든 「(단위: 천원)」은 표지판이 아니다.
  const rest = flat.replace(m[0], '').replace(/\s+/g, '').trim();
  if (rest.length > 12) return null;
  return m[1].replace(/\s+/g, '');
}

/**
 * 표마다 **표시 단위**를 매긴다.
 *
 * 단위는 회사가 아니라 **표마다** 붙는다(2026-09-12 실측) — 알티스트 FY25 한 부 안에
 * 「천원」 41개와 「원」 7개가 섞여 있었다. DSD 는 「(단위: 천원)」을 한 칸짜리 작은 표로
 * 데이터 표 바로 앞에 둔다. 그 표지판을 만나면 그 뒤 표들의 단위로 삼는다.
 *
 * 주석이 바뀌면 초기화한다 — 앞 주석의 단위가 뒤로 새면 ③ 대조에서 천 배가 어긋난다.
 */
function markUnits(notes: NoteBlocks[]): void {
  for (const n of notes) {
    let cur: string | undefined;
    let per: '당기' | '전기' | undefined;
    for (const b of n.blocks) {
      if (b.kind === 'para') {
        // 표 바로 앞 문단이 「1) 당기」 하나뿐이면 그것이 표지판이다.
        const p = periodPara(b.parts[b.parts.length - 1] ?? '');
        if (p) per = p;
        continue;
      }
      if (b.kind !== 'table') continue;
      const u = unitMark(b.rows);
      const p = periodMark(b.rows);
      if (u || p) {
        if (u) { cur = u; b.unit = u; }
        if (p) per = p;
        b.isUnitMark = true;
        continue;
      }
      if (cur) b.unit = cur;
      // **기간 표지판은 바로 다음 표 하나만 거느린다.** 뒤따르는 표는 남남이다 —
      // 명진 12. 특수관계자는 「<전기>」 뒤에 자금거래·채권채무·담보제공 표가 줄줄이 오는데
      // 앞의 둘만 전기 자료다. 단위는 다르다 — 한 번 밝히면 그 아래로 쭉 간다.
      if (per) { b.period = per; per = undefined; }
    }
  }
}

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

  // 칸(TD·TH)의 범위와 속성. **글자는 안쪽 `<P>` 에 들어 있을 수 있다** —
  //   <TH ROWSPAN="2"><P>특수관계 구분</P></TH>
  // 그러면 잎사귀로 잡히는 것은 `<P>` 라서 TH 인 줄도, ROWSPAN 도 모른 채 지나갔다.
  // 명진 12. 특수관계자 표가 통째로 어긋난 까닭이다(2026-09-13 지적).
  const cellAt: [number, number][] = [];
  const cellTag: string[] = [];
  const cellAttr: string[] = [];
  for (const m of s.matchAll(CELL_RE)) {
    const i = m.index!;
    if (i < a0 || i >= a1) continue;
    cellAt.push([i, i + m[0].length]);
    cellTag.push(m[1]);
    cellAttr.push(m[2]);
  }

  // 주석 머리로 쓰이는 문단의 자리 — 목록 규칙과 같은 결과를 쓰려고 제목 문단을 먼저 찾는다.
  const paraSlots: { slot: number; text: string; pos: number }[] = [];
  const all = slots(s);
  all.forEach((sl, i) => {
    if (sl.start < a0 || sl.start >= a1) return;
    if (sl.tag !== 'P') return;
    if (owner(sl.start, tables) !== -1) return;
    paraSlots.push({ slot: i, text: headingCandidate(sl.raw), pos: sl.start });
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
  let rows: TableCell[][] = [];
  let row: TableCell[] = [];
  let curCell = -1;

  const flushTable = () => {
    if (row.length) { rows.push(row); row = []; }
    if (rows.length && cur) {
      assignGrid(rows);                            // 칸 순서 → 격자 열 번호
      cur.blocks.push({ kind: 'table', rows });
    }
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
      // 제목 뒤에 본문이 붙어 있으면 **살려서 첫 문단으로 넣는다.** 버리면 서술이 사라진다.
      const { lead, body } = headingBody(unescapeXml(sl.raw), head.title);
      if (body.length) cur.blocks.push({ kind: 'para', slot: i, parts: body, lead });
      return;
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
    if (t !== curTbl) { flushTable(); curTbl = t; curTr = owner(sl.start, trs); curCell = -1; }
    const r = owner(sl.start, trs);
    if (r !== curTr) { if (row.length) rows.push(row); row = []; curTr = r; curCell = -1; }
    const ci = owner(sl.start, cellAt);
    // 한 칸에 `<P>` 가 여럿이면 **한 칸으로 합친다.** 따로 세면 열이 하나씩 밀린다.
    if (ci !== -1 && ci === curCell && row.length) {
      const last = row[row.length - 1];
      const add = unescapeXml(sl.raw).trim();
      if (add) last.text = last.text ? `${last.text}\n${add}` : add;
      (last.extra ??= []).push(i);
      return;
    }
    curCell = ci;
    const tag = ci === -1 ? sl.tag : cellTag[ci];
    const attrs = ci === -1 ? sl.attrs : cellAttr[ci];
    row.push({
      slot: i, text: unescapeXml(sl.raw).trim(), tag,
      col: 0, colspan: attrNum(attrs, 'COLSPAN'), rowspan: attrNum(attrs, 'ROWSPAN'),
    });
  });
  flushTable();

  markUnits(notes);
  return notes;
}
