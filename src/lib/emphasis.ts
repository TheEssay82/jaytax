// 화면 글에서 **강조 표시를 가르는** 규칙. React 를 물지 않는다(테스트가 돌아야 하므로).
//
// 개발노트·백로그 같은 글은 코드 안에 문자열로 들어 있어 마크다운이 먹지 않는다.
// 한때 별표(**)를 썼다가 그대로 보여 v2.60.1 에서 꺾쇠로 바꿨는데, **꺾쇠도 그대로
// 보이고 있었다**(2026-09-08 발견). 강조하려던 표시가 되레 글을 어지럽혔다.
//
// 그래서 가르는 일만 여기서 하고, 굵게 그리는 일은 화면이 한다.

export interface Piece {
  text: string;
  /** 강조할 조각인가. 꺾쇠 안에 있던 글이다. */
  em: boolean;
}

/**
 * `앞 <강조> 뒤` 를 조각으로 가른다. 꺾쇠는 **버린다** — 표시일 뿐 글자가 아니다.
 *
 * 짝이 맞지 않는 꺾쇠는 그대로 둔다. 여는 것만 있는 「<」 를 강조로 읽으면
 * 남은 글 전체가 굵어져 되레 망가진다 — 모르면 건드리지 않는 편이 낫다.
 */
export function emphasize(text: string): Piece[] {
  const out: Piece[] = [];
  // split 의 캡처 그룹은 홀수 자리에 들어온다 — 그 자리가 꺾쇠 안이다.
  const parts = String(text ?? '').split(/<([^<>]*)>/);
  for (let i = 0; i < parts.length; i += 1) {
    const t = parts[i];
    if (!t) continue;               // 빈 조각은 버린다(꺾쇠가 맨 앞·뒤일 때 생긴다)
    out.push({ text: t, em: i % 2 === 1 });
  }
  return out;
}

/** 강조 표시를 걷어낸 **맨 글**. 검색·복사·엑셀에 쓴다. */
export const plain = (text: string): string =>
  emphasize(text).map((p) => p.text).join('');
