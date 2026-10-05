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
import { colName, colNum, insertColumns, insertRowsBook, mapFormulas, mapRefs, moveRelative, shiftColsInRef, unshareFormulas } from './xlsxCols';
import { insertRowsAfter } from './xlsxRows';
import { renameSheetRefs } from './gwpRoll';

export interface TbLine {
  name: string;
  /** 재무상태표 부분·손익·제조원가 */ section: '자산' | '부채' | '자본' | '손익' | '원가';
  /** 유동(당좌·재고·유동부채)인가 — 이름이 같은 유동·비유동 줄을 가른다 */ current?: boolean;
  /** 차변잔액 − 대변잔액(제조원가는 보이는 금액 그대로) */ bal: number;
  /** 전기 금액 — 재무제표에 보이는 대로(성격대로 양수, 차감 계정은 음수). 이름이 안 맞을 때 작년 수정후 금액과 같은 줄을 찾는다. */ prior?: number;
  /** 어느 시트에서 왔나 — 'TB' · 'BS' · 'PL' · 'MC:시트이름'(제조원가명세서) */ src?: string;
  /** 바로 위 무리 이름(「1) 현금및현금성자산」) — 세목 이름이 틀리게 찍힌 ERP(아비즈)에서 보여 주기용 */ group?: string;
  /** 합계·이익 같은 계산 줄 — 받을 줄이 없어도 묻지 않는다 */ subtotal?: boolean;
}

export interface WtbRollOptions {
  /** 올해 기준일(중간이면 기준월 말) 「2026-08-31」 */ closing: string;
  /** 올해 연말 「2026-12-31」 — A500 B2 */ yearEnd: string;
  /** 작년 결산일 「2025-12-31」 */ prevEnd: string;
  /** 올해 기수 — 없으면 WBS 머리 + 1(머리에 기수가 없으면 작업 건의 기수를 준다) */ term?: number;
  /** A500 작성자·검토자 — **회사 담당자**(사용자 2026-10-03 정정: 감사인이 아니다). 주면 바꾸고, 없으면 작년 그대로. */
  companyAuthor?: string; companyReviewer?: string;
  tb?: TbLine[];
  /** 제조원가명세서 표(WMS-…) ↔ 회사 자료 시트(TbLine.src 'MC:…'). 없으면 같은 이름끼리. */
  pair?: Record<string, string>;
  /** 보이게 둘 해 수(올해 포함) — 기본 4 */ years?: number;
  /** 시산표에만 있는 계정을 어디에 — 이미 있는 줄에 더하기(label = 계정 열 이름) 또는 과목 끝에 새 줄 */
  place?: WtbPlace[];
}

export type WtbPlace =
  | { name: string; sheet: string; to: 'row'; label: string; row?: number }
  | { name: string; sheet: string; to: 'new'; fsli: string };

export interface WtbRow { sheet: string; row: number; fsli: string; label: string; section: TbLine['section']; kind: TableKind }

/** 화면용 — 정산표의 표(WBS·WPL·제조원가)와 계정 줄. 새 계정을 어디에 둘지 고를 목록·시트 짝 고르기. */
export function wtbOutline(bytes: Uint8Array): { rows: WtbRow[]; term: number | null; tables: { sheet: string; kind: TableKind; hidden: boolean }[] } {
  const rows: WtbRow[] = [];
  const tables: { sheet: string; kind: TableKind; hidden: boolean }[] = [];
  let term: number | null = null;
  for (const sh of readWorkbook(bytes)) {
    const L = readLayout(sh);
    if (!L) continue;
    tables.push({ sheet: sh.name, kind: L.kind, hidden: !!sh.hidden });
    if (L.kind === 'BS') term = L.curTerm;
    const { sec } = rowSections(sh, L);
    for (const r of L.accounts) {
      rows.push({
        sheet: sh.name, row: r, kind: L.kind,
        fsli: (sh.cells.get(`${colName(L.fsli ?? L.acct)}${r}`)?.text ?? '').trim(),
        label: (sh.cells.get(`${colName(L.acct)}${r}`)?.text ?? '').trim(),
        section: L.kind === 'PL' ? '손익' : L.kind === 'MC' ? '원가' : sec.get(r)?.section ?? '자산',
      });
    }
  }
  return { rows, term, tables };
}

export interface WtbRollReport {
  term: number;
  tables: { sheet: string; insertedAt: string; prior: string; company: string; zeroed: number; normalized: number; hidden: string }[];
  filled: { sheet: string; row: number; label: string; value: number; from: string[]; how?: string }[];
  unmatched: (TbLine & { sheet: string })[];
  renamed: [string, string][];
  notes: string[];
}

const dec = (b: Uint8Array) => strFromU8(b);
const enc = (s: string) => strToU8(s);
const norm = (s: string | undefined) => (s ?? '').replace(/[\s.·/]/g, '').toUpperCase();   // CsI = CSI
const termOf = (s: string | undefined) => { const m = /제?\s*(\d{1,3})\s*기/.exec(s ?? ''); return m ? Number(m[1]) : null; };
const rowOf = (ref: string) => Number(/\d+$/.exec(ref)![0]);
const colOf = (ref: string) => /^[A-Z]+/.exec(ref)![0];
/** 엑셀 날짜 일련번호 → 해 */
const yearOfSerial = (n: number | undefined) => (n != null && n > 20000 && n < 80000 ? new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).getUTCFullYear() : null);
/** 로마 숫자 머리(「Ⅴ.기초재공품재고액」「VI. 타계정…」)·번호를 뗀 이름 — 정산표·회사 자료 양쪽에 같게. */
const bare = (s: string | undefined) => norm((s ?? '').replace(/^\s*([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+|[IVX]+\s*\.)\.?\s*/, '').replace(/^\s*(\(\d+\)|\d+\)|\d+\.)\s*/, ''));

