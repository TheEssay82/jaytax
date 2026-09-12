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

export type Level = '틀림' | '살펴볼 것' | '안 채움';
export type Kind = '풋팅' | '빈칸' | '전기값' | '단수차이' | '수식';

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
export function layoutReport(r: VerifyResult, when = new Date()): SheetPlan {
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
  return { name: '검증보고서', cells, merges: [], lastRow: 5 + Math.max(1, rows.length), tables: [] };
}
