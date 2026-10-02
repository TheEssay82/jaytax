// 정산표 이월 — 작년 최종 정산표(WTB)를 올해 중간감사용으로 민다. 순수 모듈(브라우저·노드 같이).
//
// 사용자 2026-10-03 「보통 이월하는 순서」(제이스튜디오 FY25 → FY26 중간, 기준월 2026-08-31):
//   2  SCE 전기 자본변동표를 지우고 당기 자본변동표의 링크를 전기로 옮긴다            → rollSce
//   3  WBS: S(수정후)의 숫자를 P(회사제시) 앞에 한 열로 끼운다 — 서식은 P, 식은 P 것 → rollTable
//   4  6~7행 기수·연도                                                                → rollTable
//   5  새 Q(올해 회사제시)는 함수 아닌 숫자 칸을 0 으로 — 그리고 회사 시산표로 채운다   → rollTable·fillFromTb
//   6  WPL 도 같게                                                                    → rollTable
//   7  WBS·WPL 수정사항 DR·CR 비우기                                                   → rollTable
//   8  A500 수정분개 비우기, B2 = 올해 연말                                            → rollA500
//   9·10 A500 H35·H38 의 WPL 링크 — 열 끼우기가 저절로 올해 열로 민다                   → insertColumns
//   11 작성자·검토자                                                                   → rollA500
//   12 WBS 이익잉여금 검증(109행) — 엑셀에서 확인
//   13 최근 4개 연도만 보이게 열 숨기기(지우지 않음)                                    → hideOldYears
//   14 보고서BS·PL 1~2행, 링크는 해당 기수로                                            → 「한 해 앞으로」·bumpHeads
//   15 SCE 당기 완성                                                                   → rollSce
//   16 WCF B·C 열 링크를 올해 WBS 열로                                                 → 「한 해 앞으로」
// 사용자 결정(같은 날): 합계 줄은 식 유지 · Q 는 시산표로 바로 채움 · Q7 = 기준월 · 시트 이름 FY25→FY26 ·
// 증감 열의 값 칸은 수식으로 통일 · 작성자·검토자는 일반조서 세팅 값.
//
// 「한 해 앞으로」: 열을 끼운 뒤 **모든 시트의 수식**에서 WBS·WPL 의 과거 연도 열 참조를 다음 해 열로 바꾼다
// (보고서BS D열 =SUMIF(WBS!$O…) → $P, SCE 전기초 =WBS!N82 → O82, WBS 당기 =O108 → P108). 단 WBS·WPL 의 과거 열 속 수식은 그대로.
import { strFromU8, strToU8 } from 'fflate';
import { readWorkbook, type SheetData } from './xlsxRead';
import { setCells, excelSerial, type CellEdit } from './xlsxCells';
import { sheetEntries, dropCalcChain, forceRecalc } from './xlsxTransplant';
import { colName, colNum, insertColumns, insertRowsBook, mapFormulas, mapRefs, moveRelative, unshareFormulas } from './xlsxCols';
import { insertRowsAfter } from './xlsxRows';
import { renameSheetRefs } from './gwpRoll';

export interface TbLine {
  name: string;
  /** 재무상태표 부분·손익 */ section: '자산' | '부채' | '자본' | '손익';
  /** 유동(당좌·재고·유동부채)인가 — 이름이 같은 유동·비유동 줄을 가른다 */ current?: boolean;
  /** 차변잔액 − 대변잔액 */ bal: number;
}

export interface WtbRollOptions {
  /** 올해 기준일(중간이면 기준월 말) 「2026-08-31」 */ closing: string;
  /** 올해 연말 「2026-12-31」 — A500 B2 */ yearEnd: string;
  /** 작년 결산일 「2025-12-31」 */ prevEnd: string;
  /** 올해 기수 — 없으면 WBS 머리 + 1 */ term?: number;
  /** A500 작성자·검토자 — **회사 담당자**(사용자 2026-10-03 정정: 감사인이 아니다). 주면 바꾸고, 없으면 작년 그대로. */
  companyAuthor?: string; companyReviewer?: string;
  tb?: TbLine[];
  /** 보이게 둘 해 수(올해 포함) — 기본 4 */ years?: number;
  /** 시산표에만 있는 계정을 어디에 — 이미 있는 줄에 더하기(label = C열 이름) 또는 과목(B열) 끝에 새 줄 */
  place?: WtbPlace[];
}

export type WtbPlace =
  | { name: string; sheet: 'WBS' | 'WPL'; to: 'row'; label: string }
  | { name: string; sheet: 'WBS' | 'WPL'; to: 'new'; fsli: string };

export interface WtbRow { sheet: 'WBS' | 'WPL'; row: number; fsli: string; label: string; section: TbLine['section'] }

/** 화면용 — WBS·WPL 의 계정 줄(과목·회사제시계정·부분). 새 계정을 어디에 둘지 고를 목록. */
export function wtbOutline(bytes: Uint8Array): { rows: WtbRow[]; term: number | null } {
  const rows: WtbRow[] = [];
  let term: number | null = null;
  for (const sh of readWorkbook(bytes, (n) => n === 'WBS' || n === 'WPL')) {
    const L = readLayout(sh);
    if (!L) continue;
    if (sh.name === 'WBS') term = L.curTerm;
    const { sec } = rowSections(sh, L, sh.name === 'WPL');
    for (const r of L.accounts) {
      rows.push({ sheet: sh.name as 'WBS' | 'WPL', row: r, fsli: (sh.cells.get(`B${r}`)?.text ?? '').trim(), label: (sh.cells.get(`C${r}`)?.text ?? '').trim(), section: sh.name === 'WPL' ? '손익' : sec.get(r)?.section ?? '자산' });
    }
  }
  return { rows, term };
}

export interface WtbRollReport {
  term: number;
  tables: { sheet: string; insertedAt: string; prior: string; company: string; zeroed: number; normalized: number; hidden: string }[];
  filled: { sheet: string; row: number; label: string; value: number; from: string[] }[];
  unmatched: TbLine[];
  renamed: [string, string][];
  notes: string[];
}

const dec = (b: Uint8Array) => strFromU8(b);
const enc = (s: string) => strToU8(s);
const norm = (s: string | undefined) => (s ?? '').replace(/[\s.·/]/g, '');
const termOf = (s: string | undefined) => { const m = /제?\s*(\d{1,3})\s*기/.exec(s ?? ''); return m ? Number(m[1]) : null; };
const rowOf = (ref: string) => Number(/\d+$/.exec(ref)![0]);
const colOf = (ref: string) => /^[A-Z]+/.exec(ref)![0];

