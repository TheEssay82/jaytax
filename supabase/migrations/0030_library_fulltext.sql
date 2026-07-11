-- 0030: 자료실(library) 참고자료 원문 RAG 청크
-- 자료실에 올린 '참고자료(reference)' PDF에서 텍스트를 추출·청킹·임베딩해 상담진행 근거로 검색한다.
-- 회계기준(standard_fulltext)·요지(accounting_standards)와 별개 테이블 — 사무소 내부 정리자료라
-- 열람은 사내 직원(외부인 제외)만. 적재는 service_role 스크립트(scripts/library/load-library-rag.ts).
-- 임베딩: OpenAI text-embedding-3-small (1536차원) — standard_fulltext와 동일.
create extension if not exists vector;

-- ── RAG 청크 테이블 ─────────────────────────────────────────────
create table if not exists public.library_fulltext (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.library_documents (id) on delete cascade,
  -- 라벨용 denormalize(적재 시점 스냅샷). 메타 수정 시 재적재로 갱신.
  title        text not null default '',
  category     text not null default '',
  kind         text not null default 'reference',
  chunk_index  int  not null,
  content      text not null,
  token_count  int,
  content_hash text,
  embedding    vector(1536), -- OpenAI text-embedding-3-small
  created_at   timestamptz not null default now()
);

-- 문서 재적재 시 기존 청크 제거 후 삽입(청크 수 변동 대비) — 문서·청크번호 유일.
create unique index if not exists uniq_library_chunk
  on public.library_fulltext (document_id, chunk_index);
create index if not exists idx_library_ft_doc on public.library_fulltext (document_id);
create index if not exists idx_library_ft_embedding
  on public.library_fulltext using hnsw (embedding vector_cosine_ops);

-- ── RLS: 사내 직원 열람만(외부인 제외). 적재는 service_role 스크립트가 RLS 우회. ──
alter table public.library_fulltext enable row level security;

drop policy if exists library_ft_sel on public.library_fulltext;
create policy library_ft_sel on public.library_fulltext
  for select to authenticated
  using (not public.is_external());
-- INSERT/UPDATE/DELETE 정책 없음 → authenticated는 쓰기 불가(근거 데이터 보호).

-- ── 유사도 검색 RPC: 질의 임베딩 → 유사 자료실 청크 N개 ──────────
create or replace function public.match_library_fulltext(
  query_embedding vector(1536),
  match_count     int  default 4,
  filter_kind     text default null
)
returns table (
  document_id uuid,
  title       text,
  category    text,
  kind        text,
  chunk_index int,
  content     text,
  similarity  float
)
language sql stable
as $$
  select document_id, title, category, kind, chunk_index, content,
         1 - (embedding <=> query_embedding) as similarity
  from public.library_fulltext
  where embedding is not null
    and (filter_kind is null or kind = filter_kind)
  order by embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_library_fulltext(vector, int, text) to authenticated;

-- ── library_documents: RAG 편입 상태(스크립트 멱등·UI 배지용) ─────
alter table public.library_documents add column if not exists rag_indexed boolean not null default false;
alter table public.library_documents add column if not exists rag_chunks  int     not null default 0;
alter table public.library_documents add column if not exists indexed_at  timestamptz;
