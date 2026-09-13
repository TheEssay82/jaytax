// ③ 검증 — 사람이 채워 넣은 주석 시트를 훑어 어긋난 곳을 찾는다.
//
// 검증은 **배치가 남긴 표 구조**(SheetPlan.tables)를 보고 한다. 엑셀만 보고 표를 다시
// 알아내려 들면 배치 규칙을 두 벌 쓰게 되고 둘이 어긋난다. 그래서 ③ 도 작년 DSD 를 받는다 —
// 같은 배치를 다시 만들어 「어디에 무엇이 있어야 하는가」를 알고 시작한다.
//
// 판단은 세 갈래다.
//   틀림      — 숫자가 맞지 않는다. 고쳐야 한다.
//   살펴볼 것 — 틀렸다고 단정할 수 없다. 단수차이·수식을 지운 자리 따위.
//   안 채움   — 노란 칸이 비어 있다. 아직 일이 남았다는 뜻이지 잘못은 아니다.
import type { SheetPlan, TablePlan, SheetCell } from './noteSheet';
import { colName, asNumber } from './noteSheet';
import type { SheetData, CellValue } from './xlsxRead';
import type { FsLine } from './fsParse';
import type { LinkGroup } from './noteLink';

export type Level = '틀림' | '살펴볼 것' | '안 채움';
export type Kind = '풋팅' | '빈칸' | '전기값' | '단수차이' | '수식' | '대사' | '주석대사';

export interface Finding {
  sheet: string;
  note: string;
  kind: Kind;
  level: Level;
  /** 「D15」 또는 「D9:D14 → D15」 */ where: string;
  says: string;
  /** 숫자로 재는 어긋남 */ diff?: number;
}

export interface VerifyResult {
  findings: Finding[];
  /** 훑은 시트·표·칸 수 */ scanned: { sheets: number; tables: number; cells: number };
  /** 노란 칸 가운데 채운 것 */ filled: { done: number; total: number };
}

/** 값이 비어 있는가 — 수식만 있고 값이 없는 것도 「아직」로 본다. */
function isEmpty(v: CellValue | undefined): boolean {
  if (!v) return true;
  if (v.num != null) return false;
  return (v.text ?? '').trim() === '';
}

/** 숫자로 읽는다. 글자로 적힌 「1,234」도 숫자로 본다. */
export function numOf(v: CellValue | undefined): number | undefined {
  if (!v) return undefined;
  if (v.num != null) return v.num;
  const t = (v.text ?? '').trim();
  if (!t) return undefined;
  return asNumber(t);
}

/**
 * 소수점 아래 오차를 봐 준다.
 *
 * 원 단위는 딱 떨어져야 하지만, 천원 표의 ROUND 나 비율 열에서는 부동소수점 찌꺼기가 남는다.
 * 1원 미만은 어긋남으로 세지 않는다.
 */
export function offBy(a: number, b: number): number {
  const d = a - b;
  return Math.abs(d) < 0.5 ? 0 : d;
}

