// 웹 조서 2120A 위험평가 분석적절차 — 1차 확정(중간감사 전).
//
// 사용자 2026-09-27: 「감사계획단계의 조서이므로 전기 DSD 를 반영하면 돼. 이미 들어 있는 숫자가 있다면 전전기 숫자는
// 칸을 옮기면 해결될 거야」 — 이월이 당기 열을 전기 열로 옮겨 두었고(gwpCarry), 여기서는 비워 둔 당기 열을
// **자료함의 전기 DSD 재무제표**로 채운다. 줄 짝짓기:
//   ① 문구 — 「현금및현금성자산」 = 「현금및현금성자산」(번호·공백 떼고)
//   ② 차감 계정 — 「대손충당금-매출채권」은 DSD 「매출채권」 바로 아래 「대손충당금」
//   ③ 전기 금액 — 문구가 달라도(「단기투자자산」 ↔ 「단기금융상품」) 전기 열 금액 = DSD 전기 금액인 줄이 하나면 그 줄
// 회사가 손본 분석표라 올해 양식으로 갈아끼우지 않는다(useTemplate 없음).
import type { SheetData } from './xlsxRead';
import type { CellEdit } from './xlsxCells';
import { normLabel, textOf, colOf, rowOf, type WebPaperDef } from './gwpWeb';
import { findPeriodColumns } from './gwpCarry';
import type { FsLine } from './fsParse';

export interface Row2120 {
  key: string;
  label: string;
  /** 공시용 계정(D열) */ fsli: string;
  /** 손익 줄인가(매출액 아래) */ pl: boolean;
  prev: number | null;
  cur: number | null;
  note: string;
  /** 당기 금액을 어디서 채웠나 */ src?: '문구' | '차감' | '금액' | '손' | '';
  /** 전기 열 금액이 DSD 전기 금액과 다르다 */ prevDiff?: number | null;
}
export interface Paper2120A { rows: Row2120[]; prevLabel: string; curLabel: string }

type Hit = { row: number; col: string; text: string };
function textsOf(sheet: SheetData): Hit[] {
  const out: Hit[] = [];
  for (const [ref, v] of sheet.cells) { const t = textOf(v); if (t && v.formula == null && v.text != null) out.push({ row: rowOf(ref), col: colOf(ref), text: t }); }
  return out;
}
function colNum(c: string): number { let n = 0; for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
function colName(n: number): string { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }

function layout(sheet: SheetData) {
  const pc = findPeriodColumns(sheet);
  if (!pc) return null;
  const hits = textsOf(sheet);
  const head = hits.filter((h) => h.row === pc.headerRow);
  const fsliHead = head.find((h) => normLabel(h.text).includes('IFRS공시'));
  const acctHead = head.find((h) => normLabel(h.text).startsWith('계정과목') && h !== fsliHead);
  const noteHead = head.find((h) => normLabel(h.text) === '비고');
  const labelCol = acctHead ? colName(colNum(acctHead.col) + 1) : 'C';
  const plStart = hits.find((h) => h.row > pc.headerRow && /^(Ⅰ|I)\.?매출액$/.test(normLabel(h.text)))?.row ?? Infinity;
  const rows: { row: number; label: string; fsli: string; pl: boolean }[] = [];
  for (const h of hits.filter((x) => x.col === labelCol && x.row > pc.headerRow + 1).sort((a, b) => a.row - b.row)) {
    const cur = sheet.cells.get(`${pc.curCol}${h.row}`);
    const prev = sheet.cells.get(`${pc.prevCol}${h.row}`);
    if (cur?.formula != null || prev?.formula != null) continue;   // 합계·비율 줄
    rows.push({ row: h.row, label: h.text, fsli: fsliHead ? textOf(sheet.cells.get(`${fsliHead.col}${h.row}`)) : '', pl: h.row > plStart });
  }
  return { pc, rows, noteCol: noteHead?.col ?? null };
}

const keyOf = (label: string, fsli: string, n: number) => `${normLabel(label)}|${normLabel(fsli)}#${n}`;
function keyed<T extends { label: string; fsli: string }>(rows: T[]): (T & { key: string })[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const b = `${normLabel(r.label)}|${normLabel(r.fsli)}`;
    const n = seen.get(b) ?? 0;
    seen.set(b, n + 1);
    return { ...r, key: keyOf(r.label, r.fsli, n) };
  });
}

const numOf = (sheet: SheetData, ref: string) => { const v = sheet.cells.get(ref); return v?.num != null ? v.num : null; };

export const PAPER_2120A: WebPaperDef<Paper2120A> = {
  code: '2120A', title: '위험평가 분석적절차', stage: 1, sheetCode: '2120A',
  note: '자료함의 전기 DSD 로 당기 열을 채운다(문구·차감 계정·전기 금액으로 짝짓기). 증감 큰 줄에 비고.',
  empty: () => ({ rows: [], prevLabel: '', curLabel: '' }),
  read(sheet) {
    const L = layout(sheet);
    if (!L) return { rows: [], prevLabel: '', curLabel: '' };
    return {
      prevLabel: L.pc.prevLabel, curLabel: L.pc.curLabel,
      rows: keyed(L.rows).map((r) => ({
        key: r.key, label: r.label, fsli: r.fsli, pl: r.pl,
        prev: numOf(sheet, `${L.pc.prevCol}${r.row}`), cur: numOf(sheet, `${L.pc.curCol}${r.row}`),
        note: L.noteCol ? textOf(sheet.cells.get(`${L.noteCol}${r.row}`)) : '',
      })),
    };
  },
  write(sheet, d) {
    const L = layout(sheet);
    if (!L) throw new Error('2120A 에서 전기·당기 기간 열(머리 줄)을 찾지 못했습니다.');
    const at = new Map(keyed(L.rows).map((r) => [r.key, r.row]));
    const e: CellEdit[] = [];
    for (const r of d.rows) {
      const row = at.get(r.key);
      if (!row) continue;
      const ref = `${L.pc.curCol}${row}`;
      e.push(r.cur == null ? { ref, clear: true } : { ref, num: r.cur });
      if (L.noteCol) { const nref = `${L.noteCol}${row}`; e.push(r.note.trim() ? { ref: nref, text: r.note.trim() } : { ref: nref, clear: true }); }
    }
    return e;
  },
};

