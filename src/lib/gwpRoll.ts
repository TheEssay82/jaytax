// 일반조서 **이월** — 전기 회사 워크북 + 당기 표준양식 묶음 → 당기 시작 워크북.
//
// 사무소가 해마다 손으로 하던 일(사용자 2026-09-15): 전기 일반조서를 가져와 + 당기 양식이 바뀌었는지 조서마다
// 확인하고 + 바뀐 양식으로 옮겨 적는다. 이것을 그대로 옮긴다.
//
//   1) 조서 코드로 전기 시트와 양식 시트를 짝짓는다.
//   2) **라벨 대조** — 양식의 글자 칸(수식·숫자 아닌 것)이 전기 시트 같은 자리에 같은 글자로 있으면
//      양식이 안 바뀐 것이다. 그런 시트는 손대지 않는다(작성자·검토 흔적이 그대로 남는다).
//      개정사항총괄이나 파란 글씨를 믿지 않는 까닭: 회사 파일이 몇 해 전 양식일 수도 있고, 파란 글씨는
//      시트마다 들쭉날쭉했다(2301 은 110칸, 2302 는 0칸 — 2026-09-15 실측).
//   3) 바뀐 시트는 양식 시트를 **이식**(xlsxTransplant)하고, 전기의 입력값을 **행 라벨 → 열**로 짝지어
//      옮긴다. 자리(칸 주소)로 맞추지 않는다 — 양식이 바뀌면 행이 밀린다. 못 옮긴 것은 알려 준다.
//   4) 머리의 회사명·결산일은 조서표지로, 작성자·일자는 **조서목록의 그 조서 줄**로 링크를 건다
//      (사무소 관행 — "조서목록에 적은 날짜를 각 조서가 링크로 가져간다"). 검토자는 전기 값을 그대로.
//   5) 조서표지의 결산일·대상기간을 한 해 올리고 감사보고서일을 비운다. 조서목록의 작성일을 비운다 —
//      조서를 RUN 할 때마다 적는다.
//
// 값을 지어내지 않는다. 옮긴 것·못 옮긴 것·새로 생긴 조서·양식에서 사라진 조서를 전부 보고한다.
import { strFromU8, strToU8 } from 'fflate';
import { readWorkbook, type SheetData, type CellValue } from './xlsxRead';
import { buildCatalog, codeOf, kindOf, isoDate, type Catalog } from './gwpCatalog';
import { findTemplateSheet, type TemplateCatalog } from './gwpTemplate';
import {
  transplantSheet, sheetEntries, dropCalcChain, forceRecalc, unzip, zip,
} from './xlsxTransplant';
import { setCells, excelSerial, type CellEdit } from './xlsxCells';
import { dateRules, bumpSheetDates, bumpDatesInText, findPeriodColumns, carryForward, CARRY_FORWARD_CODES, type DateRules } from './gwpCarry';
import { setTabColor, highlightCells, TAB } from './xlsxMark';

const norm = (s: string | undefined) => (s ?? '').replace(/\s/g, '');
function textOf(v: CellValue | undefined): string {
  if (!v) return '';
  if (v.text != null) return v.text.trim();
  if (v.num != null) return String(v.num);
  return '';
}
function split(ref: string): { col: string; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
  return { col: m[1], row: Number(m[2]) };
}
function colNum(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

// ── 라벨 대조 ───────────────────────────────────────────────────
/** 양식의 **글자 칸** — 수식·숫자·빈칸이 아닌 것. 이것이 양식의 몸이다. */
export function labelCells(sheet: SheetData): Map<string, string> {
  const out = new Map<string, string>();
  for (const [ref, v] of sheet.cells) {
    if (v.formula != null || v.num != null) continue;
    const t = norm(v.text);
    if (t) out.set(ref, t);
  }
  return out;
}

export interface Compare {
  /** 양식 글자 칸 수 */ total: number;
  /** 전기에 같은 자리 같은 글자로 있는 수 */ same: number;
  /** 0~1 */ score: number;
  /** 양식에는 있는데 전기는 다르거나 없는 자리 */ differ: string[];
  /**
   * 양식 문구 가운데 전기 시트 **어디에도** 없는 것의 자리 — 올해 새로 생기거나 고친 문구.
   * 자리 대조(differ)는 줄 하나만 밀려도 전부 다르다고 나온다(명진 8100A 320칸 중 320칸). 「얼마나 다른가」는 이것으로 본다(2026-09-27).
   */
  missing: string[];
}

/** 양식이 바뀌었는지 — 양식의 글자 칸이 전기 시트 같은 자리에 얼마나 그대로 있는가, 문구가 전기 어디엔가 있는가. */
export function compareSheets(tpl: SheetData, prior: SheetData): Compare {
  const labels = labelCells(tpl);
  const priorList = [...new Set(labelCells(prior).values())];
  const priorTexts = new Set(priorList);
  let same = 0;
  const differ: string[] = [];
  const missing: string[] = [];
  for (const [ref, t] of labels) {
    if (norm(textOf(prior.cells.get(ref))) === t) same += 1;
    else differ.push(ref);
    if (!priorTexts.has(t) && !priorList.some((p) => sameWording(t, p))) missing.push(ref);
  }
  const total = labels.size;
  return { total, same, score: total ? same / total : 1, differ, missing };
}

/**
 * 같은 문구로 볼 것인가(공백 뺀 글자). 작년 조서는 문구 안에 답을 적는다 — 「경영진의 동의여부 : [ V ] 예」,
 * 「… 만족함」 — 그래서 한쪽이 다른 쪽을 품거나, 글자쌍이 85% 넘게 같으면 같은 문구로 본다.
 */
export function sameWording(t: string, p: string): boolean {
  if (t === p) return true;
  if (t.length < 4 || p.length < 4) return false;
  if (p.includes(t) || (t.includes(p) && p.length >= t.length * 0.7)) return true;
  if (p.length < t.length * 0.6 || p.length > t.length * 1.8) return false;
  const grams = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); } return m; };
  const a = grams(t), b = grams(p);
  let both = 0;
  for (const [g, n] of a) both += Math.min(n, b.get(g) ?? 0);
  return (2 * both) / (t.length - 1 + p.length - 1) >= 0.85;
}

