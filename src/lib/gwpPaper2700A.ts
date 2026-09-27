// 웹 조서 — 중요성 2700A-1(적용지침) · 2700A-2(감사계획단계, 1차) · 2700A-3(감사수행단계, 2차) · 2700A-4(감사완결단계, 3차).
// 요약표 2700A 는 수식으로 2·3·4 를 모은다 — 반영할 때 올해 양식으로 함께 맞춘다(companions).
//
// 쓰기는 2026 양식 모양에만 한다(설계서 14.2 — 옛 모양은 반영 때 갈아끼운다). 읽기는 옛 모양도 한다:
// 명진 FY25 의 2700A-2(소규모)는 「① 자산총액 · 1) 선택 기준 · 2) 백분율 · 1) 삭감 비율」 꼴이었다.
import type { SheetData } from './xlsxRead';
import type { CellEdit } from './xlsxCells';
import { normLabel, textOf, colOf, rowOf, findHeader, type WebPaperDef } from './gwpWeb';
import type { StageNo } from './gwpStage';
import type { FsLine } from './fsParse';

export const BENCHES = ['세전계속사업이익', '매출액', '총자산', '순자산'] as const;
export type BenchKey = (typeof BENCHES)[number];

export interface Paper2700 {
  /** 회계기간 글자 「제19기 2026년 1월 1일 ～ 2026년 12월 31일」 */ period: string;
  /** 상장여부 「일반외감」 */ listed: string;
  /** 기준 금액(백만원) */ amounts: Record<BenchKey, number | null>;
  bench: BenchKey;
  /** 적용비율(0.03 = 3%) */ rate: number | null;
  /** 결정된 중요성 금액(백만원) */ materiality: number | null;
  reason: string;
  /** 전기와 다른 기준·적용률이면 그 근거 */ changeReason: string;
  /** 수행중요성 — 전체 중요성에 대한 비율(0.75) */ pmRate: number | null;
  pmReason: string;
  /** 명백하게 사소한 — 전체 중요성에 대한 비율(0.05) */ ctRate: number | null;
  ctReason: string;
}

export const emptyMateriality = (): Paper2700 => ({
  period: '', listed: '', amounts: { 세전계속사업이익: null, 매출액: null, 총자산: null, 순자산: null },
  bench: '총자산', rate: null, materiality: null, reason: '', changeReason: '', pmRate: 0.75, pmReason: '', ctRate: 0.05, ctReason: '',
});

