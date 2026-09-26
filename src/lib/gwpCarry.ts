// 일반조서 이월 — 전기 시트를 그대로 이을 때 본문에서 **해가 바뀌는 칸**을 찾아 고친다. 순수 모듈(테스트로 덮는다).
//
// 사용자 2026-09-27: 「작년 그대로 간다는 의미가 그래도 날짜는 업데이트가 된다는 의미죠?」 「2120A 의 경우 숫자를
// 전기시키고 날짜도 업데이트가 되어야 합니다」 「수정된 부분을 노란색 셀로 표시」.
//   ① 날짜 올리기 — 전기 결산일·기초일(과 그 한 해 앞)이 든 칸, 그런 날짜를 적은 글자, 「제18기」 「FY2025」 「2024_4Q」.
//      관계없는 날짜(설립일·계약일)는 건드리지 않는다 — 기간의 끝·처음과 같은 날짜만 본다.
//   ② 전기 이동 — 두 기간 열(예: 2023_4Q │ 2024_4Q)을 가진 분석 시트에서 당기 열의 숫자를 전기 열로 옮기고
//      당기 열을 비운다(새로 채울 자리). 수식 칸은 건드리지 않는다.
// 고친 칸은 모두 돌려주어 부르는 쪽이 노랗게 칠한다.
import type { CellEdit } from './xlsxCells';
import type { SheetData, CellValue } from './xlsxRead';

export interface Period {
  /** 전기 결산일 「2025-12-31」 */ closing: string;
  /** 전기 개시일 「2025-01-01」. 없으면 결산일 다음 날의 한 해 전. */ opening?: string;
  /** 전기 기수(「제18기」의 18). 모르면 null. */ term?: number | null;
}