/** 문구가 이만큼 넘게 전기에 없으면 「올해 양식이 다르다」. 자리만 밀린 것은 다르다고 하지 않는다. */
export const MISSING_THRESHOLD = 0.02;

/** 이 점수 이상이면 「안 바뀐 양식」으로 본다. 오탈자 몇 개는 봐준다. */
export const SAME_THRESHOLD = 0.98;

// ── 입력값 옮기기 ───────────────────────────────────────────────
/** 행마다 **첫 글자 칸**(라벨)과 그 열. */
function rowLabels(sheet: SheetData): Map<number, { col: number; text: string }> {
  const out = new Map<number, { col: number; text: string }>();
  for (const [ref, v] of sheet.cells) {
    if (v.formula != null) continue;
    const t = norm(v.text);
    if (!t) continue;
    const { col, row } = split(ref);
    const c = colNum(col);
    const had = out.get(row);
    if (!had || c < had.col) out.set(row, { col: c, text: t });
  }
  return out;
}

export interface Moved { from: string; to: string; value: string; /** 문구가 조금 다른 줄로 옮겼다 — 확인할 것 */ fuzzy?: boolean }
export interface Migration {
  edits: CellEdit[];
  moved: Moved[];
  /** 라벨을 못 찾았거나 양식 그 자리에 글자가 있어 못 옮긴 것 */ left: { from: string; value: string; why: string }[];
}

/**
 * 전기 시트의 입력값을 양식 시트로 — **행 라벨 → 열**로 짝짓는다.
 *
 * 입력값이란: 전기 시트의 수식 아닌 칸 가운데, 양식 같은 자리의 글자와 다르고(라벨이 아니고),
 * 그 행에 자기보다 왼쪽에 라벨이 있는 것. 같은 라벨이 여럿이면 몇 번째인지로 가른다.
 * 머리(1~6행)는 옮기지 않는다 — 링크로 다시 건다.
 */