/** WBS·WPL 의 모양 — 머리 줄(「회사제시계정」)과 올해 묶음(회사제시·DR·CR·수정후)·증감 열. */
export interface TableLayout {
  sheet: string;
  head: number;
  /** 회사제시 · 수정 DR · CR · 수정후 · 증감액 · 증감율 (열 번호) */ cur: number; dr: number; cr: number; adj: number; inc: number | null; ratio: number | null;
  curTerm: number | null;
  /** 과거 연도 → 그 해 금액 열(묶음이면 수정후 열) */ history: Map<number, number>;
  /** 계정 줄(C열 회사제시계정이 있는 줄) */ accounts: number[];
  /** 마지막 줄 — 이 아래는 표가 아니다 */ last: number;
}

export function readLayout(sh: SheetData): TableLayout | null {
  let head = 0;
  for (const [ref, v] of sh.cells) if (colOf(ref) === 'C' && norm(v.text) === '회사제시계정') { head = rowOf(ref); break; }
  if (!head) return null;
  const text = (c: number, r: number) => sh.cells.get(`${colName(c)}${r}`)?.text ?? '';
  const maxCol = Math.max(...[...sh.cells.keys()].map((r) => colNum(colOf(r))));
  // 올해 묶음 — 「제n기 | 수정사항」 이고 그 아래 「DR | CR」. 맨 오른쪽 것.
  let cur = 0;
  for (let c = 4; c <= maxCol; c++) if (termOf(text(c, head)) != null && /수정/.test(text(c + 1, head)) && /DR/i.test(text(c + 1, head + 1))) cur = c;
  if (!cur) return null;
  let inc: number | null = null;
  for (let c = cur + 3; c <= Math.min(maxCol, cur + 8); c++) if (/증감액/.test(text(c, head + 1)) || /증감액/.test(text(c, head))) { inc = c; break; }
  const ratio = inc && /증감율|증감률/.test(text(inc + 1, head + 1) + text(inc + 1, head)) ? inc + 1 : null;
  // 과거 연도 — 머리 글자(수식 =D6 이면 캐시 글자)로 기수. 같은 기수가 여럿이면 오른쪽(수정후).
  const history = new Map<number, number>();
  for (let c = 4; c < cur; c++) { const t = termOf(text(c, head)); if (t != null) history.set(t, c); }
  const accounts: number[] = [];
  let last = head;
  for (const [ref, v] of sh.cells) {
    const r = rowOf(ref);
    if (colOf(ref) === 'C' && r > head + 1 && v.text && !v.formula) accounts.push(r);
    if (colOf(ref) === colName(cur + 3) && r > last && (v.formula || v.num != null)) last = r;
  }
  // C열 이름은 없어도 회사제시 열에 숫자를 직접 넣은 줄(WPL 「Ⅶ.법인세등」)도 계정 줄 — 검증 줄(=P57=P99·「검증」) 위까지만.
  let end = last;
  for (let r = head + 2; r <= last; r++) {
    const b = sh.cells.get(`B${r}`)?.text ?? '';
    const f = sh.cells.get(`${colName(cur + 3)}${r}`)?.formula ?? '';
    if (/검증|차이/.test(b) || /^[^=]*[A-Z]+\d+=[A-Z]+\d+$/.test(f)) { end = r - 1; break; }
  }
  for (const [ref, v] of sh.cells) {
    const r = rowOf(ref);
    if (colOf(ref) === colName(cur) && r > head + 1 && r <= end && v.num != null && !v.formula && !accounts.includes(r) && sh.cells.get(`B${r}`)?.text) accounts.push(r);
  }
  accounts.sort((a, b) => a - b);
  return { sheet: sh.name, head, cur, dr: cur + 1, cr: cur + 2, adj: cur + 3, inc, ratio, curTerm: termOf(text(cur, head)), history, accounts, last };
}

/** 줄의 성격 — 대변(부채·자본·수익)이면 true. 같은 무리 수정후 식에서 배우고, 없으면 위 머리글로. */
function creditRows(sh: SheetData, L: TableLayout): Map<number, boolean> {
  const out = new Map<number, boolean>();
  const comp = colName(L.cur), dr = colName(L.dr);
  const fromFormula = (r: number): boolean | null => {
    const f = sh.cells.get(`${colName(L.adj)}${r}`)?.formula?.replace(/\s|\$/g, '');
    if (!f) return null;
    if (new RegExp(`^\\+?${comp}${r}-${dr}${r}`).test(f)) return true;
    if (new RegExp(`^\\+?${comp}${r}\\+${dr}${r}`).test(f)) return false;
    return null;
  };
  let section = false;
  const isWpl = /PL/i.test(L.sheet);
  for (let r = L.head + 2; r <= L.last; r++) {
    const b = norm(sh.cells.get(`B${r}`)?.text);
    if (!L.accounts.includes(r)) {
      if (!isWpl && /^(부채|자본)$/.test(b)) section = true;
      if (isWpl && /^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX]+\.?/.test(b)) section = /수익|매출/.test(b);
      continue;
    }
    out.set(r, fromFormula(r) ?? section);
  }
  // 식이 없는 줄은 같은 무리(이어진 계정 줄)의 식 있는 줄을 따른다.
  for (const r of L.accounts) {
    if (fromFormula(r) != null) continue;
    for (let d = 1; d < 40; d++) {
      const up = fromFormula(r - d), down = fromFormula(r + d);
      if (!L.accounts.includes(r - d) && !L.accounts.includes(r + d)) break;
      if (L.accounts.includes(r - d) && up != null) { out.set(r, up); break; }
      if (L.accounts.includes(r + d) && down != null) { out.set(r, down); break; }
    }
  }
  return out;
}

/** 줄마다 부분(자산·부채·자본·손익)·유동·시산표 부호 — 머리글(「부채」「자본」「Ⅱ.비유동자산」「Ⅰ.영업수익」)로. */
function rowSections(sh: SheetData, L: TableLayout, isPl: boolean) {
  const blabel = (r: number) => sh.cells.get(`B${r}`)?.text ?? '';
  const sec = new Map<number, { section: TbLine['section']; current: boolean }>();
  let s: TbLine['section'] = isPl ? '손익' : '자산'; let current = true;
  let plCredit = false;
  const sign = new Map<number, number>();
  for (let r = L.head + 2; r <= L.last; r++) {
    const b = norm(blabel(r));
    if (!isPl && /^부채$/.test(b)) { s = '부채'; current = true; }
    if (!isPl && /^자본$/.test(b)) s = '자본';
    if (/비유동/.test(b)) current = false; else if (/^[ⅠⅡⅢIV]+\.?유동|^\(?1\)?당좌|유동자산$|유동부채$/.test(b) && !/비유동/.test(b)) current = true;
    if (isPl && !L.accounts.includes(r) && /^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX]+\.?/.test(b)) plCredit = /수익|매출/.test(b);
    sec.set(r, { section: s, current });
    // 시산표 금액의 부호 — 자산·비용은 차변−대변, 부채·자본·수익은 대변−차변(차감 계정은 음수로 남는다: 감가상각누계액·퇴직연금운용자산).
    sign.set(r, (isPl ? plCredit : s !== '자산') ? -1 : 1);
  }
  return { sec, sign };
}

