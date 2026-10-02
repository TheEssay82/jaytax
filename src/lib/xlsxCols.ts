// 시트에 열을 끼워 넣는다 — 엑셀의 「열 삽입」과 같다. ZIP 안 XML 만 고친다(엑셀 라이브러리 없음).
//
// 정산표 이월(사용자 2026-10-03): WBS·WPL 의 P열(회사제시) 앞에 한 열을 끼워 작년 수정후 금액을 넣는다.
// 엑셀에서 열을 끼우면 **다른 시트의 참조까지** 저절로 밀린다(보고서BS 의 SUMIF(WBS!$S…) → $T). 그것을 똑같이 한다:
//   · 그 시트: 칸 주소, 열 너비·숨김(<cols>), 병합, 조건부 서식·데이터 유효성·하이퍼링크 범위, dimension
//   · 모든 시트의 수식: 그 시트를 가리키는 열 참조(같은 시트면 앞 이름 없이도)
//   · 통합문서의 이름 정의
// 새 열은 밀려난 열(원래 at 열)의 서식을 본뜨고 값은 비운다.
//
// 공유 수식(<f t="shared">)은 먼저 낱 수식으로 푼다 — 주인 칸의 글자를 고치면 딸린 칸이 엉뚱하게 계산되기 때문이다.

export function colNum(c: string): number { let n = 0; for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
export function colName(n: number): string { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

const unq = (s: string) => (s.startsWith("'") ? s.slice(1, -1).replace(/''/g, "'") : s);
const unesc = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * 수식 속 참조마다 fn 을 부른다 — fn(sheet|null, ref) → 새 ref. 글자("…")는 건드리지 않는다.
 * ref 는 「$A$1」「A1:B5」「A:C」 꼴. 함수 이름(LOG10( 등)·이름 정의는 건드리지 않는다.
 */
export function mapRefs(f: string, fn: (sheet: string | null, ref: string) => string): string {
  return f.split(/("(?:[^"]|"")*")/).map((part, i) => (i % 2 ? part : part.replace(
    /(?<![A-Za-z0-9_$.\]])((?:'(?:[^']|'')*'|[A-Za-z0-9_가-힣.]+)!)?(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?|\$?[A-Z]{1,3}:\$?[A-Z]{1,3})(?![A-Za-z0-9_(!])/g,
    (m, sheet: string | undefined, ref: string) => {
      const s = sheet ? unq(sheet.slice(0, -1)) : null;
      const out = fn(s, ref);
      return out === ref ? m : `${sheet ?? ''}${out}`;
    },
  ))).join('');
}

/** 「$P$5」「P5:Q9」「P:Q」 의 열을 at 이상이면 count 만큼 민다. */
export function shiftColsInRef(ref: string, at: number, count: number): string {
  return ref.replace(/(\$?)([A-Z]{1,3})(?=\$?\d|:|$)/g, (m, d: string, c: string) => (colNum(c) >= at ? `${d}${colName(colNum(c) + count)}` : m));
}

/** 상대 참조를 dRow·dCol 만큼 옮긴다(공유 수식 풀기·수식 복사). $ 붙은 쪽은 그대로. */
export function moveRelative(f: string, dRow: number, dCol: number): string {
  return mapRefs(f, (_s, ref) => ref.replace(/(\$?)([A-Z]{1,3})(\$?)(\d*)/g, (m, dc: string, c: string, dr: string, r: string) => {
    if (!c) return m;
    const col = dc ? c : colName(colNum(c) + dCol);
    const row = r === '' ? '' : dr ? r : String(Number(r) + dRow);
    return `${dc}${col}${dr}${row}`;
  }));
}

/** 공유 수식을 낱 수식으로 푼다. */
export function unshareFormulas(xml: string): string {
  if (!/t="shared"/.test(xml)) return xml;
  const masters = new Map<string, { row: number; col: number; text: string }>();
  for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const m = /<f\b([^>]*\bt="shared"[^>/]*)>([\s\S]*?)<\/f>/.exec(c[2] ?? '');
    const ref = /\br="([A-Z]+)(\d+)"/.exec(c[1]);
    const si = m ? /\bsi="(\d+)"/.exec(m[1])?.[1] : undefined;
    if (m && ref && si != null && m[2]) masters.set(si, { col: colNum(ref[1]), row: Number(ref[2]), text: unesc(m[2]) });
  }
  // 칸 하나씩 — 딸린 칸의 <f …/> 는 속이 없어서, 칸 경계를 넘는 정규식은 다음 칸까지 삼킨다.
  return xml.replace(/<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g, (cell: string, attrs: string, _e: string, body: string | undefined) => {
    if (!body || !/t="shared"/.test(body)) return cell;
    const ref = /\br="([A-Z]+)(\d+)"/.exec(attrs);
    if (!ref) return cell;
    const nb = body.replace(/<f\b([^>]*)\/>|<f\b([^>]*)>([\s\S]*?)<\/f>/, (fm: string, a1: string | undefined, a2: string | undefined, text: string | undefined) => {
      const a = a1 ?? a2 ?? '';
      if (!/t="shared"/.test(a)) return fm;
      const keep = a.replace(/\s*\b(t|ref|si)="[^"]*"/g, '');
      if (text) return `<f${keep}>${text}</f>`;
      const si = /\bsi="(\d+)"/.exec(a)?.[1];
      const ms = si != null ? masters.get(si) : undefined;
      if (!ms) return '';
      return `<f${keep}>${esc(moveRelative(ms.text, Number(ref[2]) - ms.row, colNum(ref[1]) - ms.col))}</f>`;
    });
    return `<c${attrs}>${nb}</c>`;
  });
}

