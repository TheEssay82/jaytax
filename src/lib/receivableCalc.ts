// 사업장 한 곳의 미수금을 어떻게 세는가 — **그 규칙만**. supabase 를 물지 않는다.
//
// 미수금 = 기초 + 발행 − 취소 − 입금 − 대손  (모두 **부가세 포함**)
//
// 왜 다섯으로 나누는가(2026-09-06 지시): 그전에는 「발행」 한 칸에 <b>발행완료와
// (−)수정발행이 섞여</b> 있었고, 대손은 아예 자리가 없었다. 숫자가 왜 그런지 보려면
// 움직임 하나하나가 제 칸에 있어야 한다.
//
// ⚠️ **「취소」는 (−)수정발행이다** — 이미 나간 세금계산서를 무른 것.
//    요청 단계에서 취소한 건(status='취소')은 **세금계산서가 나간 적이 없어** 채권이
//    아니므로 여기 들어오지 않는다. 둘을 섞으면 나가지도 않은 돈을 뺀 셈이 된다.
//
// ⚠️⚠️ **수정발행에는 (+)도 있다.** 「되살리기 (+)」 — 덜 발행했거나 예전에 끊어 둔
//    (−)크레딧이 소멸해 채권이 되살아나는 것이다. 이것은 채권을 **늘린다**.
//    2026-09-06 에 실제로 이 구분을 빠뜨려 ㈜제이엠스토리 미수금이 0 이어야 하는데
//    −330,000 으로 나왔다(되살리기 165,000 을 취소로 세어 두 번 뺐다).
//    **부호로 갈라야 한다 — 상태만 보면 안 된다.**

export interface Movement {
  /** 청구 상태 — '발행완료' | '수정발행' | '취소' | '요청' */
  status: string;
  /** 부가세 포함 금액. 수정발행은 음수로 들어온다. */
  total: number;
}

export interface ReceivableParts {
  opening: number;
  /** 발행완료 합계(양수). */
  issued: number;
  /** (−)수정발행을 **양수로** 담는다 — 화면에서 「취소」 칸에 그대로 보이게. */
  cancelled: number;
  paid: number;
  /** ERP 미수금대장의 당기대손액. */
  writeoff: number;
}

/**
 * 청구 한 건을 어느 칸에 담을지. 채권이 아닌 것은 null.
 *
 * 수정발행은 **부호로 가른다** — (−)되돌리기는 취소, (+)되살리기는 발행 쪽이다.
 * 상태만 보고 전부 취소로 넣으면 되살린 채권을 오히려 빼 버린다.
 */
export function bucketOf(m: Movement): 'issued' | 'cancelled' | null {
  if (m.status === '발행완료') return 'issued';
  if (m.status === '수정발행') return m.total < 0 ? 'cancelled' : 'issued';
  // '요청'은 아직 나가지 않았고, '취소'는 나간 적이 없다.
  return null;
}

/** 청구들을 발행·취소로 가른다. 취소는 양수로 담는다. */
export function splitIssued(ms: Movement[]): { issued: number; cancelled: number } {
  let issued = 0;
  let cancelled = 0;
  for (const m of ms) {
    const b = bucketOf(m);
    if (b === 'issued') issued += m.total;
    else if (b === 'cancelled') cancelled += Math.abs(m.total);
  }
  return { issued, cancelled };
}

/** 미수금 = 기초 + 발행 − 취소 − 입금 − 대손. */
export function balanceOf(p: ReceivableParts): number {
  return p.opening + p.issued - p.cancelled - p.paid - p.writeoff;
}

/** 움직임이 하나도 없는 사업장은 표에 세우지 않는다. */
export function hasAnything(p: ReceivableParts): boolean {
  return !!(p.opening || p.issued || p.cancelled || p.paid || p.writeoff);
}
