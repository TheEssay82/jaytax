// **같은 해 반기 보고서를 틀로** — 반기 감사(검토)보고서를 그해 기말 보고서 서식으로 바꾼다(사용자 2026-11-28, 인코어 B안).
//
// 인코어는 작년 감사보고서가 없다(설립 이듬해). 대신 올해 반기 감사보고서(제2기 반기)가 있다. 그것을 틀로 쓰되
// 「한 해 밀기」가 아니라 **같은 해 안에서 반기 → 기말**로 바꾼다. 사용자가 정한 규칙:
//
//   자리                    처리
//   기수                    그대로(제2기) — 올리지 않는다
//   머리 말                 당반기(말) → 당기(말) · 전반기 → 전기 · 반기재무상태표 → 재무상태표 · 표지 「반기재무제표에 대한」 → 「재무제표에 대한」
//   날짜                    올해·작년 6월 30일 → 12월 31일(전반기 2025.02.10~06.30 → 2025.02.10~12.31). 2025.12.31 은 그대로
//   당기 칸                 모두 비워 노랗게
//   전기말 칸(잔액 주석·BS) 반기 보고서 값 그대로
//   전반기 칸(PL·흐름 주석) 비우고 정산표 2025 수정후 열에 연결(전반기 값 ↔ 정산표 전반기 열로 줄을 찾는다)
//   「감사받지 아니한」     그대로
//   감사의견 글             손대지 않는다(사람이 고친다) — 긴 글은 건드리지 않는다
//
// 「분ㆍ반기검토」·「반기검토」·「반기보고서」 같은 말은 반기를 뜻하는 이름이라 바꾸지 않는다 — 아래 목록에 있는 말만 바꾼다.
import { slots, unescapeXml, assignGrid, hasInline, type TableCell } from './dsdBlocks';
import { statementsSection } from './fsParse';

/** 붉은 글자(BGR) — dsdRoll.RED 와 같은 값. dsdRoll 을 들이면 noteSheet 와 고리가 생겨 따로 둔다. */
const RED = '0X0000FF';

/** 반기 → 기말 말 바꾸기. 차례가 중요하다(「당반기말」을 「당반기」보다 먼저). */
const WORDS: [RegExp, string][] = [
  [/당\s*반\s*기\s*말/g, '당기말'],
  [/당\s*반\s*기/g, '당기'],
  [/전\s*반\s*기\s*말/g, '전기말'],
  [/전\s*반\s*기/g, '전기'],
  // 「제 2 반기」·「제 1 반 기」·「제 2(당) 반기」 → 「제 2 기」·「제 1 기」·「제 2(당) 기」
  [/(제\s*\d{1,3}\s*(?:\([당전]\))?\s*)반\s*기/g, '$1기'],
  [/반기(순이익|순손실|순손익)/g, '당기$1'],
  [/반기(\s*)중/g, '당기$1중'],
  [/반기(재무|포괄|손익|현금흐름|자본변동)/g, '$1'],
  // 표지·제목은 글자 사이를 띄운다 — 「반 기 재 무 상 태 표」 → 「재 무 상 태 표」
  [/반\s+기\s+(재\s*무|포\s*괄|손\s*익|현\s*금\s*흐\s*름|자\s*본\s*변\s*동)/g, '$1'],
  [/반\s*기\s*(순\s*이\s*익|순\s*손\s*실)/g, '당기$1'],
  [/반기\s*말/g, '기말'],
];

/** 머리·서술의 반기 말을 기말 말로. 날짜는 건드리지 않는다(halfDate). */
export function halfText(text: string): string {
  let t = text ?? '';
  for (const [re, to] of WORDS) t = t.replace(re, to);
  return t;
}

/** 날짜 — 「2026년 06월 30일」·「2026.06.30」·「2026-6-30」. 해·달·날 토막을 따로 잡아 원래 꼴을 지킨다. */
const DATE = /((?:19|20)\d{2})(\s*[년.\-/]\s*)(0?6)(\s*[월.\-/]\s*)(30)(?!\d)/g;

/** 올해·작년 6월 30일 → 12월 31일. 다른 날짜(처분확정일 3월 31일, 상환일 2027.06.30)는 그대로. */
export function halfDate(text: string, fy: number): string {
  return (text ?? '').replace(DATE, (m, y: string, a: string, _mo: string, b: string) =>
    (Number(y) === fy || Number(y) === fy - 1 ? `${y}${a}12${b}31` : m));
}

