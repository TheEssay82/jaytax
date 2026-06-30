// 회계기준 근거 검색 — Edge Function(standards-query) 호출.
// 인증된 직원이 질문을 보내면 근거 문단 N개를 유사도순으로 받는다.
// 검색 로직은 scripts/standards/search.ts(임베딩 → match_accounting_standards RPC)와 동일하며,
// 단일 소스(accounting-standards/*.md)를 Supabase에 적재한 데이터를 검색한다.
import { supabase } from './supabase';

export interface StandardMatch {
  standard_set: string;
  standard_no: string;
  standard_title: string;
  part: string;
  section_title: string | null;
  paragraph_no: string;
  content: string;
  similarity: number;
  /** 인용 문자열 (예: "K-IFRS 제1115호 문단 31 (요지)") */
  citation: string;
}

export interface StandardsQueryResult {
  question: string;
  matches: StandardMatch[];
  /** 정리본=요지 안내. UI에 함께 노출 권장. */
  notice: string;
}

/**
 * 회계기준 근거 검색.
 * @param question 자연어 질의
 * @param opts.standardNo 특정 기준서로 한정 (예: '1115'). 미지정 시 전체.
 * @param opts.matchCount 반환 문단 수 (1~20, 기본 5).
 */
export async function queryStandards(
  question: string,
  opts: { standardNo?: string; matchCount?: number } = {}
): Promise<StandardsQueryResult> {
  const { data, error } = await supabase.functions.invoke('standards-query', {
    body: {
      question,
      standard_no: opts.standardNo ?? null,
      match_count: opts.matchCount ?? 5,
    },
  });
  if (error) throw new Error(error.message);
  if (!data || data.ok === false) throw new Error(data?.error || '근거 검색에 실패했습니다.');
  return { question: data.question, matches: data.matches, notice: data.notice };
}
