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
import type { NoteBlocks } from './dsdBlocks';

/** 어떤 서식으로 그릴 칸인가 — xlsxStyles 의 이름과 같다. */
export type CellKind = 'label' | 'title' | 'para' | 'head' | 'text' | 'num';

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
export function layoutNote(note: NoteBlocks, name: string): SheetPlan {
  const cells: SheetCell[] = [
    { row: 2, col: 2, text: '주석명', kind: 'label' },
    { row: 2, col: 3, text: `${note.no}. ${note.title}`, kind: 'title' },
  ];
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
    } else {
      r += 1;                                          // 표 앞에 빈 줄
      const blankRow = r - 1;
      // **어느 열이 숫자 열인가**를 먼저 본다. 그 열의 「-」는 0 으로 넣어야 합계가 잡힌다.
      // 글자 열의 「-」까지 0 으로 바꾸면 구분 이름이 숫자가 되어 버린다.
      const numericCol: number[] = [];
      for (const line of b.rows) {
        if (line.every((c) => c.tag === 'TH')) continue;
        line.forEach((c, j) => {
          if (asNumber(c.text) != null && !numericCol.includes(j)) numericCol.push(j);
        });
      }
      numericCol.sort((a, x) => a - x);

      const factor = b.isUnitMark ? null : unitFactor(b.unit);
      const dual = factor != null && numericCol.length > 0;
      const width = Math.max(...b.rows.map((x) => x.length), 1);
      const srcBase = 3 + width + 1;                   // 표 오른쪽에 한 칸 띄운다
      const diffCol = srcBase + numericCol.length + 1;

      // 몇 번째 엑셀 행에 놓이는지 미리 정해 둔다 — 합계 수식이 범위를 알아야 한다.
      const rowNo = b.rows.map((_, i) => r + i);
      const isHeadRow = b.rows.map((line) => line.length > 0 && line.every((c) => c.tag === 'TH'));
      const bodyIdx = b.rows.map((_, i) => i).filter((i) => !isHeadRow[i]);
      const totalIdx = bodyIdx.filter((i) => isTotalLabel(b.rows[i][0]?.text ?? ''));
      // 합계가 하나뿐이고 위에 항목이 둘 이상일 때만 SUM 으로 묶는다.
      // 여럿이면(소계+합계 등) 구간이 애매해 잘못 걸 수 있으니 손대지 않는다.
      const sumAt = totalIdx.length === 1 ? totalIdx[0] : -1;
      const items = sumAt >= 0 ? bodyIdx.filter((i) => i < sumAt) : [];
      const canSum = items.length >= 2;

      if (dual) {
        cells.push({ row: blankRow, col: srcBase, text: '원 단위 (입력)', kind: 'label' });
      }

      b.rows.forEach((line, i) => {
        const head = isHeadRow[i];
        cells.push({ row: rowNo[i], col: 1, text: line.map((c) => addrOf(c.slot)).join(' ') });
        line.forEach((c, j) => {
          // 「-」는 재무제표에서 0 이다. 숫자 0 으로 넣고 화면에는 숫자꼴이 「-」로 보여 준다
          // (#,##0;(#,##0);"-"). 글자로 두면 합계·검증식이 안 잡힌다(2026-09-13 지적).
          const num = !head && numericCol.includes(j) && isDash(c.text) ? 0 : asNumber(c.text);
          const cell: SheetCell = {
            row: rowNo[i], col: 3 + j, text: c.text, num,
            kind: head ? 'head' : num != null ? 'num' : 'text',
          };
          if (!head && num != null && dual) {
            const k = numericCol.indexOf(j);
            const src = `${colName(srcBase + k)}${rowNo[i]}`;
            // 합계 행은 **표시값끼리 더한다**(㉮) — 보는 사람이 더해서 맞아야 한다.
            // 원 합계를 반올림한 값(㉯)과의 차이는 옆에 「단수차이」로 따로 보여 준다.
            cell.formula = canSum && i === sumAt
              ? `SUM(${colName(3 + j)}${rowNo[items[0]]}:${colName(3 + j)}${rowNo[items[items.length - 1]]})`
              : `ROUND(${src}/${factor},0)`;
            delete cell.num;
          }
          cells.push(cell);
        });

        // ── 오른쪽 원 단위 블록 ────────────────────────────────
        if (!dual) return;
        numericCol.forEach((j, k) => {
          const col = srcBase + k;
          if (head) {
            cells.push({ row: rowNo[i], col, text: line[j]?.text ?? '', kind: 'head' });
            return;
          }
          const num = asNumber(line[j]?.text ?? '') ?? (isDash(line[j]?.text ?? '') ? 0 : undefined);
          if (num == null) return;
          const cell: SheetCell = { row: rowNo[i], col, text: '', num: num * factor, kind: 'num' };
          if (canSum && i === sumAt) {
            cell.formula = `SUM(${colName(col)}${rowNo[items[0]]}:${colName(col)}${rowNo[items[items.length - 1]]})`;
            delete cell.num;
          }
          cells.push(cell);
        });
      });

      // ── 단수차이 — 원 합계를 반올림한 값(㉯)과 표시 합계(㉮)의 차이 ──
      if (dual && canSum) {
        const headRow = isHeadRow.indexOf(true);
        if (headRow >= 0) cells.push({ row: rowNo[headRow], col: diffCol, text: '단수차이', kind: 'head' });
        numericCol.forEach((j, k) => {
          const src = colName(srcBase + k);
          const show = colName(3 + j);
          cells.push({
            row: rowNo[sumAt], col: diffCol + k, text: '', kind: 'num',
            formula: `ROUND(${src}${rowNo[sumAt]}/${factor},0)-${show}${rowNo[sumAt]}`,
          });
        });
      }

      r += b.rows.length;
      prevWasTable = true;
    }
  }
  return { name, cells, lastRow: Math.max(2, r - 1) };
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