// ── 전기 DSD 로 당기 열 채우기 ─────────────────────────────
const CONTRA = /^(대손충당금|감가상각누계액|손상차손누계액|정부보조금|현재가치할인차금)[-−–](.+)$/;
export const cleanFs = (s: string) => normLabel(s)
  .replace(/^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX]+\./, '').replace(/^\(\d+\)/, '').replace(/^\d+\./, '')
  .replace(/\(손실\)$|\(수익\)$/, '');

export interface FillReport {
  byLabel: number; byContra: number; byValue: number; missing: string[]; prevDiff: string[]; scale: number;
  /** DSD 에는 금액이 있는데 2120A 에 받을 줄이 없는 계정 — 합계가 안 맞는 까닭(명진 FY25 당기법인세자산 30,345) */
  unplaced: { statement: string; label: string; cur: number }[];
}

/** 전기 DSD 재무제표(당기 = 전기 결산) → 2120A 당기 열. 손으로 고친 줄(src '손')은 건드리지 않는다. */
export function fillFromFs(d: Paper2120A, lines: FsLine[]): { data: Paper2120A; report: FillReport } {
  const bs = lines.filter((l) => /재무상태|대차대조/.test(l.statement));
  const pl = lines.filter((l) => /손익/.test(l.statement));
  // 단위 — 전기 열(원 단위 시산표)과 DSD 전기 금액의 비율(1 또는 1000).
  const ratios: number[] = [];
  for (const r of d.rows) {
    const l = (r.pl ? pl : bs).find((x) => cleanFs(x.label) === cleanFs(r.label));
    if (l?.pri && r.prev) ratios.push(r.prev / l.pri);
  }
  const med = ratios.sort((a, b) => a - b)[Math.floor(ratios.length / 2)] ?? 1;
  const scale = Math.abs(med - 1000) < Math.abs(med - 1) ? 1000 : 1;
  const rep: FillReport = { byLabel: 0, byContra: 0, byValue: 0, missing: [], prevDiff: [], scale, unplaced: [] };
  const val = (n: number | undefined) => (n == null ? 0 : n * scale);
  // 한 DSD 줄은 한 번만 쓴다 — 판관비·영업외에 같은 이름(지급수수료)이 있다.
  const used = new Set<FsLine>();
  const rows = d.rows.map((r): Row2120 => {
    if (r.src === '손') return r;
    const pool = (r.pl ? pl : bs).filter((x) => !used.has(x));
    const me = cleanFs(r.label);
    let hit: FsLine | undefined; let src: Row2120['src'] = '';
    const c = CONTRA.exec(me);
    if (c) {
      // 기준 계정(매출채권)은 이미 쓰였을 수 있다 — 전체 목록에서 찾고, 그 아래 안 쓴 차감 줄을 고른다.
      const all = r.pl ? pl : bs;
      const i = all.findIndex((x) => cleanFs(x.label) === c[2]);
      if (i >= 0) hit = all.slice(i + 1, i + 4).find((x) => !used.has(x) && cleanFs(x.label).startsWith(c[1]));
      if (hit) src = '차감';
    }
    if (!hit) { hit = pool.find((x) => cleanFs(x.label) === me); if (hit) src = '문구'; }
    if (!hit && r.prev) {
      const same = pool.filter((x) => x.pri != null && val(x.pri) === r.prev);
      if (same.length === 1) { hit = same[0]; src = '금액'; }
    }
    // 작년에도 없던 계정이 올해도 DSD 에 없으면 비워 둔다 — 알릴 것은 작년 금액이 있던 줄뿐.
    if (!hit) { if (r.prev) rep.missing.push(r.label); return { ...r, cur: r.prev ? r.cur : null, src: '' }; }
    used.add(hit);
    if (src === '문구') rep.byLabel += 1; else if (src === '차감') rep.byContra += 1; else rep.byValue += 1;
    let cur = val(hit.cur);
    if (src === '차감') cur = -Math.abs(cur);
    const pri = src === '차감' ? -Math.abs(val(hit.pri)) : val(hit.pri);
    const diff = r.prev != null && hit.pri != null && pri !== r.prev ? pri : null;
    if (diff != null) rep.prevDiff.push(r.label);
    return { ...r, cur, src, prevDiff: diff };
  });
  // 안 쓴 DSD 줄 — 합계 줄(아래에 더 깊은 줄이 있는 것)·쓴 줄의 하위 줄·총계는 빼고, 금액이 있는 것만.
  for (const pool of [bs, pl]) {
    let cover = -1;
    pool.forEach((x, i) => {
      const nextDeeper = (pool[i + 1]?.level ?? -1) > x.level;
      if (used.has(x)) { cover = x.level; return; }
      if (cover >= 0 && x.level > cover) return;
      cover = -1;
      if (nextDeeper || x.level === 0 || /총계|합계/.test(cleanFs(x.label)) || !x.cur) return;
      rep.unplaced.push({ statement: x.statement, label: x.label, cur: val(x.cur) });
    });
  }
  return { data: { ...d, rows }, report: rep };
}
