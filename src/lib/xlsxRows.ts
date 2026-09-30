// 시트에 줄을 끼워 넣는다 — 엑셀의 「행 삽입」과 같다. ZIP 안 시트 XML 만 고친다(엑셀 라이브러리 없음).
//
// 2301 감사위험의 평가: 올해 양식의 계정 칸은 6줄뿐인데 회사 계정은 30개 가까이다(명진). 줄을 늘려야 한다.
// 옮기는 것: 줄·칸 번호, 병합, 조건부 서식·데이터 유효성·하이퍼링크 범위, 시트 안 수식의 줄 참조, dimension.
// 새 줄은 cloneFrom 줄의 서식(칸 서식·높이·그 줄 안의 병합)을 본뜨고 값은 비운다.
// 그림·메모의 자리(drawing anchor)는 옮기지 않는다 — 일반조서 표 영역에는 없다.

function colNum(c: string): number { let n = 0; for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64; return n; }

/** 「A12」「$A$12」 꼴 참조의 줄을 at 이상이면 count 만큼 민다. */
function shiftRef(ref: string, at: number, count: number): string {
  return ref.replace(/(\$?[A-Z]{1,3})(\$?)(\d+)/g, (_m, c: string, d: string, r: string) => `${c}${d}${Number(r) >= at ? Number(r) + count : Number(r)}`);
}
/** 「A1:C5 E7」 같은 범위 목록. */
const shiftSqref = (s: string, at: number, count: number) => s.split(/\s+/).map((x) => shiftRef(x, at, count)).join(' ');

/** 수식 안의 같은 시트 참조만 민다 — 「시트!A1」·「'시트'!A1」 처럼 다른 시트를 가리키는 것은 두고, 글자("…")는 건드리지 않는다. */
export function shiftFormula(f: string, at: number, count: number): string {
  return f.split(/("[^"]*")/).map((part, i) => (i % 2 ? part : part.replace(
    /((?:'[^']*'|[A-Za-z0-9_가-힣.]+)!)?(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)(?![A-Za-z0-9_(])/g,
    (m, sheet: string | undefined, ref: string) => (sheet ? m : shiftRef(ref, at, count)),
  ))).join('');
}

