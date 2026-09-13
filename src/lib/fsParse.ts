// DSD 안의 **재무제표**를 읽는다 — 주석과 대 보기 위해서다.
//
// 재무제표를 적는 꼴이 두 가지다(2026-09-13 실물 확인).
//
// **가. 편집기 서식** — 명진·알티스트. 칸이 `<TE>` 고 여기에 셋이 적혀 있다.
//     ACODE   표준계정코드 — 「111150」 매출채권. 못 정한 계정은 999999999999.
//     ADELIM  **격자 열 번호** — 0 이 과목이고 1~4 가 금액 칸이다.
//     ALEVEL  들여쓰기 깊이 — 0 이 대분류(I.유동자산), 2 가 개별 계정.
//   주석 번호는 과목 이름 뒤에 붙는다 — 「매출채권<주석 12,18>」.
//
// **나. 손으로 짠 표** — 넵튠. 여느 표와 같은 `<TD>` 고, **「주석」 열을 따로 둔다.**
//     과 목 │ 주석 │ 제11(당)기말 │ 제10(전)기말
//     현금및현금성자산 │ 7 │ 6,987,678,038 │ 23,015,521,988
//
// 어느 꼴이든 **재무제표와 주석을 잇는 끈이 문서 안에 이미 있다.** 사람이 따로 짝지어
// 줄 필요가 없다 — 명진 19곳 · 알티스트 47곳 · 넵튠 은 열 하나로.
import { unescapeXml, assignGrid, type TableCell } from './dsdBlocks';
import { asNumber, periodOfHead } from './noteSheet';

export interface FsLine {
  /** 재무상태표 · 손익계산서 · 자본변동표 · 현금흐름표 */ statement: string;
  /** 주석 표시를 뗀 과목 이름 */ label: string;
  /** 이 과목이 가리키는 주석 번호들 */ notes: number[];
  /** 당기 금액 */ cur?: number;
  /** 전기 금액 */ pri?: number;
  /** 들여쓰기 깊이 — 0 이 대분류. 손으로 짠 표는 모두 0 이다. */ level: number;
  /** 과목 글자가 원본 XML 에서 시작하는 자리 — ④ 에서 주석 번호를 고칠 때 쓴다. */ at: number;
}

const NAMES = [
  '재무상태표', '대차대조표', '포괄손익계산서', '손익계산서', '자본변동표', '현금흐름표',
  '이익잉여금처분계산서', '결손금처리계산서',
];

/**
 * 표 앞머리에서 표 이름을 딴다.
 *
 * 편집기 서식은 「◆click◆『재무상태표』 삽입 …」 안내가 앞에 붙고, 손으로 짠 표는
 * 「재 무 상 태 표」 라는 제목 표가 앞에 온다. 공백을 지우고 **가장 뒤에서 끝나는** 이름을
 * 고른다 — 넵튠은 『현금흐름표』 안내 뒤에 재무상태표 제목이 오기 때문이다.
 * 끝이 같으면 긴 이름을 고른다 — 「포괄손익계산서」 안에 「손익계산서」가 들어 있다.
 */
export function statementName(before: string): string | null {
  const flat = (before ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, '');
  let hit: { name: string; end: number } | null = null;
  for (const n of NAMES) {
    const at = flat.lastIndexOf(n);
    if (at < 0) continue;
    const end = at + n.length;
    if (!hit || end > hit.end || (end === hit.end && n.length > hit.name.length)) hit = { name: n, end };
  }
  return hit?.name ?? null;
}

/** 「매출채권<주석 12,18>」 → 이름과 번호로 가른다. */
export function noteRefs(label: string): { label: string; notes: number[] } {
  const notes: number[] = [];
  const plain = (label ?? '').replace(/[<〈(［[]\s*주\s*석\s*([\d,\s]+)[>〉)］\]]/g, (_, list: string) => {
    addNotes(notes, list);
    return '';
  });
  return { label: plain.replace(/\s+/g, ' ').trim(), notes };
}

function addNotes(into: number[], list: string): void {
  for (const n of (list ?? '').split(/[,·]/)) {
    const v = Number(n.trim());
    if (Number.isInteger(v) && v > 0 && v < 100 && !into.includes(v)) into.push(v);
  }
}

