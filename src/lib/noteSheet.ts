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
import { gridWidth, type Block, type NoteBlocks } from './dsdBlocks';

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
 * **정책 주석**인가 — 해가 바뀌어도 내용이 그대로인 주석이다.
 *
 * 「중요한 회계처리방침」·「유의적인 회계정책」 안에는 내용연수 표처럼 해마다 안 바뀌는 것이
 * 들어 있다. 이월할 때 이런 것까지 비우면 해마다 다시 적어야 한다.
 */
export function isPolicyNote(title: string): boolean {
  return /회계처리방침|회계정책|중요한\s*판단|추정\s*불확실성/.test(title ?? '');
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
  // 「<전기>」 표는 같은 주석의 앞선 「<당기>」 표에서 값을 받아 온다 — 행 모양이 같을 때만.
  const prevOf = opts.roll === true ? pairCurrentTables(note) : new Map<Block, Map<number, string>[]>();
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
    // **표지판은 이월하지 않는다.** 「(단위: 원)」·「<당기>」는 자료가 아니라 안내판이다.
    // 이것도 「전기 열이 없는 표」라서 통째로 비우는 규칙에 걸려 단위 글자가 지워지고
    // 노랗게 칠해졌다 — 명진 15. 부가가치계산(2026-09-13 지적).
    const roll = opts.roll === true && !b.isUnitMark;
    r += 1;                                          // 표 앞에 빈 줄
    const blankRow = r - 1;
    const width = Math.max(gridWidth(b.rows), 1);
    const rowNo = b.rows.map((_, i) => r + i);
    const isHeadRow = b.rows.map((line) => line.length > 0 && line.every((c) => c.tag === 'TH'));

    // 값은 **격자 열 번호**로 다룬다. 칸 순서로 다루면 COLSPAN 이 있는 표에서 옆으로 샌다.
    const orig = b.rows.map((line) => new Map(line.map((c) => [c.col, c.text])));

    // 어느 열이 숫자 열인가 — 그 열의 「-」는 0 으로 넣어야 합계가 잡힌다.
    //
    // **전부 「-」인 열도 숫자 열이다.** 명진 6. 유형자산의 취득·처분·대체가 그랬다 —
    // 작년에 움직임이 없어 전부 붙임표였는데, 숫자 열이 아니라고 보아 이월할 때
    // 비우지도 노랗게 칠하지도 않았다(2026-09-13 지적).
    const numericCol: number[] = [];
    const dashOnly = new Map<number, boolean>();
    b.rows.forEach((line, i) => {
      if (isHeadRow[i]) return;
      for (const c of line) {
        if (asNumber(c.text) != null) {
          if (!numericCol.includes(c.col)) numericCol.push(c.col);
          dashOnly.set(c.col, false);
        } else if (isDash(c.text)) {
          if (!dashOnly.has(c.col)) dashOnly.set(c.col, true);
        } else if (c.text.trim()) {
          dashOnly.set(c.col, false);
        }
      }
    });
    for (const [col, only] of dashOnly) if (only && !numericCol.includes(col)) numericCol.push(col);
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
    // **당기 자료는 모두 비운다.** 전기로 이름 붙은 열만 남긴다(거기에 작년 당기 값이 내려온다).
    // 이자율·지분율·금액처럼 이름에 「당기」가 안 붙은 열도 결국 올해 값이라 채워 넣어야 한다 —
    // 명진 9. 차입금의 이자율이 작년 값 그대로 남아 있었다(2026-09-13 지적).
    const priSet = new Set(priCols);
    // 머리에 「당기」가 **들어 있기만 해도** 올해 값이다 — 「당기말 현재 연이자율(%)」이 그렇다.
    // 짝을 지을 때는 딱 맞는 이름만 썼지만(안전), **비울 때는 느슨하게 본다.**
    // 알티스트 9. 차입금의 이자율이 글자라서 안 비워졌었다(2026-09-13 지적).
    const looseCur = new Set<number>();
    b.rows.forEach((line, i) => {
      if (!isHeadRow[i]) return;
      for (const c of line) {
        const t = c.text.replace(/\s/g, '');
        if (!/당기|당분기/.test(t) || /전기|전분기/.test(t)) continue;
        for (let k = 0; k < c.colspan; k += 1) looseCur.add(c.col + k);
      }
    });
    const blankCols = new Set<number>(
      roll
        ? [...new Set([...numericCol, ...looseCur])].filter((c) => !priSet.has(c))
        : [],
    );
    // **전기 열이 하나도 없는 표는 통째로 올해 자료다.** 담보제공·보증 내역이 그렇다 —
    // 제공받은자·내용·성격까지 해마다 새로 적는다. 첫 열(구분)만 남기고 비운다.
    // 정책 주석은 빼 둔다 — 내용연수처럼 해마다 안 바뀌는 것이 들어 있다(2026-09-13 지적).
    if (roll && priCols.length === 0 && !isPolicyNote(note.title)) {
      for (let c = 1; c < width; c += 1) blankCols.add(c);
    }
    // 전기 표(「<전기>」 표지판)는 같은 주석의 당기 표에서 값을 받아 온다.
    const fromCurrent = roll ? prevOf.get(b) : undefined;
    const grid = !roll ? orig
      : fromCurrent ?? rollGrid(orig, pairs, false, []);
    if (fromCurrent) blankCols.clear();

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
      // 한 칸에 `<P>` 가 여럿이면 자리표도 여럿이다 — 되돌릴 때 다 찾아가야 한다.
      cells.push({
        row: rowNo[i], col: 1,
        text: line.map((c) => [c.slot, ...(c.extra ?? [])].map((x) => addrOf(x)).join('+')).join(' '),
      });

      for (const c of line) {
        const at = 3 + c.col;
        // 머리행이라도 **날짜가 든 칸은 이월한다** — 「처분예정일: 2026년 3월 31일」은 내년에
        // 전기 칸으로 내려가야 하고 당기 칸은 새로 적어야 한다(2026-09-13 지적).
        const dated = head && /\d{4}\s*년|\d{4}-\d{2}-\d{2}/.test(c.text);
        const rolls = !head || dated;
        const val = rolls ? (grid[i].get(c.col) ?? '') : bumpTerm(c.text);
        const blank = rolls && (blankCols.has(c.col) || (dated && curCols.includes(c.col)));
        // 「-」는 재무제표에서 0 이다. 숫자 0 으로 넣고 화면에는 숫자꼴이 「-」로 보여 준다.
        const num = blank ? undefined
          : (!head && numericCol.includes(c.col) && isDash(val) ? 0 : asNumber(val));
        const cell: SheetCell = {
          row: rowNo[i], col: at, text: blank ? '' : val, num,
          kind: blank ? 'input' : head ? 'head' : num != null ? 'num' : 'text',
        };
        if (!head && dual && numericCol.includes(c.col) && (num != null || blank)) {
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
 * 「<전기>」 표에 짝이 되는 「<당기>」 표의 값을 물려준다.
 *
 * 명진 6. 유형자산처럼 같은 표를 「<당기>」와 「<전기>」로 두 벌 두는 주석이 있다. 이월하면
 * **전기 표에는 작년 당기 표의 값**이 들어가야 한다. 행 수와 첫 열 이름이 같을 때만 짝으로 본다 —
 * 모양이 다르면 어느 줄이 어느 줄인지 알 수 없다.
 */
export function pairCurrentTables(note: NoteBlocks): Map<Block, Map<number, string>[]> {
  const out = new Map<Block, Map<number, string>[]>();
  let cur: Block | null = null;
  const key = (b: Block) => (b.kind !== 'table' ? '' : b.rows.map((r) => r[0]?.text.replace(/\s/g, '') ?? '').join('|'));
  for (const b of note.blocks) {
    if (b.kind !== 'table' || b.isUnitMark) continue;
    if (b.period === '당기') { cur = b; continue; }
    if (b.period === '전기' && cur && cur.kind === 'table' && key(cur) === key(b)) {
      out.set(b, cur.rows.map((line) => new Map(line.map((c) => [c.col, c.text]))));
    }
  }
  return out;
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

/**
 * 작년 보고서에 없던 주석 — **빈 서식 한 장.**
 *
 * 주석을 새로 넣는 일은 드물지만, ①에서 목록에 더해 두면 ②가 자리를 만들어 주어야 한다.
 * 그래야 「JAYTAX 에서 범위를 정하고 엑셀을 만든다」가 끝까지 성립한다(사용자 확정 2026-09-13).
 *
 * A열 자리표를 비워 둔다 — **원본에 대응할 자리가 없다는 뜻**이다. DSD 를 만들 때
 * 이 시트는 제자리 치환이 아니라 새로 붙이는 쪽으로 간다.
 */
export function layoutNewNote(no: number | null, title: string, name: string): SheetPlan {
  const head = no != null ? `${no}. ${title}` : title;
  const cells: SheetCell[] = [
    { row: 2, col: 2, text: '주석명', kind: 'label' },
    { row: 2, col: 3, text: head, kind: 'title' },
    { row: 3, col: 2, text: '새 주석', kind: 'label' },
    {
      row: 3, col: 3, kind: 'para',
      text: '작년 보고서에 없던 주석입니다. 노란 칸에 서술을 적고, 표가 필요하면 아래에 만들어 주십시오.',
    },
  ];
  for (let i = 0; i < NEW_NOTE_LINES; i += 1) cells.push({ row: 5 + i, col: 3, text: '', kind: 'input' });
  return { name, cells, merges: [], lastRow: 4 + NEW_NOTE_LINES };
}

/** 빈 주석 시트에 마련해 두는 서술 줄 수. */
export const NEW_NOTE_LINES = 8;

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
