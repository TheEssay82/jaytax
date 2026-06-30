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

export interface LawDetail {
  name: string;
  effDate: string;
  dept: string;
  articleCount: number;
  articles: LawArticle[];
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
