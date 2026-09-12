// 법령 조문을 회신 근거로 실을 때 **어디서 자를지** 정하는 규칙.
//
// 왜 필요한가: 조문 본문을 앞에서부터 1,400자로 잘라 넣었다. 짧은 조문에는 넉넉하지만
// 시행령의 정의 조항처럼 항이 열 개 넘는 조문은 뒷부분이 통째로 날아간다.
//
// 2026-09-11 통합고용세액공제 회신이 그랬다 — 조특령 제26조의8은 제1항부터 제13항까지
// 있는데 근거에는 제4항까지만 실렸다. 창업한 법인은 직전 상시근로자 수를 0으로 본다는
// **제8항(제23조제13항 준용)이 잘려 나가** 회신이 "창업 첫해 특례는 확인되지 않는다"고
// 단정했고, 그래서 결론의 이유가 통째로 틀렸다. 조문에는 있었다.
//
// 그래서 둘을 한다. ① 상한을 넉넉히 잡고 ② 그래도 넘치면 **항 경계에서** 자른 뒤
// 잘렸다는 사실과 빠진 항 번호를 남긴다 — 없는 것으로 오해하지 않도록.

/** 항 머리글자 ①②③… (원문자 1~20). */
const MARK = /[①-⑳]/;
const MARKS_G = /[①-⑳]/g;

/** 항 머리글자면 그 항 번호, 아니면 0. */
export function clauseNo(chunk: string): number {
  const c = (chunk ?? '').trimStart().charCodeAt(0);
  return c >= 0x2460 && c <= 0x2473 ? c - 0x245f : 0;
}

/** 조문을 항 단위로 가른다. 항 표시가 없으면 통째로 한 덩이. */
export function splitClauses(content: string): string[] {
  const s = content ?? '';
  if (!MARK.test(s)) return s.trim() ? [s] : [];
  const out: string[] = [];
  let last = 0;
  for (const m of s.matchAll(MARKS_G)) {
    const i = m.index ?? 0;
    if (i > last) out.push(s.slice(last, i));
    last = i;
  }
  out.push(s.slice(last));
  return out.filter((x) => x.trim());
}

/**
 * 조문 본문을 max 자 안으로 줄인다 — **항 경계에서만** 자른다.
 *
 * 잘라낸 것이 있으면 어느 항이 빠졌는지 밝힌다. 근거를 읽는 쪽(모델)이 잘린 조문을 보고
 * "그런 규정이 없다"로 단정하는 것이 이 함수가 막으려는 사고다.
 */
export function clipArticle(content: string, max: number): string {
  const s = (content ?? '').trim();
  if (s.length <= max) return s;

  const parts = splitClauses(s);
  const kept: string[] = [];
  let len = 0;
  for (const p of parts) {
    if (kept.length && len + p.length > max) break;
    kept.push(p);
    len += p.length;
  }
  let body = kept.join('').trimEnd();
  if (body.length > max) body = body.slice(0, max).trimEnd();   // 첫 덩이부터 상한을 넘는 경우

  const nos = parts.slice(kept.length).map(clauseNo).filter((n) => n > 0);
  const where = nos.length === 0 ? '뒷부분'
    : nos.length === 1 ? `제${nos[0]}항`
    : `제${nos[0]}항부터 제${nos[nos.length - 1]}항까지`;
  return `${body}\n…(${where} 생략 — 길어서 싣지 못했다. 생략된 부분에 준용·특례·예외 규정이 있을 수 있으므로, 이 조문에 그런 규정이 "없다"고 단정하지 않는다.)`;
}
