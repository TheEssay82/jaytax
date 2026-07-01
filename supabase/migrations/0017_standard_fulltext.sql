-- 0017: 회계기준서 원문 전문(PDF 추출) RAG 청크
-- 게시한 원문 PDF에서 텍스트를 추출·청킹·임베딩해 상담진행 근거로 검색한다.
-- 요지(accounting_standards)와 별개 테이블 — 원문은 verbatim 발췌(문단번호 없이 청크 순번).
create extension if not exists vector;

create table if not exists public.standard_fulltext (
  id             uuid primary key default gen_random_uuid(),
  standard_set   text not null default 'K-IFRS',
  standard_no    text not null,
  standard_title text not null default '',
  chunk_index    int  not null,
  content        text not null,
  token_count    int,
  content_hash   text,
  embedding      vector(1536), -- OpenAI text-embedding-3-small
  created_at     timestamptz not null default now()
);

create unique index if not exists uniq_fulltext_chunk
  on public.standard_fulltext (standard_set, standard_no, chunk_index);
create index if not exists idx_fulltext_no on public.standard_fulltext (standard_no);
create index if not exists idx_fulltext_embedding
  on public.standard_fulltext using hnsw (embedding vector_cosine_ops);

alter table public.standard_fulltext enable row level security;
drop policy if exists standard_fulltext_sel on public.standard_fulltext;
create policy standard_fulltext_sel on public.standard_fulltext
  for select to authenticated using (true);
-- INSERT/UPDATE/DELETE 정책 없음 → 적재는 service_role 스크립트만.

-- 유사도 검색 RPC: 질의 임베딩 → 유사 원문 청크 N개
create or replace function public.match_standard_fulltext(
  query_embedding    vector(1536),
  match_count        int  default 6,
  filter_standard_no text default null
)
returns table (
  standard_set   text,
  standard_no    text,
  standard_title text,
  chunk_index    int,
  content        text,
  similarity     float
)
language sql stable
as $$
  select standard_set, standard_no, standard_title, chunk_index, content,
         1 - (embedding <=> query_embedding) as similarity
  from public.standard_fulltext
  where embedding is not null
    and (filter_standard_no is null or standard_no = filter_standard_no)
  order by embedding <=> query_embedding
  limit match_count;
$$;