/** 시산표 → 표 줄. 같은 줄로 가는 것은 더한다. alias = 사람이 고른 짝(시산표 이름 → 정산표 C열 이름, 둘 다 norm). */
function matchTb(sh: SheetData, L: TableLayout, tb: TbLine[], isPl: boolean, alias: Map<string, string> = new Map()) {
  const label = (r: number) => sh.cells.get(`C${r}`)?.text ?? '';
  const blabel = (r: number) => sh.cells.get(`B${r}`)?.text ?? '';
  const { sec, sign } = rowSections(sh, L, isPl);
  const rows = L.accounts.filter((r) => (isPl ? true : sec.get(r)?.section !== '손익'));
  const sums = new Map<number, { value: number; from: string[] }>();
  const unmatched: TbLine[] = [];
  const add = (r: number, t: TbLine, v: number) => { const x = sums.get(r) ?? { value: 0, from: [] }; x.value += v; x.from.push(t.name); sums.set(r, x); };
  const lines = tb.filter((t) => (isPl ? t.section === '손익' : t.section !== '손익'));
  const ni = tb.filter((t) => t.section === '손익').reduce((a, t) => a - t.bal, 0);   // 수익(대변) − 비용(차변)
  let prevName = '';
  for (const t of lines) {
    const n = norm(t.name);
    const contra = /^(감가상각누계액|대손충당금|정부보조금|국고보조금|현재가치할인차금|손상차손누계액)$/.test(n);
    const pool = rows.filter((r) => isPl || (sec.get(r)?.section === t.section));
    const byCurrent = (cands: number[]) => (cands.length > 1 && t.current != null ? (cands.filter((r) => sec.get(r)?.current === t.current).length ? cands.filter((r) => sec.get(r)?.current === t.current) : cands) : cands);
    let cands: number[] = [];
    if (alias.has(n)) {
      cands = rows.filter((r) => norm(label(r)) === alias.get(n));
      if (!cands.length) { if (t.bal) unmatched.push(t); continue; }
    } else if (contra) {
      cands = pool.filter((r) => { const c = norm(label(r)); if (!c.startsWith(n)) return false; const suf = c.slice(n.length).replace(/^-/, ''); return !!suf && (prevName.includes(suf) || suf.includes(prevName)); });
    } else {
      const tries = [n, n.replace(/_.*$/, ''), n.replace(/\(.*?\)/g, ''),
        n === '자본금' ? '보통주자본금' : '', n === '이월이익잉여금' ? '미처분이익잉여금' : ''].filter(Boolean);
      for (const k of tries) { cands = byCurrent(pool.filter((r) => norm(label(r)) === k)); if (cands.length) break; }
      if (!cands.length) for (const k of tries) { cands = byCurrent(pool.filter((r) => norm(blabel(r)) === k)); if (cands.length) break; }
      prevName = n;
    }
    // 부분이 다른 줄(시산표는 투자자산, 정산표는 비유동부채의 차감 — 퇴직연금운용자산)
    if (!cands.length && !contra && !isPl) {
      const all = rows.filter((r) => sec.get(r)?.section !== t.section);
      for (const k of [n, n.replace(/_.*$/, '')]) { cands = all.filter((r) => norm(label(r)) === k); if (cands.length) break; }
    }
    if (!cands.length) { if (t.bal) unmatched.push(t); continue; }
    const r = cands[0];
    add(r, t, (sign.get(r) ?? 1) * t.bal);
    // 중간 재무상태표의 미처분이익잉여금은 당기순이익을 품는다(FY25 중간 P94 = 기초 + 1~8월 순이익).
    if (!isPl && n === '이월이익잉여금' && norm(label(r)) === '미처분이익잉여금' && ni) add(r, { ...t, name: '당기순이익(손익)' }, ni);
  }
  return { sums, unmatched };
}

/** 표 한 장(WBS·WPL)을 민다. layouts 는 열 끼우기 전 모양. 반환: 끼운 뒤 모양에서 할 편집. */
interface Planned { L: TableLayout; sh: SheetData; credit: Map<number, boolean> }

function tableEdits(p: Planned, o: { closing: number; prevEnd: number; term: number; prevTerm: number; fill?: Map<number, { value: number; from: string[] }> }) {
  const { L, sh } = p;
  const at = L.cur;                                     // 끼운 열(새 전기) = 원래 회사제시 자리
  const C = (n: number) => colName(n);
  const comp = at + 1, dr = at + 2, cr = at + 3, adj = at + 4;
  const inc = L.inc ? L.inc + 1 : null, ratio = L.ratio ? L.ratio + 1 : null;
  const edits: CellEdit[] = [];
  let zeroed = 0, normalized = 0;
  const acc = new Set(L.accounts);
  // 머리 — 새 전기 · 올해 회사제시
  edits.push({ ref: `${C(at)}${L.head}`, text: `제${o.prevTerm}기` }, { ref: `${C(at)}${L.head + 1}`, num: o.prevEnd });
  edits.push({ ref: `${C(comp)}${L.head}`, text: `제${o.term}기` }, { ref: `${C(comp)}${L.head + 1}`, num: o.closing });
  for (let r = L.head + 2; r <= L.last + 12; r++) {
    const old = sh.cells.get(`${C(L.cur)}${r}`);          // 원래 회사제시(끼우기 전 좌표)
    const after = sh.cells.get(`${C(L.adj)}${r}`);        // 원래 수정후
    // 새 전기: 식은 원래 P 것 그대로(좌표가 같은 자리), 숫자는 수정후.
    if (old?.formula && !acc.has(r)) edits.push({ ref: `${C(at)}${r}`, formula: old.formula });
    else if (acc.has(r) && after?.num != null) edits.push({ ref: `${C(at)}${r}`, num: after.num });
    else if (old?.formula) edits.push({ ref: `${C(at)}${r}`, formula: old.formula });
    // 올해 회사제시: 계정 줄의 숫자 칸 → 0, 시산표 값.
    if (acc.has(r)) {
      const v = o.fill?.get(r);
      if (v) edits.push({ ref: `${C(comp)}${r}`, num: Math.round(v.value) });
      else if (!old?.formula && old?.num != null) { edits.push({ ref: `${C(comp)}${r}`, num: 0 }); zeroed++; }
      else if (o.fill && !old?.formula) edits.push({ ref: `${C(comp)}${r}`, num: 0 });
      // 수정사항 DR·CR 비우기
      edits.push({ ref: `${C(dr)}${r}`, clear: true }, { ref: `${C(cr)}${r}`, clear: true });
      // 수정후 — 값이면 식으로
      if (!after?.formula) {
        const cred = p.credit.get(r) ?? false;
        edits.push({ ref: `${C(adj)}${r}`, formula: cred ? `${C(comp)}${r}-${C(dr)}${r}+${C(cr)}${r}` : `${C(comp)}${r}+${C(dr)}${r}-${C(cr)}${r}` });
        normalized++;
      }
    }
  }
  // 증감·증감율 — 값 칸은 가까운 식을 본떠(끼운 뒤 좌표의 식은 아래에서 다시 읽어 만든다).
  return { edits, zeroed, normalized, inc, ratio };
}

