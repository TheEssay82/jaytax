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
import { insertRowsAfter, moveFormula } from './xlsxRows';

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
  /** 재무상태표의 어느 부분인가 — 자산 = 부채 + 자본 검증(사용자 2026-09-27) */ sec?: Sec;
  /** 「이 줄에 더하기」로 받은 DSD 계정 — 다시 채울 때 그 계정을 이미 받은 것으로 친다 */ absorbs?: string[];
  /** 분류(「Ⅰ. 유 동 자 산」·「(1) 유 형 자 산」·「Ⅳ. 판매비와관리비」) — 새 줄을 어디에 끼울지 */ group?: string;
  /** 웹에서 새로 넣은 계정 줄 — 반영할 때 그 분류의 끝에 줄을 끼운다(평안정공 2026-09-28) */ added?: boolean;
  /** K열 주요 감사절차(ToD) — Material·Unexpected 가 뜬 줄은 적어야 한다(사용자 2026-09-30) */ proc?: string;
  /** 표준 절차 표에서 넣은 추천 문구 — 확인 전 노랑 */ procStd?: boolean;
  /** 이 줄이 받은 DSD 줄(「BS#12」) — 빌린 틀에 새 줄을 DSD 순서대로 끼울 때 쓴다 */ fs?: string;
  /** 새 줄을 이 줄 바로 아래에 끼운다(없으면 분류 끝) — DSD 에서 바로 위 계정이 받은 줄(아비즈 단기금융상품 → 현금 아래) */ after?: string;
}
export type Sec = '자산' | '부채' | '자본' | '손익';
export interface Paper2120A {
  rows: Row2120[]; prevLabel: string; curLabel: string;
  /**
   * 다른 회사 2120A 틀을 빌려 썼다(사용자 2026-09-30 에이치앤아비즈 — 작년 2120A 가 빈 양식이면 「기본 계정과목이 비슷한 타사 내용」).
   * 반영할 때 그 판의 시트를 복사해 넣고, 전기·당기 두 열을 이 조서 값으로 쓴다(빌린 회사 금액·비고는 남기지 않는다).
   */
  borrow?: Borrow2120;
  /** 시트에 주요 감사절차 열(「주요 ToD 절차」)이 있다 */ hasProc?: boolean;
  /** 분류 줄(「(1) 유 형 자 산」)에 적힌 절차 — 그 아래 계정 줄 전체에 적용된 것으로 본다(평안정공·알티스트 관행) */ groupProc?: Record<string, string>;
  /** 판정 기준 중요성(원) — 2700A-2 계획단계 중요성. 반영 때 시트의 Overall Materiality 칸에 쓴다(사용자 2026-09-30) */ om?: number | null;
  /** 수행중요성(원) — Planning Materiality 칸 */ pm?: number | null;
  /** [표준 절차 넣기]로 채운 분류 줄 절차(재고·유형·무형자산 묶음) — 확인 전 노랑 */ groupStd?: string[];
}
export interface Borrow2120 { engagementId: string; entity: string; version: number; sheet: string }

/** 계정 줄에 금액이 거의 없다 — 작년 2120A 를 안 쓴 회사(빈 양식). */
export const isBlank2120 = (d: Paper2120A | null | undefined) =>
  !d?.borrow && (d?.rows ?? []).filter((r) => r.prev != null || r.cur != null).length < 3;

/**
 * 빌린 회사 2120A 시트 → 이 회사 조서의 시작 값: 줄·분류만. 금액·비고·공시 계정·주요 감사절차는 비운다 —
 * 모두 그 회사 것이다(사용자 2026-09-30 아비즈: 평안정공의 「매출채권 및 기타채권」 공시 계정과 「미정산 운송건」 절차가 남았다).
 * 공시 계정은 전기 DSD 로 채울 때 이 회사 재무제표 과목으로, 절차는 [표준 절차 넣기]로.
 */
export function fromBorrowed(sheet: SheetData, b: Borrow2120): Paper2120A {
  const d = PAPER_2120A.read(sheet);
  return {
    ...d, borrow: b, groupProc: d.hasProc ? {} : d.groupProc,
    rows: d.rows.map((r) => ({
      ...r, prev: null, cur: null, note: '', src: '' as const, prevDiff: null, absorbs: undefined, added: false, fsli: '',
      // 계정이 아닌 절차 줄(「부외부채 테스트」 — 우발채무·후속사건)은 어느 회사나 같다 — 문구를 남긴다.
      ...(d.hasProc && !procRow(r.label) ? { proc: '', procStd: false } : {}),
    })),
  };
}

/** 계정이 아니라 절차를 적는 줄(평안정공 「부외부채 테스트」). */
const procRow = (label: string) => /테스트|test/i.test(label);

/** 빌린 틀에만 있고 이 회사엔 없는 계정 줄(두 해 모두 빈칸) — 화면·시트에서 숨긴다(평안정공의 토지·건물·금형을 아비즈에 남기지 않는다). */
export const unusedBorrowed = (d: Paper2120A, r: Row2120) => !!d.borrow && !r.added && r.prev == null && r.cur == null && !procRow(r.label);

