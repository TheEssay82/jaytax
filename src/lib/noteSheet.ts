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

export interface SheetCell {
  /** 1부터 */ row: number;
  /** 1=A, 2=B, 3=C … */ col: number;
  text: string;
  /** 숫자로 넣을 값. 없으면 글자로 넣는다. */ num?: number;
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
    { row: 2, col: 2, text: '주석명' },
    { row: 2, col: 3, text: `${note.no}. ${note.title}` },
  ];
  let r = 3;
  let prevWasTable = false;

  for (const b of note.blocks) {
    if (b.kind === 'para') {
      if (prevWasTable) r += 1;                       // 표 뒤에는 한 줄 띄운다
      b.parts.forEach((p, i) => {
        cells.push({ row: r, col: 1, text: addrOf(b.slot, b.parts.length > 1 ? i : undefined) });
        cells.push({ row: r, col: 3, text: p });
        r += 1;
      });
      prevWasTable = false;
    } else {
      r += 1;                                          // 표 앞에 빈 줄
      for (const line of b.rows) {
        cells.push({ row: r, col: 1, text: line.map((c) => addrOf(c.slot)).join(' ') });
        line.forEach((c, j) => {
          const num = asNumber(c.text);
          cells.push({ row: r, col: 3 + j, text: c.text, num });
        });
        r += 1;
      }
      prevWasTable = true;
    }
  }
  return { name, cells, lastRow: Math.max(2, r - 1) };
}

/** 주석 목록 시트 — 정산표가 이미 쓰던 「주석번호 · 주석제목 · 사용여부」 그대로. */
export function layoutIndex(rows: { no: number | null; title: string; enabled: boolean; sheet: string }[]): SheetPlan {
  const cells: SheetCell[] = [
    { row: 2, col: 2, text: '주석번호' },
    { row: 2, col: 3, text: '주석제목' },
    { row: 2, col: 4, text: '사용여부' },
    { row: 2, col: 5, text: '시트' },
  ];
  rows.forEach((x, i) => {
    const r = 3 + i;
    if (x.no != null) cells.push({ row: r, col: 2, text: String(x.no), num: x.no });
    cells.push({ row: r, col: 3, text: x.title });
    cells.push({ row: r, col: 4, text: x.enabled ? 'O' : 'X' });
    cells.push({ row: r, col: 5, text: x.sheet });
  });
  return { name: '주석목록(생성)', cells, lastRow: 2 + rows.length };
}