/** 증감 열의 값 칸 → 같은 열 가까운 식을 줄만 옮겨. sheetXml 은 끼운 뒤. */
function normalizeColumn(xml: string, col: string, from: number, to: number, skip: Set<number>): { xml: string; n: number } {
  const sh = readSheetXml(xml);
  const f = new Map<number, string>();
  for (let r = from; r <= to; r++) { const v = sh.get(`${col}${r}`); if (v?.formula) f.set(r, v.formula); }
  if (!f.size) return { xml, n: 0 };
  const edits: CellEdit[] = [];
  for (let r = from; r <= to; r++) {
    const v = sh.get(`${col}${r}`);
    if (!v || v.formula || v.num == null || skip.has(r)) continue;
    let best: number | null = null;
    for (const k of f.keys()) if (best == null || Math.abs(k - r) < Math.abs(best - r)) best = k;
    if (best == null) continue;
    edits.push({ ref: `${col}${r}`, formula: moveRelative(f.get(best)!, r - best, 0) });
  }
  return { xml: edits.length ? setCells(xml, edits) : xml, n: edits.length };
}

function readSheetXml(xml: string): Map<string, { formula?: string; num?: number; text?: string }> {
  const out = new Map<string, { formula?: string; num?: number; text?: string }>();
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = /\br="([A-Z]+\d+)"/.exec(m[1])?.[1]; if (!ref) continue;
    const body = m[2] ?? '';
    const f = /<f\b(?:[^>]*[^>/])?>([\s\S]*?)<\/f>/.exec(body)?.[1];
    const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
    const t = /\bt="([^"]*)"/.exec(m[1])?.[1];
    const x: { formula?: string; num?: number; text?: string } = {};
    if (f != null) x.formula = f.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    if (v != null && (!t || t === 'n')) x.num = Number(v);
    else if (v != null || /<is>/.test(body)) x.text = v ?? '';
    out.set(ref, x);
  }
  return out;
}

/** <cols> 에서 from~to 열을 숨긴다(정의를 쪼갠다). */
export function hideCols(xml: string, from: number, to: number): string {
  if (to < from) return xml;
  if (!/<cols>/.test(xml)) xml = xml.replace(/<sheetData\b/, '<cols></cols><sheetData');
  return xml.replace(/<cols>([\s\S]*?)<\/cols>/, (_m, body: string) => {
    const defs = [...body.matchAll(/<col\b([^>]*?)\/>/g)].map((m) => ({ a: m[1], min: Number(/\bmin="(\d+)"/.exec(m[1])![1]), max: Number(/\bmax="(\d+)"/.exec(m[1])![1]) }));
    const out: string[] = [];
    const mk = (a: string, x: number, y: number, hide: boolean) => {
      let s = a.replace(/\bmin="\d+"/, `min="${x}"`).replace(/\bmax="\d+"/, `max="${y}"`).replace(/\s+hidden="[^"]*"/, '');
      if (hide) s += ' hidden="1"';
      return `<col${s}/>`;
    };
    let covered = from;
    for (const d of defs) {
      // 정의가 없는 빈 틈(숨길 범위 안)
      if (d.min > covered && covered <= to) { const y = Math.min(d.min - 1, to); out.push(`<col min="${covered}" max="${y}" width="9" hidden="1"/>`); covered = y + 1; }
      if (d.max < from || d.min > to) { out.push(`<col${d.a}/>`); continue; }
      if (d.min < from) out.push(mk(d.a, d.min, from - 1, false));
      out.push(mk(d.a, Math.max(d.min, from), Math.min(d.max, to), true));
      if (d.max > to) out.push(mk(d.a, to + 1, d.max, false));
      covered = Math.max(covered, Math.min(d.max, to) + 1);
    }
    if (covered <= to) out.push(`<col min="${covered}" max="${to}" width="9" hidden="1"/>`);
    out.sort((x, y) => Number(/min="(\d+)"/.exec(x)![1]) - Number(/min="(\d+)"/.exec(y)![1]));
    return `<cols>${out.join('')}</cols>`;
  });
}

