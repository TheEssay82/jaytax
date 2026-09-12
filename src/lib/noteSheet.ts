// 주석 블록을 **엑셀 시트 한 장의 배치**로 옮긴다. 순수 규칙이라 테스트가 붙는다.
//
// 배치는 **명진 정산표가 이미 쓰고 있던 모양 그대로**다(2026-09-12 확인):
//
//   B2 = 주석명 │ C2 = 회사의 개요
//   C3         명진산업개발 주식회사(이하 "당사")은 …
//   C4         당사의 설립시 자본금은 520백만원이며 …
//   (빈 줄)
//   C8:E8      구 분 │ 주식수(주) │ 지분율
//   C9:E9      이 종 명 │ 32,000 │ 50%
//
// A열에는 **자리표**를 숨겨 둔다 — 이 칸이 DSD 의 몇 번째 글자칸인지다. 그게 있어야
// 엑셀에서 고친 값을 DSD 제자리에 도로 넣을 수 있다.
import { gridWidth, type NoteBlocks } from './dsdBlocks';

/** 어떤 서식으로 그릴 칸인가 — xlsxStyles 의 이름과 같다. */
export type CellKind = 'label' | 'title' | 'para' | 'head' | 'text' | 'num' | 'input';

export interface SheetCell {
  /** 1부터 */ row: number;
  /** 1=A, 2=B, 3=C … */ col: number;
  text: string;
  /** 숫자로 넣을 값. 없으면 글자로 넣는다. */ num?: number;
  /** 엑셀 수식(= 없이). 있으면 num·text 대신 이것이 들어간다. */ formula?: string;
  kind?: CellKind;
}

/** 1=A, 2=B, … 27=AA */
export function colName(n: number): string {
  let out = '';
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    x = Math.floor((x - 1) / 26);
  }
  return out;
}

/**
 * 표시 단위에서 **원으로 되돌리는 배수**.
 *
 * 재무제표와 TB 는 모두 원이다. 주석이 천원 값만 들고 있으면 대사할 때마다 사람이 ÷1000 을
 * 해야 하고 반올림 때문에 등식이 깨진다. 그래서 **원을 원본으로 두고 표시를 ROUND 로 유도**한다
 * (사용자 설계 2026-09-13).
 *
 * 단위가 섞인 표(「천원,%」·「USD,JPY,천원」)는 열마다 뜻이 달라 손대지 않는다 — 잘못 걸면
 * 주식수나 비율이 천 배로 어긋난다.
 */
export function unitFactor(unit: string | undefined): number | null {
  if (unit === '천원') return 1000;
  if (unit === '백만원') return 1000000;
  return null;
}

/** 머리글이 「당기」쪽인가. 「당기순손익」처럼 다른 말은 아니다 — 딱 맞을 때만. */
const CUR_HEAD = /^(당기|당기말|당분기|제\d+\(당\)기말?)$/;
const PRI_HEAD = /^(전기|전기말|전분기|제\d+\(전\)기말?)$/;
export function periodOfHead(text: string): '당기' | '전기' | null {
  const t = (text ?? '').replace(/\s/g, '');
  if (CUR_HEAD.test(t)) return '당기';
  if (PRI_HEAD.test(t)) return '전기';
  return null;
}