/** 표 한 장을 훑는다. */
function verifyTable(
  plan: SheetPlan, t: TablePlan, cells: Map<string, CellValue>, note: string, out: Finding[],
): void {
  if (t.isUnitMark) return;
  const at = (col: number, row: number) => cells.get(`${colName(col)}${row}`);

  // ── 풋팅 — 합계 행이 항목 합과 맞는가 ────────────────────────
  // 사람이 합계를 손으로 적어 넣는 일이 있다. 그러면 항목을 고쳐도 합계가 따라오지 않는다.
  if (t.totalRow != null && t.itemRows.length >= 2) {
    for (const col of t.numCols) {
      const tc = at(col, t.totalRow);
      if (tc?.formula != null && tc.num == null) continue;   // 아직 계산되지 않은 파일
      const total = numOf(tc);
      if (total == null) continue;
      let sum = 0;
      let seen = 0;
      for (const r of t.itemRows) {
        const n = numOf(at(col, r));
        if (n == null) continue;
        sum += n; seen += 1;
      }
      if (seen < 2) continue;
      const d = offBy(total, sum);
      if (d === 0) continue;
      const c = colName(col);
      out.push({
        sheet: plan.name, note, kind: '풋팅', level: '틀림',
        where: `${c}${t.itemRows[0]}:${c}${t.itemRows[t.itemRows.length - 1]} → ${c}${t.totalRow}`,
        says: `합계 ${fmt(total)} 인데 항목을 더하면 ${fmt(sum)} 입니다 (${fmt(d)} 차이).`,
        diff: d,
      });
    }
  }

  // ── 단수차이 — 천원 표에서 표시 합계와 원 합계가 어긋난 자리 ──
  // 어긋나는 것 자체는 잘못이 아니다. 다만 커지면 원 단위 입력을 잘못 넣은 것이다.
  if (t.diffCol != null) {
    t.numCols.forEach((_, k) => {
      const ref = `${colName(t.diffCol! + k)}${t.totalRow}`;
      const d = numOf(cells.get(ref));
      if (d == null || d === 0) return;
      out.push({
        sheet: plan.name, note, kind: '단수차이', level: '살펴볼 것',
        where: ref, diff: d,
        says: `표시 합계와 원 합계가 ${fmt(d)} 만큼 다릅니다. 단수차이면 그대로 두십시오.`,
      });
    });
  }

  // ── 원 단위 ↔ 표시값 — ROUND 가 지워졌는지 ───────────────────
  if (t.srcBase != null && t.factor != null) {
    t.numCols.forEach((col, k) => {
      for (const r of t.bodyRows) {
        if (t.totalRow === r) continue;
        const src = numOf(at(t.srcBase! + k, r));
        const shown = numOf(at(col, r));
        if (src == null || shown == null) continue;
        const d = offBy(shown, Math.round(src / t.factor!));
        if (d === 0) continue;
        out.push({
          sheet: plan.name, note, kind: '수식', level: '틀림',
          where: `${colName(t.srcBase! + k)}${r} → ${colName(col)}${r}`, diff: d,
          says: `원 단위 ${fmt(src)} 을 ${t.unit ?? '천원'} 으로 옮기면 ${fmt(Math.round(src / t.factor!))} 인데 ${fmt(shown)} 이 적혀 있습니다.`,
        });
      }
    });
  }

  // ── 전기 값 — 이월해 넣은 숫자를 사람이 고쳤는가 ──────────────
  // 전기는 이미 공시된 확정 숫자다. 바뀌었다면 알려야 한다.
  for (const [ref, was] of t.carried) {
    const want = asNumber(was);
    if (want == null) continue;                    // 글자는 다시 쓸 수 있다
    const cell = cells.get(ref);
    // 아직 엑셀에서 한 번도 열지 않은 파일이면 수식 칸에 값이 없다. 지운 것이 아니다.
    if (cell?.formula != null && cell.num == null) continue;
    const now = numOf(cell);
    if (now == null) {
      out.push({
        sheet: plan.name, note, kind: '전기값', level: '틀림', where: ref,
        says: `작년 보고서의 ${fmt(want)} 이 지워졌습니다.`,
      });
      continue;
    }
    const d = offBy(now, want);
    if (d === 0) continue;
    out.push({
      sheet: plan.name, note, kind: '전기값', level: '틀림', where: ref, diff: d,
      says: `작년 보고서는 ${fmt(want)} 인데 ${fmt(now)} 으로 바뀌었습니다.`,
    });
  }
}

/** 「-1,234」·「1,234」 — 보고서에 그대로 실을 모양. */
export function fmt(n: number): string {
  const r = Math.abs(n) < 1 ? n : Math.round(n);
  return r.toLocaleString('ko-KR');
}