export type TableKind = 'BS' | 'PL' | 'MC';

/** 표(WBS·WPL·제조원가 WMS-…)의 모양 — 회사마다 다르다(제이: B 과목·C 회사제시계정·「제n기」, 아비즈: B 과목·C Dart과목·날짜·Proposed/Audited). */
export interface TableLayout {
  sheet: string;
  kind: TableKind;
  /** 머리 글자 줄(「제10기」·「Proposed」) */ head: number;
  /** 날짜 줄 — 「DR | CR」 가 있는 줄 */ dateRow: number;
  /** 계정 이름 열 · 과목(공시) 열(없으면 null) · 머리글(「자산」「Ⅰ.유동자산」)이 적힌 열 */ acct: number; fsli: number | null; headCol: number;
  /** 회사제시 · 수정 DR · CR · 수정후 · 증감액 · 증감율 (열 번호) */ cur: number; dr: number; cr: number; adj: number; inc: number | null; ratio: number | null;
  curTerm: number | null;
  /** 회사제시 열의 해(작년 결산일) */ curYear: number | null;
  /** 과거 해 → 그 해 금액 열(묶음이면 수정후 열) */ history: Map<number, number>;
  /** 계정 줄 */ accounts: number[];
  /** 합계 줄 — 회사제시 열엔 숫자가 박혀 있고 수정후 열은 다른 줄을 더하는 식(아비즈 WMS 「Ⅳ.당기총제조비용」 =L3+L9+L13). 회사제시에도 같은 식을 넣는다. */ derived: number[];
  /** 마지막 줄 — 이 아래는 표가 아니다 */ last: number;
}

export function readLayout(sh: SheetData): TableLayout | null {
  const text = (c: number, r: number) => (sh.cells.get(`${colName(c)}${r}`)?.text ?? '').trim();
  const cells = [...sh.cells.keys()];
  if (!cells.length) return null;
  const maxCol = Math.max(...cells.map((r) => colNum(colOf(r))));
  // 올해 묶음 — 「DR | CR」 짝이 있는 줄. 그 왼쪽이 회사제시, CR 오른쪽이 수정후. 맨 오른쪽 짝.
  let dateRow = 0, dr = 0;
  for (const ref of cells) {
    const r = rowOf(ref), c = colNum(colOf(ref));
    if (r > 12 || !/^DR$/i.test(text(c, r)) || !/^CR$/i.test(text(c + 1, r))) continue;
    if (c > dr) { dr = c; dateRow = r; }
  }
  if (!dr) return null;
  const head = dateRow - 1, cur = dr - 1;
  // 계정·과목 열 — 머리글 「회사제시계정」(제이) 이면 그것이 계정, 「과목」이 공시 과목. 아니면 「과목」이 계정, 「Dart과목」이 공시 과목(아비즈).
  const hdr = (re: RegExp) => { for (let c = 1; c < cur; c++) for (const r of [head, dateRow]) if (re.test(norm(text(c, r)))) return c; return 0; };
  const ci = hdr(/^(회사제시계정|계정과목)$/), gw = hdr(/^과목$/), dart = hdr(/^(dart|DART|Dart)과목$/);
  let acct: number, fsli: number | null;
  if (ci) { acct = ci; fsli = gw || null; } else if (gw) { acct = gw; fsli = dart || null; } else return null;
  const headCol = Math.min(acct, fsli ?? acct);
  let inc: number | null = null;
  for (let c = cur + 4; c <= Math.min(maxCol, cur + 9); c++) if (/증감액/.test(text(c, dateRow)) || /증감액/.test(text(c, head))) { inc = c; break; }
  const ratio = inc && /증감율|증감률/.test(text(inc + 1, dateRow) + text(inc + 1, head)) ? inc + 1 : null;
  // 과거 해 — 날짜 줄의 날짜(수식이면 캐시 값). 같은 해가 여럿이면 오른쪽(묶음의 수정후). 날짜가 없으면 「제n기」로.
  const curYear = yearOfSerial(sh.cells.get(`${colName(cur)}${dateRow}`)?.num);
  const curTerm = termOf(text(cur, head));
  // 수정사항집계표(A500 — 「계정과목 | DR | CR」)처럼 회사제시 열에 날짜·기수가 없거나 계정 열 왼쪽이면 표가 아니다.
  if (cur <= Math.max(acct, fsli ?? 0) || (curYear == null && curTerm == null)) return null;
  const history = new Map<number, number>();
  const first = Math.max(acct, fsli ?? 0) + 1;
  for (let c = first; c < cur; c++) {
    const y = yearOfSerial(sh.cells.get(`${colName(c)}${dateRow}`)?.num);
    const t = termOf(text(c, head));
    if (y != null) history.set(y, c);
    else if (t != null && curTerm != null && curYear != null) history.set(curYear - (curTerm - t), c);
  }
  const kind: TableKind = /^WBS$/i.test(sh.name.trim()) ? 'BS' : /^WPL$/i.test(sh.name.trim()) ? 'PL' : 'MC';
  let last = dateRow;
  for (const [ref, v] of sh.cells) if (colOf(ref) === colName(cur + 3) && rowOf(ref) > last && (v.formula || v.num != null)) last = rowOf(ref);
  // 검증 줄(=P57=P99·「검증」·「<이익잉여금정합성검증>」) 위까지만 계정으로 본다.
  let end = last;
  for (let r = dateRow + 1; r <= last; r++) {
    const b = text(headCol, r) + text(acct, r);
    const f = sh.cells.get(`${colName(cur + 3)}${r}`)?.formula ?? '';
    if (/검증|차이|정합성/.test(b) || /^[^=]*[A-Z]+\d+=[A-Z]+\d+$/.test(f)) { end = r - 1; break; }
  }
  const accounts: number[] = [];
  for (let r = dateRow + 1; r <= end; r++) {
    const a = sh.cells.get(`${colName(acct)}${r}`);
    const c = sh.cells.get(`${colName(cur)}${r}`);
    const name = (a?.text ?? '').trim();
    if (fsli != null && fsli !== acct) {
      // 과목 열이 따로 있으면 — 두 열 모두 이름이 있는 줄(제이: B 과목 + C 계정, 아비즈: B 계정 + C Dart과목)
      const f = (sh.cells.get(`${colName(fsli)}${r}`)?.text ?? '').trim();
      if (name && !a?.formula && f) { accounts.push(r); continue; }
    } else if (name && !a?.formula && !c?.formula && !/합계|총계/.test(name)) { accounts.push(r); continue; }
    // 이름 열은 비었어도 회사제시 열에 숫자를 직접 넣은 줄(제이 WPL 「Ⅶ.법인세등」)
    const h = (sh.cells.get(`${colName(headCol)}${r}`)?.text ?? '').trim();
    if (acct !== headCol && !name && h && c?.num != null && !c.formula) accounts.push(r);
  }
  // 합계 줄 빼기 — 수정후 식이 제 줄 회사제시(I30)를 쓰지 않고 다른 줄의 수정후를 더한다.
  const adjL = colName(cur + 3), curL = colName(cur);
  const derived = accounts.filter((r) => {
    const f = sh.cells.get(`${adjL}${r}`)?.formula;
    if (!f || new RegExp(String.raw`(^|[^A-Z$])\$?${curL}\$?${r}(?!\d)`).test(f) || /!/.test(f)) return false;
    return new RegExp(String.raw`(^|[^A-Z$])\$?${adjL}\$?\d`).test(f);
  });
  const acc2 = accounts.filter((r) => !derived.includes(r));
  return { sheet: sh.name, kind, head, dateRow, acct, fsli, headCol, cur, dr: cur + 1, cr: cur + 2, adj: cur + 3, inc, ratio, curTerm, curYear, history, accounts: acc2, derived, last };
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
  const { sign } = rowSections(sh, L);
  for (const r of L.accounts) out.set(r, fromFormula(r) ?? (sign.get(r) === -1));
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

/** 줄마다 부분(자산·부채·자본·손익·원가)·유동·시산표 부호 — 머리글(「부채」「자본」「Ⅱ.비유동자산」「Ⅰ.영업수익」)로. */
function rowSections(sh: SheetData, L: TableLayout) {
  const hl = (r: number) => sh.cells.get(`${colName(L.headCol)}${r}`)?.text ?? '';
  const sec = new Map<number, { section: TbLine['section']; current: boolean }>();
  const isPl = L.kind === 'PL', isMc = L.kind === 'MC';
  let s: TbLine['section'] = isPl ? '손익' : isMc ? '원가' : '자산'; let current = true;
  let plCredit = false;
  const sign = new Map<number, number>();
  for (let r = L.dateRow + 1; r <= L.last; r++) {
    const raw = hl(r), b = norm(raw);
    const isAcc = L.accounts.includes(r);
    if (!isPl && !isMc && !isAcc && /^부채$/.test(b)) { s = '부채'; current = true; }
    if (!isPl && !isMc && !isAcc && /^자본$/.test(b)) s = '자본';
    if (!isAcc) { if (/비유동/.test(b)) current = false; else if (/^[ⅠⅡⅢIV]+\.?유동|^\(?1\)?당좌|유동자산$|유동부채$/.test(b)) current = true; }
    if (isPl && !isAcc && (/^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]/.test(b) || /^[IVX]+\s*\./.test(raw.trim()))) plCredit = /수익|매출액?$|^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX]+매출액/.test(b) && !/원가|총이익/.test(b);
    sec.set(r, { section: s, current });
    // 시산표 금액의 부호 — 자산·비용·원가는 차변−대변, 부채·자본·수익은 대변−차변(차감 계정은 음수로 남는다: 감가상각누계액·퇴직연금운용자산).
    sign.set(r, isMc ? 1 : (isPl ? plCredit : s !== '자산') ? -1 : 1);
  }
  return { sec, sign };
}

