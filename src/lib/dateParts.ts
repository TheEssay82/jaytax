// 연·월·일 칸 입력(DateParts)의 조립 규칙 — 화면 부품과 떼어 두어 테스트하기 쉽게.
export type DatePartsMode = 'date' | 'month';
const pad2 = (s: string) => (s.length === 1 ? '0' + s : s);

/** 완성된 값만 'YYYY-MM-DD'(월 모드 'YYYY-MM') 로. 미완성·범위 밖은 '' — 저장 로직에 반쪽 날짜를 넘기지 않는다. */
export function composeDateParts(y: string, m: string, d: string, mode: DatePartsMode): string {
  if (y.length !== 4) return '';
  const mm = Number(m), dd = Number(d);
  if (!m || mm < 1 || mm > 12) return '';
  if (mode === 'month') return `${y}-${pad2(m)}`;
  if (!d || dd < 1 || dd > 31) return '';
  return `${y}-${pad2(m)}-${pad2(d)}`;
}