export function migrateInputs(prior: SheetData, tpl: SheetData, skipRows = 6): Migration {
  const tplLabels = labelCells(tpl);
  const pLabels = rowLabels(prior);
  const tLabels = rowLabels(tpl);
  const tRowsByLabel = new Map<string, number[]>();
  for (const [row, l] of [...tLabels].sort((a, b) => a[0] - b[0])) {
    tRowsByLabel.set(l.text, [...(tRowsByLabel.get(l.text) ?? []), row]);
  }
  const pRowsByLabel = new Map<string, number[]>();
  for (const [row, l] of [...pLabels].sort((a, b) => a[0] - b[0])) {
    pRowsByLabel.set(l.text, [...(pRowsByLabel.get(l.text) ?? []), row]);
  }

  // 양식 어딘가에 있는 글자 — 자리가 밀렸을 뿐 라벨이다. 옛 양식의 서술이 개정으로 바뀌었어도
  // 긴 글은 사람이 적은 값이 아니라 양식 문구다. 이 둘을 입력값으로 세면 「못 옮긴 것」이 수천 건으로 붇는다.
  const tplTexts = new Set(tplLabels.values());
  const isNarrative = (t: string) => t.length >= 12;

  const out: Migration = { edits: [], moved: [], left: [] };
  const refs = [...prior.cells.keys()].sort((a, b) => {
    const x = split(a); const y = split(b);
    return x.row - y.row || colNum(x.col) - colNum(y.col);
  });
  for (const ref of refs) {
    const v = prior.cells.get(ref)!;
    if (v.formula != null) continue;
    const value = textOf(v);
    if (!value) continue;
    const { col, row } = split(ref);
    if (row <= skipRows) continue;
    const nv = norm(value);
    // 양식 같은 자리에 같은 글자 → 라벨이다.
    if (norm(tpl.cells.get(ref)?.text) === nv && tplLabels.has(ref)) continue;
    const label = pLabels.get(row);
    if (!label || label.col >= colNum(col)) {
      // 자기가 그 행의 첫 글자 칸이다 — 양식 문구(자리만 밀렸거나 개정된 것)이거나 사람이 넣은 줄이다.
      if (tplTexts.has(nv) || isNarrative(nv)) continue;
      out.left.push({ from: ref, value, why: '왼쪽에 라벨이 없습니다' });
      continue;
    }
    // 라벨 오른쪽이라도 양식 문구가 옮겨 앉은 것(두 번째 열의 서술)이면 입력이 아니다.
    if (tplTexts.has(nv)) continue;
    const k = pRowsByLabel.get(label.text)!.indexOf(row);
    let tRow = tRowsByLabel.get(label.text)?.[k];
    let fuzzy = false;
    if (tRow == null) {
      // 문구가 조금 고쳐진 줄 — 앞 열 글자가 같은 줄이 양식에 **하나뿐**이면 그 줄로 본다.
      const head = label.text.slice(0, 10);
      if (head.length >= 8) {
        const cands = [...tRowsByLabel].filter(([t]) => t.startsWith(head) || label.text.startsWith(t.slice(0, 10)));
        if (cands.length === 1 && cands[0][1].length === 1) { tRow = cands[0][1][0]; fuzzy = true; }
      }
    }
    if (tRow == null) { out.left.push({ from: ref, value, why: `양식에 「${label.text.slice(0, 20)}」 줄이 없습니다` }); continue; }
    const to = `${col}${tRow}`;
    const there = tpl.cells.get(to);
    if (there && (there.formula != null || norm(there.text))) {
      if (norm(there.text) === norm(value)) continue;   // 이미 같은 글자
      out.left.push({ from: ref, value, why: `양식 ${to} 에 다른 것이 있습니다` });
      continue;
    }
    out.edits.push(v.num != null && v.text == null ? { ref: to, num: v.num } : { ref: to, text: value });
    out.moved.push(fuzzy ? { from: ref, to, value, fuzzy: true } : { from: ref, to, value });
  }
  return out;
}

// ── 머리 링크 ───────────────────────────────────────────────────
const HEAD_LABELS: Record<string, RegExp> = {
  company: /^회사명[:：]?$/, closing: /^결산일[:：]?$/, author: /^작성자[:：]?$/, reviewer: /^검토자[:：]?$/, date: /^일자[:：]?$/,
};

/** 머리 라벨마다 값 칸의 주소(바로 오른쪽 칸). 「일자」는 작성자 줄·검토자 줄 둘 다. */
export function headRefs(sheet: SheetData): { company?: string; closing?: string; author?: string; reviewer?: string; dates: string[] } {
  const out: { company?: string; closing?: string; author?: string; reviewer?: string; dates: string[] } = { dates: [] };
  const byRow = new Map<number, { col: number; ref: string; text: string }[]>();
  for (const [ref, v] of sheet.cells) {
    const { col, row } = split(ref);
    if (row > 8) continue;
    const list = byRow.get(row) ?? [];
    list.push({ col: colNum(col), ref, text: norm(textOf(v)) });
    byRow.set(row, list);
  }
  for (const row of [...byRow.keys()].sort((a, b) => a - b)) {
    const cells = byRow.get(row)!.sort((a, b) => a.col - b.col);
    cells.forEach((c, i) => {
      for (const [k, re] of Object.entries(HEAD_LABELS)) {
        if (!re.test(c.text)) continue;
        // 값 칸은 바로 오른쪽. 그 칸이 비어 있어 목록에 없으면 주소를 지어낸다.
        const next = cells[i + 1];
        const ref = next && next.col === c.col + 1 ? next.ref : `${colName(c.col + 1)}${row}`;
        if (k === 'date') out.dates.push(ref);
        else if (!(out as Record<string, unknown>)[k]) (out as Record<string, unknown>)[k] = ref;
      }
    });
  }
  return out;
}
function colName(n: number): string {
  let out = '';
  let x = n;
  while (x > 0) { const r = (x - 1) % 26; out = String.fromCharCode(65 + r) + out; x = Math.floor((x - 1) / 26); }
  return out;
}