/** 「제12(당)기」의 기수를 한 해 올린다. 기수가 없으면 그대로. */
export function bumpTerm(text: string): string {
  return (text ?? '').replace(/제\s*(\d+)\s*\(/g, (_, n) => `제${Number(n) + 1}(`);
}

/**
 * 합계 행인가 — **SUM 으로 묶어도 되는 줄**만 참이다.
 *
 * 「기말」·「당기말」은 합계가 아니다. 기초 + 증감 = 기말이라 SUM 으로 묶으면 두 배가 된다.
 */
export function isTotalLabel(text: string): boolean {
  return /^(합계|소계|총계|계)$/.test((text ?? '').replace(/\s/g, ''));
}

export interface SheetPlan {
  name: string;
  cells: SheetCell[];
  /** 엑셀에서 병합할 자리 — 「D4:E4」 꼴. 원본이 덮은 만큼 덮는다. */ merges?: string[];
  /** 마지막 행 */ lastRow: number;
}

/** 표 안의 「32,000」·「(57,670)」·「50%」를 어떻게 넣을지. 퍼센트·단위는 글자 그대로 둔다. */
export function asNumber(text: string): number | undefined {
  const s = (text ?? '').trim();
  if (!s || !/^[(]?-?[\d,]+(\.\d+)?[)]?$/.test(s)) return undefined;
  const neg = s.startsWith('(');
  const v = Number(s.replace(/[(),]/g, ''));
  if (!Number.isFinite(v)) return undefined;
  return neg ? -v : v;
}

/**
 * 「-」 한 글자 — 재무제표에서 **0** 을 뜻한다.
 *
 * 붙임표는 여러 모양으로 쓰인다(-, –, —, 전각 －). 숫자 사이에 낀 「1-2」 같은 것은 아니다.
 */
export function isDash(text: string): boolean {
  const s = (text ?? '').trim();
  return s.length > 0 && /^[-‐‑–—―－\s]+$/.test(s) && /[-‐‑–—―－]/.test(s);
}

/**
 * 엑셀 시트 이름으로 쓸 수 있게 다듬는다.
 * 31자 넘으면 자르고, 엑셀이 금지하는 글자(: \ / ? * [ ])는 뺀다. 겹치면 뒤에 번호를 붙인다.
 */
export function sheetName(title: string, used: Set<string>): string {
  let base = (title ?? '').replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base) base = '주석';
  base = base.slice(0, 31);
  let name = base;
  let n = 2;
  while (used.has(name)) {
    const tail = `(${n})`;
    name = base.slice(0, 31 - tail.length) + tail;
    n += 1;
  }
  used.add(name);
  return name;
}

/** 자리표 — 「슬롯번호」 또는 문단이 여럿인 칸은 「슬롯번호#몇번째」. */
export function addrOf(slot: number, part?: number): string {
  return part == null ? String(slot) : `${slot}#${part}`;
}