/** DSD 과목 → 공시 계정 칸 글자(번호·띄어쓰기 뗌): 「Ⅰ. 현금및현금성자산」 → 「현금및현금성자산」. */
const caption = (s: string) => normLabel(s).replace(/^([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+|[IVX]+|\d+)\./, '').replace(/^\(\d+\)/, '');
const fsId = (x: FsLine, bs: FsLine[], pl: FsLine[]) => (bs.includes(x) ? `BS#${bs.indexOf(x)}` : `PL#${pl.indexOf(x)}`);

type Hit = { row: number; col: string; text: string };
function textsOf(sheet: SheetData): Hit[] {
  const out: Hit[] = [];
  for (const [ref, v] of sheet.cells) { const t = textOf(v); if (t && v.formula == null && v.text != null) out.push({ row: rowOf(ref), col: colOf(ref), text: t }); }
  return out;
}
function colNum(c: string): number { let n = 0; for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
function colName(n: number): string { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }

type LRow = { row: number; label: string; fsli: string; pl: boolean; sec: Sec; group: string; col: string };
type Layout = {
  pc: NonNullable<ReturnType<typeof findPeriodColumns>>; rows: LRow[]; noteCol: string | null; fsliCol: string | null;
  /** 공시 계정 열이 줄 키에 들어간다(「IFRS 공시」 머리) — 그 열은 기존 줄에 다시 쓰지 않는다(키가 바뀐다) */ fsliKeyed?: boolean;
  /** 주요 감사절차 열 · 분류 줄(이름 → 행) · 중요성 칸 */ procCol?: string | null; heads?: { name: string; row: number }[]; omRef?: string | null; pmRef?: string | null;
};
function layout(sheet: SheetData): Layout | null {
  const pc = findPeriodColumns(sheet);
  if (!pc) return null;
  const hits = textsOf(sheet);
  const head = hits.filter((h) => h.row === pc.headerRow);
  const fsliHead = head.find((h) => normLabel(h.text).includes('IFRS공시'));
  const acctHead = head.find((h) => normLabel(h.text).startsWith('계정과목') && h !== fsliHead);
  const noteHead = head.find((h) => normLabel(h.text) === '비고');
  const procHead = head.find((h) => /tod|감사절차/i.test(normLabel(h.text)));
  if (!acctHead) return layered(sheet, pc, hits);
  const labelCol = acctHead ? colName(colNum(acctHead.col) + 1) : 'C';
  const plStart = hits.find((h) => h.row > pc.headerRow && /^(Ⅰ|I)\.?매출액$/.test(normLabel(h.text)))?.row ?? Infinity;
  // 구분 줄 「자 산」「부 채」「자 본」(명진 B16·B64·B87) — 그 아래 줄이 그 부분이다.
  const secRows = hits.filter((h) => h.row > pc.headerRow && h.row < plStart && /^(자산|부채|자본)$/.test(normLabel(h.text)))
    .map((h) => ({ row: h.row, sec: normLabel(h.text) as Sec })).sort((a, b) => a.row - b.row);
  const secOf = (row: number): Sec => (row > plStart ? '손익' : [...secRows].reverse().find((x) => x.row < row)?.sec ?? '자산');
  // 분류 줄 — 계정과목 머리 열(B)에 글자가 있고 계정 열(C)은 빈 줄(「Ⅰ. 유 동 자 산」「(1) 유 형 자 산」). 번호(「1.」)는 아니다.
  const labelRows = new Set(hits.filter((x) => x.col === labelCol).map((x) => x.row));
  const heads = hits.filter((x) => x.col === acctHead.col && x.row > pc.headerRow && !labelRows.has(x.row) && !/^\d+\.?$/.test(x.text.trim()))
    .sort((a, b) => a.row - b.row);
  const groupOf = (row: number) => [...heads].reverse().find((x) => x.row < row)?.text.trim() ?? '';
  const rows: LRow[] = [];
  for (const h of hits.filter((x) => x.col === labelCol && x.row > pc.headerRow + 1).sort((a, b) => a.row - b.row)) {
    const cur = sheet.cells.get(`${pc.curCol}${h.row}`);
    const prev = sheet.cells.get(`${pc.prevCol}${h.row}`);
    if (cur?.formula != null || prev?.formula != null) continue;   // 합계·비율 줄
    rows.push({ row: h.row, label: h.text, fsli: fsliHead ? textOf(sheet.cells.get(`${fsliHead.col}${h.row}`)) : '', pl: h.row > plStart, sec: secOf(h.row), group: groupOf(h.row), col: labelCol });
  }
  // 공시 계정 열 — 짝 키에는 「IFRS 공시」 머리만 쓴다(키가 바뀌면 저장한 입력과 어긋난다). 새 줄 쓰기에는 「계정과목 (공시용)」(평안정공)도.
  const fsliAny = fsliHead ?? head.find((h) => h !== acctHead && normLabel(h.text).includes('공시'));
  // 중요성 칸 — 「Overall Materiality」·「Planning Materiality」 줄의 첫 숫자·수식 칸(평안정공 D7·D8).
  const refRight = (re: RegExp) => {
    const h = hits.find((x) => x.row < pc.headerRow && re.test(normLabel(x.text)));
    if (!h) return null;
    for (let c = colNum(h.col) + 1; c <= colNum(h.col) + 4; c++) { const ref = `${colName(c)}${h.row}`; const v = sheet.cells.get(ref); if (v && (v.formula != null || v.num != null)) return ref; }
    return null;
  };
  return {
    pc, rows, noteCol: noteHead?.col ?? null, fsliCol: fsliAny?.col ?? null, fsliKeyed: !!fsliHead, procCol: procHead?.col ?? null,
    heads: heads.map((x) => ({ name: x.text.trim(), row: x.row })),
    omRef: refRight(/^overallmateriality$/i), pmRef: refRight(/^planningmateriality$/i),
  };
}

/**
 * 2026 양식 그대로의 2120A(윤성이 숨겨 둔 예시·새로 쓰기 시작하는 회사) — 「계정과목」 머리가 없고 계정이 A·B·C 열에
 * 층으로 있다(유동자산 A → 당좌자산 B → 현금 C). 합계 줄은 전기·당기 칸이 수식이다. 8110A 와 같은 모양.
 * 재무상태표의 부분은 「자산총계」·「부채총계」 줄로 나누고, 「손익계산서」 줄 아래는 손익이다. 비고 = 「설명 …」 머리.
 */
function layered(sheet: SheetData, pc: NonNullable<ReturnType<typeof findPeriodColumns>>, hits: Hit[]): Layout {
  const near = hits.filter((h) => h.row >= pc.headerRow && h.row <= pc.headerRow + 3);
  const noteCol = near.find((h) => /^(설명|비고)/.test(normLabel(h.text)))?.col ?? null;
  const varCol = near.find((h) => /^variance$/i.test(normLabel(h.text)))?.col ?? null;
  const label = new Map<number, Hit>();
  for (const h of hits) {
    if (h.row <= pc.headerRow || !['A', 'B', 'C'].includes(h.col)) continue;
    const cur = label.get(h.row);
    if (!cur || h.col < cur.col) label.set(h.row, h);
  }
  const aRow = (re: RegExp) => [...label.values()].find((h) => h.col === 'A' && re.test(normLabel(h.text)))?.row ?? Infinity;
  const plStart = aRow(/^손익계산서$|^포괄손익계산서$/);
  const assetEnd = aRow(/^자산총계$/), liabEnd = aRow(/^부채총계$/);
  const isNum = (ref: string) => sheet.cells.get(ref)?.num != null;
  const rows: LRow[] = [];
  const parent: Record<string, string> = {};
  for (const r of [...label.keys()].sort((a, b) => a - b)) {
    const t = normLabel(label.get(r)!.text);
    const col = label.get(r)!.col;
    parent[col] = label.get(r)!.text.trim();
    if (col === 'A') delete parent.B;
    if (r === plStart || t === '재무상태표') continue;
    const cur = sheet.cells.get(`${pc.curCol}${r}`), prev = sheet.cells.get(`${pc.prevCol}${r}`);
    if (cur?.formula != null || prev?.formula != null) continue;                       // 합계·비율 줄
    if (!isNum(`${pc.prevCol}${r}`) && !isNum(`${pc.curCol}${r}`) && !(varCol && isNum(`${varCol}${r}`))) continue;
    const pl = r > plStart;
    const group = col === 'C' ? parent.B ?? '' : col === 'B' ? parent.A ?? '' : pl ? '손익계산서' : '재무상태표';
    rows.push({ row: r, label: label.get(r)!.text, fsli: '', pl, sec: pl ? '손익' : r < assetEnd ? '자산' : r < liabEnd ? '부채' : '자본', group, col });
  }
  return { pc, rows, noteCol, fsliCol: null };
}

/**
 * 아직 시트에 없는 새 계정 줄 — 끼울 자리(그 줄 바로 아래)별로. 자리는 `after` 가 가리키는 줄(새 줄끼리 이어지면 첫 기존 줄),
 * 없거나 다른 분류면 그 분류의 끝줄. 분류를 못 찾으면 알린다.
 */
function pendingAdds(L: Layout, d: Paper2120A): Map<number, { last: number; rows: Row2120[] }> {
  const out = new Map<number, { last: number; rows: Row2120[] }>();
  const find = locator(L, d.rows, !!d.borrow);
  const byKey = new Map(d.rows.map((r) => [r.key, r]));
  for (const x of d.rows.filter((r) => r.added && r.label.trim())) {
    const g = x.group ?? '';
    const inGroup = L.rows.filter((r) => normLabel(r.group) === normLabel(g) && r.pl === x.pl);
    if (!inGroup.length) throw new Error(`2120A 에서 분류 「${g}」를 찾지 못했습니다 — 새 계정 「${x.label}」을 넣을 곳이 없습니다.`);
    if (inGroup.some((r) => normLabel(r.label) === normLabel(x.label))) continue;   // 이미 넣었다(다시 반영)
    let a = x.after; const seen = new Set<string>();
    while (a && byKey.get(a)?.added && !seen.has(a)) { seen.add(a); a = byKey.get(a)!.after; }
    const anchor = a ? find(a) : undefined;
    const last = anchor && inGroup.some((r) => r.row === anchor.row) ? anchor.row : Math.max(...inGroup.map((r) => r.row));
    const cur = out.get(last) ?? { last, rows: [] };
    cur.rows.push(x);
    out.set(last, cur);
  }
  return out;
}

/** 시트 XML 의 줄 숨김 — 빌린 틀에만 있는 계정 줄. 값이 생긴 줄은 다시 보이게. */
function setRowsHidden(xml: string, hide: Set<number>, show: Set<number>): string {
  return xml.replace(/<row\b[^>]*?\br="(\d+)"[^>]*?>/g, (m: string, n: string) => {
    const r = Number(n);
    if (hide.has(r) && !/\bhidden="(1|true)"/.test(m)) return m.replace(/^<row\b/, '<row hidden="1"');
    if (show.has(r)) return m.replace(/\s+hidden="(1|true)"/, '');
    return m;
  });
}

/** 계정 줄마다 수식이 있는 열(증감·비율·Material 판정) — 열마다 수식이 적힌 가장 가까운 계정 줄. 공유 수식은 첫 줄에만 글자가 있다. */
function formulaCols(sheet: SheetData, L: Layout, keep: Set<string>, tpl: LRow): Map<string, { row: number; formula: string }> {
  const out = new Map<string, { row: number; formula: string }>();
  // 같은 구간(재무상태·손익)의 계정 줄에서, 윗줄(tpl)에도 칸이 있는 열만 — 손익에만 있는 열(평안 P118)이 자산 줄로 오지 않게.
  const dataRows = new Set(L.rows.filter((r) => r.pl === tpl.pl).map((r) => r.row));
  for (const [ref, v] of sheet.cells) {
    const r = rowOf(ref), c = colOf(ref);
    if (!dataRows.has(r) || v.formula == null || keep.has(c) || c === 'A' || c === 'B' || !sheet.cells.has(`${c}${tpl.row}`)) continue;
    if (!new RegExp(`[A-Z]\\$?${r}(?!\\d)`).test(v.formula)) continue;   // 제 줄을 쓰는 수식만(F18-E18)
    const had = out.get(c);
    if (!had || Math.abs(r - tpl.row) < Math.abs(had.row - tpl.row)) out.set(c, { row: r, formula: v.formula });
  }
  return out;
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

/**
 * 데이터 줄 → 시트 줄. 키(이름|공시#n)로 찾고, 못 찾으면 이름#n 으로 — 빌린 틀은 공시 칸을 이 회사 과목으로 바꿔 쓰므로
 * 「IFRS 공시」 머리 양식(명진)은 재확정 때 키의 공시 부분이 달라진다(주원이노베이션 2026-10-01).
 */
function locator(L: Layout, rows: Row2120[], byLabelOnly = false): (key: string) => LRow | undefined {
  const labs = (xs: { label: string }[]) => { const seen = new Map<string, number>(); return xs.map((x) => { const b = normLabel(x.label); const n = seen.get(b) ?? 0; seen.set(b, n + 1); return `${b}#${n}`; }); };
  const byKey = new Map(keyed(L.rows).map((r, i) => [r.key, L.rows[i]]));
  // 웹에서 새로 넣은 줄(이미 시트에 들어간 것)은 빼고 센다 — 데이터 쪽도 새 줄은 빼고 센다.
  const addedAt = new Set(rows.filter((r) => r.added).map((r) => `${normLabel(r.label)}|${normLabel(r.group ?? '')}`));
  const sheetRows = L.rows.filter((r) => !addedAt.has(`${normLabel(r.label)}|${normLabel(r.group)}`));
  const sl = labs(sheetRows);
  const byLab = new Map(sheetRows.map((r, i) => [sl[i], r]));
  const base = rows.filter((r) => !r.added);
  const dl = labs(base);
  const lab = new Map(base.map((r, i) => [r.key, dl[i]]));
  const viaLabel = (key: string) => (lab.has(key) ? byLab.get(lab.get(key)!) : undefined);
  // 빌린 틀은 공시 칸을 이 회사 과목으로 바꿔 쓰므로 키가 다른 줄과 우연히 겹칠 수 있다 — 이름·순번으로만(주원 v5 퇴직연금운용자산이 지워진 것).
  return byLabelOnly ? viaLabel : (key) => byKey.get(key) ?? viaLabel(key);
}

const numOf = (sheet: SheetData, ref: string) => { const v = sheet.cells.get(ref); return v?.num != null ? v.num : null; };

export const PAPER_2120A: WebPaperDef<Paper2120A> = {
  code: '2120A', title: '위험평가 분석적절차', stage: 1, sheetCode: '2120A',
  note: '자료함의 전기 DSD 로 당기 열을 채운다(문구·차감 계정·전기 금액으로 짝짓기). 증감 큰 줄에 비고.',
  empty: () => ({ rows: [], prevLabel: '', curLabel: '' }),
  borrowOf: (d) => d?.borrow ?? null,
  read(sheet) {
    const L = layout(sheet);
    if (!L) return { rows: [], prevLabel: '', curLabel: '' };
    return {
      prevLabel: L.pc.prevLabel, curLabel: L.pc.curLabel,
      rows: keyed(L.rows).map((r) => ({
        key: r.key, label: r.label, fsli: r.fsli, pl: r.pl, sec: r.sec, group: r.group,
        prev: numOf(sheet, `${L.pc.prevCol}${r.row}`), cur: numOf(sheet, `${L.pc.curCol}${r.row}`),
        note: L.noteCol ? textOf(sheet.cells.get(`${L.noteCol}${r.row}`)) : '',
        ...(L.procCol ? { proc: textOf(sheet.cells.get(`${L.procCol}${r.row}`)) } : {}),
      })),
      ...(L.procCol ? {
        hasProc: true,
        groupProc: Object.fromEntries((L.heads ?? []).map((h) => [h.name, textOf(sheet.cells.get(`${L.procCol}${h.row}`))]).filter(([, t]) => t)),
      } : {}),
    };
  },
  // 새 계정 줄 — 분류 끝줄 아래에 끼우고 그 분류의 합계 범위를 늘린다(아래 분류부터 — 위 줄 번호가 밀리지 않게).
  prepareXml(xml, sheet, d) {
    const L = layout(sheet);
    if (!L) return xml;
    if (d.borrow) {
      const hide = new Set<number>(), show = new Set<number>();
      const find = locator(L, d.rows, !!d.borrow);
      for (const x of d.rows) { const r = x.added ? undefined : find(x.key); if (r) (unusedBorrowed(d, x) ? hide : show).add(r.row); }
      // 계정이 모두 숨은 분류(평안정공 「(3) 투자부동산」)는 머리 줄도.
      for (const h of L.heads ?? []) {
        const mine = L.rows.filter((r) => r.group === h.name);
        const added = d.rows.some((r) => r.added && r.group === h.name);
        if (mine.length && !added) (mine.every((r) => hide.has(r.row)) ? hide : show).add(h.row);
      }
      xml = setRowsHidden(xml, hide, show);
    }
    const plan = [...pendingAdds(L, d).values()].sort((a, b) => b.last - a.last);
    for (const p of plan) xml = insertRowsAfter(xml, p.last, p.rows.length);
    return xml;
  },
  write(sheet, d) {
    const L = layout(sheet);
    if (!L) throw new Error('2120A 에서 전기·당기 기간 열(머리 줄)을 찾지 못했습니다.');
    const find = locator(L, d.rows, !!d.borrow);
    const e: CellEdit[] = [];
    // 빌린 틀 — 계정 줄이 아닌 곳에 손으로 넣은 그 회사 숫자(평안정공 「매출총이익율」 전기 2.38%)도 지운다. 수식은 둔다.
    if (d.borrow) {
      const acct = new Set(L.rows.map((r) => r.row));
      for (const [ref, v] of sheet.cells) {
        const c = colOf(ref), r = rowOf(ref);
        if ((c === L.pc.prevCol || c === L.pc.curCol) && r > L.pc.headerRow && !acct.has(r) && v.formula == null && v.num != null) e.push({ ref, clear: true });
      }
    }
    // 분류 합계가 칸 하나(「Ⅰ. 자본금」 =E101)인데 그 분류에 계정 줄이 여럿이면(새로 넣은 우선주자본금) 분류 전체 합으로 —
    // 전에는 새 줄이 합계에서 빠져 대차가 3억 어긋났다(주원이노베이션 v3, 명진 틀 2026-10-01). 재확정 때도 바로잡힌다.
    for (const h of L.heads ?? []) {
      const mine = L.rows.filter((r) => r.group === h.name).map((r) => r.row);
      const extra = pendingAdds(L, d).get(Math.max(...mine))?.rows.length ?? 0;
      if (mine.length + extra < 2) continue;
      const lo = Math.min(...mine), hi = Math.max(...mine) + extra;
      for (const col of [L.pc.prevCol, L.pc.curCol]) {
        const f = sheet.cells.get(`${col}${h.row}`)?.formula?.replace(/^\+/, '');
        const m = f ? /^(\$?[A-Z]{1,3})\$?(\d+)$/.exec(f) : null;
        if (m && m[1].replace('$', '') === col && mine.includes(Number(m[2]))) e.push({ ref: `${col}${h.row}`, formula: `SUM(${col}${lo}:${col}${hi})` });
      }
    }
    // 분류 줄의 절차 — 웹에서 적은 것(재고·유형·무형자산 묶음 절차, 사용자 2026-10-01). 빌린 틀이면 그 회사 분류 절차는 지운다.
    if (L.procCol && d.groupProc) for (const h of L.heads ?? []) {
      const t = d.groupProc?.[h.name]?.trim(); const ref = `${L.procCol}${h.row}`;
      e.push(t ? { ref, text: t } : { ref, clear: true });
    }
    // 새 계정 줄 — 끼워 둔 빈 줄(분류 끝줄 바로 아래)에 이름·금액·비고와 이웃 줄의 수식(증감·비율·판정)을 쓴다.
    for (const p of pendingAdds(L, d).values()) {
      const tpl = L.rows.find((r) => r.row === p.last)!;
      const keep = new Set([tpl.col, L.pc.prevCol, L.pc.curCol, L.noteCol, L.fsliCol].filter(Boolean) as string[]);
      const fcols = formulaCols(sheet, L, keep, tpl);
      p.rows.forEach((x, i) => {
        const r = p.last + 1 + i;
        if (textOf(sheet.cells.get(`${tpl.col}${r}`))) throw new Error(`2120A ${r}행이 비어 있지 않습니다 — 새 줄(${x.label})을 끼우지 못했습니다.`);
        e.push({ ref: `${tpl.col}${r}`, text: x.label.trim() });
        const fsli = (x.fsli || tpl.fsli || (L.fsliCol ? textOf(sheet.cells.get(`${L.fsliCol}${p.last}`)) : '')).trim();
        if (L.fsliCol && fsli) e.push({ ref: `${L.fsliCol}${r}`, text: fsli });
        if (x.prev != null) e.push({ ref: `${L.pc.prevCol}${r}`, num: x.prev });
        if (x.cur != null) e.push({ ref: `${L.pc.curCol}${r}`, num: x.cur });
        if (L.noteCol && x.note.trim()) e.push({ ref: `${L.noteCol}${r}`, text: x.note.trim() });
        if (L.procCol && x.proc?.trim()) e.push({ ref: `${L.procCol}${r}`, text: x.proc.trim() });
        for (const [c, f] of fcols) e.push({ ref: `${c}${r}`, formula: moveFormula(f.formula, r - f.row) });
      });
    }
    for (const r of d.rows) {
      // 새 줄은 처음 반영 때 위에서 썼다(끼운 빈 줄이라 이름이 없다) — 재확정 때는 이름·분류로 찾아 금액·절차를 고친다.
      const row = r.added
        ? L.rows.filter((x) => normLabel(x.label) === normLabel(r.label) && normLabel(x.group) === normLabel(r.group ?? '')).pop()?.row
        : find(r.key)?.row;
      if (!row) continue;
      const ref = `${L.pc.curCol}${row}`;
      e.push(r.cur == null ? { ref, clear: true } : { ref, num: r.cur });
      // 빌린 틀 — 전기 열도 이 회사 값(DSD 전기)으로. 빌린 회사 금액을 남기지 않는다.
      if (d.borrow) { const pref = `${L.pc.prevCol}${row}`; e.push(r.prev == null ? { ref: pref, clear: true } : { ref: pref, num: r.prev }); }
      // 빌린 틀 — 공시 계정도 이 회사 재무제표 과목으로(빌린 회사 분류를 남기지 않는다).
      if (d.borrow && L.fsliCol) { const fref = `${L.fsliCol}${row}`; e.push(r.fsli.trim() ? { ref: fref, text: r.fsli.trim() } : { ref: fref, clear: true }); }
      if (L.noteCol) { const nref = `${L.noteCol}${row}`; e.push(r.note.trim() ? { ref: nref, text: r.note.trim() } : { ref: nref, clear: true }); }
      // 주요 감사절차(K) — 웹에서 적거나 표준으로 넣은 문구.
      if (L.procCol && r.proc !== undefined) { const kref = `${L.procCol}${row}`; e.push(r.proc.trim() ? { ref: kref, text: r.proc.trim() } : { ref: kref, clear: true }); }
    }
    // 판정 기준 = 2700A-2 계획단계 중요성(사용자 2026-09-30) — 시트 자체 계산(=F85*0.01)을 덮는다. Unexpected 기준(E7=D7*0.9)은 수식 그대로 따라온다.
    if (d.om != null && L.omRef) e.push({ ref: L.omRef, num: Math.round(d.om) });
    if (d.pm != null && L.pmRef) e.push({ ref: L.pmRef, num: Math.round(d.pm) });
    return e;
  },
};

// ── 전기 DSD 로 당기 열 채우기 ─────────────────────────────
const CONTRA = /^(대손충당금|감가상각누계액|손상차손누계액|정부보조금|현재가치할인차금)[-−–](.+)$/;
/**
 * 같은 계정의 다른 이름 — 대표 이름으로 모은다. 사용자 2026-09-27: 「당기법인세자산은 선납법인세와 동일한 계정」.
 * 개정·회사 관행으로 이름만 바뀐 것들이다(접대비 → 기업업무추진비 2024 세법 개정 등).
 */
export const SYNONYMS: string[][] = [
  ['선납법인세', '당기법인세자산', '선급법인세'],
  ['미지급법인세', '당기법인세부채'],
  ['기업업무추진비', '접대비'],
  ['퇴직급여충당부채', '퇴직급여부채'],
  ['자본금', '보통주자본금'],
  ['매출액', '영업수익'],
  ['법인세비용', '법인세등', '법인세비용(수익)'],
];
const SYN = new Map(SYNONYMS.flatMap((g) => g.map((n) => [normLabel(n), normLabel(g[0])] as const)));
export const cleanFs = (s: string) => {
  const c = normLabel(s)
    .replace(/^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX]+\./, '').replace(/^\(\d+\)/, '').replace(/^\d+\./, '')
    .replace(/\(손실\)$|\(수익\)$/, '');
  return SYN.get(c) ?? c;
};

export interface FillReport {
  byLabel: number; byContra: number; byValue: number; missing: string[]; prevDiff: string[]; scale: number;
  /** DSD 에는 금액이 있는데 2120A 에 받을 줄이 없는 계정 — 합계가 안 맞는 까닭(명진 FY25 당기법인세자산 30,345) */
  unplaced: { statement: string; label: string; cur: number }[];
}

/** 전기 DSD 재무제표(당기 = 전기 결산) → 2120A 당기 열. 손으로 고친 줄(src '손')은 건드리지 않는다. */
export function fillFromFs(d: Paper2120A, lines: FsLine[], opts: { both?: boolean; scale?: number } = {}): { data: Paper2120A; report: FillReport } {
  const bs = lines.filter((l) => /재무상태|대차대조/.test(l.statement));
  const pl = lines.filter((l) => /손익/.test(l.statement));
  // 단위 — 전기 열(원 단위 시산표)과 DSD 전기 금액의 비율(1 또는 1000).
  const ratios: number[] = [];
  for (const r of d.rows) {
    const l = (r.pl ? pl : bs).find((x) => cleanFs(x.label) === cleanFs(r.label));
    if (l?.pri && r.prev) ratios.push(r.prev / l.pri);
  }
  const med = ratios.sort((a, b) => a - b)[Math.floor(ratios.length / 2)] ?? 1;
  const scale = opts.scale ?? (Math.abs(med - 1000) < Math.abs(med - 1) ? 1000 : 1);
  const rep: FillReport = { byLabel: 0, byContra: 0, byValue: 0, missing: [], prevDiff: [], scale, unplaced: [] };
  const val = (n: number | undefined) => (n == null ? 0 : n * scale);
  // 한 DSD 줄은 한 번만 쓴다 — 판관비·영업외에 같은 이름(지급수수료)이 있다.
  const used = new Set<FsLine>();
  // 손으로 고친 줄(src '손')은 건드리지 않되, 그 줄이 받은 계정은 이미 쓴 것으로 친다 — 30,345 를 넣었는데도 또 넣으라고 뜨던 것(사용자 2026-09-27).
  for (const r of d.rows.filter((x) => x.src === '손')) {
    const pool = r.pl ? pl : bs;
    const names = new Set([cleanFs(r.label), ...(r.absorbs ?? []).map(cleanFs)]);
    for (const x of pool) if (names.has(cleanFs(x.label))) used.add(x);
  }
  const handCur = new Set(d.rows.filter((x) => x.src === '손' && x.cur != null).map((x) => x.cur));
  // DSD 줄의 부분(자산·부채·자본·손익)과 윗 과목들 — 같은 이름이 둘일 때(보증금 유동·비유동, 리스부채) 고르고, 두 해 모드에선 부분이 다르면 짝짓지 않는다.
  const bsAt = (re: RegExp) => { const i = bs.findIndex((x) => re.test(cleanFs(x.label))); return i < 0 ? Infinity : i; };
  const assetEnd = bsAt(/^자산총계$/), liabEnd = bsAt(/^부채총계$/);
  const secOf = (x: FsLine): Sec => { if (!bs.includes(x)) return '손익'; const i = bs.indexOf(x); return i < assetEnd ? '자산' : i < liabEnd ? '부채' : '자본'; };
  const parentsOf = (x: FsLine): string[] => {
    const pool = bs.includes(x) ? bs : pl; const out: string[] = [];
    for (let k = pool.indexOf(x) - 1, lv = x.level; k >= 0 && lv > 0; k--) if (pool[k].level < lv) { out.push(cleanFs(pool[k].label)); lv = pool[k].level; }
    return out;
  };
  const sameSec = (r: Row2120, x: FsLine) => !opts.both || !r.sec || secOf(x) === r.sec;
  const inGroup = (r: Row2120, x: FsLine) => { const g = cleanFs(r.group ?? ''); return !!g && parentsOf(x).some((p) => groupLike(g, p)); };
  const rows = d.rows.map((r): Row2120 => {
    if (r.src === '손') return r;
    const pool = (r.pl ? pl : bs).filter((x) => !used.has(x));
    const me = cleanFs(r.label);
    let hit: FsLine | undefined; let src: Row2120['src'] = '';
    const c = CONTRA.exec(me);
    if (c) {
      // 기준 계정(매출채권)은 이미 쓰였을 수 있다 — 전체 목록에서 찾고, **바로 밑에 붙은** 차감 줄만 고른다.
      // (아비즈: 매출채권 · 단기대여금 · 대손충당금 — 이 대손충당금은 단기대여금 것이다. 전에는 3줄 안이면 가져갔다.)
      const all = r.pl ? pl : bs;
      all.forEach((x, i) => {
        if (hit || cleanFs(x.label) !== c[2]) return;
        for (let k = i + 1; k < all.length && CONTRA_NAME.test(cleanFs(all[k].label)); k++) {
          if (!used.has(all[k]) && cleanFs(all[k].label).startsWith(c[1]) && sameSec(r, all[k])) { hit = all[k]; break; }
        }
      });
      if (hit) src = '차감';
    }
    if (!hit) {
      const cands = pool.filter((x) => cleanFs(x.label) === me && sameSec(r, x));
      hit = cands.find((x) => inGroup(r, x)) ?? cands[0];
      if (hit) src = '문구';
    }
    if (!hit && r.prev && !opts.both) {
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
    // 빌린 틀(both) — 전기 열도 DSD 전기 금액으로 채운다(작년 조서에 전기 값이 없다).
    if (opts.both) {
      // 공시 계정 = 이 회사 재무제표 과목. 차감 계정은 기준 계정(대손충당금 → 단기대여금)으로.
      const all = r.pl ? pl : bs;
      let cap = caption(hit.label);
      if (src === '차감') for (let k = all.indexOf(hit) - 1; k >= 0; k--) if (!CONTRA_NAME.test(cleanFs(all[k].label))) { cap = caption(all[k].label); break; }
      return { ...r, cur, prev: hit.pri != null ? pri : null, src, prevDiff: null, fs: fsId(hit, bs, pl), fsli: cap };
    }
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
      // 두 해를 채울 때(빌린 틀)는 전기에만 있던 계정도 — 올해 0 이라고 빼면 전기 자산=부채+자본이 어긋난다(아비즈 리스부채 17.6억).
      if (nextDeeper || x.level === 0 || /총계|합계/.test(cleanFs(x.label)) || !(x.cur || (opts.both && x.pri))) return;
      if (handCur.has(val(x.cur))) return;                       // 손으로 같은 금액을 넣어 둔 줄이 있다
      rep.unplaced.push({ statement: x.statement, label: x.label, cur: val(x.cur) });
    });
  }
  return { data: { ...d, rows }, report: rep };
}

const CONTRA_NAME = /^(대손충당금|감가상각누계액|손상차손누계액|정부보조금|현재가치할인차금)$/;
/**
 * 분류 이름이 같은가(번호·띄어쓰기 뗀 뒤) — 같거나 한쪽이 다른 쪽을 품되, 「유동」과 「비유동」은 섞지 않는다
 * (「기타비유동자산」이 「유동자산」을 글자로 품어서 유동 보증금을 기타비유동 줄에 넣던 것).
 */
function groupLike(a: string, b: string): boolean {
  if (a === b) return true;
  if (!(a.includes(b) || b.includes(a))) return false;
  return a.includes('비유동') === b.includes('비유동');
}

/**
 * 빌린 틀에 없는 DSD 계정 → 알맞은 분류 끝의 새 줄(사용자 2026-09-30 「나중에는 클로드 없이도」 — 빌린 틀은 손 안 대고 끝나야 한다).
 * 분류는 DSD 표의 윗 과목(「유형자산」·「판매비와관리비」)과 틀의 분류 이름(번호·띄어쓰기 뗀 것)으로 찾고, 없으면 같은 부분(자산·부채·자본·손익)의 끝 분류.
 * 차감 계정(감가상각누계액)은 바로 위 계정 이름을 붙이고(「감가상각누계액-리스자산」) 음수로.
 */
export function placeUnplaced(d: Paper2120A, lines: FsLine[], scale: number): { data: Paper2120A; placed: { label: string; group: string }[] } {
  const rep = fillFromFs(d, lines, { both: true, scale }).report;
  if (!rep.unplaced.length) return { data: d, placed: [] };
  const groups: { name: string; pl: boolean; sec?: Sec }[] = [];
  for (const r of d.rows) if (r.group && !groups.some((g) => g.name === r.group && g.pl === r.pl)) groups.push({ name: r.group, pl: r.pl, sec: r.sec });
  const bs = lines.filter((l) => /재무상태|대차대조/.test(l.statement));
  const pl = lines.filter((l) => /손익/.test(l.statement));
  const idxOf = (pool: FsLine[], re: RegExp) => pool.findIndex((x) => re.test(cleanFs(x.label)));
  const assetEnd = idxOf(bs, /^자산총계$/), liabEnd = idxOf(bs, /^부채총계$/);
  const added: Row2120[] = []; const placed: { label: string; group: string }[] = [];
  const taken = new Set<FsLine>();
  for (const u of rep.unplaced) {
    const isPl = /손익/.test(u.statement);
    const pool = isPl ? pl : bs;
    const i = pool.findIndex((x) => !taken.has(x) && x.label === u.label && (x.cur ?? 0) * scale === u.cur);
    if (i < 0) continue;
    const x = pool[i]; taken.add(x);
    // 차감 계정 — 바로 위의 같은 깊이 계정이 기준.
    let base = i;
    let label = x.label.trim();
    const contra = CONTRA_NAME.test(cleanFs(x.label));
    if (contra) { for (let k = i - 1; k >= 0; k--) if (pool[k].level === x.level && !CONTRA_NAME.test(cleanFs(pool[k].label))) { base = k; break; } label = `${label}-${pool[base].label.trim()}`; }
    const parents: FsLine[] = [];
    for (let k = base - 1, lv = pool[base].level; k >= 0 && lv > 0; k--) if (pool[k].level < lv) { parents.push(pool[k]); lv = pool[k].level; }
    const sec: Sec = isPl ? '손익' : i < assetEnd ? '자산' : i < liabEnd ? '부채' : '자본';
    const cands = groups.filter((g) => g.pl === isPl);
    const g = parents.map((p) => cands.find((c) => cleanFs(c.name) === cleanFs(p.label))).find(Boolean)
      ?? parents.map((p) => cands.find((c) => groupLike(cleanFs(c.name), cleanFs(p.label)))).find(Boolean)
      ?? [...cands].reverse().find((c) => isPl || c.sec === sec);
    if (!g) continue;
    const amt = (n: number | undefined) => (n == null ? null : contra ? -Math.abs(n * scale) : n * scale);
    // 끼울 자리 — DSD 에서 바로 위 과목들 중 같은 분류의 줄이 받은 것(새 줄 포함) 바로 아래. 못 찾으면 분류 끝.
    const id = (k: number) => (isPl ? `PL#${k}` : `BS#${k}`);
    let after: string | undefined;
    for (let k = i - 1; k >= 0 && !after; k--) after = [...added, ...d.rows].find((r) => r.fs === id(k) && r.group === g.name && r.pl === isPl)?.key;
    added.push({
      // src 는 비워 둔다 — 다시 채울 때 일반 짝짓기(문구·차감 「감가상각누계액-리스자산」)로 같은 DSD 줄을 찾는다.
      // 「손」+absorbs 로 두면 같은 이름(감가상각누계액)의 다른 줄까지 쓴 것으로 쳐서 틀의 차감 줄이 비었다.
      key: `new|${g.name}|${label}|${added.length}`, label, fsli: caption(pool[base].label), pl: isPl, sec: isPl ? '손익' : g.sec ?? sec, group: g.name, added: true, src: '', note: '',
      cur: amt(x.cur), prev: amt(x.pri), fs: id(i), after,
    });
    placed.push({ label, group: g.name });
  }
  // 화면 순서도 시트와 같게 — 새 줄을 자리 줄 바로 아래(없으면 분류 끝줄 아래)에.
  const rows = [...d.rows];
  for (const x of added) {
    let at = x.after ? rows.findIndex((r) => r.key === x.after) : -1;
    if (at < 0) at = rows.map((r, k) => ({ r, k })).filter(({ r }) => r.group === x.group && r.pl === x.pl).pop()?.k ?? rows.length - 1;
    while (at + 1 < rows.length && rows[at + 1].added && rows[at + 1].after === x.after && x.after) at += 1;
    rows.splice(at + 1, 0, x);
  }
  return { data: { ...d, rows }, placed };
}

/** 자산 = 부채 + 자본 — 전기·당기 각각. 차감 계정은 이미 음수다. */
export function balance(rows: Row2120[], which: 'prev' | 'cur'): { asset: number; liab: number; equity: number; diff: number } | null {
  if (!rows.some((r) => r.sec)) return null;
  const sum = (sec: Sec) => rows.filter((r) => r.sec === sec).reduce((t, r) => t + (r[which] ?? 0), 0);
  const asset = sum('자산'), liab = sum('부채'), equity = sum('자본');
  return { asset, liab, equity, diff: asset - liab - equity };
}
