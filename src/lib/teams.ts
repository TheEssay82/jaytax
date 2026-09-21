// 팀 이름 — 저장 코드와 화면 표기를 여기서만 잇는다.
//
// DB 에는 'taxteam' · '감사team' 이 그대로 들어 있다(체크 제약 7개·RLS 정책 3개·컬럼 14개가 이 값을 본다).
// 사람에게는 **기장팀 · 감사팀** 으로만 보여 준다(2026-09-21 지시 — "여러 형태로 되어 있는 팀 구분을 전면 통일").
// ERP 부서명(기장24팀 · 2본부5팀)도 화면에서는 같은 이름으로 부른다. 코드를 화면에 직접 찍지 말 것.
export const TEAM_CODES = ['감사team', 'taxteam'] as const;
export type TeamCode = (typeof TEAM_CODES)[number];

export const TEAM_LABEL: Record<TeamCode, string> = { '감사team': '감사팀', taxteam: '기장팀' };

/** 코드 → 표기. 모르는 값은 그대로(옛 데이터·빈 값). */
export function teamLabel(code: string | null | undefined): string {
  return code ? (TEAM_LABEL[code as TeamCode] ?? code) : '';
}

/** 표기·옛 이름·코드 → 코드. 엑셀 가져오기처럼 사람이 적은 값을 받을 때. 못 알아보면 null. */
export function teamCodeOf(text: string | null | undefined): TeamCode | null {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t) return null;
  if (t === 'taxteam' || t === '기장팀' || t === '기장24팀' || t === 'tax' || t === '기장' || t === 't') return 'taxteam';
  if (t === '감사team' || t === '감사팀' || t === '2본부5팀' || t === 'audit' || t === '감사' || t === 'a') return '감사team';
  return null;
}
