// 세법(법령) 검색·조문 열람 — Edge Function(law-search) 호출.
// 법제처 국가법령정보 Open API를 서버(Edge)가 프록시한다. 회계기준(요지)과 달리 '원문'을 그대로 반환한다.
import { supabase } from './supabase';

export interface LawSummary {
  mst: string; // 법령일련번호 (상세 조회 키)
  lawId: string;
  name: string;
  lawType: string; // 법령구분명 (법률/시행령/시행규칙 등)
  effDate: string; // 시행일자 YYYYMMDD
  dept: string; // 소관부처
  link: string | null;
}

export interface LawArticle {
  no: string;
  title: string | null;
  isChapter: boolean;
  content: string;
  effDate: string;
}

/** 별표·별지서식 (법령 상세에 포함, 공개 PDF 다운로드 링크). */
export interface LawAttachment {
  no: string;
  branch: string; // 가지번호(예: '2')
  kind: string; // 별표 / 별지 / 서식
  title: string;
  pdfUrl: string | null; // 법제처 공개 다운로드(OC 없음)
}

export interface LawDetail {
  name: string;
  effDate: string;
  dept: string;
  articleCount: number;
  articles: LawArticle[];
  attachments: LawAttachment[];
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('law-search', { body });
  if (error) throw new Error(error.message);
  if (!data || data.ok === false) throw new Error(data?.error || '법령 조회에 실패했습니다.');
  return data as T;
}

/** 법령명/키워드로 검색 → 법령 목록(법/시행령/시행규칙 등). */
export async function searchLaws(query: string, display = 20): Promise<{ totalCnt: number; laws: LawSummary[] }> {
  const r = await invoke<{ totalCnt: number; laws: LawSummary[] }>({ action: 'search', query, display });
  return { totalCnt: r.totalCnt, laws: r.laws };
}

/** 법령일련번호(mst)로 조문 전문 열람. */
export async function fetchLawDetail(mst: string): Promise<LawDetail> {
  return invoke<LawDetail>({ action: 'detail', mst });
}

/** 시행일자(YYYYMMDD) → 'YYYY.MM.DD' */
export function fmtEffDate(d: string): string {
  if (!d || d.length !== 8) return d || '';
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
}

// ── 3단비교 (법 · 시행령 · 시행규칙 동시 조회) ────────────────────
export interface LawTrio {
  base: string; // 기준 법령명 (예: '법인세법')
  law: LawDetail | null; // 법률
  decree: LawDetail | null; // 시행령
  rule: LawDetail | null; // 시행규칙
}

/** 법령명으로 법·시행령·시행규칙을 한 번에 조회(3단비교용). 없는 단은 null.
 *  '법인세법 시행령'처럼 넣어도 기준 법령('법인세법')으로 정규화해 3단을 찾는다. */
export async function fetchLawTrio(name: string): Promise<LawTrio> {
  const base = name.trim().replace(/\s*(시행령|시행규칙)\s*$/, '');
  const { laws } = await searchLaws(base, 20);
  const exact = (n: string) => laws.find((l) => l.name === n);
  const lawS = exact(base) ?? laws.find((l) => l.name.startsWith(base) && !/시행(령|규칙)/.test(l.name));
  const decreeS = exact(`${base} 시행령`);
  const ruleS = exact(`${base} 시행규칙`);
  const [law, decree, rule] = await Promise.all([
    lawS ? fetchLawDetail(lawS.mst) : Promise.resolve(null),
    decreeS ? fetchLawDetail(decreeS.mst) : Promise.resolve(null),
    ruleS ? fetchLawDetail(ruleS.mst) : Promise.resolve(null),
  ]);
  return { base, law, decree, rule };
}

// ── 판례 검색 (법제처 target=prec) ────────────────────────────────
export interface PrecedentSummary {
  serial: string; // 판례일련번호 (본문 조회 키)
  caseName: string; // 사건명
  caseNo: string; // 사건번호 (예: 2022두32382)
  court: string; // 법원명
  date: string; // 선고일자
  caseType: string; // 사건종류명 (세무/일반행정 등)
  judgmentType: string; // 판결유형
  link: string | null; // 법제처 공개 판례 페이지
}

export interface PrecedentDetail {
  hasText: boolean; // 법제처 전문 제공 여부 (대법원 공간판례 등 일부만 제공)
  serial: string;
  link: string;
  caseName?: string;
  caseNo?: string;
  court?: string;
  date?: string;
  caseType?: string;
  judgmentType?: string;
  issue?: string; // 판시사항
  summary?: string; // 판결요지
  refClauses?: string; // 참조조문
  refCases?: string; // 참조판례
  body?: string; // 판례내용(전문)
}

/**
 * 판례 검색. 세법 쟁점 관련 판례를 사건명/본문에서 찾는다.
 * @param opts.section 1=제목·사건명(기본), 2=본문 전체
 */
export async function searchPrecedents(
  query: string,
  opts: { section?: 1 | 2; display?: number } = {}
): Promise<{ totalCnt: number; precedents: PrecedentSummary[] }> {
  const r = await invoke<{ totalCnt: number; precedents: PrecedentSummary[] }>({
    action: 'prec-search',
    query,
    section: opts.section ?? 1,
    display: opts.display ?? 30,
  });
  return { totalCnt: r.totalCnt, precedents: r.precedents };
}

/** 판례 본문 열람(판례일련번호). 전문 미제공 시 hasText=false + 링크만. */
export async function fetchPrecedent(serial: string): Promise<PrecedentDetail> {
  return invoke<PrecedentDetail>({ action: 'prec-detail', id: serial });
}

/** 선고일자 표시: YYYYMMDD → 'YYYY.MM.DD', 이미 점표기면 그대로. */
export function fmtPrecDate(d: string): string {
  if (!d) return '';
  if (/^\d{8}$/.test(d)) return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
  return d;
}

/** 주요 세법 빠른 선택 목록 (검색어로 사용). */
export const TAX_LAW_QUICKLIST: string[] = [
  '국세기본법',
  '국세징수법',
  '부가가치세법',
  '소득세법',
  '법인세법',
  '상속세 및 증여세법',
  '조세특례제한법',
  '종합부동산세법',
  '개별소비세법',
  '국제조세조정에 관한 법률',
  '조세범 처벌법',
  '지방세법',
  '지방세기본법',
  '지방세특례제한법',
];
