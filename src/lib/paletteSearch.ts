// 어디서든 찾기(Ctrl+K)의 **맞추는 규칙**. supabase 를 물지 않아 테스트가 돈다.
//
// 규칙은 둘뿐이다.
//   ① 이름 어디든 들어 있으면 맞다 — 「톰」으로 「㈜오톰」이 잡힌다.
//   ② 질의가 자모(ㄱ~ㅎ)로만 이루어졌으면 **앞글자 초성**으로 맞춘다 — 「ㅇㅌ」→「오톰」.
//      가운데까지 허용하면 「ㅇㅌ」에 「나이스앱텍」·「대양이티에스」가 줄줄이 걸려 쓸모가 없다.

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

/** 한글을 첫 자음으로 바꾼다. 한글이 아닌 글자는 그대로 둔다. */
export function initials(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0) - 0xac00;
    out += c >= 0 && c <= 11171 ? CHO[Math.floor(c / 588)] : ch;
  }
  return out;
}

/**
 * 글자·숫자·한글만 남긴다.
 * 이모지·괄호·㈜·가운뎃점이 앞에 붙으면 초성이 거기서 시작해 앞글자 맞추기가 무너진다.
 */
export const norm = (s: string) => s.toLowerCase().replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]/g, '');

/** 질의가 자모로만 이루어졌는가 — 그때만 초성으로 맞춘다. */
export const isChoQuery = (q: string) => /^[ㄱ-ㅎ]+$/.test(norm(q));

/** 이 이름이 이 질의에 걸리는가. */
export function hit(hay: string, q: string): boolean {
  const h = norm(hay);
  const n = norm(q);
  if (!n) return true;
  if (h.includes(n)) return true;
  return isChoQuery(n) && initials(h).startsWith(n);
}

/** 사업자번호·전화번호처럼 하이픈이 섞이는 숫자 — 하이픈을 지우고 견준다. */
export function digitsHit(hay: string, q: string): boolean {
  const h = hay.replace(/\D/g, '');
  const n = q.replace(/\D/g, '');
  return !!n && !!h && h.includes(n);
}