const pad = (n: number) => String(n).padStart(2, '0');
function parseIso(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? '');
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}
/** 1900 날짜 체계 일련번호(엑셀). */
export function serialOf(y: number, m: number, d: number): number {
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}
function openingOf(closing: { y: number; m: number; d: number }): { y: number; m: number; d: number } {
  const t = new Date(Date.UTC(closing.y - 1, closing.m - 1, closing.d + 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export interface DateRules {
  /** 올릴 일련번호 → 한 해 뒤 일련번호 */ serials: Map<number, number>;
  /** 전기 기준 연도(결산일이 속한 해) */ year: number;
  /** 결산일·개시일의 (월, 일) — 글자 속 날짜가 이것과 같아야 올린다 */ days: { m: number; d: number }[];
  term: number | null;
}

export function dateRules(p: Period): DateRules | null {
  const c = parseIso(p.closing);
  if (!c) return null;
  const o = p.opening ? parseIso(p.opening) ?? openingOf(c) : openingOf(c);
  const serials = new Map<number, number>();
  for (const back of [0, 1]) {   // 당기·전기 두 해치 — 분석 시트는 두 해를 나란히 둔다
    for (const x of [c, o]) {
      const y = x.y - back;
      serials.set(serialOf(y, x.m, x.d), serialOf(y + 1, x.m, x.d));
    }
  }
  return { serials, year: c.y, days: [{ m: c.m, d: c.d }, { m: o.m, d: o.d }], term: p.term ?? null };
}

/** 글자 속의 기간 날짜·기수·FY·분기 표시를 한 해 올린다. 바뀌지 않으면 그대로 돌려준다. */
export function bumpDatesInText(s: string, r: DateRules): string {
  const years = new Set([r.year, r.year - 1]);
  const isDay = (m: number, d: number) => r.days.some((x) => x.m === m && x.d === d);
  let out = s;
  // 2025년 12월 31일 · 2025년12월31일
  out = out.replace(/(\d{4})(\s*년\s*)(\d{1,2})(\s*월\s*)(\d{1,2})(\s*일)/g,
    (all, y, a, m, b, d, c) => (years.has(Number(y)) && isDay(Number(m), Number(d)) ? `${Number(y) + 1}${a}${m}${b}${d}${c}` : all));
  // 2025.12.31 · 2025-12-31 · 2025/12/31
  out = out.replace(/(\d{4})([.\-/])(\d{1,2})\2(\d{1,2})(?!\d)/g,
    (all, y, sep, m, d) => (years.has(Number(y)) && isDay(Number(m), Number(d)) ? `${Number(y) + 1}${sep}${m}${sep}${d}` : all));
  // 제18기 — 전기·전전기 기수만
  if (r.term != null) {
    const t = r.term;
    out = out.replace(/제(\s*)(\d+)(\s*)기/g, (all, a, n, b) => (Number(n) === t || Number(n) === t - 1 ? `제${a}${Number(n) + 1}${b}기` : all));
  }
  // FY2025 · FY25
  out = out.replace(/\bFY(\s?)(\d{4}|\d{2})\b/g, (all, sp, n) => {
    const full = n.length === 2 ? 2000 + Number(n) : Number(n);
    if (!years.has(full)) return all;
    const next = full + 1;
    return `FY${sp}${n.length === 2 ? pad(next % 100) : next}`;
  });
  // 2024_4Q (분석적검토 머리) — 전기 기준 세 해치(2120A 는 전기·전전기를 나란히 둔다)
  out = out.replace(/(\d{4})_(\dQ)/g, (all, y, q) => (Number(y) >= r.year - 2 && Number(y) <= r.year ? `${Number(y) + 1}_${q}` : all));
  // 2025년 말 · 2025년도 · 2025년 결산 · 2025 사업연도
  out = out.replace(/(\d{4})(\s*년\s*)(말|도|결산|감사|기말|기초)/g, (all, y, a, w) => (years.has(Number(y)) ? `${Number(y) + 1}${a}${w}` : all));
  out = out.replace(/(\d{4})(\s*)(사업연도|회계연도)/g, (all, y, a, w) => (years.has(Number(y)) ? `${Number(y) + 1}${a}${w}` : all));
  return out;
}

export interface SheetEdits { edits: CellEdit[]; refs: string[] }

/**
 * 한 시트의 날짜 칸을 올린다. 수식 칸은 건드리지 않는다(열면 다시 계산된다).
 * `skip` 칸(이미 다른 규칙이 고친 칸)은 뺀다.
 */
export function bumpSheetDates(sheet: SheetData, r: DateRules, skip: Set<string> = new Set()): SheetEdits {
  const edits: CellEdit[] = []; const refs: string[] = [];
  for (const [ref, v] of sheet.cells) {
    if (skip.has(ref) || v.formula != null) continue;
    if (v.num != null && r.serials.has(v.num)) {
      edits.push({ ref, num: r.serials.get(v.num)! }); refs.push(ref); continue;
    }
    if (v.text) {
      const t = bumpDatesInText(v.text, r);
      if (t !== v.text) { edits.push({ ref, text: t }); refs.push(ref); }
    }
  }
  return { edits, refs };
}

// ── 전기 이동 ───────────────────────────────────────────────
/** 전기 이동을 하는 조서 — 두 기간 열을 나란히 두는 분석 시트(사용자 2026-09-27: 2120A). 규칙 표가 생기면 거기서 온다. */
export const CARRY_FORWARD_CODES = ['2120A', '8110A', '8110ARP_BS', '8110ARP_PL'];

const colOf = (ref: string) => /^([A-Z]+)/.exec(ref)![1];
const rowOf = (ref: string) => Number(/(\d+)$/.exec(ref)![1]);
const yearIn = (s: string): number | null => {
  const m = /(20\d{2})(?:_\dQ|\s*년|\.|-|\/|\s|$)/.exec(s);
  return m ? Number(m[1]) : null;
};

export interface PeriodColumns { headerRow: number; prevCol: string; curCol: string; prevLabel: string; curLabel: string }

/** 머리 줄에서 기간 열 둘을 찾는다 — 한 해 차이 나는 두 칸(2023_4Q │ 2024_4Q), 없으면 「전기」「당기」 글자. */
export function findPeriodColumns(sheet: SheetData, maxHeaderRow = 40): PeriodColumns | null {
  const byRow = new Map<number, { col: string; text: string; md?: string; y?: number | null }[]>();
  for (const [ref, v] of sheet.cells) {
    const row = rowOf(ref);
    if (row > maxHeaderRow) continue;
    // 머리가 날짜 숫자인 시트도 있다(8110ARP: 2025-12-31 │ 2024-12-31). 날짜의 해로 본다.
    // 수식 머리(8110ARP_PL 이 BS 머리를 따라감)도 계산값으로 읽는다 — 머리 글자를 고칠 때는 수식을 건드리지 않는다.
    let y: number | undefined; let md: string | undefined;
    if (v.num != null && v.num > 20000 && v.num < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + v.num * 86400000);
      y = d.getUTCFullYear(); md = `${d.getUTCMonth()}-${d.getUTCDate()}`;
    }
    if (!v.text && y == null) continue;
    (byRow.get(row) ?? byRow.set(row, []).get(row)!).push({ col: colOf(ref), text: v.formula != null ? '' : v.text ?? '', md, y });
  }
  for (const row of [...byRow.keys()].sort((a, b) => a - b)) {
    const cells = byRow.get(row)!;
    // 날짜 머리는 월·일이 같은 두 기말(2025-12-31 │ 2024-12-31) — 결산일·작성일(2026-03-24) 짝은 머리가 아니다.
    const dates = cells.filter((c) => c.y != null);
    for (const a of dates) for (const b of dates) {
      if (b.y === a.y! + 1 && a.md === b.md) return { headerRow: row, prevCol: a.col, curCol: b.col, prevLabel: a.text, curLabel: b.text };
    }
    const withYear = cells.map((c) => ({ ...c, y: c.text ? yearIn(c.text) : null })).filter((c) => c.y != null);
    for (const a of withYear) for (const b of withYear) {
      if (b.y === a.y! + 1) return { headerRow: row, prevCol: a.col, curCol: b.col, prevLabel: a.text, curLabel: b.text };
    }
    const prev = cells.find((c) => /^전\s*기$/.test(c.text.trim()));
    const cur = cells.find((c) => /^당\s*기$/.test(c.text.trim()));
    if (prev && cur) return { headerRow: row, prevCol: prev.col, curCol: cur.col, prevLabel: prev.text, curLabel: cur.text };
  }
  return null;
}

/**
 * 당기 열의 숫자를 전기 열로 옮기고 당기 열을 비운다. 수식이 걸린 칸(합계·증감)은 두 열 어느 쪽이든 건드리지 않는다.
 * 머리 글자의 연도도 한 해 올린다(「BS: 2023_4Q」→「BS: 2024_4Q」). 비운 당기 칸도 돌려준다 — 노랗게 칠해 채울 자리를 보인다.
 */
export function carryForward(sheet: SheetData, pc: PeriodColumns): SheetEdits & { moved: number; linked: number } {
  const edits: CellEdit[] = []; const refs: string[] = [];
  let moved = 0;
  /** 전기·당기 둘 다 외부 링크 수식인 줄 — 옮길 것이 없다. 링크를 새 해 파일로 바꾸면 따라온다(8110ARP_PL). */
  let linked = 0;
  const isLink = (v: CellValue | undefined) => v?.formula != null && /\[\d+\]/.test(v.formula);
  const get = (ref: string): CellValue | undefined => sheet.cells.get(ref);
  let maxRow = 0;
  for (const ref of sheet.cells.keys()) maxRow = Math.max(maxRow, rowOf(ref));
  for (let r = pc.headerRow + 1; r <= maxRow; r++) {
    const curRef = `${pc.curCol}${r}`, prevRef = `${pc.prevCol}${r}`;
    const cur = get(curRef), prev = get(prevRef);
    if (prev?.formula != null) { if (isLink(prev) && isLink(cur)) linked += 1; continue; }
    if (cur?.formula != null) {
      // 당기가 링크 수식(8110ARP 의 [98]WBS!X6)이면 계산값을 전기로 적고 수식은 둔다 — 새 해 시산표로 다시 건다.
      // 합계 같은 시트 안 수식은 전기 쪽도 수식이라 위에서 걸러진다.
      if (cur.num != null && isLink(cur)) {
        edits.push({ ref: prevRef, num: cur.num }); refs.push(prevRef, curRef); moved += 1;
      }
      continue;
    }
    if (cur?.num != null) {
      edits.push({ ref: prevRef, num: cur.num }, { ref: curRef, clear: true });
      refs.push(prevRef, curRef);
      moved += 1;
    } else if (prev?.num != null && !cur?.text) {
      // 작년 당기가 비어 있던 줄 — 전전기 값이 전기 자리에 남지 않게 비운다(명진 2120A 미수수익).
      edits.push({ ref: prevRef, clear: true });
      refs.push(prevRef);
    }
  }
  // 머리 글자의 연도를 올린다. 날짜 숫자 머리는 날짜 올리기(bumpSheetDates)가 맡는다.
  const bumpYear = (s: string) => s.replace(/(20\d{2})/g, (y) => String(Number(y) + 1));
  for (const [col, label] of [[pc.prevCol, pc.prevLabel], [pc.curCol, pc.curLabel]] as const) {
    if (!label) continue;
    const t = bumpYear(label);
    if (t !== label) { const ref = `${col}${pc.headerRow}`; edits.push({ ref, text: t }); refs.push(ref); }
  }
  return { edits, refs, moved, linked };
}