/** 작년 최종 정산표 → 올해 이월본. */
export function rollWtb(bytes: Uint8Array, o: WtbRollOptions, unzipFn: (b: Uint8Array) => Record<string, Uint8Array>, zipFn: (f: Record<string, Uint8Array>) => Uint8Array): { bytes: Uint8Array; report: WtbRollReport } {
  const files = unzipFn(bytes);
  for (const e of sheetEntries(files)) files[e.part] = enc(unshareFormulas(dec(files[e.part])));   // 공유 수식을 풀고 읽는다
  const report0: string[] = [];
  // ⓪ 새 계정 줄 — 과목(B열) 무리 끝에 한 줄. 다른 시트의 SUMIF 범위도 따라 밀린다(insertRowsBook).
  for (const p of (o.place ?? []).filter((x): x is Extract<WtbPlace, { to: 'new' }> => x.to === 'new')) {
    const sh = readWorkbook(zipFn(files), (n) => n === p.sheet)[0];
    const L = sh && readLayout(sh);
    const mine = L ? L.accounts.filter((r) => norm(sh.cells.get(`B${r}`)?.text) === norm(p.fsli)) : [];
    if (!L || !mine.length) { report0.push(`${p.sheet} 에 과목 「${p.fsli}」 줄이 없어 「${p.name}」 새 줄을 넣지 못했습니다.`); continue; }
    const after = Math.max(...mine), n = after + 1;
    insertRowsBook(files, sheetEntries(files).map((e) => ({ name: e.name, part: e.part })), p.sheet, after, 1, dec, enc, insertRowsAfter);
    const edits: CellEdit[] = [
      { ref: `B${n}`, text: sh.cells.get(`B${after}`)?.text ?? p.fsli }, { ref: `C${n}`, text: p.name },
    ];
    const a = sh.cells.get(`A${after}`)?.text; if (a) edits.push({ ref: `A${n}`, text: a });
    for (const c of [L.adj, L.inc, L.ratio]) {
      const f = c ? sh.cells.get(`${colName(c)}${after}`)?.formula : undefined;
      if (c && f) edits.push({ ref: `${colName(c)}${n}`, formula: moveRelative(f, 1, 0) });
    }
    const part = sheetEntries(files).find((e) => e.name === p.sheet)!.part;
    files[part] = enc(setCells(dec(files[part]), edits));
    report0.push(`${p.sheet} ${n}행 — 과목 「${p.fsli}」 끝에 새 계정 「${p.name}」`);
  }
  const before = readWorkbook(zipFn(files));
  const entries = () => sheetEntries(files);
  const partOf = (name: string) => entries().find((e) => e.name === name)!.part;
  const report: WtbRollReport = { term: 0, tables: [], filled: [], unmatched: [], renamed: [], notes: [...report0] };
  const closing = excelSerial(o.closing)!, prevEnd = excelSerial(o.prevEnd)!, yearEnd = excelSerial(o.yearEnd)!;
  const prevEndOld = excelSerial(`${Number(o.prevEnd.slice(0, 4)) - 1}${o.prevEnd.slice(4)}`)!;

  const tables: Planned[] = [];
  for (const name of ['WBS', 'WPL']) {
    const sh = before.find((s) => s.name === name);
    const L = sh && readLayout(sh);
    if (!sh || !L) { report.notes.push(`${name} 시트(머리 「회사제시계정」·「제n기 | 수정사항」)를 찾지 못했습니다.`); continue; }
    tables.push({ L, sh, credit: creditRows(sh, L) });
  }
  const wbs = tables.find((t) => t.L.sheet === 'WBS');
  const prevTerm = wbs?.L.curTerm ?? tables[0]?.L.curTerm ?? 0;
  const term = o.term ?? prevTerm + 1;
  report.term = term;

  // ① 열 끼우기(모든 시트의 참조가 따라 밀린다) — 공유 수식도 이때 풀린다.
  for (const t of tables) insertColumns(files, entries().map((e) => ({ name: e.name, part: e.part })), t.L.sheet, t.L.cur, 1, dec, enc);

  // ② 한 해 앞으로 — 과거 연도 열 참조 → 다음 해 열(올해 전기 = 끼운 열). WBS·WPL 의 과거 열 속 수식은 빼고.
  const forward = new Map<string, Map<string, string>>();
  for (const t of tables) {
    const m = new Map<string, string>();
    const years = [...t.L.history.keys()].sort((a, b) => a - b);
    for (const y of years) {
      const nextCol = y + 1 === prevTerm ? t.L.cur : t.L.history.get(y + 1);
      if (nextCol != null) m.set(colName(t.L.history.get(y)!), colName(nextCol));
    }
    forward.set(t.L.sheet, m);
  }
  const fwdRef = (sheet: string | null, here: string, ref: string) => {
    const m = forward.get(sheet ?? here);
    if (!m) return ref;
    return ref.replace(/(\$?)([A-Z]{1,3})(?=\$?\d|:|$)/g, (x, d: string, c: string) => (m.has(c) ? `${d}${m.get(c)}` : x));
  };
  for (const e of entries()) {
    const t = tables.find((x) => x.L.sheet === e.name);
    let xml = dec(files[e.part]);
    if (t) {
      xml = xml.replace(/(<c\b[^>]*?\br="([A-Z]+)\d+"(?:[^>]*[^>/])?>(?:(?!<\/c>|<c\b)[\s\S])*?)(<f\b(?:[^>]*[^>/])?>)([\s\S]*?)(<\/f>)/g, (m, head: string, col: string, fo: string, f: string, fc: string) =>
        (colNum(col) < t.L.cur ? m : `${head}${fo}${escXml(mapRefs(unescXml(f), (s, ref) => fwdRef(s, e.name, ref)))}${fc}`));
    } else {
      xml = mapFormulas(xml, (f) => mapRefs(f, (s, ref) => fwdRef(s, e.name, ref)));
    }
    files[e.part] = enc(xml);
  }

  // ③ 표마다 — 새 전기 열 채우기, 올해 회사제시 0·시산표, DR·CR 비우기, 수정후·증감 식 통일, 머리.
  for (const t of tables) {
    const isPl = t.L.sheet === 'WPL';
    let fill: Map<number, { value: number; from: string[] }> | undefined;
    if (o.tb?.length) {
      const alias = new Map((o.place ?? []).filter((p) => p.sheet === t.L.sheet).map((p) => [norm(p.name), norm(p.to === 'row' ? p.label : p.name)] as [string, string]));
      const m = matchTb(t.sh, t.L, o.tb, isPl, alias);
      fill = m.sums; report.unmatched.push(...m.unmatched);
      for (const [r, v] of m.sums) report.filled.push({ sheet: t.L.sheet, row: r, label: t.sh.cells.get(`C${r}`)?.text ?? '', value: Math.round(v.value), from: v.from });
    }
    const te = tableEdits(t, { closing, prevEnd, term, prevTerm, fill });
    let xml = setCells(dec(files[partOf(t.L.sheet)]), te.edits);
    let normalized = te.normalized;
    const skip = new Set<number>();
    if (te.inc) { const r = normalizeColumn(xml, colName(te.inc), t.L.head + 2, t.L.last, skip); xml = r.xml; normalized += r.n; }
    if (te.ratio) { const r = normalizeColumn(xml, colName(te.ratio), t.L.head + 2, t.L.last, skip); xml = r.xml; normalized += r.n; }
    // ⑬ 최근 n 해만 — 남길 과거 열: 새 전기(끼운 열) + 그 앞 (years-2) 해.
    const keep = (o.years ?? 4) - 2;
    const hist = [...t.L.history.entries()].sort((a, b) => b[0] - a[0]).slice(0, keep).map(([, c]) => c);
    const firstKeep = hist.length ? Math.min(...hist) : t.L.cur;
    // 묶음(제n기 | 수정 DR·CR | 수정후)의 첫 열부터 숨기지 않게 — 남길 해의 묶음 시작은 그 해 머리 글자가 처음 나온 열.
    let hideTo = firstKeep - 1;
    for (let c = 4; c < firstKeep; c++) if (termOf(t.sh.cells.get(`${colName(c)}${t.L.head}`)?.text) === termOf(t.sh.cells.get(`${colName(firstKeep)}${t.L.head}`)?.text)) { hideTo = c - 1; break; }
    if (hideTo >= 4) xml = hideCols(xml, 4, hideTo);
    files[partOf(t.L.sheet)] = enc(xml);
    report.tables.push({ sheet: t.L.sheet, insertedAt: colName(t.L.cur), prior: `제${prevTerm}기`, company: `제${term}기 ${o.closing}`, zeroed: te.zeroed, normalized, hidden: hideTo >= 4 ? `D:${colName(hideTo)}` : '' });
  }

  // ④ A500 — 수정분개 비우기, B2 = 올해 연말, 작성자·검토자.
  const a500 = entries().find((e) => /^A500|수정(사항)?집계/.test(e.name));
  if (a500) {
    const sh = readSheetXml(dec(files[a500.part]));
    const edits: CellEdit[] = [];
    let headRow = 0, sumRow = 0;
    const sstr = sharedStrings(files);
    const ax = dec(files[a500.part]);
    const txtOf = new Map([...sh.keys()].map((ref) => [ref, cellText(ax, ref, sstr)]));
    for (const ref of [...sh.keys()].sort((a, b) => rowOf(a) - rowOf(b))) {
      const t = (txtOf.get(ref) ?? '').replace(/\s/g, '');
      if (!headRow && /계정과목/.test(t)) headRow = rowOf(ref);
      if (!sumRow && headRow && t === '합계' && rowOf(ref) > headRow) sumRow = rowOf(ref);
    }
    for (const [ref, v] of sh) {
      const r = rowOf(ref);
      if (headRow && sumRow && r > headRow + 1 && r < sumRow && (v.num != null || v.text != null || v.formula)) edits.push({ ref, clear: true });
      if (ref === 'B2') edits.push({ ref, num: yearEnd });
      const txt = txtOf.get(ref) ?? '';
      if (o.companyAuthor && /작성자\s*:/.test(txt)) edits.push({ ref, text: txt.replace(/(작성자\s*:\s*)([^님]*?)(\s*님|$)/, `$1${o.companyAuthor}$3`) });
      if (o.companyReviewer && /검토자\s*:/.test(txt)) edits.push({ ref, text: txt.replace(/(검토자\s*:\s*)([^님]*?)(\s*님|$)/, `$1${o.companyReviewer}$3`) });
    }
    if (edits.length) files[a500.part] = enc(setCells(dec(files[a500.part]), edits));
    if (!headRow || !sumRow) report.notes.push(`${a500.name}: 수정분개 표(머리 「계정과목」~「합계」)를 찾지 못해 비우지 않았습니다.`);
  }

  // ⑤ SCE — 전기 자본변동표를 올해 것으로.
  const sce = entries().find((e) => /^SCE/.test(e.name));
  if (sce) files[sce.part] = enc(rollSce(dec(files[sce.part]), sharedStrings(files), report));

  // ⑥ 보고서·현금흐름 머리 — 날짜·기수 한 해 앞으로.
  for (const e of entries()) {
    if (!/^보고서|^WCF|^SCF/.test(e.name)) continue;
    files[e.part] = enc(bumpHeads(dec(files[e.part]), sharedStrings(files), { [prevEnd]: closing, [prevEndOld]: prevEnd }));
  }

  // ⑥-2 보고서·WCF 전기 열의 값 칸 — 같은 줄 당기 열이 WBS·WPL 수정후 열을 가리키면, 전기 열은 새 전기 열을 가리키게(제이 보고서BS D19 「0」).
  const adjToPrior = new Map(tables.map((t) => [t.L.sheet, [colName(t.L.adj + 1), colName(t.L.cur)] as [string, string]]));
  for (const e of entries()) {
    if (!/^보고서|^WCF/.test(e.name)) continue;
    const r = fillPriorLinks(dec(files[e.part]), sharedStrings(files), adjToPrior);
    if (r.n) { files[e.part] = enc(r.xml); report.notes.push(`${e.name}: 전기 열에 값으로 적힌 ${r.n}칸을 전기 링크로 바꿨습니다(${r.refs.slice(0, 6).join(', ')}${r.refs.length > 6 ? ' …' : ''}).`); }
  }

  // ⑥-3 WCF 에 없는 과목 — 보고서BS 의 과목(F열 열쇠) 가운데 WCF(A열)에 줄이 없고 올해·작년 금액이 있는 것(제이 부가세대급금 7,925만).
  {
    const wbsT = tables.find((t) => t.L.sheet === 'WBS');
    const nz = new Set<string>();
    if (wbsT) {
      const bOf = (r: number) => norm(wbsT.sh.cells.get(`B${r}`)?.text);
      for (const r of wbsT.L.accounts) if (wbsT.sh.cells.get(`${colName(wbsT.L.adj)}${r}`)?.num) nz.add(bOf(r));
      for (const f of report.filled) if (f.sheet === 'WBS' && f.value) nz.add(bOf(f.row));
      for (const p of o.place ?? []) if (p.to === 'new' && p.sheet === 'WBS') nz.add(norm(p.fsli));
    }
    const wcf = entries().find((e) => /^WCF/.test(e.name));
    if (wcf && nz.size) {
      const added: string[] = [];
      for (let guard = 0; guard < 40; guard++) {
        const now = readWorkbook(zipFn(files), (n) => n === '보고서BS' || n === wcf.name);
        const bs = now.find((x) => x.name === '보고서BS'), cf = now.find((x) => x.name === wcf.name);
        if (!bs || !cf) break;
        const keyRows = (sh: SheetData, keyCol: string) => {
          const out: { key: string; row: number; text: string }[] = [];
          for (const [ref, v] of sh.cells) if (colOf(ref) === 'B' && /SUMIF/i.test(v.formula ?? '')) {
            const t = sh.cells.get(`${keyCol}${rowOf(ref)}`)?.text ?? '';
            if (t) out.push({ key: norm(t), row: rowOf(ref), text: t.trim() });
          }
          return out.sort((a, b) => a.row - b.row);
        };
        const bsKeys = keyRows(bs, 'F'), cfKeys = keyRows(cf, 'A');
        const have = new Map(cfKeys.map((k) => [k.key, k.row]));
        const i = bsKeys.findIndex((k) => !have.has(k.key) && nz.has(k.key));
        if (i < 0) break;
        const nextRow = bsKeys.slice(i + 1).map((k) => have.get(k.key)).find((r) => r != null);
        const prevRow = bsKeys.slice(0, i).reverse().map((k) => have.get(k.key)).find((r) => r != null);
        const after = nextRow != null ? nextRow - 1 : prevRow;
        const tmpl = prevRow ?? nextRow;
        if (after == null || tmpl == null) { report.notes.push(`${wcf.name}: 「${bsKeys[i].text}」 줄을 넣을 자리를 찾지 못했습니다.`); nz.delete(bsKeys[i].key); continue; }
        insertRowsBook(files, entries().map((e) => ({ name: e.name, part: e.part })), wcf.name, after, 1, dec, enc, insertRowsAfter);
        const n = after + 1;
        const edits: CellEdit[] = [{ ref: `A${n}`, text: bsKeys[i].text }];
        for (let c = 2; c <= 5; c++) {
          const f = cf.cells.get(`${colName(c)}${tmpl}`)?.formula;
          if (f) edits.push({ ref: `${colName(c)}${n}`, formula: moveRelative(f, n - (tmpl > after ? tmpl + 1 : tmpl), 0) });
        }
        files[wcf.part] = enc(setCells(dec(files[wcf.part]), edits));
        added.push(`${bsKeys[i].text}(${n}행)`);
      }
      if (added.length) report.notes.push(`${wcf.name}: 보고서BS 에는 있고 WCF 에 없던 과목 줄을 넣었습니다 — ${added.join(', ')}. 현금흐름 배분 칸은 비어 있습니다.`);
    }
  }

  // ⑦ 시트 이름 _FY25 → _FY26
  const yy = (n: number) => String(n % 100).padStart(2, '0');
  const fromY = yy(Number(o.prevEnd.slice(0, 4))), toY = yy(Number(o.closing.slice(0, 4)));
  const ren = new Map<string, string>();
  for (const e of entries()) if (new RegExp(`FY${fromY}$`).test(e.name)) ren.set(e.name, e.name.replace(new RegExp(`FY${fromY}$`), `FY${toY}`));
  if (ren.size) {
    let wb = dec(files['xl/workbook.xml']);
    for (const [a, b] of ren) wb = wb.replace(new RegExp(`(<sheet\\b[^>]*\\bname=")${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(")`), `$1${b}$2`);
    files['xl/workbook.xml'] = enc(wb);
    for (const e of entries()) files[e.part] = enc(renameSheetRefs(dec(files[e.part]), ren));
    report.renamed = [...ren];
  }
  dropCalcChain(files);
  forceRecalc(files);
  return { bytes: zipFn(files), report };
}

