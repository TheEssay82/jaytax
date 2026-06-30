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

// ── 카탈로그 브라우징(검색 아님) ────────────────────────────────

/** 현재 DB에 문단이 적재된 기준서 키 집합 (`${set} ${no}`). 카탈로그에서 클릭 가능 여부 판별용. */
export async function loadedStandardKeys(): Promise<Set<string>> {
  const { data, error } = await supabase.from('accounting_standards').select('standard_set, standard_no');
  if (error) throw new Error(error.message);
  const set = new Set<string>();
  for (const r of (data ?? []) as { standard_set: string; standard_no: string }[]) {
    set.add(`${r.standard_set} ${r.standard_no}`);
  }
  return set;
}

export interface ParagraphRow {
  part: string;
  chapter_title: string | null;
  section_title: string | null;
  paragraph_no: string;
  content: string;
  ordinal: number;
}

/** 한 기준서의 전체 문단을 등장순으로 — 열람(browse)용. */
export async function fetchStandardParagraphs(standardSet: string, standardNo: string): Promise<ParagraphRow[]> {
  const { data, error } = await supabase
    .from('accounting_standards')
    .select('part, chapter_title, section_title, paragraph_no, content, ordinal')
    .eq('standard_set', standardSet)
    .eq('standard_no', standardNo)
    .order('ordinal', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ParagraphRow[];
}

// ── 질의회신요약 인덱스 (public/qnas-index.json, KASB 제목·메타·링크) ──

export interface QnaIndexItem {
  id: number;
  docNumber: string | null;
  date: string | null;
  title: string;
  relStds: string | null;
  deprecated: boolean;
  link: string;
}

let _qnaCache: QnaIndexItem[] | null = null;

/** 질의회신 인덱스 로드(캐시). 본문은 없고 제목·메타·KASB 원문 링크만. */
export async function loadQnaIndex(): Promise<QnaIndexItem[]> {
  if (_qnaCache) return _qnaCache;
  const res = await fetch('/qnas-index.json');
  if (!res.ok) throw new Error(`질의회신 인덱스 로드 실패 ${res.status}`);
  const json = (await res.json()) as { items: QnaIndexItem[] };
  _qnaCache = json.items ?? [];
  return _qnaCache;
}

/** 특정 기준서 번호(예: '1115')에 관련된 질의회신만 필터. relStds 문자열 매칭(휴리스틱). */
export function filterQnasByStandardNo(items: QnaIndexItem[], no: string): QnaIndexItem[] {
  if (!no) return [];
  return items.filter((q) => q.relStds && q.relStds.includes(no));
}

// ── KASB 회계기준열람서비스 링크 ─────────────────────────────────
// 본문은 KASB 저작물이라 저장하지 않고(요지만 유지), 원문은 KASB에서 직접 열람·내려받게 링크만 제공.
// 주의: KASB 열람서비스(db.kasb.or.kr)는 기준서별 deep-link를 지원하지 않는다(SPA 라우트가 /·/qnas/:id 뿐,
//   /standard/{번호}는 매칭 라우트가 없어 빈 화면). 그래서 '열람서비스 진입점'으로만 연결하고, 사용자가
//   거기서 번호로 검색·열람한다. 질의회신(/qnas/{id})은 deep-link가 동작한다.
export const KASB_STANDARDS_URL = 'https://db.kasb.or.kr/standard/';
