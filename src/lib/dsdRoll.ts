// 재무제표와 표지를 **다음 해로 민다** — 기수·연도를 올리고 금액을 전기로 내린다.
//
// 주석은 ② 가 엑셀에서 이월해 ④ 가 갈아끼운다. 그런데 재무제표와 표지는 엑셀에 올리지
// 않으므로 손대지 않았고, 그래서 「제 18(당) 기 2025년」이 그대로 남았다(사용자 지적 2026-09-13).
//
// **본문 속 연도는 절대 건드리지 않는다.** 「2015년의 증자를 거쳐」를 2016년으로 바꾸면
// 보고서를 망친다. 그래서 **칸 전체가 기수·날짜뿐인 것**만 민다 — 토큰을 빼고 남는 글자가
// 몇 자 안 될 때다. 실측으로 정형과 서술이 깨끗하게 갈렸다(명진 35:5 · 알티스트 62:11).
import { slots, unescapeXml, escapeXml, assignGrid, type TableCell } from './dsdBlocks';
import { statementsSection } from './fsParse';
import { periodOfHead, bumpTerm, TERM_RE } from './noteSheet';

/** 기수·연도·날짜 토큰 — 이것만 밀고 나머지 글자는 손대지 않는다. */
const TERM = TERM_RE;
const YMD = /((?:19|20)\d{2})(\s*[년.\-/]\s*\d{1,2}\s*[월.\-/]\s*\d{1,2}\s*[일]?)/g;
const YEAR = /((?:19|20)\d{2})(\s*년)/g;

/** 토큰을 뺀 나머지 글자 — 짧으면 「정형」이다. */
export function restOf(text: string): string {
  return (text ?? '')
    .replace(TERM, '').replace(YMD, '').replace(YEAR, '')
    .replace(/[\s()（）[\]<>「」·~∼-]/g, '')
    .replace(/현재|부터|까지|당기초|당기말|전기초|전기말|당기|전기|기초|기말/g, '');
}

/**
 * 이 칸이 기수·날짜뿐인가 — 밀어도 되는 자리인가.
 *
 * `g` 플래그가 붙은 정규식으로 `test` 를 부르면 `lastIndex` 가 남아 **다음 칸을 건너뛴다.**
 * 명진에서 「제 18(당) 기」 한 칸이 그렇게 안 밀렸다(2026-09-13). 여기서는 `g` 없는 사본을 쓴다.
 */
const HAS_TERM = /제\s*\d{1,3}\s*(?:\([당전]\))?\s*기/;
const HAS_YEAR = /(?:19|20)\d{2}/;
export function isTidyTerm(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  if (!HAS_TERM.test(t) && !HAS_YEAR.test(t)) return false;
  return restOf(t).length <= 6;
}

/**
 * 기수와 연도를 한 해 올린다.
 *
 * 연도는 **네 자리 수 하나당 한 번만** 민다. 「2025년 12월 31일」을 날짜 규칙으로 밀고 연도
 * 규칙으로 또 밀면 2027년이 된다(2026-09-13). 뒤에 「년·.·-·/」가 오는 네 자리만 잡는다.
 * 기수는 주석 쪽과 **같은 규칙**을 쓴다(noteSheet.bumpTerm) — 두 벌이면 어긋난다.
 */
const YEARISH = /(?:19|20)\d{2}(?=\s*[년.\-/])/g;
export function bumpTermText(text: string, by = 1): string {
  return bumpTerm(text ?? '', by).replace(YEARISH, (y) => String(Number(y) + by));
}