/** 시트 한 장. */
export function verifySheet(plan: SheetPlan, sheet: SheetData, note: string): Finding[] {
  const out: Finding[] = [];
  for (const t of plan.tables ?? []) verifyTable(plan, t, sheet.cells, note, out);
  return out;
}

/**
 * 통째로 훑는다. `plans` 는 ② 가 만든 것과 **같은 차례·같은 이름**이어야 한다 —
 * 같은 작년 DSD 와 같은 이월 설정으로 다시 만들면 그렇게 된다.
 */
export function verifyAll(plans: SheetPlan[], sheets: SheetData[]): VerifyResult {
  const byName = new Map(sheets.map((s) => [s.name, s]));
  const findings: Finding[] = [];
  let tables = 0; let cells = 0; let hit = 0;
  let done = 0; let total = 0;

  for (const plan of plans) {
    const sheet = byName.get(plan.name);
    const note = plan.cells.find((c) => c.kind === 'title')?.text ?? plan.name;
    if (!sheet) {
      findings.push({
        sheet: plan.name, note, kind: '빈칸', level: '살펴볼 것', where: '-',
        says: '이 주석 시트를 엑셀에서 찾지 못했습니다. 시트 이름이 바뀌었는지 보십시오.',
      });
      continue;
    }
    hit += 1;
    tables += (plan.tables ?? []).filter((t) => !t.isUnitMark).length;
    cells += sheet.cells.size;

    // 노란 칸을 채웠는가 — 잘못이 아니라 남은 일이다.
    for (const c of plan.cells) {
      if (c.kind !== 'input') continue;
      total += 1;
      const ref = `${colName(c.col)}${c.row}`;
      if (!isEmpty(sheet.cells.get(ref))) { done += 1; continue; }
      findings.push({
        sheet: plan.name, note, kind: '빈칸', level: '안 채움', where: ref,
        says: '채워 넣을 칸이 비어 있습니다.',
      });
    }
    findings.push(...verifySheet(plan, sheet, note));
  }

  const rank: Record<Level, number> = { 틀림: 0, '살펴볼 것': 1, '안 채움': 2 };
  findings.sort((a, b) => rank[a.level] - rank[b.level] || a.sheet.localeCompare(b.sheet, 'ko'));
  return { findings, scanned: { sheets: hit, tables, cells }, filled: { done, total } };
}

/**
 * 검증 결과를 시트 한 장으로 — 엑셀에 얹어 두면 고칠 때 옆에 놓고 볼 수 있다.
 *
 * 「안 채움」은 자리마다 한 줄씩 적으면 수백 줄이 된다. 시트별로 묶어 한 줄로 적는다 —
 * 어차피 노란 칸을 보면 되는 일이라 자리를 다 늘어놓을 까닭이 없다.
 */