/** 시트 이름을 수식에 쓸 꼴로. */
function sheetRef(name: string): string {
  return /^[A-Za-z가-힣_][A-Za-z0-9가-힣_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/** 머리를 사무소 관행대로 링크한다. 조서목록 줄이 없으면 작성자·일자는 비운다. */
export function headEdits(
  refs: ReturnType<typeof headRefs>, coverName: string, indexName: string, indexRow: number | null, reviewer: string,
): CellEdit[] {
  const edits: CellEdit[] = [];
  if (refs.company) edits.push({ ref: refs.company, formula: `${sheetRef(coverName)}!B14` });
  if (refs.closing) edits.push({ ref: refs.closing, formula: `${sheetRef(coverName)}!B15` });
  // 목록 칸이 비어 있으면 0 이 아니라 빈 글자가 보이게 — 날짜꼴 칸에 0 이 오면 「######」로 보인다.
  const link = (col: 'D' | 'E') => `IF(${sheetRef(indexName)}!${col}${indexRow}="","",${sheetRef(indexName)}!${col}${indexRow})`;
  if (refs.author) edits.push(indexRow ? { ref: refs.author, formula: link('D') } : { ref: refs.author, clear: true });
  if (refs.reviewer) edits.push(reviewer ? { ref: refs.reviewer, text: reviewer } : { ref: refs.reviewer, clear: true });
  refs.dates.forEach((ref, i) => {
    if (i === 0) edits.push(indexRow ? { ref, formula: link('E') } : { ref, clear: true });
    else edits.push({ ref, formula: `IF(${refs.dates[0]}="","",${refs.dates[0]})` });
  });
  return edits;
}

/** 수식 안의 시트 이름을 바꾼다 — 양식 안 이름(2700)을 회사 파일 이름(2700(소규모))으로. */
export function renameSheetRefs(sheetXml: string, map: Map<string, string>): string {
  if (!map.size) return sheetXml;
  return sheetXml.replace(/<f\b([^>]*)>([\s\S]*?)<\/f>/g, (_m, a: string, f: string) => {
    let out = f;
    for (const [from, to] of map) {
      if (from === to) continue;
      const q = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(`'${q.replace(/'/g, "''")}'!`, 'g'), `${sheetRef(to)}!`);
      out = out.replace(new RegExp(`(^|[^A-Za-z0-9가-힣_.'])${q}!`, 'g'), (_x, pre: string) => `${pre}${sheetRef(to)}!`);
    }
    return `<f${a}>${out}</f>`;
  });
}

// ── 연도 올리기 ─────────────────────────────────────────────────
/** 「제18기 2025년 1월 1일 ～ 2025년 12월 31일」 → 기수·연도를 한 해 올린다. */
export function bumpPeriodText(s: string, by = 1): string {
  return s
    .replace(/제\s*(\d{1,3})\s*기/g, (_m, n: string) => `제${Number(n) + by}기`)
    .replace(/(19|20)(\d{2})(?=\s*년|-|\.|\/)/g, (_m, c: string, y: string) => `${c}${String(Number(y) + by).padStart(2, '0')}`);
}

// ── 이월 ────────────────────────────────────────────────────────
/**
 * 조서마다 한 일.
 *  그대로       — 전기 시트를 잇는다(기본). 머리의 작성자·일자·검토자만 당기로 건다.
 *  갈아끼움     — 사람이 골라서 당기 양식으로 바꾸고 전기 값을 옮겼다.
 *  새 조서      — 사람이 골라서 당기 양식에만 있는 조서를 넣었다.
 *  양식에만 있음 — 당기 양식에만 있는 조서. 넣지 않았다(골라서 넣을 수 있다).
 *  양식 없음    — 당기 양식에 없는 시트(회사가 더한 것 등). 전기 그대로.
 *  숨김 그대로  — 전기에 숨겨 둔 안 쓰는 조서.
 */
export type SheetAction = '그대로' | '갈아끼움' | '새 조서' | '양식에만 있음' | '양식 없음' | '숨김 그대로';

export interface SheetReport {
  code: string;
  name: string;
  action: SheetAction;
  /** 라벨 대조 */ score?: number;
  differ?: number;
  moved?: number;
  left?: { from: string; value: string; why: string }[];
  /** 짝지은 양식 시트의 파일 */ template?: string;
  /** 짝지은 양식 시트의 코드 — 회사 「2700A-2」 ↔ 양식 「2700A-2(감사계획단계)」처럼 다를 수 있다 */ tplCode?: string;
  /** 당기 양식과 글자가 다르다(그대로 이었지만 골라서 갈아끼울 수 있다). */ templateDiffers?: boolean;
  /** 어디가 다른지 — 양식 글자 칸 가운데 전기와 다른 것(앞 30개). 「올해 양식이 얼마나 다른가」(2026-09-27). */
  diffs?: { ref: string; prior: string; tpl: string }[];
  /** 다른 칸 전부(참고 파일에서 노랗게 칠한다) */ differRefs?: string[];
  /** 한 해 올린 날짜 칸 수 */ dates?: number;
  /** 전기 열로 옮긴 숫자 줄 수(2120A 같은 분석 시트) */ carried?: number;
  note?: string;
}

export interface RollReport {
  fy: number;
  sheets: SheetReport[];
  cover: { closing?: string; period?: string; reportDate: '비움' };
  index: { datesCleared: number };
  /** 탭을 빨강으로 바꾼 시트 수 · 노랗게 칠한 칸 수 */ marks: { tabs: number; cells: number };
  warnings: string[];
}

export interface RollOptions {
  /** 당기 사업연도(결산일이 속한 해). 결산일·대상기간을 이만큼 올린다. */ fy: number;
  /** 전기 결산일 「2025-12-31」 → 당기 결산일. 없으면 한 해 더한다. */ closing?: string;
  /**
   * 당기 양식으로 **갈아끼울** 조서 코드. 기본은 없음 — 전기 시트를 그대로 잇는다(사용자 결정 2026-09-27:
   * 「대부분의 시트는 양식이 많이 바뀌지 않습니다」). 명진 FY25 를 전부 갈아끼웠더니 2120A 702칸 등 전기 내용을 잃었다.
   */
  replace?: string[];
  /** 당기 양식에만 있는 조서 가운데 **넣을** 코드. 기본은 넣지 않는다. */ addCodes?: string[];
  /** 검토자(파트너) — 당기 세팅 값. 없으면 전기 조서 머리의 검토자를 그대로 쓴다. */ reviewer?: string;
}

/**
 * 전기 워크북 + 양식 묶음 → 당기 워크북. 묶음 파일은 `tplFiles[path]` 로 준다(readBundle 이 준 것).
 */
export function rollWorkbook(
  priorBytes: Uint8Array, tpl: TemplateCatalog, tplFiles: Record<string, Uint8Array>, opts: RollOptions,
): { bytes: Uint8Array; report: RollReport; catalog: Catalog } {
  const files = unzip(priorBytes);
  const prior = readWorkbook(priorBytes);
  const cat = buildCatalog(prior);
  const report: RollReport = { fy: opts.fy, sheets: [], cover: { reportDate: '비움' }, index: { datesCleared: 0 }, marks: { tabs: 0, cells: 0 }, warnings: [] };

  const coverSheet = prior.find((s) => norm(s.name).includes('조서표지'));
  const indexSheet = prior.find((s) => kindOf(s.name) === 'index');
  const coverName = coverSheet?.name ?? '조서표지(공통사항)';
  const indexName = indexSheet?.name ?? '조서목록';
  if (!coverSheet) report.warnings.push('「조서표지(공통사항)」 시트가 없어 회사명·결산일 링크를 걸지 못했습니다.');
  if (!indexSheet) report.warnings.push('「조서목록」 시트가 없어 작성자·일자 링크를 걸지 못했습니다.');
  const indexRowOf = new Map(cat.index.map((r) => [r.code, r.row]));
  /** 조서목록에서 이 조서의 줄 — 없으면 윗 조서 줄(2100A→2100, 2302→2301, 8110→8100, 2512→2511). */
  const indexRowFor = (code: string): number | null => {
    const base = code.replace(/\(.*$/, '');
    const four = base.slice(0, 4);
    for (const c of [base, four, `${four.slice(0, 3)}0`, `${four.slice(0, 3)}1`, `${four.slice(0, 2)}00`]) {
      const r = indexRowOf.get(c);
      if (r) return r;
    }
    return null;
  };
  const replaceSet = new Set(opts.replace ?? []);
  const addSet = new Set(opts.addCodes ?? []);
  // 해가 바뀌는 칸 — 전기 결산일·개시일·기수(표지의 대상기간에서 읽는다).
  const termMatch = /제\s*(\d+)\s*기/.exec(cat.period ?? '');
  const rules: DateRules | null = cat.closing ? dateRules({
    closing: cat.closing,
    opening: openingOfPeriod(cat.period) ?? undefined,
    term: termMatch ? Number(termMatch[1]) : null,
  }) : null;
  if (!rules) report.warnings.push('표지에서 전기 결산일을 읽지 못해 조서 안의 날짜를 올리지 못했습니다.');

  /** 탭 빨강(올해 아직 손 안 댐) + 바뀐 칸 노랑. 사무소 관행(2026-09-27). */
  function mark(part: string, refs: string[]) {
    files[part] = strToU8(setTabColor(strFromU8(files[part]), TAB.red));
    report.marks.tabs += 1;
    report.marks.cells += highlightCells(files, part, refs);
  }

  /**
   * 전기 시트를 그대로 잇는다. 머리는 당기로(회사명·결산일은 표지, 작성자·일자는 조서목록, 검토자는 파트너),
   * 본문은 기간 날짜를 한 해 올리고, 분석 시트(2120A 등)는 당기 숫자를 전기 열로 옮긴다. 바뀐 본문 칸은 노랗게.
   */
  function keepSheet(sheetName: string, sheet: SheetData, code: string, reviewer: string, withHead = true): { dates: number; carried?: number; note?: string } {
    const e = sheetEntries(files).find((x) => x.name === sheetName);
    if (!e) return { dates: 0 };
    const head = withHead ? headEdits(headRefs(sheet), coverName, indexName, indexRowFor(code), reviewer) : [];
    const skip = new Set(head.map((x) => x.ref));
    const body: CellEdit[] = []; const refs: string[] = [];
    let carried: number | undefined; let note: string | undefined;
    if (carryCodeOf(code)) {
      const pc = findPeriodColumns(sheet);
      if (pc) {
        const c = carryForward(sheet, pc);
        body.push(...c.edits); refs.push(...c.refs); c.refs.forEach((r) => skip.add(r));
        carried = c.moved;
        note = [
          c.moved ? `당기 ${pc.curCol}열 숫자 ${c.moved}줄을 전기 ${pc.prevCol}열로 옮겼습니다(노란 칸 — 당기 칸은 비웠고, 외부 링크 수식은 두었으니 새 해 시산표로 다시 거세요).` : '',
          c.linked ? `${c.linked}줄은 전기·당기 모두 외부 시산표 링크라 옮기지 않았습니다 — 링크를 새 해 파일로 바꾸면 따라옵니다.` : '',
        ].filter(Boolean).join(' ') || '옮길 숫자가 없었습니다.';
      } else note = '전기·당기 기간 열을 찾지 못해 숫자를 옮기지 못했습니다 — 손으로 옮기세요.';
    }
    const d = rules ? bumpSheetDates(sheet, rules, skip) : { edits: [], refs: [] };
    body.push(...d.edits); refs.push(...d.refs);
    const edits = [...head, ...body];
    if (edits.length) files[e.part] = strToU8(setCells(strFromU8(files[e.part]), edits));
    mark(e.part, refs);
    return { dates: d.refs.length, carried, note };
  }

  // 코드 → 회사 시트 이름(보이는 것 우선). 양식 수식의 시트 이름을 회사 이름으로 바꿀 때 쓴다.
  const nameOfCode = new Map<string, string>();
  for (const s of [...cat.sheets].sort((a, b) => Number(a.hidden) - Number(b.hidden))) {
    if (s.code && !nameOfCode.has(s.code)) nameOfCode.set(s.code, s.name);
  }
  const tplNameMap = new Map<string, string>();
  for (const t of tpl.sheets) {
    if (t.code && nameOfCode.has(t.code)) tplNameMap.set(t.name, nameOfCode.get(t.code)!);
  }

  const tplCache = new Map<string, Record<string, Uint8Array>>();
  const tplSheetCache = new Map<string, SheetData[]>();
  function tplSheet(file: string, name: string): { files: Record<string, Uint8Array>; sheet: SheetData } {
    if (!tplCache.has(file)) tplCache.set(file, unzip(tplFiles[file]));
    if (!tplSheetCache.has(file)) tplSheetCache.set(file, readWorkbook(tplFiles[file]));
    const sheet = tplSheetCache.get(file)!.find((s) => s.name === name);
    if (!sheet) throw new Error(`양식 파일에서 「${name}」 시트를 읽지 못했습니다: ${file}`);
    return { files: tplCache.get(file)!, sheet };
  }

  const seenCodes = new Set<string>();
  /** 회사 시트와 짝지어진 양식 코드 — 「양식에만 있음」에서 뺀다 */
  const matchedTpl = new Set<string>();
  for (const cs of cat.sheets) {
    if (cs.kind !== 'paper' || !cs.code) continue;
    const priorSheet = prior.find((s) => s.name === cs.name)!;
    if (cs.hidden) { report.sheets.push({ code: cs.code, name: cs.name, action: '숨김 그대로' }); continue; }
    const reviewer = opts.reviewer || cs.head.reviewer;
    if (seenCodes.has(cs.code)) {
      const k = keepSheet(cs.name, priorSheet, cs.code, reviewer);
      report.sheets.push({ code: cs.code, name: cs.name, action: '그대로', dates: k.dates, carried: k.carried, note: k.note ?? '같은 코드의 시트가 둘 — 둘 다 전기 그대로 이었습니다' });
      continue;
    }
    seenCodes.add(cs.code);
    const ts = findTemplateSheet(tpl, cs.code);
    if (ts?.code) matchedTpl.add(ts.code);
    if (!ts) {
      const k = keepSheet(cs.name, priorSheet, cs.code, reviewer);
      report.sheets.push({ code: cs.code, name: cs.name, action: '양식 없음', dates: k.dates, carried: k.carried, note: k.note ?? '당기 양식에 같은 번호의 조서가 없습니다 — 전기 그대로 이었습니다.' });
      continue;
    }
    const { files: srcFiles, sheet: tplData } = tplSheet(ts.file, ts.name);
    const cmp = compareSheets(tplData, priorSheet);
    // 기본은 전기 그대로 — 사람이 고른 조서만 갈아끼운다.
    if (!replaceSet.has(cs.code)) {
      const k = keepSheet(cs.name, priorSheet, cs.code, reviewer);
      // 「얼마나 다른가」는 문구로 — 올해 양식 문구가 작년 시트 어디에도 없는 수. 자리만 밀린 것은 다르다고 하지 않는다.
      const textScore = cmp.total ? 1 - cmp.missing.length / cmp.total : 1;
      const differs = cmp.total > 0 && cmp.missing.length / cmp.total > MISSING_THRESHOLD;
      const shifted = !differs && cmp.score < SAME_THRESHOLD;
      const tplLabels = labelCells(tplData);
      const diffNote = differs
        ? `올해 양식 문구 ${cmp.total}개 중 ${cmp.missing.length}개가 작년 시트에 없습니다(새로 생기거나 고친 문구) — 작년 그대로 이었습니다.`
        : shifted ? '문구는 올해 양식과 같고 줄 자리만 다릅니다 — 작년 그대로 이었습니다.' : undefined;
      report.sheets.push({
        code: cs.code, name: cs.name, action: '그대로', score: textScore, differ: cmp.missing.length, template: ts.file, tplCode: ts.code ?? undefined,
        templateDiffers: differs, dates: k.dates, carried: k.carried,
        diffs: differs ? cmp.missing.slice(0, 30).map((ref) => ({ ref, prior: textOf(priorSheet.cells.get(ref)), tpl: tplLabels.get(ref) ?? '' })) : undefined,
        differRefs: differs ? cmp.missing : undefined,
        note: [k.note, diffNote].filter(Boolean).join(' ') || undefined,
      });
      continue;
    }
    // 갈아끼운다 — 이름·자리·숨김은 회사 것 그대로.
    const r = transplantSheet(files, srcFiles, ts.name, { as: cs.name, replace: true });
    const mig = migrateInputs(priorSheet, tplData);
    const refs = headRefs(tplData);
    const moved = rules ? mig.edits.map((x) => bumpEdit(x, rules)) : mig.edits;
    const edits: CellEdit[] = [...moved, ...headEdits(refs, coverName, indexName, indexRowFor(cs.code), reviewer)];
    let xml = strFromU8(files[r.part]);
    xml = renameSheetRefs(xml, tplNameMap);
    if (edits.length) xml = setCells(xml, edits);
    files[r.part] = strToU8(xml);
    mark(r.part, mig.edits.map((x) => x.ref));
    report.sheets.push({
      code: cs.code, name: cs.name, action: '갈아끼움', score: cmp.score, differ: cmp.differ.length,
      moved: mig.moved.length, left: mig.left, template: ts.file,
    });
  }

  // 양식에는 있는데 회사 파일에 없는 조서 — 새로 생긴 것(2533·3400-1 같은). 기본은 넣지 않고 알려만 준다.
  {
    const existing = new Set(sheetEntries(files).map((e) => e.name));
    const have = new Set(cat.sheets.map((s) => s.code).filter(Boolean) as string[]);
    for (const t of tpl.sheets) {
      if (!t.code || t.hidden || have.has(t.code) || seenCodes.has(t.code) || matchedTpl.has(t.code)) continue;
      seenCodes.add(t.code);
      if (!addSet.has(t.code)) {
        report.sheets.push({ code: t.code, name: t.name, action: '양식에만 있음', template: t.file, note: '당기 양식에만 있는 조서입니다 — 넣지 않았습니다. 필요하면 골라서 넣으세요.' });
        continue;
      }
      let name = t.name;
      if (existing.has(name)) name = `${name}(2026)`;
      const { files: srcFiles, sheet: tplData } = tplSheet(t.file, t.name);
      const r = transplantSheet(files, srcFiles, t.name, { as: name });
      existing.add(name);
      let xml = strFromU8(files[r.part]);
      xml = renameSheetRefs(xml, tplNameMap);
      const edits = headEdits(headRefs(tplData), coverName, indexName, indexRowFor(t.code), opts.reviewer ?? '');
      if (edits.length) xml = setCells(xml, edits);
      files[r.part] = strToU8(xml);
      mark(r.part, []);
      report.sheets.push({ code: t.code, name, action: '새 조서', template: t.file, note: '골라서 넣은 조서입니다. 맨 뒤에 붙였습니다.' });
    }
  }

  // 조서 번호가 없는 시트(회사가 더한 것). 분석 시트(8110ARP_BS 등)는 조서처럼 전기 이동·날짜 올리기를 하고,
  // 나머지는 내용은 그대로 두고 탭만 빨강 — 「특수관계자검토25」 같은 해별 사본의 날짜를 올리면 기록이 바뀐다.
  // 참고 시트(참고_…·감사조서철 작성 및 보존)는 손대지 않는다.
  for (const cs of cat.sheets) {
    if (cs.kind !== 'extra' || cs.hidden || /^참고/.test(norm(cs.name))) continue;
    const e = sheetEntries(files).find((x) => x.name === cs.name);
    if (!e) continue;
    const carry = carryCodeOf(cs.name);
    if (carry) {
      const k = keepSheet(cs.name, prior.find((x) => x.name === cs.name)!, carry, '', false);
      report.sheets.push({ code: carry, name: cs.name, action: '양식 없음', dates: k.dates, carried: k.carried, note: k.note });
    } else mark(e.part, []);
  }

  // 조서표지 — 결산일·대상기간 올리고 감사보고서일 비움.
  if (coverSheet) {
    const e = sheetEntries(files).find((x) => x.name === coverSheet.name)!;
    const edits: CellEdit[] = [];
    const closing = opts.closing ?? (cat.closing ? bumpPeriodText(cat.closing) : '');
    const serial = closing ? excelSerial(closing) : null;
    if (serial != null) { edits.push({ ref: 'B15', num: serial }); report.cover.closing = closing; }
    if (cat.period) { const p = bumpPeriodText(cat.period); edits.push({ ref: 'B16', text: p }); report.cover.period = p; }
    edits.push({ ref: 'B17', clear: true });
    files[e.part] = strToU8(setCells(strFromU8(files[e.part]), edits));
    mark(e.part, edits.map((x) => x.ref));
  }
  // 조서목록 — 작성일 비움.
  if (indexSheet) {
    const e = sheetEntries(files).find((x) => x.name === indexSheet.name)!;
    const edits: CellEdit[] = cat.index.filter((r) => r.date).map((r) => ({ ref: `E${r.row}`, clear: true }));
    report.index.datesCleared = edits.length;
    if (edits.length) files[e.part] = strToU8(setCells(strFromU8(files[e.part]), edits));
    mark(e.part, edits.map((x) => x.ref));
  }

  dropCalcChain(files);
  forceRecalc(files);
  const bytes = zip(files);
  return { bytes, report, catalog: buildCatalog(readWorkbook(bytes)) };
}

/** 시트 이름·코드 → 전기 이동 코드(「2120A」 「8110ARP_BS」). 괄호·공백은 뗀다. 전기 이동 조서가 아니면 null. */
function carryCodeOf(name: string): string | null {
  const s = norm(name).replace(/\(.*$/, '');
  return CARRY_FORWARD_CODES.find((c) => s === c) ?? null;
}

/** 대상기간 「제18기 2025년 1월 1일 ～ 2025년 12월 31일」의 앞 날짜 → 「2025-01-01」. */
function openingOfPeriod(period: string): string | null {
  const m = /(\d{4})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})/.exec(period ?? '');
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

/** 옮겨 적는 전기 값의 기간 날짜를 한 해 올린다(갈아끼울 때). */
function bumpEdit(e: CellEdit, r: DateRules): CellEdit {
  if (e.num != null && r.serials.has(e.num)) return { ...e, num: r.serials.get(e.num)! };
  if (e.text != null) { const t = bumpDatesInText(e.text, r); if (t !== e.text) return { ...e, text: t }; }
  return e;
}

export { isoDate, codeOf };