/** 이 표가 받을 회사 자료 줄 — 재무상태표·손익계산서·짝지은 제조원가명세서. */
function linesFor(L: TableLayout, tb: TbLine[], pair: Record<string, string> | undefined): TbLine[] {
  if (L.kind === 'BS') return tb.filter((t) => t.section !== '손익' && t.section !== '원가');
  if (L.kind === 'PL') return tb.filter((t) => t.section === '손익');
  const want = pair?.[L.sheet] ?? `MC:${L.sheet}`;
  return tb.filter((t) => t.section === '원가' && t.src === want);
}

/**
 * 시산표 → 표 줄. 같은 줄로 가는 것은 더한다. alias = 사람이 고른 짝(회사 계정 이름 → 정산표 계정 열 이름·줄).
 * 찾는 차례: 사람이 고른 짝 → 이름(차감 계정은 바로 위 계정과 짝) → **전기 금액이 작년 수정후와 같은 줄**(아비즈 ERP 처럼 세목 이름이 틀리게 찍힐 때).
 * 이름 후보가 여럿이면(아비즈 WPL 의 「기초제품재고액」 세 줄) 전기 금액이 같은 줄을 고른다.
 */
function matchTb(sh: SheetData, L: TableLayout, tb: TbLine[], alias: Map<string, { label: string; row?: number }>, ni: number) {
  const label = (r: number) => sh.cells.get(`${colName(L.acct)}${r}`)?.text ?? '';
  const flabel = (r: number) => (L.fsli != null ? sh.cells.get(`${colName(L.fsli)}${r}`)?.text ?? '' : '');
  // 작년 금액 — 수정후(회사가 수정분개를 장부에 반영한 경우, 제이) 또는 회사제시(반영 안 한 경우, 아비즈 기말제품재고액(System)).
  const priorsOf = (r: number) => [sh.cells.get(`${colName(L.adj)}${r}`)?.num, sh.cells.get(`${colName(L.cur)}${r}`)?.num].filter((x): x is number => x != null);
  const isPl = L.kind !== 'BS';
  const { sec, sign } = rowSections(sh, L);
  const rows = L.accounts;
  const sums = new Map<number, { value: number; from: string[]; how: string }>();
  const unmatched: TbLine[] = [];
  const add = (r: number, t: TbLine, v: number, how: string) => { const x = sums.get(r) ?? { value: 0, from: [], how }; x.value += v; x.from.push(t.name); sums.set(r, x); };
  const samePrior = (r: number, t: TbLine) => t.prior != null && t.prior !== 0 && priorsOf(r).some((p) => Math.abs(p - t.prior!) < 1);
  let prevName = '';
  for (const t of tb) {
    const n = norm(t.name), nb = bare(t.name);
    const contra = /^(감가상각누계액|대손충당금|정부보조금|국고보조금|현재가치할인차금|손상차손누계액)$/.test(n);
    const pool = rows.filter((r) => isPl || (sec.get(r)?.section === t.section));
    const byCurrent = (cands: number[]) => (cands.length > 1 && t.current != null ? (cands.filter((r) => sec.get(r)?.current === t.current).length ? cands.filter((r) => sec.get(r)?.current === t.current) : cands) : cands);
    let cands: number[] = [];
    let how = '이름';
    const al = alias.get(n);
    if (al) {
      cands = al.row != null && rows.includes(al.row) ? [al.row] : rows.filter((r) => norm(label(r)) === al.label);
      how = '고른 짝';
      if (!cands.length) { if (t.bal) unmatched.push(t); continue; }
    } else if (contra) {
      cands = pool.filter((r) => { const c = norm(label(r)) + '|' + norm(flabel(r)); return c.split('|').some((x) => { if (!x.startsWith(n)) return false; const suf = x.slice(n.length).replace(/^-/, ''); return !!suf && (prevName.includes(suf) || suf.includes(prevName)); }); });
    } else {
      // ① 계정 열 이름이 같은 줄
      const tries = [n, nb, n.replace(/_.*$/, ''), n.replace(/\(.*?\)/g, ''),
        n === '자본금' ? '보통주자본금' : '', n === '이월이익잉여금' ? '미처분이익잉여금' : ''].filter(Boolean);
      for (const k of tries) { cands = byCurrent(pool.filter((r) => norm(label(r)) === k || bare(label(r)) === k)); if (cands.length) break; }
      // 후보가 여럿(아비즈 WPL 「기초제품재고액」 세 줄) — 전기 금액이 같은 줄. 전기 금액이 있는데 아무도 안 맞으면 이름은 버리고 아래 ②로.
      if (cands.length > 1 && t.prior) { const same = cands.filter((r) => samePrior(r, t)); cands = same.length ? same : []; }
      // ② 전기 금액이 작년 수정후와 같은 줄(아직 채우지 않은 줄 가운데 하나뿐일 때) — 세목 이름이 엉뚱하게 찍힌 ERP(아비즈)
      if (!cands.length && t.prior) {
        const same = rows.filter((r) => samePrior(r, t) && !sums.has(r));
        if (same.length === 1) { cands = same; how = '전기 금액'; }
      }
      // ③ 과목(공시) 열 이름 — 하나뿐일 때만(「원재료」처럼 과목이 같은 줄이 여럿이면 고르지 않는다)
      if (!cands.length) for (const k of tries) {
        const c = byCurrent(pool.filter((r) => norm(flabel(r)) === k));
        if (c.length === 1 || (c.length > 1 && t.prior == null)) { cands = c; how = '과목'; break; }
      }
      prevName = n;
    }
    // 부분이 다른 줄(시산표는 투자자산, 정산표는 비유동부채의 차감 — 퇴직연금운용자산)
    if (!cands.length && !contra && !isPl) {
      const all = rows.filter((r) => sec.get(r)?.section !== t.section);
      for (const k of [n, n.replace(/_.*$/, '')]) { cands = all.filter((r) => norm(label(r)) === k); if (cands.length) break; }
    }
    // 차감 계정(TB)·고른 짝 — 후보가 여럿이면 전기 금액으로
    if (cands.length > 1 && t.prior) { const same = cands.filter((r) => samePrior(r, t)); if (same.length) cands = same; }
    if (!cands.length && t.prior && contra) {
      const same = rows.filter((r) => samePrior(r, t) && !sums.has(r));
      if (same.length === 1) { cands = same; how = '전기 금액'; }
    }
    if (!cands.length) { if ((t.bal || t.prior) && !t.subtotal) unmatched.push(t); continue; }
    const r = cands[0];
    add(r, t, (sign.get(r) ?? 1) * t.bal, how);
    // 중간 재무상태표의 미처분이익잉여금은 당기순이익을 품는다(FY25 중간 P94 = 기초 + 1~8월 순이익).
    if (L.kind === 'BS' && n === '이월이익잉여금' && norm(label(r)) === '미처분이익잉여금' && ni) add(r, { ...t, name: '당기순이익(손익)' }, ni, how);
  }
  return { sums, unmatched };
}