export function layoutReport(r: VerifyResult, when = new Date(), ties: TieRow[] = []): SheetPlan {
  const cells: SheetCell[] = [
    { row: 2, col: 2, text: '검증보고서', kind: 'title' },
    {
      row: 3, col: 2, kind: 'para',
      text: `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-`
        + `${String(when.getDate()).padStart(2, '0')} · 주석 시트 ${r.scanned.sheets}장 · 표 ${r.scanned.tables}장`
        + ` · 채워 넣을 칸 ${r.filled.done}/${r.filled.total}개`,
    },
  ];
  const head = ['갈래', '판단', '주석', '자리', '내용', '차이'];
  head.forEach((h, i) => cells.push({ row: 5, col: 2 + i, text: h, kind: 'head' }));

  const rows: (string | number)[][] = [];
  for (const f of r.findings.filter((x) => x.level !== '안 채움')) {
    rows.push([f.kind, f.level, f.note, f.where, f.says, f.diff ?? '']);
  }
  // 안 채운 칸은 시트마다 한 줄로 묶는다
  const left = new Map<string, { note: string; n: number; first: string }>();
  for (const f of r.findings) {
    if (f.level !== '안 채움') continue;
    const cur = left.get(f.sheet);
    if (cur) cur.n += 1;
    else left.set(f.sheet, { note: f.note, n: 1, first: f.where });
  }
  for (const [, v] of left) {
    rows.push(['빈칸', '안 채움', v.note, `${v.first} 외`, `채워 넣을 칸 ${v.n}개가 비어 있습니다.`, '']);
  }

  rows.forEach((line, i) => {
    const row = 6 + i;
    line.forEach((v, k) => {
      if (v === '') return;
      if (typeof v === 'number') cells.push({ row, col: 2 + k, text: '', num: v, kind: 'num' });
      else cells.push({ row, col: 2 + k, text: v, kind: 'text' });
    });
  });
  if (!rows.length) {
    cells.push({ row: 6, col: 2, text: '어긋난 곳을 찾지 못했습니다.', kind: 'text' });
  }
  let last = 5 + Math.max(1, rows.length);

  // ── 대사표 — 재무제표가 가리킨 주석에서 그 금액을 찾았는가 ──
  if (ties.length) {
    const found = ties.filter((t) => t.foundIn).length;
    last += 2;
    cells.push({
      row: last, col: 2, kind: 'title',
      text: `재무제표 ↔ 주석 대사  ${found}/${ties.length} 찾음`,
    });
    last += 1;
    cells.push({
      row: last, col: 2, kind: 'para',
      text: '금액이 주석에 없는 것이 잘못은 아닙니다 — 주석 표시는 「관련된 주석」이라 '
        + '특수관계자분만 싣는 경우처럼 액수가 다를 수 있습니다. 한 번 보고 넘기십시오.',
    });
    last += 2;
    ['재무제표', '과목', '금액', '가리킨 주석', '찾은 곳'].forEach((h, i) => {
      cells.push({ row: last, col: 2 + i, text: h, kind: 'head' });
    });
    for (const t of ties) {
      last += 1;
      cells.push({ row: last, col: 2, text: t.statement, kind: 'text' });
      cells.push({ row: last, col: 3, text: t.label, kind: 'text' });
      cells.push({ row: last, col: 4, text: '', num: t.amount, kind: 'num' });
      cells.push({ row: last, col: 5, text: t.notes.map((n) => `주석 ${n}`).join(', '), kind: 'text' });
      cells.push({
        row: last, col: 6, kind: 'text',
        text: t.foundIn ?? (t.missing.length ? `주석 ${t.missing.join(',')} 없음` : '짝 없음'),
      });
    }
  }
  return { name: '검증보고서', cells, merges: [], lastRow: last, tables: [] };
}

/**
 * 시트에 든 숫자를 모두 모은다.
 *
 * **합계는 직접 더해서 넣는다.** 합계 칸은 SUM 수식이라 엑셀에서 한 번 열기 전에는 값이 없다.
 * 대사가 「엑셀을 열어 봤는가」에 매달리면 안 된다 — 알티스트 대사율이 7/44 로 떨어졌었다
 * (2026-09-13).
 */
export function numbersOf(sheet: SheetData, plan?: SheetPlan): number[] {
  const out: number[] = [];
  for (const v of sheet.cells.values()) {
    const n = numOf(v);
    if (n != null && n !== 0) out.push(n);
  }
  for (const t of plan?.tables ?? []) {
    if (t.isUnitMark || t.totalRow == null || t.itemRows.length < 2) continue;
    const cols = t.srcBase != null ? t.numCols.map((_, k) => t.srcBase! + k) : t.numCols;
    for (const col of cols) {
      const at = sheet.cells.get(`${colName(col)}${t.totalRow}`);
      if (numOf(at) != null) continue;               // 엑셀이 이미 계산해 두었다
      let sum = 0;
      let seen = 0;
      for (const r of t.itemRows) {
        const n = numOf(sheet.cells.get(`${colName(col)}${r}`));
        if (n == null) continue;
        sum += n; seen += 1;
      }
      if (seen >= 2 && sum !== 0) out.push(sum);
    }
  }
  return out;
}

