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
 * `USERMARK` 이 서식 지시자다 — 실물에서 `0X0000FF` · `0X9D3272` · `B`(굵게) ·
 * `BC0XDCDCDC`(배경) 가 쓰이고, 공백으로 이어 붙인 것도 있다(`F-BT12 B 0X000000`).
 *
 * **색은 RGB 가 아니라 BGR 이다**(윈도 COLORREF · `0x00BBGGRR`). `0XFF0000` 을 넣었더니
 * 편집기에서 **파랗게** 나왔다(2026-09-13 실물). 그래서 붉은 글자는 `0X0000FF` 다 —
 * 넵튠 원본의 그 값도 파랑이 아니라 빨강이었다.
 *
 * **새 요소를 만들지 않는다.** 처음에는 `<SPAN>` 으로 감쌌는데 편집기가 문서를 열지 못했다.
 * 원본의 `<SPAN>` 은 **예외 없이 `<P>` 안**에 있는데 우리는 `<TD>` 안에 바로 넣었다.
 * 그래서 **여는 태그에 이미 붙어 있는 USERMARK 에 색을 더하는** 쪽으로 바꿨다 —
 * `<P USERMARK="B">` · `<TD … USERMARK="F-BT14 ">` 가 실물에 있으니 구조가 그대로다.
 */
export const RED = '0X0000FF';

/**
 * 글자칸의 **여는 태그**를 손본다 — 색을 더하고, 짝인 날짜 속성을 함께 민다.
 *
 * DSD 는 기간을 **글자와 속성 두 곳에** 적는다.
 *
 *     <TD AUNIT="PERIODTO" AUNITVALUE="20251231">2025년 12월 31일</TD>
 *
 * 글자만 밀고 속성을 두면 편집기가 **문서를 열지 못한다**(2026-09-13 실물). 밀 때는 둘 다
 * 밀어야 한다. 날짜가 아닌 값(`WON`=1 · `ASK_FIN`=O)은 손대지 않는다.
 *
 * 한 칸에 대해 **고침은 하나만** 만든다 — 여는 태그 범위가 겹치면 깨진다.
 */
export function fixOpenTag(
  xml: string, contentStart: number, opts: { mark?: boolean; by?: number } = {},
): { start: number; end: number; raw: string } | null {
  if (contentStart <= 0 || xml[contentStart - 1] !== '>') return null;
  const lt = xml.lastIndexOf('<', contentStart - 1);
  if (lt < 0) return null;
  const open = xml.slice(lt, contentStart);
  if (!/^<[A-Z][A-Z0-9-]*[\s>/]/.test(open)) return null;

  let next = open;
  const by = opts.by ?? 1;
  // 짝인 날짜 속성 — YYYYMMDD 일 때만
  next = next.replace(/AUNITVALUE="(\d{8})"/g, (_m, v: string) =>
    `AUNITVALUE="${Number(v.slice(0, 4)) + by}${v.slice(4)}"`);

  if (opts.mark) {
    const has = /USERMARK="([^"]*)"/.exec(next);
    if (has) {
      if (!has[1].split(/\s+/).includes(RED)) {
        next = next.replace(/USERMARK="([^"]*)"/, (_m, v: string) => `USERMARK="${v.trim()} ${RED}"`);
      }
    } else {
      next = next.replace(/^<([A-Z][A-Z0-9-]*)/, (_m, t: string) => `<${t} USERMARK="${RED}"`);
    }
  }
  return next === open ? null : { start: lt, end: contentStart, raw: next };
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
    edits.push({ start: sl.start, end: sl.end, raw: head + escapeXml(next) + tail });
    // **짝인 날짜 속성도 함께 민다.** 그리고 민 자리를 붉게 — 무엇이 바뀌었는지 보이게.
    const tag = fixOpenTag(s, sl.start, { mark, by });
    if (tag) edits.push(tag);
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