/** 수식 글자 하나 — target 시트의 열 참조를 민다. here 는 이 수식이 있는 시트. */
export function shiftFormulaCols(f: string, here: string, target: string, at: number, count: number): string {
  return mapRefs(f, (s, ref) => ((s ?? here) === target ? shiftColsInRef(ref, at, count) : ref));
}

const shiftSqref = (s: string, at: number, count: number) => s.split(/\s+/).map((x) => shiftColsInRef(x, at, count)).join(' ');

/** 시트 XML 의 모든 <f>…</f> 에 fn. */
export function mapFormulas(xml: string, fn: (f: string) => string): string {
  return xml
    .replace(/(<f\b(?:[^>]*[^>/])?>)([\s\S]*?)(<\/f>)/g, (_m, a: string, f: string, z: string) => `${a}${esc(fn(unesc(f)))}${z}`)
    .replace(/(<formula[12]?>)([\s\S]*?)(<\/formula[12]?>)/g, (_m, a: string, f: string, z: string) => `${a}${esc(fn(unesc(f)))}${z}`);
}

/** <cols> — at 열부터 민다. 새 열(at)은 원래 at 열의 정의를 본뜬다. */
function shiftColDefs(xml: string, at: number, count: number): string {
  return xml.replace(/<cols>([\s\S]*?)<\/cols>/, (_m, body: string) => {
    const out: string[] = [];
    for (const m of body.matchAll(/<col\b([^>]*?)\/>/g)) {
      const attrs = m[1];
      const min = Number(/\bmin="(\d+)"/.exec(attrs)?.[1]); const max = Number(/\bmax="(\d+)"/.exec(attrs)?.[1]);
      const mk = (a: number, b: number) => `<col${attrs.replace(/\bmin="\d+"/, `min="${a}"`).replace(/\bmax="\d+"/, `max="${Math.min(b, 16384)}"`)}/>`;
      if (max < at) out.push(mk(min, max));
      else if (min >= at) {
        if (min === at) out.push(mk(at, at + count - 1));                       // 새 열 — 원래 at 열 정의
        if (min + count <= 16384) out.push(mk(min + count, max + count));
      } else {                                                               // at 을 품은 정의 — 쪼갠다
        out.push(mk(min, at - 1)); out.push(mk(at, at + count - 1)); out.push(mk(at + count, max + count));
      }
    }
    return `<cols>${out.join('')}</cols>`;
  });
}