export function insertRows(xml: string, at: number, count: number, cloneFrom: number): string {
  if (count <= 0) return xml;
  const sd = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml);
  if (!sd) return xml;
  const body = sd[1];
  const rows = [...body.matchAll(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)].map((m) => m[0]);
  const rowNo = (r: string) => Number(/\br="(\d+)"/.exec(r)?.[1] ?? '0');
  const template = rows.find((r) => rowNo(r) === cloneFrom) ?? '';

  const moveRow = (r: string, by: number) => r
    .replace(/(<row\b[^>]*\br=")(\d+)(")/, (_m, a, n, b) => `${a}${Number(n) + by}${b}`)
    .replace(/(<c\b[^>]*\br=")([A-Z]+)(\d+)(")/g, (_m, a, c, n, b) => `${a}${c}${Number(n) + by}${b}`);
  const fixFormulas = (r: string) => r
    .replace(/(<f\b[^>]*>)([\s\S]*?)(<\/f>)/g, (_m, a: string, f: string, z: string) => `${a}${shiftFormula(f, at, count)}${z}`)
    .replace(/(<f\b[^>]*\bref=")([^"]+)(")/g, (_m, a, ref, z) => `${a}${shiftSqref(ref, at, count)}${z}`);

  // 새 줄 — 서식만(값·수식 없이).
  const blank = (n: number) => {
    if (!template) return `<row r="${n}"/>`;
    const open = /^<row\b[^>]*?>/.exec(template)?.[0] ?? `<row r="${n}">`;
    const cells = [...template.matchAll(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)].map((c) => {
      const attrs = c[1].replace(/\s+t="[^"]*"/, '').replace(/\br="([A-Z]+)\d+"/, `r="$1${n}"`);
      return `<c${attrs}/>`;
    });
    // 숨긴 줄(빌린 2120A 의 안 쓰는 계정)을 본떠도 새 줄은 보이게.
    const o = open.replace(/\br="\d+"/, `r="${n}"`).replace(/\s+spans="[^"]*"/, '').replace(/\s+hidden="(1|true)"/, '');
    return /\/>$/.test(o) ? o : `${o}${cells.join('')}</row>`;
  };

  const out: string[] = [];
  let inserted = false;
  for (const r of rows) {
    const n = rowNo(r);
    if (!inserted && n >= at) {
      for (let k = 0; k < count; k++) out.push(blank(at + k));
      inserted = true;
    }
    out.push(fixFormulas(n >= at ? moveRow(r, count) : r));
  }
  if (!inserted) for (let k = 0; k < count; k++) out.push(blank(at + k));

  let res = xml.slice(0, sd.index) + xml.slice(sd.index, sd.index + sd[0].length).replace(body, out.join('')) + xml.slice(sd.index + sd[0].length);
  // 병합 — 옮기고, 본뜬 줄의 가로 병합은 새 줄에도.
  const merges = [...res.matchAll(/<mergeCell ref="([^"]+)"\/>/g)].map((m) => m[1]);
  if (merges.length) {
    const moved = merges.map((m) => shiftSqref(m, at, count));
    const same = merges.filter((m) => { const rs = [...m.matchAll(/\d+/g)].map((x) => Number(x[0])); return rs.length === 2 && rs[0] === cloneFrom && rs[1] === cloneFrom; });
    const added: string[] = [];
    for (let k = 0; k < count; k++) for (const m of same) added.push(m.replace(/\d+/g, String(at + k)));
    const all = [...moved, ...added];
    res = res.replace(/<mergeCells\b[^>]*>[\s\S]*?<\/mergeCells>/, `<mergeCells count="${all.length}">${all.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`);
  }
  res = res
    .replace(/(<conditionalFormatting\b[^>]*\bsqref=")([^"]+)(")/g, (_m, a, s, z) => `${a}${shiftSqref(s, at, count)}${z}`)
    .replace(/(<dataValidation\b[^>]*\bsqref=")([^"]+)(")/g, (_m, a, s, z) => `${a}${shiftSqref(s, at, count)}${z}`)
    .replace(/(<hyperlink\b[^>]*\bref=")([^"]+)(")/g, (_m, a, s, z) => `${a}${shiftSqref(s, at, count)}${z}`)
    .replace(/(<dimension\b[^>]*\bref=")([^"]+)(")/, (_m, a, s, z) => `${a}${s.replace(/(\d+)$/, (x: string) => String(Number(x) + count))}${z}`)
    .replace(/(<conditionalFormatting\b[\s\S]*?<\/conditionalFormatting>)/g, (block: string) => block.replace(/(<formula>)([\s\S]*?)(<\/formula>)/g, (_m, a, f: string, z) => `${a}${shiftFormula(f, at, count)}${z}`));
  // 인쇄 영역·페이지 나눔은 그대로 둔다.
  void colNum;
  return res;
}

/**
 * after 줄 **바로 아래**에 줄을 끼우고, after 에서 끝나던 같은 시트 범위(「SUM(E37:E58)」)를 새 줄까지 늘린다.
 * 엑셀은 범위 끝 줄 아래에 끼우면 범위를 늘리지 않는다 — 2120A 에 새 계정을 분류 맨 끝에 넣을 때 합계가 빠지지 않게
 * (평안정공 2026-09-28 「2120A 새로운 계정 … 대분류·중분류를 고려하여 줄 추가」).
 */
export function insertRowsAfter(xml: string, after: number, count: number): string {
  if (count <= 0) return xml;
  let res = insertRows(xml, after + 1, count, after);
  const grow = (s: string) => s.replace(/(\$?[A-Z]{1,3}\$?)(\d+):(\$?[A-Z]{1,3}\$?)(\d+)(?![A-Za-z0-9_(])/g,
    (m, c1: string, r1: string, c2: string, r2: string) => (Number(r2) === after && Number(r1) <= after ? `${c1}${r1}:${c2}${after + count}` : m));
  const growFormula = (f: string) => f.split(/("[^"]*")/).map((part, i) => (i % 2 ? part : part.replace(
    /((?:'[^']*'|[A-Za-z0-9_가-힣.]+)!)?(\$?[A-Z]{1,3}\$?\d+:\$?[A-Z]{1,3}\$?\d+)(?![A-Za-z0-9_(])/g,
    (m, sheet: string | undefined, range: string) => (sheet ? m : grow(range)),
  // 칸 하나짜리 합계 「SUM(E117)」(평안정공 자본잉여금)도 범위로 — 아래에 끼운 줄이 합계에서 빠지지 않게(아비즈 기타자본잉여금 3.9억).
  ).replace(/(SUM\()(\$?[A-Z]{1,3})(\$?)(\d+)\)/gi,
    (m, a: string, c: string, d: string, r: string) => (Number(r) === after ? `${a}${c}${d}${r}:${c}${d}${after + count})` : m),
  ))).join('');
  res = res
    .replace(/(<f\b[^>]*>)([\s\S]*?)(<\/f>)/g, (_m, a: string, f: string, z: string) => `${a}${growFormula(f)}${z}`)
    .replace(/(<conditionalFormatting\b[^>]*\bsqref=")([^"]+)(")/g, (_m, a, s: string, z) => `${a}${s.split(/\s+/).map(grow).join(' ')}${z}`)
    .replace(/(<dataValidation\b[^>]*\bsqref=")([^"]+)(")/g, (_m, a, s: string, z) => `${a}${s.split(/\s+/).map(grow).join(' ')}${z}`);
  return res;
}

/** 수식을 다른 줄로 옮겨 쓴다(엑셀 「복사」) — $ 가 없는 줄 번호를 delta 만큼. 글자("…")는 건드리지 않는다. */
export function moveFormula(f: string, delta: number): string {
  return f.split(/("[^"]*")/).map((part, i) => (i % 2 ? part : part.replace(
    /(?<![A-Za-z0-9_])(\$?[A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g,
    (_m, c: string, d: string, r: string) => `${c}${d}${d ? r : Number(r) + delta}`,
  ))).join('');
}
