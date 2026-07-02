// 상담진행/상담기록 데이터 레이어.
//  - runConsult: 질문 → consult Edge Function(회계기준 RAG 근거 + Claude 회신 초안).
//  - consultations 테이블 CRUD: 전체 열람(공유 이력), 작성/수정/삭제는 본인 것만(RLS 0014).
import { supabase } from './supabase';

// ── 근거(citation) ───────────────────────────────────────────────
// consult Edge가 돌려주고 consultations.citations(jsonb)에 그대로 저장하는 형태.
export interface Citation {
  type: string; // '회계기준' | '세법' 등
  ref: string; // 인용 문자열 (예: "K-IFRS 제1115호 문단 31 (요지)")
  text: string; // 근거 요지/원문
}

/** consult Edge에 함께 보낼 세법 조문 근거(선택). */
export interface LawRef {
  ref: string; // 예: "부가가치세법 제38조 (시행 2025.1.1)"
  text: string;
}

export interface ConsultResult {
  answer_md: string;
  citations: Citation[];
  model: string;
  tags: string[];
}

/** 상담 회신에 쓸 수 있는 모델(서버 allowlist와 일치). 첫 항목이 기본값. */
export const CONSULT_MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (기본 · 빠름)' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 (고품질 · 느림)' },
] as const;
export const DEFAULT_CONSULT_MODEL = CONSULT_MODELS[0].id;

/**
 * 회신 초안 생성 — consult Edge Function 호출.
 * @param question 직원이 올린 질문/사실관계
 * @param opts.standardNo 회계기준 RAG 한정 (예: '1115'). 미지정 시 함수 기본('1115').
 * @param opts.matchCount RAG 근거 문단 수(1~12).
 * @param opts.lawRefs 함께 인용할 세법 조문 근거(수동 첨부, 선택).
 * @param opts.includeTaxLaw 세법 조문 자동근거(법제처 조문 자동 조회). 기본 true.
 * @param opts.model 회신 작성 모델(allowlist). 미지정/허용 밖이면 서버 기본(Sonnet).
 */
export async function runConsult(
  question: string,
  opts: { standardNo?: string; matchCount?: number; lawRefs?: LawRef[]; model?: string; includePrecedents?: boolean; includeTaxLaw?: boolean; domain?: '공통' | '회계' | '세무'; priorAnswer?: string; followup?: string } = {}
): Promise<ConsultResult> {
  const { data, error } = await supabase.functions.invoke('consult', {
    body: {
      question,
      standardNo: opts.standardNo ?? '',
      matchCount: opts.matchCount ?? 6,
      lawRefs: opts.lawRefs ?? [],
      model: opts.model ?? DEFAULT_CONSULT_MODEL,
      includePrecedents: opts.includePrecedents ?? false,
      includeTaxLaw: opts.includeTaxLaw ?? true,
      domain: opts.domain ?? '공통',
      priorAnswer: opts.priorAnswer ?? '',
      followup: opts.followup ?? '',
    },
  });
  if (error) throw new Error(error.message);
  if (!data || data.ok === false) throw new Error(data?.error || '회신 초안 작성에 실패했습니다.');
  return { answer_md: data.answer_md, citations: data.citations ?? [], model: data.model, tags: data.tags ?? [] };
}

/** 모델 id → 사람이 읽는 표기 (예: 'claude-sonnet-4-6' → 'Anthropic Claude Sonnet 4.6'). */
export function modelLabel(id: string | null | undefined): string {
  if (!id) return '';
  const map: Record<string, string> = {
    'claude-opus-4-8': 'Anthropic Claude Opus 4.8',
    'claude-sonnet-4-6': 'Anthropic Claude Sonnet 4.6',
    'claude-haiku-4-5-20251001': 'Anthropic Claude Haiku 4.5',
  };
  if (map[id]) return map[id];
  // claude-<family>-<ver> 패턴 일반화
  const m = id.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/);
  if (m) return `Anthropic Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
  return id;
}

// ── consultations CRUD ───────────────────────────────────────────
export type ConsultStatus = 'draft' | 'final';

export interface Consultation {
  id: string;
  authorId: string | null;
  authorEmail: string;
  /** 작성자 담당자명(profiles.name). 없으면 이메일로 대체. */
  authorName: string;
  title: string;
  question: string;
  answerMd: string;
  citations: Citation[];
  tags: string[];
  llmModel: string | null;
  status: ConsultStatus;
  createdAt: string;
  updatedAt: string;
}

interface ConsultRow {
  id: string;
  author_id: string | null;
  author_email: string | null;
  title: string | null;
  question: string;
  answer_md: string | null;
  citations: Citation[] | null;
  tags: string[] | null;
  llm_model: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
}

function rowToConsultation(r: ConsultRow): Consultation {
  return {
    id: r.id,
    authorId: r.author_id,
    authorEmail: r.author_email || '',
    authorName: r.author_email || '',
    title: r.title || '',
    question: r.question || '',
    answerMd: r.answer_md || '',
    citations: r.citations || [],
    tags: r.tags || [],
    llmModel: r.llm_model,
    status: (r.status as ConsultStatus) || 'draft',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** 전체 상담기록 조회 (최신순, 공유 이력). */
export async function listConsultations(): Promise<Consultation[]> {
  const { data, error } = await supabase
    .from('consultations')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data as ConsultRow[]).map(rowToConsultation);
  // 작성자 담당자명 매핑 (consultations.author_id → profiles.name). 없으면 이메일 유지.
  const { data: profs } = await supabase.from('profiles').select('id, name');
  const nameById = new Map((profs ?? []).map((p) => [p.id as string, (p.name as string) || '']));
  for (const c of rows) {
    const nm = c.authorId ? nameById.get(c.authorId) : '';
    if (nm) c.authorName = nm;
  }
  return rows;
}

export interface ConsultInput {
  title: string;
  question: string;
  answerMd: string;
  citations: Citation[];
  tags?: string[];
  llmModel?: string | null;
  status?: ConsultStatus;
}

/** 새 상담기록 저장 (본인 명의). author_id는 RLS/DEFAULT(auth.uid())로 채워진다. */
export async function createConsultation(input: ConsultInput): Promise<Consultation> {
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('consultations')
    .insert({
      author_id: u.user?.id ?? undefined,
      author_email: u.user?.email ?? null,
      title: input.title,
      question: input.question,
      answer_md: input.answerMd,
      citations: input.citations,
      tags: input.tags ?? [],
      llm_model: input.llmModel ?? null,
      status: input.status ?? 'draft',
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return rowToConsultation(data as ConsultRow);
}

/** 상담기록 수정 (본인 것만 — RLS). 제목/회신/상태/태그 등 일부 필드 갱신. */
export async function updateConsultation(
  id: string,
  patch: Partial<Pick<ConsultInput, 'title' | 'answerMd' | 'status' | 'tags'>>
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.answerMd !== undefined) row.answer_md = patch.answerMd;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.tags !== undefined) row.tags = patch.tags;
  const { error } = await supabase.from('consultations').update(row).eq('id', id);
  if (error) throw new Error(error.message);
}

/** 상담기록 삭제 (본인 것만 — RLS). */
export async function deleteConsultation(id: string): Promise<void> {
  const { error } = await supabase.from('consultations').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