function numAttr(attrs: string, name: string): number | null {
  const m = new RegExp(`${name}="(-?\\d+)"`, 'i').exec(attrs ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * 글자에 색을 입히는 DSD 문법.
 *
 * `USERMARK` 이 서식 지시자다 — 실물에서 `0X0000FF`(파랑) · `0X9D3272`(자주) · `B`(굵게) ·
 * `BC0XDCDCDC`(배경) 가 쓰이고 있었다(넵튠 2026-09-13 실측). 공백으로 이어 붙일 수도 있다.
 * 그래서 붉은 글자는 `0XFF0000` 이다.
 */
export const RED = '0XFF0000';
export function paint(raw: string, mark = RED): string {
  return `<SPAN USERMARK="${mark}">${raw}</SPAN>`;
}

export interface RollResult {
  xml: string;
  /** 기수·연도를 민 칸 수 */ terms: number;
  /** 금액을 전기로 내린 칸 수 */ amounts: number;
  /** 손대지 않았으니 사람이 봐야 할 곳 */ leftovers: { text: string; why: string }[];
}

/**
 * 재무제표·표지를 다음 해로 민다.
 *
 * `skip` 에는 **④ 가 엑셀 값으로 갈아끼울 자리**를 넣는다. 거기는 ② 가 이미 한 해 밀어
 * 두었으므로 여기서 또 밀면 두 해가 밀린다. 반대로 주석 절이라도 ④ 가 손대지 않는 곳
 * (주석 머리의 「제 18(당) 기 2025년 …」 기간 표)은 여기서 밀어야 한다.
 */
export function rollStatements(xml: string, by = 1, skip?: Set<number>, mark = false): RollResult {
  const s = xml ?? '';

  const edits: { start: number; end: number; raw: string }[] = [];
  const leftovers: { text: string; why: string }[] = [];
  let terms = 0;

  // ── ① 기수·연도 ────────────────────────────────────────────
  const all = slots(s);
  all.forEach((sl, i) => {
    if (skip?.has(i)) return;
    const t = unescapeXml(sl.raw).trim();
    if (!HAS_TERM.test(t) && !HAS_YEAR.test(t)) return;
    if (!isTidyTerm(t)) {
      if (leftovers.length < 40) leftovers.push({ text: t.slice(0, 60), why: '서술이라 손대지 않았습니다' });
      return;
    }
    const next = bumpTermText(t, by);
    if (next === t) return;
    const head = /^\s*/.exec(sl.raw)![0];
    const tail = /\s*$/.exec(sl.raw)![0];
    // 민 자리를 붉게 — 감사 나가기 전에 만든 서식에서 **무엇이 바뀌었는지** 바로 보인다.
    const body = mark ? paint(escapeXml(next)) : escapeXml(next);
    edits.push({ start: sl.start, end: sl.end, raw: head + body + tail });
    terms += 1;
  });

  // ── ② 재무제표 금액 — 당기를 전기로 내리고 당기는 비운다 ────
  const sec = statementsSection(s);
  let amounts = 0;
  if (sec) {
    for (const tm of sec.text.matchAll(/<TABLE\b[\s\S]*?<\/TABLE>/g)) {
      const tbl = tm[0];
      if (!/<TE\b/.test(tbl)) continue;
      const base = sec.at + tm.index!;

      // 머리행에서 당기·전기 열을 딴다
      const cur: number[] = [];
      const pri: number[] = [];
      const headTr = /<TR\b[\s\S]*?<\/TR>/.exec(tbl);
      if (headTr && /<TH\b/.test(headTr[0])) {
        const cells: TableCell[] = [];
        for (const m of headTr[0].matchAll(/<TH\b([^>]*)>([\s\S]*?)<\/TH>/g)) {
          cells.push({
            slot: -1, text: unescapeXml(m[2].replace(/<[^>]+>/g, '')).trim(), tag: 'TH',
            col: 0, colspan: numAttr(m[1], 'COLSPAN') ?? 1, rowspan: 1,
          });
        }
        assignGrid([cells]);
        for (const c of cells) {
          const p = periodOfHead(c.text);
          if (!p) continue;
          for (let k = 0; k < c.colspan; k += 1) (p === '당기' ? cur : pri).push(c.col + k);
        }
      }
      cur.sort((a, b) => a - b);
      pri.sort((a, b) => a - b);
      if (cur.length === 0 || cur.length !== pri.length) {
        // 자본변동표처럼 당기·전기가 열로 갈리지 않는 표는 손대지 않는다.
        leftovers.push({ text: (tbl.match(/<TE[^>]*>([^<]{1,20})/)?.[1] ?? '표').trim(), why: '당기·전기가 열로 나뉘지 않아 손대지 않았습니다' });
        continue;
      }

      for (const rm of tbl.matchAll(/<TR\b[\s\S]*?<\/TR>/g)) {
        const at = base + rm.index!;
        const cells: { col: number; raw: string; start: number; end: number }[] = [];
        for (const m of rm[0].matchAll(/<TE\b([^>]*)>([\s\S]*?)<\/TE>/g)) {
          const body = m[2];
          const start = at + m.index! + m[0].length - body.length - '</TE>'.length;
          cells.push({ col: numAttr(m[1], 'ADELIM') ?? cells.length, raw: body, start, end: start + body.length });
        }
        const by2 = new Map(cells.map((c) => [c.col, c]));
        cur.forEach((c, i) => {
          const from = by2.get(c);
          const to = by2.get(pri[i]);
          if (!from || !to) return;
          if (to.raw !== from.raw) { edits.push({ start: to.start, end: to.end, raw: from.raw }); amounts += 1; }
          if (from.raw.trim()) { edits.push({ start: from.start, end: from.end, raw: '' }); amounts += 1; }
        });
      }
    }
  }

  edits.sort((a, b) => b.start - a.start);
  let out = s;
  for (const e of edits) out = out.slice(0, e.start) + e.raw + out.slice(e.end);
  return { xml: out, terms, amounts, leftovers };
}
