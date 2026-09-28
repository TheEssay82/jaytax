// 웹 조서 8110ARP — 종결단계 분석적검토(8110ARP_BS · 8110ARP_PL 두 시트). 3차 확정(기말감사 완료 후).
//
// 사용자 2026-09-27: 「기말감사 완료 시 정산표가 확정되면 당기 숫자를 반영」 「Explanation 은 웹으로 직접 기재」
// 「8110 의 중요성은 2700A-4 에 연결」.
//
// 당기 숫자 — 자료함의 **확정 정산표(WTB)** 에서. 작년 링크 주소(WBS!X6)는 쓰지 않는다: 정산표는 해마다 감사후 열이
// 하나씩 옆으로 늘어 주소가 바뀐다(명진 WTB: D~T 가 FY16~FY25 감사후, U 제시, V·W 수정, X 감사후). 그래서
//   열 = 머리(1~5행)에 **올해 결산일이 적힌 가장 오른쪽 열**(감사후), 전기 = 전기 결산일이 적힌 가장 오른쪽 열
//   줄 = **계정 이름**(BS 는 WBS 의 회사제시계정 → 과목, PL 은 WPL 과목). 같은 이름이 여럿이면 더한다(명진 PL 도 SUMIF 로 이렇게 했다).
// 옛 링크 수식 칸에는 값을 적는다(노랗게). 합계·증감·Unusual 수식은 그대로 둔다.
import type { SheetData, CellValue } from './xlsxRead';
import type { CellEdit } from './xlsxCells';
import { normLabel, textOf, colOf, rowOf, findPaperSheet, type WebPaperDef } from './gwpWeb';
import { findPeriodColumns } from './gwpCarry';

export interface ArpRow {
  sheet: 'BS' | 'PL';
  key: string;
  group: string;
  label: string;
  cur: number | null;
  prev: number | null;
  /** 전기 칸도 정산표 링크였다(PL 의 SUMIF) — 정산표에서 다시 읽는다 */ prevFromWtb: boolean;
  /** 작년 당기 링크가 가리키던 정산표 줄(이름으로 못 찾을 때 보조) */ linkRows?: number[];
  explanation: string;
  /** 작년 Explanation — 참고로만 보인다 */ lastYear: string;
  src?: 'WTB' | '손' | '';
}
export interface Paper8110 { rows: ArpRow[] }

