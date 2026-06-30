-- 0013: 회계기준 근거 DB (RAG) — K-IFRS / 일반기업회계기준 문단 + 임베딩
-- 파일럿 범위: K-IFRS 제1115호. 이후 동일 스키마로 나머지 기준서 확장.
-- 구조: 전 직원이 읽는 공용 '근거 데이터'. 적재(INSERT/UPDATE)는 service_role(ingestion 스크립트)만 수행.
-- 임베딩: OpenAI text-embedding-3-small (1536차원). 모델 변경 시 vector(N) 차원과 인덱스만 재생성.

-- ──────────────────────────────────────────────
-- 0. 확장: pgvector (임베딩 유사도 검색)
-- ──────────────────────────────────────────────
create extension if not exists vector;

-- ──────────────────────────────────────────────
-- 1. 회계기준 문단 테이블
-- ──────────────────────────────────────────────
create table if not exists public.accounting_standards (
  id              uuid primary key default gen_random_uuid(),

  -- 식별 메타
  standard_set    text not null default 'K-IFRS',   -- 'K-IFRS' | '일반기업회계기준'
  standard_no     text not null,                     -- 예: '1115'
  standard_title  text not null default '',          -- 예: '고객과의 계약에서 생기는 수익'

  -- 구조 메타 (장/절/부)
  part            text not null default '본문',       -- '본문' | '부록A 용어정의' | '부록B 적용지침' | '결론도출근거' | '적용사례' ...
  chapter_no      text,                               -- 장 번호(있으면)
  chapter_title   text,                               -- 장 제목
  section_title   text,                               -- 절/소제목 (가장 가까운 상위 헤딩)
  paragraph_no    text not null,                      -- 문단번호 (예: '31', 'B2', 'IE3') — 영숫자라 text

  -- 내용
  content         text not null,
  ordinal         int  not null default 0,            -- 문서 내 등장 순서(정렬용)
  token_count     int,                                -- 대략적 토큰 수(청크 점검용)
  content_hash    text,                               -- 멱등 재적재용 (내용 변경 감지)

  -- 출처/개정
  revised_date    date,                               -- 개정일자
  source          text,                               -- 출처(공개본/페이지 등)

  -- 임베딩
  embedding       vector(1536),                       -- OpenAI text-embedding-3-small

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 멱등 재적재 키: 같은 기준서·부·문단번호는 1행
create unique index if not exists uniq_standard_paragraph
  on public.accounting_standards (standard_set, standard_no, part, paragraph_no);

-- 메타 필터/조회 인덱스
create index if not exists idx_std_no  on public.accounting_standards (standard_no);

-- 벡터 유사도 인덱스 (코사인). 데이터 적재 후 효과적; 소량이면 seq scan도 무방.
create index if not exists idx_std_embedding
  on public.accounting_standards
  using hnsw (embedding vector_cosine_ops);

create trigger trg_std_updated
  before update on public.accounting_standards
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────
-- 2. RLS: 인증 직원은 읽기만. 적재는 service_role(키)로 RLS 우회.
-- ──────────────────────────────────────────────
alter table public.accounting_standards enable row level security;

create policy accounting_standards_sel on public.accounting_standards
  for select to authenticated using (true);
-- INSERT/UPDATE/DELETE 정책 없음 → authenticated는 쓰기 불가(근거 데이터 보호).
--  ingestion 스크립트는 secret(service_role) 키로 접속하여 RLS를 우회한다.

-- ──────────────────────────────────────────────
-- 3. 유사도 검색 RPC: 질의 임베딩 → 유사 문단 N개
-- ──────────────────────────────────────────────
create or replace function public.match_accounting_standards(
  query_embedding    vector(1536),
  match_count        int  default 5,
  filter_standard_no text default null
)
returns table (
  id             uuid,
  standard_set   text,
  standard_no    text,
  standard_title text,
  part           text,
  chapter_title  text,
  section_title  text,
  paragraph_no   text,
  content        text,
  revised_date   date,
  similarity     float
)
language sql
stable
as $$
  select
    s.id, s.standard_set, s.standard_no, s.standard_title,
    s.part, s.chapter_title, s.section_title, s.paragraph_no,
    s.content, s.revised_date,
    1 - (s.embedding <=> query_embedding) as similarity
  from public.accounting_standards s
  where s.embedding is not null
    and (filter_standard_no is null or s.standard_no = filter_standard_no)
  order by s.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_accounting_standards(vector, int, text) to authenticated;