/**
 * 금액이 이 주석 안에 있는가.
 *
 * 넉넉히 본다 — **없다고 말하는 쪽**이라 섣불리 걸면 헛경보가 된다.
 *   · 부호는 따지지 않는다. 재무제표는 대손충당금을 (630,300) 으로 적고 주석은 630,300 으로 적는다.
 *   · **천원 주석은 원 자리를 잃는다.** 재무제표 1,630,779,245 가 주석에서는 1,630,779천원,
 *     원 단위 칸으로는 1,630,779,000 이다. 천원 자리에서 같으면 맞은 것으로 본다.
 *     다만 액수가 작으면 이 잣대가 헐거우므로 만원 이상일 때만 쓴다.
 */
export function hasAmount(nums: number[], want: number): boolean {
  const a = Math.abs(want);
  if (a < 1) return true;                            // 0 은 어디에나 있다 — 따지지 않는다
  const k = Math.round(a / 1000);
  for (const n of nums) {
    const b = Math.abs(n);
    if (Math.abs(b - a) < 0.5) return true;          // 딱 같다
    if (a >= 10000 && Math.abs(b - a) <= 500) return true;   // 천원에서 반올림한 만큼
    if (k > 0 && Math.abs(b - k) < 0.5) return true;         // 주석이 천원으로 적었다
  }
  return false;
}

export interface NoteSheetRef {
  plan: SheetPlan;
  /** 작년 DSD 에서의 주석 번호 — 재무제표가 부르는 번호가 이것이다. */
  dsdNo: number | null;
}

/** 대사표 한 줄 — 재무제표 계정 하나. */
export interface TieRow {
  statement: string;
  label: string;
  /** 이 계정이 가리키는 주석 번호들 */ notes: number[];
  amount: number;
  /** 금액을 찾은 주석의 시트. 못 찾았으면 null */ foundIn: string | null;
  /** 가리켰는데 만들 주석에 없는 번호들 */ missing: number[];
}

/**
 * 재무제표와 주석을 댄다 — **대사표를 만든다.**
 *
 * 재무제표가 「매출채권<주석 12,18>」처럼 **어느 주석을 보라고 이미 적어 두었다.** 그 주석들
 * 가운데 어디에 그 금액이 있는지 찾아 적는다.
 *
 * **판정하지 않는다.** 금액이 주석에 없는 것이 정상인 경우가 많기 때문이다 — 주석 표시는
 * 「이 계정과 관련된 주석」이지 「이 금액이 실린 주석」이 아니다. 명진 임대료매출 917,513,441 은
 * 주석 12 특수관계자를 가리키지만 거기엔 특수관계자분 66,000,000 만 있다.
 * 실측 대사율은 명진 14/19 · 알티스트 24/44(2026-09-13). 이대로 「틀림」을 내면 헛경보가 절반이다.
 *
 * 다만 **재무제표가 없는 주석 번호를 가리키는 것**은 틀린 것이다. 주석을 빼고 번호를 다시
 * 매기지 않으면 이렇게 된다.
 */
