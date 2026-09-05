// 매출을 어느 칸에 담을지 — **분류 규칙만**. supabase 를 물지 않는다(테스트가 돌아야 하므로).
//
// 자료를 읽어 오는 일은 revenueStatsApi 가 하고, 여기서는 「이 청구가 무슨 종류인가」만 정한다.

/** 예산·통계에서 수입을 셋으로 가를 때 쓰는 종류. */
export type RevenueKind = '기장료' | '세무조정' | '기타';

/** ERP 매출계정 → 수입 종류. */
export function revenueKind(s: string): RevenueKind {
  const v = (s || '').trim();
  if (v.includes('세무조정')) return '세무조정';
  if (['기장', '기장대리수입', '원천', '신고대리', '컨설팅', '경영자문수입'].includes(v)) return '기장료';
  return '기타';
}

/**
 * 계약이 없는 청구의 **매출유형 대분류**를 ERP 매출계정에서 미룬다.
 *
 * 왜 필요한가: 매출유형은 계약에서 나오는데, 계약에 연결되지 않은 청구가 있다.
 * 2026-09-06 기준 ㈜파인즈플래닝의 (−)수정발행 3건이 그렇다 — 기장료를 무른 것인데
 * 그 기장 계약이 앱에 등록된 적이 없어 매출통계에서 「(미지정) −600,000」 으로 떴다.
 *
 * **금액은 손대지 않는다. 어느 칸에 담을지만 정한다.**
 * 계정도 비어 있으면 빈 값을 돌려준다 — 모르는 것을 지어내지 않는다.
 */
export function typeTopFromErp(erpAccount: string): string {
  const v = (erpAccount || '').trim();
  if (!v) return '';
  if (v.includes('기장')) return '기장';
  if (v.includes('세무조정')) return '신고';
  if (v.includes('회계감사') || v.includes('임의감사')) return '감사';
  if (v.includes('진단')) return '진단';
  return '컨설팅';   // 기타용역수입·경영자문수입 등
}