const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescXml = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

function sharedStrings(files: Record<string, Uint8Array>): string[] | null {
  const x = files['xl/sharedStrings.xml']; if (!x) return null;
  return [...dec(x).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescXml(t[1])).join(''));
}
/** 칸 글자 — 공유문자열이면 풀어서. */
function cellText(xml: string, ref: string, sstr: string[] | null): string {
  const m = new RegExp(`<c\\b[^>]*\\br="${ref}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`).exec(xml);
  if (!m) return '';
  const full = m[0];
  const t = /\bt="([^"]*)"/.exec(full)?.[1];
  const body = m[2] ?? '';
  if (t === 's') { const v = /<v>(\d+)<\/v>/.exec(body)?.[1]; return v != null && sstr ? sstr[Number(v)] ?? '' : ''; }
  if (t === 'inlineStr') return [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => unescXml(x[1])).join('');
  if (t === 'str') return unescXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
  return '';
}

/** 머리(1~8행) — 날짜 일련번호를 map 대로, 「10기」·「제 10 기」를 한 해 앞으로. */
function bumpHeads(xml: string, sstr: string[] | null, dates: Record<number, number>): string {
  const sh = readSheetXml(xml);
  const edits: CellEdit[] = [];
  for (const [ref, v] of sh) {
    if (rowOf(ref) > 8 || v.formula) continue;
    if (v.num != null && dates[v.num] != null) edits.push({ ref, num: dates[v.num] });
    const txt = cellText(xml, ref, sstr);
    if (txt && /\d+\s*기/.test(txt)) edits.push({ ref, text: txt.replace(/(\d+)(\s*기)/g, (_m, n: string, k: string) => `${Number(n) + 1}${k}`) });
  }
  return edits.length ? setCells(xml, edits) : xml;
}

