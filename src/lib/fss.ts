// 금감원 자료 — 화면·검색이 함께 쓰는 순수 부분(서버 호출 없음, 테스트용으로 따로).

export const FSS_APIS = ['kifrs', 'kgaap', 'insp', 'illust', 'icfr', 'auddata', 'audfaq'] as const;
export type FssApi = (typeof FSS_APIS)[number];

export const FSS_LABEL: Record<FssApi, string> = {
  kifrs: 'K-IFRS 질의회신',
  kgaap: '일반기업회계기준 질의회신',
  insp: '심사·감리 지적사례',
  illust: '주석공시 모범사례',
  icfr: '내부회계관리제도',
  auddata: '외부감사 업무자료',
  audfaq: '외부감사 FAQ',
};
export const FSS_COLOR: Record<FssApi, [string, string]> = {
  kifrs: ['#EEF2FF', '#3730A3'], kgaap: ['#EEF2FF', '#3730A3'], insp: ['#FEF2F2', '#991B1B'],
  illust: ['#ECFDF5', '#065F46'], icfr: ['#FFF7ED', '#9A3412'], auddata: ['#F5F3FF', '#5B21B6'], audfaq: ['#F5F3FF', '#5B21B6'],
};

/** 검색어를 PostgREST or() 안전한 낱말로 — 쉼표·괄호·별표는 뺀다. 공백으로 나눈 낱말은 모두 들어 있어야(AND). */
export function fssTerms(q: string | undefined): string[] {
  return (q ?? '').replace(/[,()*%\\]/g, ' ').split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 1).slice(0, 5);
}