function numAttr(attrs: string, name: string): number | null {
  const m = new RegExp(`${name}="(-?\\d+)"`, 'i').exec(attrs ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * 재무제표 절 — 「재 무 제 표」가 머리에 있는 SECTION-1.
 *
 * 끝은 **다음 절이 시작하는 자리**다. SECTION-1 만 보고 자르면 그 사이에 낀 SECTION-2(주석)를
 * 통째로 물고 온다 — 명진에서 주석 표 26장이 재무제표로 잡혔다(2026-09-13).
 */
export function statementsSection(xml: string): { text: string; at: number } | null {
  const s = xml ?? '';
  const all = [...s.matchAll(/<SECTION-[12]\b[^>]*>/g)];
  for (let i = 0; i < all.length; i += 1) {
    if (!/<SECTION-1\b/.test(all[i][0])) continue;
    const a = all[i].index! + all[i][0].length;
    const b = i + 1 < all.length ? all[i + 1].index! : s.length;
    if (/재\s*무\s*제\s*표/.test(s.slice(a, a + 400))) return { text: s.slice(a, b), at: a };
  }
  return null;
}

interface Cell { col: number; colspan: number; text: string; level: number; at: number; tag: string }

/** 한 줄의 칸들 — TE 면 ADELIM 이 곧 열 번호고, TD·TH 면 격자를 펼쳐 매긴다. */
function readRow(tr: string, base: number): Cell[] {
  const out: Cell[] = [];
  for (const m of tr.matchAll(/<(TE|TD|TH)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const body = m[3];
    out.push({
      tag: m[1],
      col: m[1] === 'TE' ? (numAttr(m[2], 'ADELIM') ?? out.length) : 0,
      colspan: numAttr(m[2], 'COLSPAN') ?? 1,
      text: unescapeXml(body.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(),
      level: numAttr(m[2], 'ALEVEL') ?? 0,
      at: base + m.index! + m[0].length - body.length - `</${m[1]}>`.length,
    });
  }
  if (out.length && out[0].tag !== 'TE') {
    const grid: TableCell[] = out.map((c) => ({
      slot: -1, text: c.text, tag: c.tag, col: 0, colspan: c.colspan, rowspan: 1,
    }));
    assignGrid([grid]);
    out.forEach((c, i) => { c.col = grid[i].col; });
  }
  return out;
}

/** 재무제표를 줄 단위로 읽는다. */
export function parseStatements(xml: string): FsLine[] {
  const sec = statementsSection(xml ?? '');
  if (!sec) return [];
  const out: FsLine[] = [];

  for (const tm of sec.text.matchAll(/<TABLE\b[\s\S]*?<\/TABLE>/g)) {
    const tbl = tm[0];
    const tblAt = sec.at + tm.index!;
    const trs = [...tbl.matchAll(/<TR\b[\s\S]*?<\/TR>/g)];
    if (trs.length < 4) continue;                    // 표지·제목 표는 줄이 짧다
    const name = statementName(sec.text.slice(Math.max(0, tm.index! - 2000), tm.index!)) ?? '재무제표';

    const rows = trs.map((r) => readRow(r[0], tblAt + r.index!));
    const isTe = rows.some((r) => r.some((c) => c.tag === 'TE'));

    // ── 어느 열이 당기·전기·주석인가 — 머리행에서 딴다 ──────────
    const cur = new Set<number>();
    const pri = new Set<number>();
    let noteCol = -1;
    for (const line of rows) {
      if (!line.length || line.some((c) => c.tag !== 'TH')) continue;
      for (const c of line) {
        if (/^주\s*석$/.test(c.text)) { noteCol = c.col; continue; }
        const p = periodOfHead(c.text);
        if (!p) continue;
        for (let k = 0; k < c.colspan; k += 1) (p === '당기' ? cur : pri).add(c.col + k);
      }
      break;
    }
    if (isTe && !cur.size) { cur.add(1); cur.add(2); pri.add(3); pri.add(4); }
    if (!cur.size) continue;                         // 기간 열이 없으면 재무제표 표가 아니다

    for (const line of rows) {
      if (!line.length || line.every((c) => c.tag === 'TH')) continue;
      const head = line.find((c) => c.col === 0);
      if (!head || !head.text || head.text === '·') continue;
      const { label, notes } = noteRefs(head.text);
      if (!label) continue;
      if (noteCol >= 0) {
        const nc = line.find((c) => c.col === noteCol);
        if (nc) addNotes(notes, nc.text);
      }
      const pick = (want: Set<number>) => {
        for (const c of line) {
          if (!want.has(c.col)) continue;
          const n = asNumber(c.text);
          if (n != null) return n;
        }
        return undefined;
      };
      out.push({
        statement: name, label, notes, level: head.level,
        cur: pick(cur), pri: pick(pri), at: head.at,
      });
    }
  }
  return out;
}