/**
 * SCE — 「(전기초)…(전기말)」 · 「(당기초)…(당기말)」 두 표.
 *   · B열 날짜(2024.01.01)는 한 해 앞으로.
 *   · 전기 사건 줄 = 같은 이름의 당기 사건 줄(링크는 보고서의 올해 열 → 전기 열, 그 밖의 링크는 값으로). 짝 없는 줄은 0.
 *   · 전기초 줄은 식이면 그대로(이미 한 해 앞으로 밀림), 값이면 작년 당기초 값.
 *   · 전기말·당기말 줄은 세로 합계 식으로.
 */
function rollSce(xml0: string, sstr: string[] | null, report: WtbRollReport): string {
  const xml = unshareFormulas(xml0);
  const sh = readSheetXml(xml);
  const label = (r: number) => cellText(xml, `B${r}`, sstr);
  const find = (re: RegExp) => { for (let r = 1; r < 80; r++) if (re.test(label(r))) return r; return 0; };
  const pOpen = find(/전기초/), pClose = find(/전기말/), cOpen = find(/당기초/), cClose = find(/당기말/);
  if (!pOpen || !pClose || !cOpen || !cClose) { report.notes.push('SCE: 「(전기초)·(전기말)·(당기초)·(당기말)」 줄을 찾지 못해 손대지 않았습니다.'); return xml0; }
  const cols: string[] = [];
  for (let c = 3; c <= 12; c++) { const ref = `${colName(c)}${pOpen - 1}`; if (cellText(xml, ref, sstr)) cols.push(colName(c)); }
  const edits: CellEdit[] = [];
  // 날짜 글자
  for (let r = pOpen; r <= cClose; r++) {
    const t = label(r);
    if (/(19|20)\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}/.test(t)) edits.push({ ref: `B${r}`, text: t.replace(/(19|20)(\d{2})(?=[.\-/]\d)/g, (_m, c: string, y: string) => `${c}${String(Number(y) + 1).padStart(2, '0')}`) });
  }
  // 보고서 올해 열 → 전기 열 (보고서BS: B·C → D·E, 보고서PL 도 같은 모양 — 머리 「n기」 두 개의 간격)
  const toPrior = (f: string) => mapRefs(f, (s, ref) => (s && /^보고서/.test(s) ? ref.replace(/(\$?)([A-Z]{1,3})(?=\$?\d|:|$)/g, (x, d: string, c: string) => (colNum(c) <= 3 ? `${d}${colName(colNum(c) + 2)}` : x)) : ref));
  const curEvents = new Map<string, number>();
  for (let r = cOpen + 1; r < cClose; r++) curEvents.set(norm(label(r)), r);
  for (let r = pOpen + 1; r < pClose; r++) {
    const src = curEvents.get(norm(label(r)));
    for (const c of cols) {
      const ref = `${c}${r}`;
      if (src == null) { if (c !== cols[cols.length - 1] || !sh.get(ref)?.formula) edits.push({ ref, num: 0 }); continue; }
      const v = sh.get(`${c}${src}`);
      if (v?.formula) {
        // 같은 시트 참조만 줄을 옮긴다(=-E15 → =-E9). 다른 시트 링크(보고서PL!C49)는 그 칸 그대로.
        const moved = mapRefs(v.formula, (sname, r2) => (sname ? r2 : moveRelative(r2, r - src, 0)));
        // 보고서의 올해 열(B·C)만 가리키면 전기 열로 바꾼 링크, 그 밖(다른 시트·보고서 전기 열)은 값으로.
        let onlyReports = true;
        mapRefs(moved, (sname, r2) => {
          if (sname && (!/^보고서/.test(sname) || [...r2.matchAll(/[A-Z]+/g)].some((c) => colNum(c[0]) > 3))) onlyReports = false;
          return r2;
        });
        if (onlyReports) edits.push({ ref, formula: toPrior(moved) });
        else edits.push({ ref, num: v.num ?? 0 });
      } else edits.push({ ref, num: v?.num ?? 0 });
    }
  }
  // 전기초 — 작년 당기초 금액(작년 정산표가 보고서와 맞춰 둔 값). 작년 전기초 식(WBS 묶음 기준)은 쓰지 않는다 — 재분류가 두 번 잡힌다.
  for (const c of cols.slice(0, -1)) edits.push({ ref: `${c}${pOpen}`, num: sh.get(`${c}${cOpen}`)?.num ?? 0 });
  // 말 줄 — 세로 합계
  for (const c of cols) {
    edits.push({ ref: `${c}${pClose}`, formula: `SUM(${c}${pOpen}:${c}${pClose - 1})` });
    edits.push({ ref: `${c}${cClose}`, formula: `SUM(${c}${cOpen}:${c}${cClose - 1})` });
  }
  return setCells(xml, edits);
}