const isLink = (v: CellValue | undefined) => v?.formula != null && /\[/.test(v.formula);
/** 「[98]WBS!X6+[98]WBS!X7」 → [6, 7]. 정산표 WBS·WPL 을 가리키는 칸의 줄만(범위 SUMIF 는 뺀다). */
function linkRowsOf(f: string | undefined): number[] | undefined {
  if (!f || !/\[/.test(f)) return undefined;
  const rows = [...f.matchAll(/W(?:BS|PL)'?!\$?[A-Z]+\$?(\d+)(?!:)/g)].map((m) => Number(m[1]));
  return rows.length ? rows : undefined;
}
const nm = (s: string) => normLabel(s).replace(/[()（）]/g, '');
const findArp = (sheets: SheetData[], which: 'BS' | 'PL') => sheets.find((s) => normLabel(s.name).toUpperCase() === `8110ARP_${which}`) ?? null;

type Hit = { row: number; col: string; text: string };
function textsIn(sheet: SheetData, row: number): Hit[] {
  const out: Hit[] = [];
  for (const [ref, v] of sheet.cells) if (rowOf(ref) === row && v.formula == null && v.text) out.push({ row, col: colOf(ref), text: v.text });
  return out;
}

function arpLayout(sheet: SheetData) {
  const pc = findPeriodColumns(sheet);
  if (!pc) return null;
  const head = textsIn(sheet, pc.headerRow);
  const col = (l: string) => head.find((h) => nm(h.text) === nm(l))?.col ?? null;
  const labelCol = col('소계정');
  if (!labelCol) return null;
  const groupCol = col('대계정');
  const explCol = col('Explanation');
  const rows: { row: number; group: string; label: string }[] = [];
  let group = '';
  const byRow = new Map<number, string>();
  for (const [ref, v] of sheet.cells) if (colOf(ref) === labelCol && rowOf(ref) > pc.headerRow && v.formula == null && textOf(v)) byRow.set(rowOf(ref), textOf(v));
  for (const r of [...byRow.keys()].sort((a, b) => a - b)) {
    const label = byRow.get(r)!;
    if (nm(label) === '소계정') continue;                       // 둘째 머리 줄
    const g = groupCol ? textOf(sheet.cells.get(`${groupCol}${r}`)) : '';
    if (g && nm(g) !== '대계정') group = g;
    const cur = sheet.cells.get(`${pc.curCol}${r}`);
    if (cur?.formula != null && !isLink(cur)) continue;          // 비율 등 시트 안 수식 줄
    rows.push({ row: r, group, label });
  }
  // 중요성 칸 — 머리 위의 OM·PM·DM 라벨 오른쪽.
  const mat: Record<'OM' | 'PM' | 'DM', string | null> = { OM: null, PM: null, DM: null };
  for (const [ref, v] of sheet.cells) {
    const r = rowOf(ref);
    const t = normLabel(textOf(v)).toUpperCase();
    if (r < pc.headerRow && v.formula == null && (t === 'OM' || t === 'PM' || t === 'DM')) {
      const c = colOf(ref);
      mat[t] = `${String.fromCharCode(c.charCodeAt(c.length - 1) + 1)}${r}`;
    }
  }
  return { pc, rows, explCol, mat };
}

type Layout = NonNullable<ReturnType<typeof arpLayout>>;
/** 한 부분 — 8110ARP 는 시트 둘(BS·PL), 8110A(일반·K-IFRS 2026 양식·알티스트)는 한 시트의 두 구간. */
type Part = { which: 'BS' | 'PL'; sheet: SheetData; L: Layout };
const find8110A = (sheets: SheetData[]) => sheets.filter((s) => normLabel(s.name).toUpperCase() === '8110A').sort((a, b) => Number(!!a.hidden) - Number(!!b.hidden))[0] ?? null;

/**
 * 8110A 전반적인 결론을 위한 분석적절차 — 머리 「전기 · 당기」(D·E), 「설명 …」(L). 계정 이름은 A·B·C 열에 층으로
 * (유동자산 A → 당좌자산 B → 현금 C), 합계 줄은 당기 칸이 시트 안 수식이다. 「재무상태표」·「손익계산서」 줄로 나눈다.
 * 중요성은 머리 위 「재무제표 전체에 대한 중요성 :」·「수행 중요성 :」 오른쪽 칸.
 */
function a8110Parts(sheet: SheetData): Part[] {
  const pc = findPeriodColumns(sheet);
  if (!pc) return [];
  let explCol: string | null = null, varCol: string | null = null;
  const labels = new Map<number, { col: string; text: string }>();
  let plRow = Infinity, bsRow = pc.headerRow;
  for (const [ref, v] of sheet.cells) {
    const r = rowOf(ref), c = colOf(ref), t = v.formula == null ? textOf(v) : '';
    if (!t) continue;
    if (r <= pc.headerRow + 3 && !explCol && nm(t).startsWith('설명')) explCol = c;
    if (r <= pc.headerRow + 3 && !varCol && /^variance$/i.test(nm(t))) varCol = c;
    if (r <= pc.headerRow || !['A', 'B', 'C'].includes(c)) continue;
    const cur = labels.get(r);
    if (!cur || c < cur.col) labels.set(r, { col: c, text: t });
    if (c === 'A' && nm(t) === '재무상태표') bsRow = r;
    if (c === 'A' && /손익계산서|포괄손익계산서/.test(nm(t)) && !/누계/.test(t)) plRow = Math.min(plRow, r);
  }
  const num = (ref: string) => { const v = sheet.cells.get(ref); return v?.num != null && (v.formula == null || isLink(v)); };
  const rows: Record<'BS' | 'PL', { row: number; group: string; label: string }[]> = { BS: [], PL: [] };
  const parent: Record<string, string> = {};
  for (const r of [...labels.keys()].sort((a, b) => a - b)) {
    const { col, text } = labels.get(r)!;
    if (r === bsRow || r === plRow) continue;
    parent[col] = text;
    const cur = sheet.cells.get(`${pc.curCol}${r}`);
    if (cur?.formula != null && !isLink(cur)) continue;                       // 합계·비율 줄
    const vv = varCol ? sheet.cells.get(`${varCol}${r}`) : undefined;
    if (!num(`${pc.prevCol}${r}`) && !num(`${pc.curCol}${r}`) && vv?.num == null) continue;   // 머리·결론 줄(두 해 0 인 계정은 증감 칸으로)
    const group = col === 'C' ? parent.B ?? '' : col === 'B' ? parent.A ?? '' : '';
    rows[r > plRow ? 'PL' : 'BS'].push({ row: r, group, label: text });
  }
  const mat: Record<'OM' | 'PM' | 'DM', string | null> = { OM: null, PM: null, DM: null };
  for (const [ref, v] of sheet.cells) {
    const r = rowOf(ref);
    if (r >= pc.headerRow || v.formula != null) continue;
    const t = nm(textOf(v));
    const k = t.includes('전체에대한중요성') ? 'OM' : t.startsWith('수행중요성') ? 'PM' : null;
    if (!k) continue;
    const right = [...sheet.cells.entries()].filter(([x, y]) => rowOf(x) === r && colOf(x) > colOf(ref) && colOf(x).length === colOf(ref).length && (y.formula != null || y.num != null)).map(([x]) => x).sort()[0];
    mat[k] = right ?? null;
  }
  return (['BS', 'PL'] as const).map((which) => ({ which, sheet, L: { pc, rows: rows[which], explCol, mat: which === 'BS' ? mat : { OM: null, PM: null, DM: null } } }));
}

/** 이 워크북의 종결단계 분석적검토 — 8110ARP_BS·PL, 없으면 8110A. */
function partsOf(sheets: SheetData[]): Part[] {
  const arp = (['BS', 'PL'] as const).flatMap((which) => {
    const s = findArp(sheets, which);
    const L = s ? arpLayout(s) : null;
    return s && L ? [{ which, sheet: s, L }] : [];
  });
  if (arp.length) return arp;
  const a = find8110A(sheets);
  return a ? a8110Parts(a) : [];
}

function keyed(which: 'BS' | 'PL', rows: { label: string; group: string }[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const b = `${which}|${nm(r.group)}|${nm(r.label)}`;
    const n = seen.get(b) ?? 0;
    seen.set(b, n + 1);
    return `${b}#${n}`;
  });
}

/** 수식에 쓸 시트 이름. */
const qs = (name: string) => (/^[A-Za-z가-힣_][A-Za-z0-9가-힣_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);

export const PAPER_8110: WebPaperDef<Paper8110> = {
  code: '8110ARP', title: '종결단계 분석적검토', stage: 3, sheetCode: '8110ARP_BS',
  note: '자료함의 확정 정산표로 당기(·손익 전기) 숫자를 채우고, 증감이 수행중요성을 넘는 줄만 설명을 적는다. 기준은 2700A-4. 시트는 8110ARP_BS·PL, 없으면 8110A(일반·K-IFRS 2026 양식).',
  pick: (sheets) => findArp(sheets, 'BS') ?? findArp(sheets, 'PL') ?? find8110A(sheets),
  empty: () => ({ rows: [] }),
  read: (sheet) => PAPER_8110.readBook!([sheet]),
  readBook(sheets) {
    const rows: ArpRow[] = [];
    for (const { which, sheet: s, L } of partsOf(sheets)) {
      const keys = keyed(which, L.rows);
      L.rows.forEach((r, i) => {
        const cur = s.cells.get(`${L.pc.curCol}${r.row}`);
        const prev = s.cells.get(`${L.pc.prevCol}${r.row}`);
        rows.push({
          sheet: which, key: keys[i], group: r.group, label: r.label,
          cur: cur?.num ?? null, prev: prev?.num ?? null, prevFromWtb: isLink(prev), linkRows: linkRowsOf(cur?.formula),
          explanation: '', lastYear: L.explCol ? textOf(s.cells.get(`${L.explCol}${r.row}`)) : '', src: '',
        });
      });
    }
    return { rows };
  },
  write: () => { throw new Error('8110ARP 는 두 시트에 함께 씁니다(writeBook).'); },
  writeBook(sheets, d) {
    const out: { sheet: string; edits: CellEdit[] }[] = [];
    const m4 = findPaperSheet(sheets, '2700A-4');
    const parts = partsOf(sheets);
    for (const { which, sheet: s, L } of parts) {
      const at = new Map(keyed(which, L.rows).map((k, i) => [k, L.rows[i].row]));
      const e: CellEdit[] = [];
      for (const r of d.rows.filter((x) => x.sheet === which)) {
        const row = at.get(r.key);
        if (!row) continue;
        e.push(r.cur == null ? { ref: `${L.pc.curCol}${row}`, clear: true } : { ref: `${L.pc.curCol}${row}`, num: r.cur });
        if (r.prevFromWtb && r.prev != null) e.push({ ref: `${L.pc.prevCol}${row}`, num: r.prev });
        if (L.explCol) { const ref = `${L.explCol}${row}`; e.push(r.explanation.trim() ? { ref, text: r.explanation.trim() } : { ref, clear: true }); }
      }
      // 중요성 — BS 는 2700A-4(백만원 → 원), PL 은 BS 를 따른다.
      if (which === 'BS' && m4) {
        const q = qs(m4.name);
        if (L.mat.OM) e.push({ ref: L.mat.OM, formula: `${q}!K29*1000000` });
        if (L.mat.PM) e.push({ ref: L.mat.PM, formula: `${q}!K54*1000000` });
        if (L.mat.DM) e.push({ ref: L.mat.DM, formula: `${q}!K68*1000000` });
      }
      if (which === 'PL') {
        const bs = parts.find((x) => x.which === 'BS');
        if (bs && bs.sheet !== s) for (const k of ['OM', 'PM', 'DM'] as const) {
          if (L.mat[k] && bs.L.mat[k]) e.push({ ref: L.mat[k]!, formula: `${qs(bs.sheet.name)}!${bs.L.mat[k]}` });
        }
      }
      const same = out.find((x) => x.sheet === s.name);         // 8110A — 두 구간이 한 시트
      if (same) same.edits.push(...e); else out.push({ sheet: s.name, edits: e });
    }
    return out;
  },
};

// ── 확정 정산표(WTB) 에서 채우기 ────────────────────────────
function serialOf(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000) : null;
}
/** 머리(1~6행)에 이 날짜가 적힌 가장 오른쪽 열 — 감사후 금액. */
export function dateColumn(sheet: SheetData, serial: number): string | null {
  let best: string | null = null;
  const n = (c: string) => { let x = 0; for (const ch of c) x = x * 26 + ch.charCodeAt(0) - 64; return x; };
  for (const [ref, v] of sheet.cells) {
    if (rowOf(ref) > 6 || v.num == null || Math.round(v.num) !== serial) continue;
    const c = colOf(ref);
    if (!best || n(c) > n(best)) best = c;
  }
  return best;
}

export interface WtbReport { filled: number; missing: string[]; curCol: { BS: string | null; PL: string | null }; prevCol: { BS: string | null; PL: string | null } }

/**
 * 확정 정산표의 WBS·WPL → 8110ARP 당기(와 링크였던 전기). closing 은 당기 결산일 「2026-12-31」.
 * 손으로 고친 줄(src '손')은 둔다.
 */
export function fillFromWtb(d: Paper8110, wtb: SheetData[], closing: string): { data: Paper8110; report: WtbReport } {
  const cs = serialOf(closing);
  const ps = cs != null ? serialOf(`${Number(closing.slice(0, 4)) - 1}${closing.slice(4)}`) : null;
  const pick = (re: RegExp) => wtb.find((s) => re.test(normLabel(s.name).toUpperCase())) ?? null;
  const src = { BS: pick(/^WBS$/), PL: pick(/^WPL$/) };
  const rep: WtbReport = { filled: 0, missing: [], curCol: { BS: null, PL: null }, prevCol: { BS: null, PL: null } };
  const idx = { BS: new Map<string, number[]>(), PL: new Map<string, number[]>() };
  for (const which of ['BS', 'PL'] as const) {
    const s = src[which];
    if (!s || cs == null) continue;
    rep.curCol[which] = dateColumn(s, cs);
    rep.prevCol[which] = ps != null ? dateColumn(s, ps) : null;
    // 이름 → 줄들. BS 는 회사제시계정(C)·과목(B) 둘 다 잇고, PL 은 과목(B).
    for (const [ref, v] of s.cells) {
      const c = colOf(ref);
      if (rowOf(ref) < 3 || v.formula != null || !v.text || (c !== 'B' && c !== 'C')) continue;
      const k = `${c}|${nm(v.text)}`;
      (idx[which].get(k) ?? idx[which].set(k, []).get(k)!).push(rowOf(ref));
    }
  }
  const sum = (which: 'BS' | 'PL', label: string, col: string | null): number | null => {
    const s = src[which];
    if (!s || !col) return null;
    const rows = idx[which].get(`C|${nm(label)}`) ?? idx[which].get(`B|${nm(label)}`);
    if (!rows?.length) return null;
    return rows.reduce((t, r) => t + (s.cells.get(`${col}${r}`)?.num ?? 0), 0);
  };
  const atRows = (which: 'BS' | 'PL', rs: number[] | undefined, col: string | null) => {
    const s = src[which];
    if (!s || !col || !rs?.length) return null;
    return rs.reduce((t, r) => t + (s.cells.get(`${col}${r}`)?.num ?? 0), 0);
  };
  const rows = d.rows.map((r): ArpRow => {
    if (r.src === '손') return r;
    // 이름으로, 못 찾으면 작년 링크가 가리키던 줄로(정산표 줄은 잘 안 움직인다).
    const cur = sum(r.sheet, r.label, rep.curCol[r.sheet]) ?? atRows(r.sheet, r.linkRows, rep.curCol[r.sheet]);
    if (cur == null) { if (r.prev) rep.missing.push(`${r.sheet} ${r.label}`); return r; }
    rep.filled += 1;
    const prev = r.prevFromWtb ? sum(r.sheet, r.label, rep.prevCol[r.sheet]) ?? r.prev : r.prev;
    return { ...r, cur, prev, src: 'WTB' };
  });
  return { data: { rows }, report: rep };
}