/** 자리표를 도로 읽는다. 못 읽으면 null. */
export function parseAddr(s: unknown): { slot: number; part: number | null } | null {
  const m = /^(\d+)(?:#(\d+))?$/.exec(String(s ?? '').trim());
  if (!m) return null;
  return { slot: Number(m[1]), part: m[2] == null ? null : Number(m[2]) };
}

/**
 * 주석 하나를 시트 배치로.
 *
 * 문단은 붙여서 한 줄씩 놓고, **표 앞에는 빈 줄을 한 줄** 둔다 — 정산표가 그렇게 돼 있다.
 */
/**
 * 다음 해로 **이월**할 때 쓰는 설정.
 *
 * 감사조서의 관행 그대로다 — 당기 칸의 값을 전기로 밀고, 당기 칸은 **비워서 노랗게** 둔다.
 * 「채워 넣어라」는 표시다. 대부분의 주석은 재무제표에서 링크로 끌어오므로, 어디를 채워야
 * 하는지가 눈에 보여야 한다(사용자 설계 2026-09-13).
 */
export interface LayoutOptions {
  /** 참이면 이월한다. 새 사업연도 시트를 만들 때 쓴다. */ roll?: boolean;
}

export function layoutNote(note: NoteBlocks, name: string, opts: LayoutOptions = {}): SheetPlan {
  const cells: SheetCell[] = [
    { row: 2, col: 2, text: '주석명', kind: 'label' },
    { row: 2, col: 3, text: `${note.no}. ${note.title}`, kind: 'title' },
  ];
  const merges: string[] = [];
  let r = 3;
  let prevWasTable = false;

  for (const b of note.blocks) {
    if (b.kind === 'para') {
      if (prevWasTable) r += 1;                       // 표 뒤에는 한 줄 띄운다
      // 제목이 같은 칸에 함께 든 문단은 제목이 0번이라 본문이 1번부터다.
      const off = b.lead != null ? 1 : 0;
      const many = b.parts.length + off > 1;
      b.parts.forEach((p, i) => {
        cells.push({ row: r, col: 1, text: addrOf(b.slot, many ? i + off : undefined) });
        cells.push({ row: r, col: 3, text: p, kind: 'para' });
        r += 1;
      });
      prevWasTable = false;
      continue;
    }

    // ── 표 ────────────────────────────────────────────────────────
    r += 1;                                          // 표 앞에 빈 줄
    const blankRow = r - 1;
    const width = Math.max(gridWidth(b.rows), 1);
    const rowNo = b.rows.map((_, i) => r + i);
    const isHeadRow = b.rows.map((line) => line.length > 0 && line.every((c) => c.tag === 'TH'));

    // 값은 **격자 열 번호**로 다룬다. 칸 순서로 다루면 COLSPAN 이 있는 표에서 옆으로 샌다.
    const orig = b.rows.map((line) => new Map(line.map((c) => [c.col, c.text])));

    // 어느 열이 숫자 열인가 — 그 열의 「-」는 0 으로 넣어야 합계가 잡힌다.
    const numericCol: number[] = [];
    b.rows.forEach((line, i) => {
      if (isHeadRow[i]) return;
      for (const c of line) if (asNumber(c.text) != null && !numericCol.includes(c.col)) numericCol.push(c.col);
    });
    numericCol.sort((a, x) => a - x);

    // ── 이월: 당기 열과 전기 열을 격자에서 찾아 짝짓는다 ──────────────
    // 머리가 두 줄인 표(「당기」가 COLSPAN 으로 두 열을 덮고 그 아래 장부가액·공시지가)도
    // COLSPAN 을 펼쳐 두었으므로 덮는 열이 그대로 나온다.
    const curCols: number[] = [];
    const priCols: number[] = [];
    b.rows.forEach((line, i) => {
      if (!isHeadRow[i]) return;
      for (const c of line) {
        const p = periodOfHead(c.text);
        if (!p) continue;
        for (let k = 0; k < c.colspan; k += 1) (p === '당기' ? curCols : priCols).push(c.col + k);
      }
    });
    curCols.sort((a, x) => a - x);
    priCols.sort((a, x) => a - x);
    const pairs: [number, number][] = curCols.length === priCols.length && curCols.length > 0
      ? curCols.map((c, i) => [c, priCols[i]] as [number, number]) : [];
    const wholeCurrent = opts.roll === true && b.period === '당기' && pairs.length === 0;
    const grid = opts.roll === true ? rollGrid(orig, pairs, wholeCurrent, curCols) : orig;
    const blankCols = new Set<number>(
      opts.roll === true ? (pairs.length ? pairs.map(([c]) => c) : (wholeCurrent ? numericCol : curCols)) : [],
    );

    const factor = b.isUnitMark ? null : unitFactor(b.unit);
    const dual = factor != null && numericCol.length > 0;
    const srcBase = 3 + width + 1;                   // 표 오른쪽에 한 칸 띄운다
    const diffCol = srcBase + numericCol.length + 1;

    // 합계 행 — 하나뿐이고 위에 항목이 둘 이상일 때만 SUM 으로 묶는다.
    const bodyIdx = b.rows.map((_, i) => i).filter((i) => !isHeadRow[i]);
    const totalIdx = bodyIdx.filter((i) => isTotalLabel(b.rows[i][0]?.text ?? ''));
    const sumAt = totalIdx.length === 1 ? totalIdx[0] : -1;
    const items = sumAt >= 0 ? bodyIdx.filter((i) => i < sumAt) : [];
    const canSum = items.length >= 2;

    if (dual) cells.push({ row: blankRow, col: srcBase, text: '원 단위 (입력)', kind: 'label' });

    b.rows.forEach((line, i) => {
      const head = isHeadRow[i];
      cells.push({ row: rowNo[i], col: 1, text: line.map((c) => addrOf(c.slot)).join(' ') });

      for (const c of line) {
        const at = 3 + c.col;
        const val = head ? bumpTerm(c.text) : (grid[i].get(c.col) ?? '');
        const blank = !head && blankCols.has(c.col);
        // 「-」는 재무제표에서 0 이다. 숫자 0 으로 넣고 화면에는 숫자꼴이 「-」로 보여 준다.
        const num = blank ? undefined
          : (!head && numericCol.includes(c.col) && isDash(val) ? 0 : asNumber(val));
        const cell: SheetCell = {
          row: rowNo[i], col: at, text: blank ? '' : val, num,
          kind: head ? 'head' : blank ? 'input' : num != null ? 'num' : 'text',
        };
        if (!head && (num != null || blank) && dual) {
          const k = numericCol.indexOf(c.col);
          const src = `${colName(srcBase + k)}${rowNo[i]}`;
          const rng = `${colName(at)}${rowNo[items[0]]}:${colName(at)}${rowNo[items[items.length - 1]]}`;
          // 합계 행은 **표시값끼리 더한다**(㉮) — 보는 사람이 더해서 맞아야 한다.
          // 원 합계를 반올림한 값(㉯)과의 차이는 옆에 「단수차이」로 따로 보여 준다.
          cell.formula = canSum && i === sumAt
            ? `IF(COUNT(${rng})=0,"",SUM(${rng}))`
            : `IF(${src}="","",ROUND(${src}/${factor},0))`;
          cell.kind = 'num';
          delete cell.num;
        }
        cells.push(cell);
        // 병합 — 원본이 덮은 만큼 엑셀에서도 덮는다. 안 그러면 2단 머리가 어긋나 보인다.
        if (c.colspan > 1 || c.rowspan > 1) {
          merges.push(`${colName(at)}${rowNo[i]}:${colName(at + c.colspan - 1)}${rowNo[i] + c.rowspan - 1}`);
        }
      }

      // ── 오른쪽 원 단위 블록 ────────────────────────────────
      if (!dual) return;
      numericCol.forEach((gc, k) => {
        const col = srcBase + k;
        if (head) {
          const hit = line.find((c) => c.col <= gc && gc < c.col + c.colspan);
          cells.push({ row: rowNo[i], col, text: bumpTerm(hit?.text ?? ''), kind: 'head' });
          return;
        }
        // 합계 행은 비우지 않는다 — 항목만 채우면 합계가 저절로 따라와야 한다.
        if (blankCols.has(gc) && !(canSum && i === sumAt)) {
          cells.push({ row: rowNo[i], col, text: '', kind: 'input' });
          return;
        }
        if (canSum && i === sumAt) {
          cells.push({
            row: rowNo[i], col, text: '', kind: 'num',
            formula: `SUM(${colName(col)}${rowNo[items[0]]}:${colName(col)}${rowNo[items[items.length - 1]]})`,
          });
          return;
        }
        const raw = grid[i].get(gc) ?? '';
        const num = asNumber(raw) ?? (isDash(raw) ? 0 : undefined);
        if (num == null) return;
        cells.push({ row: rowNo[i], col, text: '', num: num * factor, kind: 'num' });
      });
    });

    // ── 단수차이 — 원 합계를 반올림한 값(㉯)과 표시 합계(㉮)의 차이 ──
    if (dual && canSum) {
      const headRow = isHeadRow.indexOf(true);
      if (headRow >= 0) cells.push({ row: rowNo[headRow], col: diffCol, text: '단수차이', kind: 'head' });
      numericCol.forEach((gc, k) => {
        cells.push({
          row: rowNo[sumAt], col: diffCol + k, text: '', kind: 'num',
          formula: `ROUND(${colName(srcBase + k)}${rowNo[sumAt]}/${factor},0)-${colName(3 + gc)}${rowNo[sumAt]}`,
        });
      });
    }

    r += b.rows.length;
    prevWasTable = true;
  }
  return { name, cells, merges, lastRow: Math.max(2, r - 1) };
}

/**
 * 값을 한 해 민다 — **전기 ← 당기, 당기는 빈칸.**
 *
 * 격자 열 번호로 다룬다. 칸 순서로 다루면 COLSPAN 이 있는 표에서 값이 옆으로 샌다.
 * 머리행은 손대지 않는다 — 「당기말」·「전기말」은 해가 바뀌어도 그대로인 이름이다.
 */
export function rollGrid(
  rows: Map<number, string>[],
  pairs: [number, number][],
  wholeCurrent: boolean,
  curCols: number[],
): Map<number, string>[] {
  return rows.map((line) => {
    const out = new Map(line);
    for (const [cur, pri] of pairs) out.set(pri, line.get(cur) ?? '');
    for (const [cur] of pairs) out.set(cur, '');
    if (!pairs.length) {
      const targets = wholeCurrent ? [...line.keys()] : curCols;
      for (const c of targets) {
        const v = line.get(c) ?? '';
        if (asNumber(v) != null || isDash(v)) out.set(c, '');
      }
    }
    return out;
  });
}

/** 주석 목록 시트 — 정산표가 이미 쓰던 「주석번호 · 주석제목 · 사용여부」 그대로. */
export function layoutIndex(rows: { no: number | null; title: string; enabled: boolean; sheet: string }[]): SheetPlan {
  const cells: SheetCell[] = [
    { row: 2, col: 2, text: '주석번호', kind: 'head' },
    { row: 2, col: 3, text: '주석제목', kind: 'head' },
    { row: 2, col: 4, text: '사용여부', kind: 'head' },
    { row: 2, col: 5, text: '시트', kind: 'head' },
  ];
  rows.forEach((x, i) => {
    const r = 3 + i;
    if (x.no != null) cells.push({ row: r, col: 2, text: String(x.no), num: x.no, kind: 'num' });
    cells.push({ row: r, col: 3, text: x.title, kind: 'text' });
    cells.push({ row: r, col: 4, text: x.enabled ? 'O' : 'X', kind: 'text' });
    cells.push({ row: r, col: 5, text: x.sheet, kind: 'text' });
  });
  return { name: '주석목록(생성)', cells, lastRow: 2 + rows.length };
}