/** 말과 날짜 둘 다. */
export function halfAll(text: string, fy: number): string {
  return halfDate(halfText(text), fy);
}

/** 이 보고서가 반기 보고서인가 — 표지·재무제표 이름에 「반기재무」가 든다. */
export function isHalfReport(xml: string): boolean {
  return /반\s*기\s*재\s*무\s*(제\s*표|상\s*태\s*표)|반\s*기\s*검\s*토\s*보\s*고\s*서/.test(xml ?? '');
}

/**
 * 표 머리 칸 하나가 어느 기간인가 — 반기 틀에서만 쓴다.
 *   cur     당반기·당반기말·당기·제2(당)반기
 *   flow    전반기·제1(전)반기 — 흐름이라 기말에는 1년 치로 다시 채운다
 *   end     전기말·전기·제1(전)기 — 잔액이라 반기 보고서 값 그대로
 */
export function halfHead(text: string): 'cur' | 'flow' | 'end' | null {
  const t = (text ?? '').replace(/\s/g, '').replace(/&cr;/g, '');
  if (/^(당반기말?|당기말?|당분기말?)$/.test(t) || /^제\d+\(당\)(반기|기)말?/.test(t)) return 'cur';
  if (/^(전반기말?|전분기)$/.test(t) || /^제\d+\(전\)반기/.test(t)) return 'flow';
  if (/^(전기말?)$/.test(t) || /^제\d+\(전\)기/.test(t)) return 'end';
  return null;
}

/** 이 칸이 짧은 머리·이름인가 — 긴 서술(감사의견)은 손대지 않는다. */
const SHORT = 60;

function numAttr(attrs: string, name: string): number | null {
  const m = new RegExp(`${name}="(-?\\d+)"`, 'i').exec(attrs ?? '');
  return m ? Number(m[1]) : null;
}

export interface HalfResult {
  xml: string;
  /** 말·날짜를 바꾼 칸 수 */ terms: number;
  /** 비운 재무제표 금액 칸 수 */ amounts: number;
  /** 손대지 않았으니 사람이 봐야 할 곳 */ leftovers: { text: string; why: string }[];
}

/**
 * 재무제표·표지·감사보고서 머리를 반기 → 기말로. `skip` 에는 ④ 가 엑셀 값으로 갈아끼울 주석 자리를 넣는다.
 *
 * 금액: 당기 열은 비운다. 전기 열은 머리가 「(전) 반기」(손익·현금흐름)면 비우고, 「(전) 기」(재무상태표)면 그대로 둔다.
 * 자본변동표처럼 기간이 열로 갈리지 않는 표는 손대지 않는다.
 */