/** 표 한 장(WBS·WPL)을 민다. layouts 는 열 끼우기 전 모양. 반환: 끼운 뒤 모양에서 할 편집. */
interface Planned { L: TableLayout; sh: SheetData; credit: Map<number, boolean> }

function tableEdits(p: Planned, o: { closing: number; prevEnd: number; term: number | null; prevTerm: number | null; fill?: Map<number, { value: number; from: string[] }> }) {
  const { L, sh } = p;
  const at = L.cur;                                     // 끼운 열(새 전기) = 원래 회사제시 자리
  const C = (n: number) => colName(n);
  const comp = at + 1, dr = at + 2, cr = at + 3, adj = at + 4;
  const inc = L.inc ? L.inc + 1 : null, ratio = L.ratio ? L.ratio + 1 : null;
  const edits: CellEdit[] = [];
  let zeroed = 0, normalized = 0;
  const acc = new Set(L.accounts);
  // 머리 — 새 전기 · 올해 회사제시.
  //   글자 줄: 「제n기」면 기수를 올리고(제이), 아니면 새 전기는 왼쪽 과거 열의 글자(「Audited」 — 아비즈), 회사제시는 그대로(「Proposed」).
  //   날짜 줄: 수식이면(WPL 「=WBS!K3」) 새 전기에 원래 식 그대로 두고 회사제시는 밀린 식 그대로, 값이면 작년 결산일 · 올해 기준일.
  const oldLabel = sh.cells.get(`${C(L.cur)}${L.head}`);
  if (termOf(oldLabel?.text) != null && o.prevTerm != null && o.term != null && !oldLabel?.formula) {
    edits.push({ ref: `${C(at)}${L.head}`, text: `제${o.prevTerm}기` }, { ref: `${C(comp)}${L.head}`, text: `제${o.term}기` });
  } else {
    const left = sh.cells.get(`${C(L.cur - 1)}${L.head}`);
    if (left?.text && !left.formula && termOf(left.text) == null) edits.push({ ref: `${C(at)}${L.head}`, text: left.text });
  }
  const oldDate = sh.cells.get(`${C(L.cur)}${L.dateRow}`);
  if (oldDate?.formula) edits.push({ ref: `${C(at)}${L.dateRow}`, formula: oldDate.formula });
  else edits.push({ ref: `${C(at)}${L.dateRow}`, num: o.prevEnd }, { ref: `${C(comp)}${L.dateRow}`, num: o.closing });
  for (let r = L.dateRow + 1; r <= L.last + 12; r++) {
    const old = sh.cells.get(`${C(L.cur)}${r}`);          // 원래 회사제시(끼우기 전 좌표)
    const after = sh.cells.get(`${C(L.adj)}${r}`);        // 원래 수정후
    // 새 전기: 식은 원래 P 것 그대로(좌표가 같은 자리), 숫자는 수정후.
    if (old?.formula && !acc.has(r)) edits.push({ ref: `${C(at)}${r}`, formula: old.formula });
    else if (acc.has(r) && after?.num != null) edits.push({ ref: `${C(at)}${r}`, num: after.num });
    else if (old?.formula) edits.push({ ref: `${C(at)}${r}`, formula: old.formula });
    // 합계 줄 — 새 전기는 수정후 값, 올해 회사제시는 수정후 식을 회사제시 열로 옮긴 식(값이 박혀 있던 것을 식으로).
    if (L.derived.includes(r)) {
      if (!old?.formula && after?.num != null) edits.push({ ref: `${C(at)}${r}`, num: after.num });
      const af = after?.formula;
      if (af && !old?.formula) {
        const curL = C(L.cur), adjL = C(L.adj);
        const f = mapRefs(af, (sn, ref) => (sn ? ref : shiftColsInRef(ref.replace(/(\$?)([A-Z]{1,3})(?=\$?\d)/g, (x, d: string, c: string) => (c === adjL ? `${d}${curL}` : x)), L.cur, 1)));
        edits.push({ ref: `${C(comp)}${r}`, formula: f });
        normalized++;
      }
      continue;
    }
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
  const inserted = new Map<string, number[]>();   // 시트 → 끼운 줄 번호(사람이 고른 「이 줄」 번호를 따라 민다)
  // ⓪ 새 계정 줄 — 과목 무리 끝에 한 줄(과목 열이 없는 제조원가 표는 고른 줄 바로 아래). 다른 시트의 SUMIF 범위도 따라 밀린다(insertRowsBook).
  for (const p of (o.place ?? []).filter((x): x is Extract<WtbPlace, { to: 'new' }> => x.to === 'new')) {
    const sh = readWorkbook(zipFn(files), (n) => n === p.sheet)[0];
    const L = sh && readLayout(sh);
    const key = L ? (L.fsli ?? L.acct) : 0;
    const mine = L ? L.accounts.filter((r) => norm(sh.cells.get(`${colName(key)}${r}`)?.text) === norm(p.fsli)) : [];
    if (!L || !mine.length) { report0.push(`${p.sheet} 에 과목 「${p.fsli}」 줄이 없어 「${p.name}」 새 줄을 넣지 못했습니다.`); continue; }
    const after = Math.max(...mine), n = after + 1;
    insertRowsBook(files, sheetEntries(files).map((e) => ({ name: e.name, part: e.part })), p.sheet, after, 1, dec, enc, insertRowsAfter);
    inserted.set(p.sheet, [...(inserted.get(p.sheet) ?? []).map((x) => (x >= n ? x + 1 : x)), n]);
    const edits: CellEdit[] = [{ ref: `${colName(L.acct)}${n}`, text: p.name }];
    if (L.fsli != null) edits.push({ ref: `${colName(L.fsli)}${n}`, text: sh.cells.get(`${colName(L.fsli)}${after}`)?.text ?? p.fsli });
    for (let c = 1; c < Math.min(L.acct, L.fsli ?? L.acct); c++) { const a = sh.cells.get(`${colName(c)}${after}`)?.text; if (a) edits.push({ ref: `${colName(c)}${n}`, text: a }); }
    for (const c of [L.adj, L.inc, L.ratio]) {
      const f = c ? sh.cells.get(`${colName(c)}${after}`)?.formula : undefined;
      if (c && f) edits.push({ ref: `${colName(c)}${n}`, formula: moveRelative(f, 1, 0) });
    }
    const part = sheetEntries(files).find((e) => e.name === p.sheet)!.part;
    files[part] = enc(setCells(dec(files[part]), edits));
    report0.push(`${p.sheet} ${n}행 — 「${p.fsli}」 끝에 새 계정 「${p.name}」`);
  }
  const before = readWorkbook(zipFn(files));
  const entries = () => sheetEntries(files);
  const partOf = (name: string) => entries().find((e) => e.name === name)!.part;
  const report: WtbRollReport = { term: 0, tables: [], filled: [], unmatched: [], renamed: [], notes: [...report0] };
  const closing = excelSerial(o.closing)!, prevEnd = excelSerial(o.prevEnd)!, yearEnd = excelSerial(o.yearEnd)!;
  const prevEndOld = excelSerial(`${Number(o.prevEnd.slice(0, 4)) - 1}${o.prevEnd.slice(4)}`)!;

  // 표 — WBS·WPL 과 같은 모양(「DR | CR」 묶음 + 과목 머리)의 모든 시트: 제조원가명세서(WMS-CSI·WMS-sys·WMS-디텍 …)도 같게 민다.
  const tables: Planned[] = [];
  for (const sh of before) {
    const L = readLayout(sh);
    if (L) tables.push({ L, sh, credit: creditRows(sh, L) });
  }
  for (const k of ['BS', 'PL'] as const) if (!tables.some((t) => t.L.kind === k)) report.notes.push(`${k === 'BS' ? 'WBS' : 'WPL'} 시트(머리 「과목」, 올해 묶음 「DR | CR」)를 찾지 못했습니다.`);
  const wbs = tables.find((t) => t.L.kind === 'BS');
  const prevTerm = wbs?.L.curTerm ?? null;
  const term = o.term ?? (prevTerm != null ? prevTerm + 1 : null);
  report.term = term ?? 0;
  const prevYear = Number(o.prevEnd.slice(0, 4));

  // ① 열 끼우기(모든 시트의 참조가 따라 밀린다).
  for (const t of tables) insertColumns(files, entries().map((e) => ({ name: e.name, part: e.part })), t.L.sheet, t.L.cur, 1, dec, enc);

  // ② 한 해 앞으로 — 과거 해 열 참조 → 다음 해 열(작년 = 끼운 열). 표의 과거 열 속 수식은 빼고.
  const forward = new Map<string, Map<string, string>>();
  for (const t of tables) {
    const m = new Map<string, string>();
    // 작년 = 작업 건의 작년 결산일 — 표 머리 날짜는 갱신이 안 된 채 남기도 한다(제이 WPL K7 이 2024-12-31 로 남아 있었다).
    const cy = prevYear;
    for (const [y, c] of t.L.history) {
      const nextCol = y + 1 === cy ? t.L.cur : t.L.history.get(y + 1);
      if (nextCol != null) m.set(colName(c), colName(nextCol));
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

  // ③ 표마다 — 새 전기 열 채우기, 올해 회사제시 0·회사 자료, DR·CR 비우기, 수정후·증감 식 통일, 머리.
  const ni = (o.tb ?? []).filter((t) => t.section === '손익' && !t.subtotal).reduce((a, t) => a - t.bal, 0);
  for (const t of tables) {
    let fill: Map<number, { value: number; from: string[]; how: string }> | undefined;
    if (o.tb?.length) {
      const lines = linesFor(t.L, o.tb, o.pair);
      if (t.L.kind === 'MC' && !lines.length) report.notes.push(`${t.L.sheet}: 짝지은 제조원가명세서가 없어 올해 회사제시를 0 으로 두었습니다.`);
      const shift = (r: number) => { let x = r; for (const n of [...(inserted.get(t.L.sheet) ?? [])].sort((a, b) => a - b)) if (n <= x) x++; return x; };
      const alias = new Map((o.place ?? []).filter((p) => p.sheet === t.L.sheet).map((p) => [norm(p.name), p.to === 'row' ? { label: norm(p.label), row: p.row != null ? shift(p.row) : undefined } : { label: norm(p.name) }] as [string, { label: string; row?: number }]));
      const m = matchTb(t.sh, t.L, lines, alias, ni);
      fill = m.sums; report.unmatched.push(...m.unmatched.map((x) => ({ ...x, sheet: t.L.sheet })));
      for (const [r, v] of m.sums) report.filled.push({ sheet: t.L.sheet, row: r, label: t.sh.cells.get(`${colName(t.L.acct)}${r}`)?.text ?? '', value: Math.round(v.value), from: v.from, how: v.how });
    }
    const te = tableEdits(t, { closing, prevEnd, term, prevTerm, fill });
    let xml = setCells(dec(files[partOf(t.L.sheet)]), te.edits);
    let normalized = te.normalized;
    const skip = new Set<number>();
    if (te.inc) { const r = normalizeColumn(xml, colName(te.inc), t.L.dateRow + 1, t.L.last, skip); xml = r.xml; normalized += r.n; }
    if (te.ratio) { const r = normalizeColumn(xml, colName(te.ratio), t.L.dateRow + 1, t.L.last, skip); xml = r.xml; normalized += r.n; }
    // ⑬ 최근 n 해만 — 남길 과거 열: 새 전기(끼운 열) + 그 앞 (years-2) 해. 묶음(제n기 | 수정 DR·CR | 수정후)은 첫 열부터 남긴다.
    const keepYears = [...t.L.history.keys()].sort((a, b) => b - a).slice(0, (o.years ?? 4) - 2);
    const first = Math.max(t.L.acct, t.L.fsli ?? 0) + 1;
    let hideTo = first - 1;
    if (keepYears.length) {
      const minY = Math.min(...keepYears);
      for (let c = first; c < t.L.cur; c++) {
        const y = yearOfSerial(t.sh.cells.get(`${colName(c)}${t.L.dateRow}`)?.num)
          ?? (termOf(t.sh.cells.get(`${colName(c)}${t.L.head}`)?.text) != null && t.L.curTerm != null && t.L.curYear != null ? t.L.curYear - (t.L.curTerm - termOf(t.sh.cells.get(`${colName(c)}${t.L.head}`)?.text)!) : null);
        if (y != null && y >= minY) { hideTo = c - 1; break; }
      }
    } else hideTo = t.L.cur - 1;
    if (hideTo >= first) xml = hideCols(xml, first, hideTo);
    files[partOf(t.L.sheet)] = enc(xml);
    report.tables.push({ sheet: t.L.sheet, insertedAt: colName(t.L.cur), prior: prevTerm != null ? `제${prevTerm}기` : `${prevYear}`, company: `${term != null ? `제${term}기 ` : ''}${o.closing}`, zeroed: te.zeroed, normalized, hidden: hideTo >= first ? `${colName(first)}:${colName(hideTo)}` : '' });
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
    const wbsT = tables.find((t) => t.L.kind === 'BS');
    const nz = new Set<string>();
    if (wbsT) {
      const bOf = (r: number) => norm(wbsT.sh.cells.get(`${colName(wbsT.L.fsli ?? wbsT.L.acct)}${r}`)?.text);
      for (const r of wbsT.L.accounts) if (wbsT.sh.cells.get(`${colName(wbsT.L.adj)}${r}`)?.num) nz.add(bOf(r));
      for (const f of report.filled) if (f.sheet === wbsT.L.sheet && f.value) nz.add(bOf(f.row));
      for (const p of o.place ?? []) if (p.to === 'new' && p.sheet === wbsT.L.sheet) nz.add(norm(p.fsli));
    }
    const wcf = entries().find((e) => /^WCF/.test(e.name));
    if (wcf && nz.size) {
      const added: string[] = [];
      for (let guard = 0; guard < 40; guard++) {
        const now = readWorkbook(zipFn(files), (n) => n === '보고서BS' || n === wcf.name);
        const bs = now.find((x) => x.name === '보고서BS'), cf = now.find((x) => x.name === wcf.name);
        if (!bs || !cf) break;
        // 열쇠 = SUMIF 의 조건 칸(제이 보고서BS 는 F열, 아비즈는 A열, WCF 는 A열) 글자.
        const keyRows = (sh: SheetData) => {
          const out: { key: string; row: number; text: string }[] = [];
          for (const [ref, v] of sh.cells) {
            if (colOf(ref) !== 'B' || !/SUMIF/i.test(v.formula ?? '')) continue;
            const crit = /SUMIF\s*\([^,]+,\s*\$?([A-Z]{1,3})\$?\d+/i.exec(v.formula!)?.[1] ?? 'A';
            const t = sh.cells.get(`${crit}${rowOf(ref)}`)?.text ?? '';
            if (t) out.push({ key: norm(t), row: rowOf(ref), text: t.trim() });
          }
          return out.sort((a, b) => a.row - b.row);
        };
        const bsKeys = keyRows(bs), cfKeys = keyRows(cf);
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
    report.notes = report.notes.map((n) => [...ren].reduce((x, [from, to]) => x.split(`${from}:`).join(`${to}:`), n));
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

/**
 * 시산표가 없는 회사 — 재무상태표·손익계산서·제조원가명세서 시트로 시산표 줄을 만든다
 * (사용자 2026-10-03 「모든 회사의 제시재무제표에 시산표가 있지 않다」, 2026-10-05 아비즈 「ERP 재무제표는 형식이 다를 수 있다」·「제조원가명세서 3종」).
 *
 * 두 모양을 같은 규칙으로 읽는다:
 *   더존   — 「Ⅰ. 유동자산」「(1) 당좌자산」 머리 아래 계정을 들여 쓴다. 당기 금액은 안쪽 열(차감 전) 또는 바깥쪽 열.
 *            차감 계정(감가상각누계액 …)은 계정과 같은 깊이, 이름으로 안다.
 *   ERP(아비즈) — 「I. → (1) → 1. → 1) → 1.」 번호가 층층이, 쪽마다 머리(재무상태표·제 15기·계정과목)가 되풀이된다.
 *            차감 계정은 번호 없이 한 단 더 들여 쓴 줄(「단기대여금대손충당금」 — 이름이 엉뚱하게 찍히기도 한다).
 * 계정 줄 = 끝 줄(바로 아래 줄이 더 깊지 않은 줄). 금액 = 「당기」 머리 열부터 「전기」 머리 앞까지의 첫 숫자. 전기도 같게(prior).
 * 재무제표 금액은 성격대로 양수라서 시산표 부호(차변 − 대변)로 바꿔 bal 에 — 자산·비용은 그대로, 부채·자본·수익은 뒤집는다.
 * 제조원가명세서는 보이는 금액 그대로(정산표 WMS 도 양수로 적고 식에서 뺀다).
 */
const CONTRA = /^(감가상각누계액|대손충당금|정부보조금|국고보조금|현재가치할인차금|손상차손누계액|퇴직연금운용자산|국민연금전환금|사채할인발행차금)$|감가상각누계액$|대손충당금$/;
const PAGE_HEAD = /^(재무상태표|대차대조표|손익계산서|포괄손익계산서|제조원가명세서|계정과목|과목|회계단위명.*|회사명.*|\(단위.*)$|^제\d+기/;
/** 합계·이익 같은 계산 줄 — 정산표에 받을 줄이 없어도 「넣을 곳」으로 묻지 않는다. */
const SUBTOTAL = /총계|합계|총이익|영업이익|영업손실|차감전|순이익|순손실|순손익|총포괄|기타포괄손익$/;
export function fsFromSheet(sh: SheetData, kind: 'BS' | 'PL' | 'MC', src?: string): TbLine[] {
  let headRow = 0, labelCol = 0;
  for (const [ref, v] of sh.cells) {
    if (/^(과목|계정과목|계정)$/.test(norm(v.text)) && (!headRow || rowOf(ref) < headRow)) { headRow = rowOf(ref); labelCol = colNum(colOf(ref)); }
  }
  if (!headRow) throw new Error(`「${sh.name}」에서 「과목」 머리를 찾지 못했습니다.`);
  const htxt = (c: number) => norm(sh.cells.get(`${colName(c)}${headRow}`)?.text);
  let curCol = 0, priorCol = 0;
  for (let c = labelCol + 1; c <= labelCol + 12; c++) {
    if (!curCol && /당\)?기|^당기/.test(htxt(c))) curCol = c;
    else if (curCol && !priorCol && /전\)?기|^전기/.test(htxt(c))) priorCol = c;
  }
  if (!curCol) curCol = labelCol + 1;
  const curEnd = priorCol || curCol + 2, priorEnd = priorCol ? priorCol + (priorCol - curCol) : 0;
  // 금액이 글자로 들어온 ERP(아비즈 「1,177,028,251」·「(1,000)」·「-1,000」)도 숫자로.
  const numOf = (v: { num?: number; text?: string } | undefined) => {
    if (v?.num != null) return v.num;
    const t = (v?.text ?? '').replace(/[\s,원]/g, '');
    const m = /^(\()?(-)?(\d+(?:\.\d+)?)(\))?$/.exec(t);
    return m ? (m[1] || m[2] ? -Number(m[3]) : Number(m[3])) : undefined;
  };
  const firstNum = (r: number, from: number, to: number) => { for (let c = from; c < to; c++) { const n = numOf(sh.cells.get(`${colName(c)}${r}`)); if (n != null) return n; } return undefined; };
  const maxRow = Math.max(...[...sh.cells.keys()].map(rowOf));
  // 줄 모으기 — 쪽 머리·빈 줄·「당기: 1,577…」 같은 덧글은 뺀다.
  type Line = { r: number; raw: string; depth: number; rank: number; name: string };
  const lines: Line[] = [];
  for (let r = headRow + 1; r <= maxRow; r++) {
    const raw = (sh.cells.get(`${colName(labelCol)}${r}`)?.text ?? '').replace(/\s+$/, '');
    const t = norm(raw);
    if (!t || PAGE_HEAD.test(t) || /^\(?당기순이익\)?$|^당기:|^전기:/.test(t)) continue;
    const lead = /^\s*/.exec(raw)![0].length;
    const body = raw.trim();
    const rank = /^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]/.test(body) || /^[IVX]+\s*\./.test(body) ? 1 : /^\(\d+\)/.test(body) ? 2 : /^\d+\./.test(body) ? 3 : /^\d+\)/.test(body) ? 4 : 9;
    const name = body.replace(/^([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+\s*\.?|[IVX]+\s*\.|\(\d+\)|\d+\)|\d+\.)\s*/, '').replace(/^\((판|제)\)\s*[A-Z]?(?=[가-힣])/, '').replace(/\s+/g, ' ').trim();
    lines.push({ r, raw, depth: lead, rank, name });
  }
  const out: TbLine[] = [];
  let section: TbLine['section'] = kind === 'PL' ? '손익' : kind === 'MC' ? '원가' : '자산', current = true, credit = false;
  const stack: Line[] = [];
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i], nx = lines[i + 1];
    const b = norm(L.name);
    while (stack.length && stack[stack.length - 1].depth >= L.depth) stack.pop();
    // 아래 줄이 번호 없이 한 단 더 깊으면 — 이 줄은 계정, 아래 줄은 차감 계정(ERP). 더존의 「(1) 당좌자산」 아래 계정 줄과 가르려고 이 줄이 「1.」「1)」일 때만.
    const contraBelow = !!nx && nx.rank === 9 && nx.depth > L.depth && (L.rank === 3 || L.rank === 4);
    const deeper = !!nx && !contraBelow && (nx.depth > L.depth || (nx.depth === L.depth && nx.rank > L.rank && L.rank < 9));
    const prev = lines[i - 1];
    const isContra = CONTRA.test(b) || (L.rank === 9 && !!prev && (prev.rank === 3 || prev.rank === 4) && L.depth > prev.depth);
    if (kind === 'BS') {
      if (/^자산$/.test(b)) section = '자산'; else if (/^부채$/.test(b)) { section = '부채'; current = true; } else if (/^자본$/.test(b)) section = '자본';
      if (deeper && /비유동/.test(b)) current = false; else if (deeper && /유동/.test(b)) current = true;
    } else if (kind === 'PL' && L.rank === 1) credit = /(매출액|수익)$/.test(b) && !/원가|총이익/.test(b);
    if (deeper) { stack.push(L); continue; }
    const amt0 = firstNum(L.r, curCol, curEnd);
    const pr0 = priorCol ? firstNum(L.r, priorCol, priorEnd) : undefined;
    if (amt0 == null && pr0 == null) continue;
    const sgn = (x: number | undefined) => (x == null ? undefined : isContra ? -Math.abs(x) : x);
    const amt = sgn(amt0) ?? 0, prior = sgn(pr0);
    const flip = kind === 'BS' ? section !== '자산' : kind === 'PL' ? credit : false;
    const group = stack.length ? stack[stack.length - 1].name : undefined;
    const name = isContra && !CONTRA.test(b) && group ? `${L.name}(차감 — ${group})` : L.name;
    const line: TbLine = { name, section, current: kind === 'BS' ? current : undefined, bal: flip ? -amt : amt, prior, src: src ?? kind, group };
    // 합계 줄 — 재무상태표는 「총계·합계」만(「당기순이익」은 자본 계정이다), 손익·제조원가는 이익·합계 줄까지.
    if (kind === 'BS' ? /총계|합계/.test(b) : SUBTOTAL.test(b) || (kind === 'MC' && /총제조|제품제조원가|^합계/.test(b))) line.subtotal = true;
    out.push(line);
  }
  return out;
}
