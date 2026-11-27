-- 0210 금감원 회계업무자료 Open API 저장소 — fss_docs (2026-11-27 인계 2단계, docs/fss/ 설계서 4-2).
--
-- 7종: illust(주석공시 모범사례) · kifrs(K-IFRS 질의회신요약) · kgaap(일반기업회계기준 질의회신요약) · icfr(내부회계관리제도)
--      · insp(심사·감리 지적사례) · auddata(외부감사 업무자료) · audfaq(외부감사 FAQ)
-- 수집은 엣지함수 fss-sync(service_role)만 한다 — 쓰기 정책 없음. 키는 Supabase secret FSS_API_KEY 에만.
-- 1단계 범위: 제목 · 요약 본문(HTML 제거본) · 링크 · 첨부 목록. body_raw · 첨부 원문은 두지 않는다(DB 한도 500MB, 지금 301MB).
-- 임베딩은 회계기준 RAG 와 같다 — OpenAI text-embedding-3-small, 1536차원(0013·0017).
-- 공개자료라 개인정보 마스킹 · 보존기한 파기 대상 아님.

create table if not exists public.fss_docs (
  api             text not null check (api in ('illust','kifrs','kgaap','icfr','insp','auddata','audfaq')),
  content_id      text not null,
  subject         text not null,
  reg_date        timestamptz,
  rel_stand       text,                 -- 관련기준서(kifrs · insp)
  iss_realm       text,                 -- 쟁점분야(insp)
  rls_no          text,
  dcsn_yr         text,
  sprvisn_trgt_yr text,
  dept_nm         text,
  origin_url      text,
  attachments     jsonb not null default '[]'::jsonb,   -- [{name, url}]
  body_text       text,                 -- HTML 제거본
  body_hash       text,                 -- 제목+본문+첨부 해시 — 바뀐 건만 다시 임베딩
  embedding       extensions.vector(1536),
  embedded_at     timestamptz,
  fetched_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (api, content_id)
);
comment on table public.fss_docs is '금감원 회계업무자료 Open API 7종(공개자료). 수집 fss-sync(service_role), 읽기 authenticated.';

create index if not exists fss_docs_reg_date_idx on public.fss_docs (reg_date desc);
create index if not exists fss_docs_api_reg_idx on public.fss_docs (api, reg_date desc);
create index if not exists fss_docs_fts_idx on public.fss_docs
  using gin (to_tsvector('simple'::regconfig, subject || ' ' || coalesce(rel_stand, '') || ' ' || coalesce(iss_realm, '') || ' ' || coalesce(body_text, '')));
create index if not exists fss_docs_embedding_idx on public.fss_docs
  using hnsw (embedding extensions.vector_cosine_ops);

alter table public.fss_docs enable row level security;
drop policy if exists fss_docs_read on public.fss_docs;
create policy fss_docs_read on public.fss_docs for select to authenticated using (true);
-- INSERT/UPDATE/DELETE 정책 없음 → 적재는 service_role(fss-sync)만.

-- 유사도 검색 — 상담(consult) 근거 · fss_search 가 쓴다(4·5단계). 종류(apis)로 먼저 거르고 거리를 잰다.
-- 낱말 가산점은 0177 과 같은 규칙(제목·본문에 핵심 낱말이 그대로 있으면 하나에 0.04, 최대 0.12).
create or replace function public.match_fss_docs(
  query_embedding extensions.vector(1536),
  match_count     int default 8,
  apis            text[] default null,
  keywords        text[] default '{}'
)
returns table (
  api        text,
  content_id text,
  subject    text,
  reg_date   timestamptz,
  rel_stand  text,
  iss_realm  text,
  origin_url text,
  body_text  text,
  similarity float,
  score      float
)
language sql stable
set search_path = public, extensions
as $$
  with s as materialized (
    select d.* from public.fss_docs d
     where d.embedding is not null and (apis is null or d.api = any(apis))
  )
  , r as (
    select s.*, 1 - (s.embedding <=> query_embedding) as sim,
           least(0.12, 0.04 * (select count(*) from unnest(keywords) k
                                where length(k) >= 2 and strpos(s.subject || ' ' || coalesce(s.body_text, ''), k) > 0)) as bonus
      from s
  )
  select r.api, r.content_id, r.subject, r.reg_date, r.rel_stand, r.iss_realm, r.origin_url, r.body_text,
         r.sim as similarity, r.sim + r.bonus as score
    from r
   order by r.sim + r.bonus desc
   limit match_count;
$$;

revoke execute on function public.match_fss_docs(extensions.vector, integer, text[], text[]) from public, anon;
grant execute on function public.match_fss_docs(extensions.vector, integer, text[], text[]) to authenticated, service_role;