// ── 칸 찾기 도우미 ─────────────────────────────────────
type Hit = { ref: string; row: number; col: string; text: string };
function cellsOf(sheet: SheetData): Hit[] {
  const out: Hit[] = [];
  for (const [ref, v] of sheet.cells) {
    const t = textOf(v);
    if (t && v.formula == null) out.push({ ref, row: rowOf(ref), col: colOf(ref), text: t });
  }
  return out.sort((a, b) => a.row - b.row || colNum(a.col) - colNum(b.col));
}
function colNum(c: string): number { let n = 0; for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
function colName(n: number): string { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
const next = (c: string, by = 1) => colName(colNum(c) + by);
/** 문구가 이것으로 시작하는 첫 칸(after 줄 뒤). */
function find(hits: Hit[], starts: string, after = 0, col?: string): Hit | null {
  const w = normLabel(starts);
  return hits.find((h) => h.row > after && (!col || h.col === col) && normLabel(h.text).startsWith(w)) ?? null;
}
const num = (sheet: SheetData, ref: string): number | null => {
  const v = sheet.cells.get(ref);
  return v?.num != null && Number.isFinite(v.num) ? v.num : null;
};
const text = (sheet: SheetData, ref: string) => textOf(sheet.cells.get(ref));
const benchOf = (s: string): BenchKey | null => {
  const t = normLabel(s).replace(/\(\*\)$/, '');
  if (/세전|법인세차감전/.test(t)) return '세전계속사업이익';
  if (/매출/.test(t)) return '매출액';
  if (/총자산|자산총/.test(t)) return '총자산';
  if (/순자산|자기자본|자본총/.test(t)) return '순자산';
  return null;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── 2026 양식 모양 ──────────────────────────────────────
const HEAD = ['Benchmark', '회사제시금액 (백만원)', '적용여부', '적용비율', '적용할 중요성금액'];
interface Layout {
  benchRows: { key: BenchKey; row: number; label: string }[];
  cols: { B: string; C: string; D: string; I: string; J: string; K: string };
  benchName: string | null; matRef: string | null;
  reasonRef: string | null; changeRef: string | null;
  pmRateRef: string | null; pmReasonRef: string | null;
  ctRateRef: string | null; ctReasonRef: string | null;
  periodRef: string | null; listedRef: string | null;
}
export function layout2700(sheet: SheetData): Layout | null {
  const h = findHeader(sheet, HEAD);
  if (!h) return null;
  const hits = cellsOf(sheet);
  const cols = { B: h.cols.Benchmark, C: h.cols['회사제시금액 (백만원)'], D: next(h.cols['회사제시금액 (백만원)']), I: h.cols['적용여부'], J: h.cols['적용비율'], K: h.cols['적용할 중요성금액'] };
  const benchRows: Layout['benchRows'] = [];
  for (const x of hits.filter((x) => x.col === cols.B && x.row > h.row && x.row < h.row + 10)) {
    const k = benchOf(x.text);
    if (k && !benchRows.some((b) => b.key === k)) benchRows.push({ key: k, row: x.row, label: x.text.replace(/\(\*\)\s*$/, '').trim() });
  }
  const inK = (label: string, after: number) => { const x = find(hits, label, after); return x ? `${cols.K}${x.row}` : null; };
  const reasonAfter = (after: number) => { const x = find(hits, '근거', after, cols.B); return x ? `${cols.B}${x.row + 1}` : null; };
  const sec3 = find(hits, '3. 수행 중요성')?.row ?? 0;
  const sec4 = find(hits, '4. 명백하게')?.row ?? 0;
  const change = find(hits, '계속감사시 전기와 다른', h.row, cols.B);
  const period = find(hits, '2) 회계기간');
  const listed = find(hits, '3) 상장여부');
  return {
    benchRows, cols,
    benchName: inK('적용할 중요성 기준', h.row), matRef: inK('결정된 중요성 금액', h.row),
    reasonRef: reasonAfter(h.row), changeRef: change ? `${cols.B}${change.row + 1}` : null,
    pmRateRef: sec3 ? inK('전체 중요성에 대한 적용비율', sec3) : null, pmReasonRef: sec3 ? reasonAfter(sec3) : null,
    ctRateRef: sec4 ? inK('전체 중요성에 대한 적용비율', sec4) : null, ctReasonRef: sec4 ? reasonAfter(sec4) : null,
    periodRef: period ? `C${period.row}` : null, listedRef: listed ? `C${listed.row}` : null,
  };
}

function readNew(sheet: SheetData, L: Layout): Paper2700 {
  const d = emptyMateriality();
  for (const b of L.benchRows) {
    d.amounts[b.key] = num(sheet, `${L.cols.C}${b.row}`);
    if (text(sheet, `${L.cols.I}${b.row}`) === '적용') { d.bench = b.key; d.rate = num(sheet, `${L.cols.J}${b.row}`); }
  }
  const bn = L.benchName ? benchOf(text(sheet, L.benchName)) : null;
  if (bn) d.bench = bn;
  d.materiality = L.matRef ? num(sheet, L.matRef) : null;
  d.reason = L.reasonRef ? text(sheet, L.reasonRef) : '';
  d.changeReason = L.changeRef ? text(sheet, L.changeRef) : '';
  d.pmRate = L.pmRateRef ? num(sheet, L.pmRateRef) : d.pmRate;
  d.pmReason = L.pmReasonRef ? text(sheet, L.pmReasonRef) : '';
  d.ctRate = L.ctRateRef ? num(sheet, L.ctRateRef) : d.ctRate;
  d.ctReason = L.ctReasonRef ? text(sheet, L.ctReasonRef) : '';
  d.period = L.periodRef ? text(sheet, L.periodRef) : '';
  d.listed = L.listedRef ? text(sheet, L.listedRef) : '';
  // 양식 견본 글자는 작년 값이 아니다.
  if (/^\(예시\)/.test(d.reason)) d.reason = '';
  if (/^\(예시\)/.test(d.changeReason)) d.changeReason = '';
  if (/제\s*기\s*20\d\d/.test(d.period)) d.period = '';
  return d;
}

/** 옛 모양(명진 FY25 2700A-2(소규모)) — 「① 자산총액 D · 1) 선택 기준 E · 2) 백분율 G · 1) 삭감 비율 G」. */
function readOld(sheet: SheetData): Paper2700 | null {
  const hits = cellsOf(sheet);
  const sel = find(hits, '1) 선택 기준');
  if (!sel) return null;
  const d = emptyMateriality();
  const valueRight = (h: Hit | null, cols: string[]) => {
    if (!h) return null;
    for (const c of cols) { const n = num(sheet, `${c}${h.row}`); if (n != null) return n; }
    return null;
  };
  d.amounts.총자산 = valueRight(find(hits, '① 자산총액'), ['D', 'C', 'E']);
  d.amounts.매출액 = valueRight(find(hits, '② 매출액'), ['D', 'C', 'E']);
  d.amounts.순자산 = valueRight(find(hits, '③ 자기자본'), ['D', 'C', 'E']);
  d.amounts.세전계속사업이익 = valueRight(find(hits, '⑥ 세전손익'), ['G', 'F', 'H']);
  const selName = hits.find((h) => h.row === sel.row && h.col !== sel.col)?.text ?? '';
  d.bench = benchOf(selName) ?? '총자산';
  const pct = find(hits, '2) 백분율', sel.row);
  d.rate = valueRight(pct, ['G', 'F', 'H']);
  const mat = find(hits, '3) 중요성 금액', sel.row);
  const m = mat ? num(sheet, `G${mat.row}`) : null;
  d.materiality = m != null ? Math.round(m) : null;
  const reasonAfter = (after: number) => { const x = find(hits, '근거', after, 'B'); return x ? text(sheet, `B${x.row + 1}`) : ''; };
  d.reason = [reasonAfter(sel.row), pct ? reasonAfter(pct.row) : ''].filter(Boolean).join('\n');
  const sec3 = find(hits, '3. 수행 중요성');
  const cut = sec3 ? find(hits, '1) 삭감 비율', sec3.row) : null;
  const cutRate = valueRight(cut, ['G', 'F', 'H']);
  d.pmRate = cutRate != null ? round2(1 - cutRate) : d.pmRate;
  d.pmReason = sec3 ? reasonAfter(sec3.row) : '';
  const sec4 = find(hits, '4. 명백하게');
  d.ctRate = valueRight(sec4 ? find(hits, '1) 산정 비율', sec4.row) : null, ['G', 'F', 'H']) ?? d.ctRate;
  d.ctReason = sec4 ? reasonAfter(sec4.row) : '';
  d.period = text(sheet, `C${find(hits, '2) 회계기간')?.row ?? 0}`);
  d.listed = text(sheet, `C${find(hits, '3) 상장여부')?.row ?? 0}`);
  return d;
}

export function read2700(sheet: SheetData): Paper2700 {
  const L = layout2700(sheet);
  return L ? readNew(sheet, L) : readOld(sheet) ?? emptyMateriality();
}

export function write2700(sheet: SheetData, d: Paper2700): CellEdit[] {
  const L = layout2700(sheet);
  if (!L) throw new Error('중요성 시트가 올해 양식 모양이 아닙니다 — 반영할 때 올해 양식으로 맞춥니다(표준양식이 등록돼 있어야 합니다).');
  const e: CellEdit[] = [];
  const put = (ref: string | null, v: string | number | null) => {
    if (!ref) return;
    if (v == null || v === '') e.push({ ref, clear: true });
    else e.push(typeof v === 'number' ? { ref, num: v } : { ref, text: v });
  };
  const { C, D, I, J, K } = L.cols;
  const E = next(D), F = next(D, 2), G = next(D, 3), H = next(D, 4);
  for (const b of L.benchRows) {
    const r = b.row;
    put(`${C}${r}`, d.amounts[b.key]);
    put(`${I}${r}`, b.key === d.bench ? '적용' : '미적용');
    put(`${J}${r}`, b.key === d.bench ? d.rate : null);
    // 양식 견본은 범위 칸이 수식·값으로 섞여 있다 — 모두 수식으로 둔다.
    e.push({ ref: `${F}${r}`, formula: `$${C}${r}*${D}${r}` }, { ref: `${G}${r}`, formula: `$${C}${r}*${E}${r}` },
      { ref: `${H}${r}`, formula: `${G}${r}-${F}${r}` }, { ref: `${K}${r}`, formula: `IFERROR(${C}${r}*${J}${r},0)` });
  }
  put(L.benchName, L.benchRows.find((b) => b.key === d.bench)?.label ?? d.bench);
  put(L.matRef, d.materiality);
  put(L.reasonRef, d.reason);
  put(L.changeRef, d.changeReason);
  put(L.pmRateRef, d.pmRate);
  put(L.pmReasonRef, d.pmReason);
  put(L.ctRateRef, d.ctRate);
  put(L.ctReasonRef, d.ctReason);
  put(L.periodRef, d.period);
  put(L.listedRef, d.listed);
  return e;
}

/** 계산된 중요성(기준 금액 × 적용비율). */
export function computedMateriality(d: Paper2700): number | null {
  const a = d.amounts[d.bench];
  return a != null && d.rate != null ? a * d.rate : null;
}

/**
 * 재무제표 → 기준 금액(백만원). 전기 DSD 의 당기(= 전기 결산) 금액을 쓴다.
 * unit 은 DSD 금액 단위(원·천원).
 */
export function amountsFromFs(lines: FsLine[], unit: '원' | '천원'): Partial<Record<BenchKey, number>> {
  const div = unit === '천원' ? 1e3 : 1e6;
  const clean = (s: string) => s.replace(/\s/g, '').replace(/^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX]+\.|^\d+\./, '').replace(/\(.*?\)$/, '');
  const out: Partial<Record<BenchKey, number>> = {};
  const pick = (re: RegExp, st?: RegExp) => lines.find((l) => (!st || st.test(l.statement)) && re.test(clean(l.label)) && l.cur != null);
  const set = (k: BenchKey, l: FsLine | undefined) => { if (l?.cur != null) out[k] = Math.round(l.cur / div); };
  set('세전계속사업이익', pick(/^법인세(비용)?차감전(계속사업)?(순)?(이익|손실|손익)/, /손익/));
  set('매출액', pick(/^(매출액|영업수익|수익)$/, /손익/));
  set('총자산', pick(/^자산총계$/, /재무상태|대차대조/));
  set('순자산', pick(/^자본총계$/, /재무상태|대차대조/));
  return out;
}

function stageDef(code: string, title: string, stage: StageNo, note: string): WebPaperDef<Paper2700> {
  return {
    code, title, stage, note, sheetCode: code, useTemplate: true, companions: ['2700A'],
    empty: emptyMateriality, read: read2700, write: write2700,
  };
}
export const PAPER_2700A_2 = stageDef('2700A-2', '중요성(감사계획단계)', 1, '기준 금액은 자료함의 전기 DSD 에서. 2700A-1 판단으로 적용률을 추천한다.');
export const PAPER_2700A_3 = stageDef('2700A-3', '중요성(감사수행단계)', 2, '1차(2700A-2) 값을 기본으로, 바뀐 것만 고친다.');
export const PAPER_2700A_4 = stageDef('2700A-4', '중요성(감사완결단계)', 3, '2차 값을 기본으로. 8110ARP 의 기준이 된다.');

// ── 2700A-1 적용지침 — 적용률 고려요소 ────────────────────
export type Level = '낮은' | '중간' | '높은' | '';
export interface Factor { label: string; level: Level; reason: string }
export interface Paper2700A1 { factors: Factor[]; extra: string }

interface Layout1 { rows: { label: string; levelRef: string; reasonRef: string | null }[]; extraRef: string | null }
export function layout2700A1(sheet: SheetData): Layout1 | null {
  const h = findHeader(sheet, ['구분', '백분율 적용']);
  if (!h) return null;
  const hits = cellsOf(sheet);
  const Dc = h.cols['백분율 적용'];
  const labelCol = h.cols['구분'];
  const Ec = next(Dc);
  const rows: Layout1['rows'] = [];
  const stop = find(hits, '추가고려요소', h.row);
  let lastLabel = '';
  for (const x of hits.filter((x) => x.col === Dc && x.row > h.row && (!stop || x.row < stop.row))) {
    if (!/수준\s*적용율/.test(x.text)) continue;
    const lab = hits.find((y) => y.row === x.row && y.col === labelCol)?.text ?? '';
    const label = lab || `${lastLabel}(2)`;
    if (lab) lastLabel = lab;
    const rr = hits.find((y) => y.col === Dc && y.row > x.row && normLabel(y.text) === '판단근거');
    rows.push({ label, levelRef: x.ref, reasonRef: rr ? `${Ec}${rr.row}` : null });
  }
  return { rows, extraRef: stop ? `${Ec}${stop.row}` : null };
}
const levelOf = (s: string): Level => (/낮은/.test(s) ? '낮은' : /중간/.test(s) ? '중간' : /높은/.test(s) ? '높은' : '');

export const PAPER_2700A_1: WebPaperDef<Paper2700A1> = {
  code: '2700A-1', title: '중요성 산정 적용지침', stage: 1, sheetCode: '2700A-1', useTemplate: true,
  // 명진은 옛 2700A-1(소규모)(기본정보)와 2700A-1(적용지침)이 함께 있다 — 고려요소 표가 있는 쪽.
  pick: (sheets) => sheets.filter((s) => /^2700A-1/.test(s.name.replace(/\s/g, '')))
    .sort((a, b) => Number(!!a.hidden) - Number(!!b.hidden)).find((s) => layout2700A1(s)) ?? null,
  note: '적용률 고려요소마다 낮은·중간·높은 수준과 판단근거 — 2700A-2 의 적용률을 추천한다.',
  empty: () => ({ factors: [], extra: '' }),
  read(sheet) {
    const L = layout2700A1(sheet);
    if (!L) return { factors: [], extra: '' };
    return {
      factors: L.rows.map((r) => ({ label: r.label, level: levelOf(text(sheet, r.levelRef)), reason: r.reasonRef ? text(sheet, r.reasonRef) : '' })),
      extra: L.extraRef ? text(sheet, L.extraRef) : '',
    };
  },
  write(sheet, d) {
    const L = layout2700A1(sheet);
    if (!L) throw new Error('2700A-1 시트에서 「구분 · 백분율 적용」 표를 찾지 못했습니다.');
    const e: CellEdit[] = [];
    L.rows.forEach((r, i) => {
      const f = d.factors.find((x) => x.label === r.label) ?? d.factors[i];
      if (!f) return;
      e.push(f.level ? { ref: r.levelRef, text: `${f.level} 수준 적용율` } : { ref: r.levelRef, clear: true });
      if (r.reasonRef) e.push(f.reason.trim() ? { ref: r.reasonRef, text: f.reason.trim() } : { ref: r.reasonRef, clear: true });
    });
    if (L.extraRef) e.push(d.extra.trim() ? { ref: L.extraRef, text: d.extra.trim() } : { ref: L.extraRef, clear: true });
    return e;
  },
};

/** 2700A-1 판단 → 적용률 수준. 낮은 쪽 요소가 하나라도 있으면 낮게(보수적), 높은 쪽만 있으면 높게, 아니면 중간. */
export function suggestLevel(f: Factor[]): Level {
  const ls = f.map((x) => x.level).filter(Boolean);
  if (!ls.length) return '';
  if (ls.includes('낮은')) return '낮은';
  if (ls.every((l) => l === '높은')) return '높은';
  return '중간';
}

/** 인덕 규정 적용율 범위(2700A-1 표) — 하한·평균·상한. 시트에서 못 읽으면 양식 값. */
export const RATE_RANGE: Record<BenchKey, [number, number]> = {
  세전계속사업이익: [0.05, 0.1], 매출액: [0.008, 0.03], 총자산: [0.01, 0.03], 순자산: [0.01, 0.05],
};
export function suggestRate(bench: BenchKey, level: Level): number | null {
  const [lo, hi] = RATE_RANGE[bench];
  if (level === '낮은') return lo;
  if (level === '높은') return hi;
  if (level === '중간') return round2(((lo + hi) / 2) * 1000) / 1000;
  return null;
}