export function tieOut(
  fs: FsLine[], notes: NoteSheetRef[], sheets: SheetData[], roll: boolean,
): { rows: TieRow[]; findings: Finding[] } {
  const bySheet = new Map(sheets.map((x) => [x.name, x]));
  const byNo = new Map<number, NoteSheetRef>();
  for (const n of notes) if (n.dsdNo != null && !byNo.has(n.dsdNo)) byNo.set(n.dsdNo, n);
  const cache = new Map<string, number[]>();
  const rows: TieRow[] = [];
  const findings: Finding[] = [];
  const told = new Set<number>();

  for (const line of fs) {
    if (!line.notes.length) continue;
    // 이월한 서식이면 재무제표의 **당기** 금액을 찾는다 — 올해 주석의 전기 칸에 그것이 내려와 있다.
    const amt = roll ? line.cur : (line.cur ?? line.pri);
    if (amt == null || Math.abs(amt) < 1) continue;

    let foundIn: string | null = null;
    const missing: number[] = [];
    for (const no of line.notes) {
      const ref = byNo.get(no);
      if (!ref) {
        missing.push(no);
        if (!told.has(no)) {
          told.add(no);
          findings.push({
            sheet: '-', note: `${line.statement} · ${line.label}`, kind: '대사', level: '틀림',
            where: `주석 ${no}`,
            says: `재무제표가 주석 ${no} 을 가리키는데 그런 주석이 없습니다. 번호가 밀렸는지 보십시오.`,
          });
        }
        continue;
      }
      if (foundIn) continue;
      const sheet = bySheet.get(ref.plan.name);
      if (!sheet) continue;
      let nums = cache.get(ref.plan.name);
      if (!nums) { nums = numbersOf(sheet, ref.plan); cache.set(ref.plan.name, nums); }
      if (hasAmount(nums, amt)) foundIn = ref.plan.name;
    }
    rows.push({
      statement: line.statement, label: line.label, notes: line.notes,
      amount: amt, foundIn, missing,
    });
  }
  return { rows, findings };
}

/**
 * 주석끼리 맞아야 하는 숫자를 본다.
 *
 * 짝은 작년 보고서에서 배운 것이다(noteLink). 여기서는 **올해 엑셀의 그 자리들이 서로 같은지**만
 * 본다. 작년 값과 같아야 한다는 뜻이 아니다 — 올해 값끼리 맞아야 한다는 뜻이다.
 *
 * 사용자가 든 예: 현금흐름표의 유형자산 취득은 유형자산 주석의 취득과 맞아야 한다.
 */
export function checkLinks(links: LinkGroup[], sheets: SheetData[]): Finding[] {
  const by = new Map(sheets.map((s2) => [s2.name, s2]));
  const out: Finding[] = [];

  for (const g of links) {
    const got: { at: string; v: number }[] = [];
    let blank = 0;
    for (const sp of g.spots) {
      if (!sp.at) continue;
      const sheet = by.get(sp.group);
      if (!sheet) continue;
      const cell = sheet.cells.get(sp.at);
      // 아직 엑셀에서 열지 않아 수식에 값이 없으면 넘긴다.
      if (cell?.formula != null && cell.num == null) { blank += 1; continue; }
      const v = numOf(cell);
      if (v == null) { blank += 1; continue; }
      got.push({ at: `${sp.group}!${sp.at}`, v });
    }
    if (got.length < 2) continue;                    // 아직 채우는 중이다
    const lo = Math.min(...got.map((x) => x.v));
    const hi = Math.max(...got.map((x) => x.v));
    const d = offBy(hi, lo);
    if (d === 0) continue;
    // **한쪽이 0 이면 단정하지 않는다.** 붙임표를 0 으로 넣은 자리이거나 아직 안 채운 자리다.
    const zero = got.some((x) => x.v === 0);
    out.push({
      sheet: g.spots.find((x) => x.at)?.group ?? '-',
      note: got.map((x) => x.at).join(' ↔ '),
      kind: '주석대사', level: zero ? '살펴볼 것' : '틀림',
      where: got.map((x) => fmt(x.v)).join(' ↔ '), diff: d,
      says: `맞아야 하는 숫자가 ${fmt(d)} 만큼 다릅니다`
        + (blank ? ` (아직 안 채운 자리 ${blank}곳은 뺐습니다)` : '')
        + (zero ? ' — 한쪽이 0 이라 아직 안 채운 것일 수 있습니다' : '')
        + `. 작년에는 ${fmt(g.value)} 으로 같았습니다.`,
    });
  }
  return out;
}
