// 담당자 이름을 화면·문서에 쓰는 규칙 **한 곳**.
//
// 왜 필요한가: 화면이 `이름 + ' ' + 호칭` 을 그냥 이어 붙였다. 그래서
//  · 이름 칸에 이미 「…님」이 든 자료 47건이 「공나영 대표님 님」으로 두 번 붙었고(2026-09-05),
//  · 호칭 칸에 직책이 든 118건은 「홍길동 과장」으로 **「님」 없이** 나갔다(2026-09-11).
// 둘 다 여기서 막는다. 밖에서는 `recipientLabel` 하나만 쓴다.

/** 「어머님·아버님·사모님」은 통째로 하나의 호칭이라 떼면 말이 안 된다. */
const WHOLE = /(어머|아버|사모)님$/;

/** 이름 끝의 「님」을 뗀다. 통호칭(어머님 등)은 그대로 둔다. */
export function stripHonorific(name: string): string {
  const s = (name ?? '').trim();
  if (WHOLE.test(s)) return s;
  return s.replace(/\s*님$/, '').trim();
}

/**
 * **직함 한 개를 고른다** — 직책 칸과 호칭 칸을 하나로 본다.
 *
 * 왜 합치는가: 두 칸이 있지만 실제로는 **먼저 눈에 띈 칸에 직책을 적어** 왔다.
 * 2026-09-11 실측 — 거래처담당자 204건의 호칭 칸이 「님」107건, **직책명 92건**, 빈칸 5건이고,
 * 36가지 값이 전부 「님」이거나 직책명이거나 「직책+님」이다(「귀하」·「귀중」은 하나도 없다).
 * 직책 칸은 55건뿐인데 그중 45건은 호칭이 「님」이라 겹치지 않는다 — **실제 충돌은 8건.**
 *
 * 그래서 둘 중 **직책 칸을 먼저** 본다(그 일을 하라고 만든 칸이다). 비어 있으면 호칭 칸이
 * 직함 노릇을 하고 있다고 보고 거기서 가져온다. 「과장님」처럼 님이 붙어 있으면 뗀다 —
 * 님은 마지막에 한 번만 붙일 것이기 때문이다.
 */
export function pickTitle(position = '', honorific = ''): string {
  const p = (position ?? '').trim();
  if (p) return stripHonorific(p);
  const h = (honorific ?? '').trim();
  if (!h || h === '님') return '';
  return stripHonorific(h);
}

/**
 * 문서 수신자 이름 — **「성명 + 직함 + 님」.**
 *
 * 공문에 찍히는 이름이라 **「님」으로 끝나야 한다.** 그전에는 화면이 `이름 + ' ' + 호칭` 을
 * 그냥 이어 붙여, 호칭 칸에 직책이 든 118건이 「홍길동 과장」으로 나갔다(2026-09-11).
 *
 * 「사모님·어머님」처럼 이미 님으로 끝나는 통호칭에는 덧붙이지 않는다.
 */
export function recipientLabel(name: string, position = '', honorific = ''): string {
  const n = stripHonorific(name);
  if (!n) return '';
  const t = pickTitle(position, honorific);
  if (!t) return `${n} 님`;
  return t.endsWith('님') ? `${n} ${t}` : `${n} ${t}님`;
}
