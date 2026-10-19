-- 원문 검색을 한 세트(예: '회계감사기준') 안에서만 — 상담(consult)이 감사 질문에 감사기준 근거를 따로 모을 때 쓴다.
--
-- 왜 따로: 전체 검색(match_standard_fulltext)에 감사기준(1,690청크)을 섞으면, 짧은 질문에서 K-IFRS 청크가
--   엉뚱하게 0.55 언저리로 올라와 감사기준(0.45~0.5)을 밀어냈다(「재고자산 실사 입회」 → K-IFRS 1036이 1위).
--   세트 안에서는 순위가 맞다(감사기준서 501 문단 A12·4가 1·2위).
-- 정확 검색: 세트로 먼저 거른 뒤(materialized) 거리를 잰다 — HNSW 에 where 를 걸면 후보 40개 중 몇 개만 남는다.
--   한 세트는 수천 줄이라 전수 비교도 가볍다.
-- 낱말 가산점: 임베딩은 짧은 전문용어(「수행중요성」·「입회」)를 잘 못 잡는다 — 질문의 핵심 낱말(keywords)이 본문에
--   그대로 들어 있으면 낱말 하나에 0.04, 최대 0.12 를 더해 순위를 매긴다(similarity 는 순수 유사도로 그대로 돌려준다).
-- 보안: RLS 를 따르는 SECURITY INVOKER(기본) — 읽기 정책(authenticated) 그대로. PUBLIC·anon 실행은 뺀다(0150 원칙).
drop function if exists public.match_standard_fulltext_in_set(vector, text, integer);
create or replace function public.match_standard_fulltext_in_set(
  query_embedding vector(1536),
  filter_set      text,
  match_count     int default 8,
  keywords        text[] default '{}'
)
returns table (
  standard_set   text,
  standard_no    text,
  standard_title text,
  chunk_index    int,
  content        text,
  similarity     float,
  score          float
)
language sql stable
set search_path = public, extensions
as $$
  with s as materialized (
    select f.standard_set, f.standard_no, f.standard_title, f.chunk_index, f.content, f.embedding
      from public.standard_fulltext f
     where f.standard_set = filter_set and f.embedding is not null
  )
  , r as (
    select s.*, 1 - (s.embedding <=> query_embedding) as sim,
           least(0.12, 0.04 * (select count(*) from unnest(keywords) k where length(k) >= 2 and strpos(s.content, k) > 0)) as bonus
      from s
  )
  select r.standard_set, r.standard_no, r.standard_title, r.chunk_index, r.content,
         r.sim as similarity, r.sim + r.bonus as score
    from r
   order by r.sim + r.bonus desc
   limit match_count;
$$;

revoke execute on function public.match_standard_fulltext_in_set(vector, text, integer, text[]) from public, anon;
grant execute on function public.match_standard_fulltext_in_set(vector, text, integer, text[]) to authenticated, service_role;
