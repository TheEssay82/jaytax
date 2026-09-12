// DSD 본문(contents.xml)에서 **주석 목록을 읽어내는 규칙**. 압축 해제는 dsdFile.ts 가 한다.
//
// DSD 는 확장자만 다를 뿐 ZIP 이고, 안에 contents.xml 한 장이 들어 있다. 본문은 DART4 XML 인데
// 문단은 <P>, 표는 <TABLE><TR><TD> 로 HTML 과 거의 같은 모양이다. **회사가 달라져도 문법이
// 같다** — ㈜넵튠(K-IFRS·상장)용으로 만든 이 규칙을 명진산업개발(일반기업회계기준·비상장)에
// 한 줄도 고치지 않고 돌려 주석 18개를 전부 잡았다(2026-09-12).
//
// 여기서는 ①에 필요한 것만 읽는다 — **주석 번호와 제목.** 표와 값을 읽는 일은 ②·③의 몫이다.

/** 태그를 걷어내고 공백을 정리한다. */
export function plain(s: string): string {
  const t = (s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;cr;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * 주석 절만 잘라낸다 — 「주석」이라는 제목 다음부터 그 다음 제목 앞까지.
 *
 * 감사보고서 한 부에는 목차·감사의견·재무제표·주석·외부감사 실시내용이 함께 들어 있다.
 * 주석 밖의 표까지 읽으면 재무제표 본문이 주석으로 섞인다.
 */
export function notesSection(xml: string): string {
  const head = /<TITLE\b[^>]*>\s*주\s*석\s*<\/TITLE>/.exec(xml ?? '');
  if (!head) return '';
  const rest = (xml ?? '').slice(head.index + head[0].length);
  const next = /<TITLE\b[^>]*>/.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/** 표 **밖**의 문단만. 표 안의 글은 주석 제목이 아니다. */
export function outerParagraphs(section: string): string[] {
  const s = section ?? '';
  const tables: [number, number][] = [];
  for (const m of s.matchAll(/<TABLE\b[\s\S]*?<\/TABLE>/g)) {
    tables.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  }
  const inTable = (i: number) => tables.some(([a, b]) => a <= i && i < b);
  const out: string[] = [];
  for (const m of s.matchAll(/<P\b[^>]*>([\s\S]*?)<\/P>/g)) {
    if (inTable(m.index ?? 0)) continue;
    const t = plain(m[1]);
    if (t) out.push(t);
  }
  return out;
}

export interface ParsedNote { no: number; title: string }

/**
 * 「1. 회사의 개요」처럼 번호로 시작하는 문단을 주석의 머리로 본다.
 *
 * 두 가지를 조심한다.
 *  · **제목과 본문이 한 문단에 붙어 있는 경우가 있다** — 명진 파일의 「3. 유의적인 회계정책
 *    당사가 일반기업회계기준에 따라…」가 그랬다. 길이로 자르면 이런 것이 통째로 빠진다.
 *  · 본문 속의 「(1) 현금및현금성자산」이나 「2.2 측정기준」 같은 것을 주석으로 오인하면 안 된다.
 *
 * 그래서 **번호가 차례로 올라갈 때만** 주석의 시작으로 본다(앞 번호보다 크고 네 칸 안).
 * 이 규칙으로 명진 FY25 에서 1번부터 18번까지 전부 잡혔다.
 */
export function noteHeadings(paras: string[]): ParsedNote[] {
  const HEAD = /^\s*(\d{1,2})\s*\.\s*(\S[\s\S]*)$/;
  const out: ParsedNote[] = [];
  let last = 0;
  for (const p of paras) {
    const m = HEAD.exec(p);
    if (!m) continue;
    const no = Number(m[1]);
    // 첫 머리는 그대로 받는다(보통 1번이지만, 1번을 놓쳤어도 거기서부터 이어 세면 된다).
    // 그 뒤로는 **차례로 올라갈 때만** — 본문 속 「2.2 측정기준」·「(1) 현금및현금성자산」을
    // 주석으로 오인하지 않으려는 것이다.
    if (last === 0 ? no < 1 : (no <= last || no > last + 4)) continue;
    const title = cutTitle(m[2]);
    if (!title) continue;
    last = no;
    out.push({ no, title });
  }
  return out;
}

/**
 * 제목과 본문이 한 문단에 붙어 있을 때 **제목만 뗀다.**
 *
 * 실물에서 이런 것들이 나왔다(2026-09-12):
 *   「사용이 제한된 예금 등 보고기간종료일 현재 …」 · 「재고자산 (1) 보고기간종료일 …」
 *   「유형자산 기중 유형자산의 변동내역은 …」 · 「특수관계자 거래 2025년 7월 9일자로 …」
 * 본문이 시작되는 자리에는 대개 같은 말머리가 온다 — 그 앞에서 끊는다.
 * 어디서도 못 끊으면 40자에서 자른다. **제목은 화면에서 고칠 수 있으니 완벽할 필요는 없다.**
 */
export function cutTitle(rest: string): string {
  const s = (rest ?? '').trim();
  const marks = [
    /\s{2,}/,                                   // 공백 두 칸 이상
    /\s*[(（](?:\d+|\*|주)/,                     // (1) · (*) · (주)
    /\s*[①-⑳]/,
    /\s\d+\.\d/,                                // 4.1 같은 하위 절
    /\s(?:당사|회사|보고기간|당기|전기|상기|기중|기말|기초|다음[과은의]|아래[와는]|\d{4}년)/,
  ];
  let cut = s.length;
  for (const re of marks) {
    const m = re.exec(s);
    if (m && (m.index ?? 0) > 0) cut = Math.min(cut, m.index);
  }
  let t = s.slice(0, cut).trim();
  if (t.length > 40) t = t.slice(0, 40).replace(/\s+\S*$/, '').trim();
  return t.replace(/[.,\s]+$/, '').trim();
}

/** DSD 본문에서 주석 목록을 읽는다. 못 읽으면 빈 배열 — 지어내지 않는다. */
export function parseNoteList(xml: string): ParsedNote[] {
  return noteHeadings(outerParagraphs(notesSection(xml)));
}

/** 이 파일이 무슨 문서인지 — 감사보고서 / 감사전 재무제표 등. */
export function documentName(xml: string): string {
  return plain(/<DOCUMENT-NAME\b[^>]*>([\s\S]*?)<\/DOCUMENT-NAME>/.exec(xml ?? '')?.[1] ?? '');
}

/** 본문에 박혀 있는 회계기간 — AUNITVALUE 로 구조화돼 있어 그대로 읽힌다. */
export function documentPeriod(xml: string): { from: string; to: string } | null {
  const pick = (unit: string) =>
    new RegExp(`AUNIT="${unit}"\\s+AUNITVALUE="(\\d{8})"`).exec(xml ?? '')?.[1] ?? '';
  const f = pick('PERIODFROM2') || pick('PERIODFROM');
  const t = pick('PERIODTO2') || pick('PERIODTO');
  const fmt = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return f && t ? { from: fmt(f), to: fmt(t) } : null;
}