/**
 * 더존 「합계잔액시산표」 시트 → 시산표 줄. 머리 「계 정 과 목」 열 양옆이 차변(잔액·합계) · 대변(합계·잔액).
 * 「<< 자 산 >>」 「[ 유 동 자 산 ]」 「< 당 좌 자 산 >」 머리로 부분·유동을 안다. 머리·합계 줄은 빼고 계정 줄만.
 */
export function tbFromSheet(sh: SheetData): TbLine[] {
  let headRow = 0, nameCol = 0;
  for (const [ref, v] of sh.cells) if (norm(v.text) === '계정과목') { headRow = rowOf(ref); nameCol = colNum(colOf(ref)); break; }
  if (!headRow) throw new Error('시산표에서 「계정과목」 머리를 찾지 못했습니다.');
  const drBal = nameCol - 2, crBal = nameCol + 2;
  const num = (c: number, r: number) => sh.cells.get(`${colName(c)}${r}`)?.num ?? 0;
  const maxRow = Math.max(...[...sh.cells.keys()].map(rowOf));
  const out: TbLine[] = [];
  let section: TbLine['section'] = '자산'; let current = true;
  for (let r = headRow + 1; r <= maxRow; r++) {
    const raw = sh.cells.get(`${colName(nameCol)}${r}`)?.text ?? '';
    const t = norm(raw);
    if (!t) continue;
    if (/^<<.*>>$/.test(t)) { section = /부채/.test(t) ? '부채' : /자본/.test(t) ? '자본' : /손익/.test(t) ? '손익' : '자산'; current = true; continue; }
    if (/^[[<].*[\]>]$/.test(t)) { if (/비유동/.test(t)) current = false; else if (/유동|당좌|재고/.test(t)) current = true; continue; }
    if (/^합계$/.test(t)) continue;
    out.push({ name: raw.trim().replace(/\s+/g, ' '), section, current: section === '손익' ? undefined : current, bal: num(drBal, r) - num(crBal, r) });
  }
  return out;
}

/**
 * 보고서·WCF — 머리(1~8행)의 「11기 | 10기」 또는 「당기 | 전기」 로 당기·전기 열 짝을 알고,
 * 당기 칸이 WBS·WPL 수정후 열 수식인데 전기 칸이 값이면 → 당기 수식의 그 열을 새 전기 열로 바꿔 넣는다.
 */
function fillPriorLinks(xml: string, sstr: string[] | null, adjToPrior: Map<string, [string, string]>): { xml: string; n: number; refs: string[] } {
  const sh = readSheetXml(xml);
  let cur = 0, prior = 0;
  for (let r = 1; r <= 8 && !prior; r++) {
    const hits: number[] = [];
    for (let c = 2; c <= 12; c++) if (/^\s*(\d+\s*기|당\s*기|전\s*기)\s*$/.test(cellText(xml, `${colName(c)}${r}`, sstr))) hits.push(c);
    if (hits.length >= 2) { cur = hits[0]; prior = hits[1]; }
  }
  if (!cur) return { xml, n: 0, refs: [] };
  const edits: CellEdit[] = [];
  const maxRow = Math.max(0, ...[...sh.keys()].map(rowOf));
  for (let r = 3; r <= maxRow; r++) {
    const f = sh.get(`${colName(cur)}${r}`)?.formula;
    const pv = sh.get(`${colName(prior)}${r}`);
    if (!f || pv?.formula) continue;
    let hit = false;
    const g = mapRefs(f, (sname, ref) => {
      const m = sname ? adjToPrior.get(sname) : undefined;
      if (!m) return ref;
      return ref.replace(/(\$?)([A-Z]{1,3})(?=\$?\d|:|$)/g, (x, d: string, c: string) => (c === m[0] ? (hit = true, `${d}${m[1]}`) : x));
    });
    if (!hit) continue;
    edits.push({ ref: `${colName(prior)}${r}`, formula: g });
  }
  return { xml: edits.length ? setCells(xml, edits) : xml, n: edits.length, refs: edits.map((e) => e.ref) };
}

/** 화면용 — 작년 A500 의 작성자·검토자(회사 담당). */
export function wtbA500People(bytes: Uint8Array): { author: string | null; reviewer: string | null } {
  const sh = readWorkbook(bytes, (n) => /^A500|수정(사항)?집계/.test(n))[0];
  let author: string | null = null, reviewer: string | null = null;
  for (const v of sh?.cells.values() ?? []) {
    const a = /작성자\s*:\s*([^님]*?)\s*(님|$)/.exec(v.text ?? ''); if (a && !author) author = a[1].trim() || null;
    const r = /검토자\s*:\s*([^님]*?)\s*(님|$)/.exec(v.text ?? ''); if (r && !reviewer) reviewer = r[1].trim() || null;
  }
  return { author, reviewer };
}