export function halfStatements(xml: string, fy: number, skip?: Set<number>, mark = false): HalfResult {
  const s = xml ?? '';
  const edits: { start: number; end: number; raw: string }[] = [];
  const leftovers: { text: string; why: string }[] = [];
  let terms = 0;

  slots(s).forEach((sl, i) => {
    // 주석 자리는 ④ 가 엑셀 값으로 갈아끼운다. 다만 글꼴·색 태그가 섞인 문단은 ④ 가 손대지 않으므로 여기서 말만 바꾼다.
    const noteInline = !!skip?.has(i) && hasInline(sl.raw);
    if (skip?.has(i) && !noteInline) return;
    const t = unescapeXml(sl.raw);
    if (!/반\s*기|(?:19|20)\d{2}/.test(t)) return;
    // 원문(XML) 그대로 바꾼다 — 바꾸는 말에는 & < > 가 없고, 칸 안의 꾸밈 태그(SPAN)를 살린다.
    const next = noteInline || t.trim().length <= SHORT ? halfAll(sl.raw, fy) : sl.raw;
    if (next === sl.raw) {
      if (t.trim().length > SHORT && /반\s*기\s*(재무|순이익|말|중)|당\s*반\s*기/.test(t) && leftovers.length < 40) {
        leftovers.push({ text: t.trim().slice(0, 60), why: '긴 글(감사의견 등)이라 손대지 않았습니다' });
      }
      return;
    }
    edits.push({ start: sl.start, end: sl.end, raw: next });
    const tag = openTag(s, sl.start, fy, mark);
    if (tag) edits.push(tag);
    terms += 1;
  });

  // 재무제표 이름은 `<TITLE>` 에 있다(「반 기 재 무 상 태 표」) — slots 가 집지 않는다.
  for (const m of s.matchAll(/<TITLE\b[^>]*>([^<]*)<\/TITLE>/g)) {
    const body = m[1];
    const next = body.trim().length <= SHORT ? halfAll(body, fy) : body;
    if (next === body) continue;
    const start = m.index! + m[0].length - body.length - '</TITLE>'.length;
    edits.push({ start, end: start + body.length, raw: next });
    terms += 1;
  }

  const sec = statementsSection(s);
  let amounts = 0;
  if (sec) {
    for (const tm of sec.text.matchAll(/<TABLE\b[\s\S]*?<\/TABLE>/g)) {
      const tbl = tm[0];
      if (!/<TE\b/.test(tbl)) continue;
      const base = sec.at + tm.index!;
      const blank: number[] = [];
      let hasCur = false;
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
          const k = halfHead(c.text);
          if (k === 'cur') hasCur = true;
          if (k === 'cur' || k === 'flow') for (let j = 0; j < c.colspan; j += 1) blank.push(c.col + j);
        }
      }
      if (!hasCur) {
        leftovers.push({ text: (tbl.match(/<TE[^>]*>([^<]{1,20})/)?.[1] ?? '표').trim(), why: '당기·전기가 열로 나뉘지 않아 금액은 손대지 않았습니다' });
      }
      // 금액은 기간이 열로 갈린 표만 비운다. 과목 칸의 말·날짜는 어느 표든 바꾼다(자본변동표 「2026.06.30 (당반기말)」).
      const set = new Set(hasCur ? blank : []);
      for (const rm of tbl.matchAll(/<TR\b[\s\S]*?<\/TR>/g)) {
        const at = base + rm.index!;
        let n = 0;
        for (const m of rm[0].matchAll(/<TE\b([^>]*)>([\s\S]*?)<\/TE>/g)) {
          const col = numAttr(m[1], 'ADELIM') ?? n;
          n += 1;
          const body = m[2];
          if (!body.trim()) continue;
          const start = at + m.index! + m[0].length - body.length - '</TE>'.length;
          if (!set.has(col)) {
            // 과목 칸 — 「Ⅹ.반기순이익」·「2026.06.30 (당반기말)」. TE 는 slots 가 집지 않아 여기서 바꾼다.
            const next = unescapeXml(body).trim().length <= SHORT ? halfAll(body, fy) : body;
            if (next !== body) { edits.push({ start, end: start + body.length, raw: next }); terms += 1; }
            continue;
          }
          edits.push({ start, end: start + body.length, raw: '' });
          amounts += 1;
        }
      }
    }
  }

  edits.sort((a, b) => b.start - a.start);
  let out = s;
  for (const e of edits) out = out.slice(0, e.start) + e.raw + out.slice(e.end);
  return { xml: out, terms, amounts, leftovers };
}

/**
 * 글자칸의 여는 태그 — 짝인 날짜 속성(AUNITVALUE="20260630")도 12월 31일로, 표시하라면 붉게.
 * DSD 는 기간을 글자와 속성 두 곳에 적는다 — 하나만 바꾸면 편집기가 문서를 열지 못한다(dsdRoll.fixOpenTag 참고).
 */
function openTag(xml: string, contentStart: number, fy: number, mark: boolean): { start: number; end: number; raw: string } | null {
  if (contentStart <= 0 || xml[contentStart - 1] !== '>') return null;
  const lt = xml.lastIndexOf('<', contentStart - 1);
  if (lt < 0) return null;
  const open = xml.slice(lt, contentStart);
  if (!/^<[A-Z][A-Z0-9-]*[\s>/]/.test(open)) return null;
  let next = open.replace(/AUNITVALUE="((?:19|20)\d{2})0630"/g, (m, y: string) =>
    (Number(y) === fy || Number(y) === fy - 1 ? `AUNITVALUE="${y}1231"` : m));
  if (mark) {
    const has = /USERMARK="([^"]*)"/.exec(next);
    if (has) {
      if (!has[1].split(/\s+/).includes(RED)) next = next.replace(/USERMARK="([^"]*)"/, (_m, v: string) => `USERMARK="${v.trim()} ${RED}"`);
    } else {
      next = next.replace(/^<([A-Z][A-Z0-9-]*)/, (_m, t: string) => `<${t} USERMARK="${RED}"`);
    }
  }
  return next === open ? null : { start: lt, end: contentStart, raw: next };
}