/** 대상 시트 XML — 칸·범위를 밀고 새 열 칸을 끼운다(값 없이 서식만). */
function shiftSheetBody(xml: string, at: number, count: number): string {
  let res = xml.replace(/<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g, (_m, attrs: string, _end: string, body: string | undefined) => {
    const a = attrs.replace(/\s+spans="[^"]*"/, '');
    if (body == null) return `<row${a}/>`;
    const rowNo = /\br="(\d+)"/.exec(a)?.[1] ?? '';
    let tmplStyle: string | null = null;
    const cells = body.replace(/<c\b([^>]*?)\br="([A-Z]+)(\d+)"([^>]*?)(\/>|>[\s\S]*?<\/c>)/g, (_c, pre: string, col: string, r: string, post: string, rest: string) => {
      const n = colNum(col);
      if (n === at) tmplStyle = /\bs="(\d+)"/.exec(pre + post)?.[1] ?? '';
      return `<c${pre}r="${n >= at ? colName(n + count) : col}${r}"${post}${rest}`;
    });
    if (tmplStyle == null) return `<row${a}>${cells}</row>`;
    // 새 칸들 — 밀려난 칸(at+count) 바로 앞에.
    const st = tmplStyle ? ` s="${tmplStyle}"` : '';
    const fresh = Array.from({ length: count }, (_x, k) => `<c r="${colName(at + k)}${rowNo}"${st}/>`).join('');
    const firstMoved = new RegExp(`<c\\b[^>]*\\br="${colName(at + count)}${rowNo}"`);
    const idx = cells.search(firstMoved);
    return `<row${a}>${idx < 0 ? cells + fresh : cells.slice(0, idx) + fresh + cells.slice(idx)}</row>`;
  });
  res = shiftColDefs(res, at, count)
    .replace(/(<mergeCell ref=")([^"]+)(")/g, (_m, a, s: string, z) => `${a}${shiftSqref(s, at, count)}${z}`)
    .replace(/(<conditionalFormatting\b[^>]*\bsqref=")([^"]+)(")/g, (_m, a, s: string, z) => `${a}${shiftSqref(s, at, count)}${z}`)
    .replace(/(<dataValidation\b[^>]*\bsqref=")([^"]+)(")/g, (_m, a, s: string, z) => `${a}${shiftSqref(s, at, count)}${z}`)
    .replace(/(<hyperlink\b[^>]*\bref=")([^"]+)(")/g, (_m, a, s: string, z) => `${a}${shiftSqref(s, at, count)}${z}`)
    .replace(/(<autoFilter\b[^>]*\bref=")([^"]+)(")/g, (_m, a, s: string, z) => `${a}${shiftSqref(s, at, count)}${z}`)
    .replace(/(<dimension\b[^>]*\bref=")([^"]+)(")/, (_m, a, s: string, z) => `${a}${shiftSqref(s, at, count)}${z}`);
  return res;
}

export interface SheetPart { name: string; part: string }

/**
 * target 시트의 at 열(1=A) 앞에 count 열을 끼운다. files 는 풀어 둔 워크북(제자리에서 고친다).
 * sheets = 시트 이름 ↔ 부품 경로(sheetEntries). 모든 시트의 공유 수식도 이때 푼다.
 */
export function insertColumns(files: Record<string, Uint8Array>, sheets: SheetPart[], target: string, at: number, count = 1,
  dec: (b: Uint8Array) => string, enc: (s: string) => Uint8Array): void {
  for (const s of sheets) {
    let xml = unshareFormulas(dec(files[s.part]));
    xml = mapFormulas(xml, (f) => shiftFormulaCols(f, s.name, target, at, count));
    if (s.name === target) xml = shiftSheetBody(xml, at, count);
    files[s.part] = enc(xml);
  }
  const wbXml = dec(files['xl/workbook.xml']);
  files['xl/workbook.xml'] = enc(wbXml.replace(/(<definedName\b[^>]*>)([\s\S]*?)(<\/definedName>)/g,
    (_m, a: string, f: string, z: string) => `${a}${esc(mapRefs(unesc(f), (sh, ref) => (sh === target ? shiftColsInRef(ref, at, count) : ref)))}${z}`));
}

// ── 줄 끼우기(통합문서 전체) ─────────────────────────────
// 정산표 이월의 새 계정(사용자 2026-10-03 「2120A 처럼 분류를 새로 넣기」): WBS 의 과목 무리 끝에 줄을 끼우면
// 보고서BS 의 SUMIF(WBS!$B$11:$B$97 …)·WCF 의 참조도 따라 밀려야 한다. 대상 시트 안은 insertRowsAfter 가 하고,
// 여기서는 **다른 시트의 그 시트 참조**를 민다 — after 에서 끝나는 범위는 새 줄까지 늘린다(엑셀은 안 늘리지만 합계가 빠지지 않게).
export function shiftRowsInRef(ref: string, after: number, count: number): string {
  const parts = ref.split(':');
  const shifted = parts.map((p) => p.replace(/(\$?[A-Z]{0,3}\$?)(\d+)$/, (m, a: string, r: string) => (Number(r) > after ? `${a}${Number(r) + count}` : m)));
  if (parts.length === 2) {
    const r1 = Number(/(\d+)$/.exec(parts[0])?.[1] ?? NaN), r2 = Number(/(\d+)$/.exec(parts[1])?.[1] ?? NaN);
    if (r2 === after && r1 <= after) shifted[1] = parts[1].replace(/(\d+)$/, String(after + count));
  }
  return shifted.join(':');
}

export function insertRowsBook(files: Record<string, Uint8Array>, sheets: SheetPart[], target: string, after: number, count: number,
  dec: (b: Uint8Array) => string, enc: (s: string) => Uint8Array, insertRowsAfter: (xml: string, after: number, count: number) => string): void {
  for (const s of sheets) {
    let xml = dec(files[s.part]);
    if (s.name === target) xml = insertRowsAfter(xml, after, count);
    else xml = mapFormulas(xml, (f) => mapRefs(f, (sh, ref) => (sh === target && /\d/.test(ref) ? shiftRowsInRef(ref, after, count) : ref)));
    files[s.part] = enc(xml);
  }
  const wbXml = dec(files['xl/workbook.xml']);
  files['xl/workbook.xml'] = enc(wbXml.replace(/(<definedName\b[^>]*>)([\s\S]*?)(<\/definedName>)/g,
    (_m, a: string, f: string, z: string) => `${a}${esc(mapRefs(unesc(f), (sh, ref) => (sh === target && /\d/.test(ref) ? shiftRowsInRef(ref, after, count) : ref)))}${z}`));
}
