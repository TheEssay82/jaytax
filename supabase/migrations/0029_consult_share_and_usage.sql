-- 0029: (1) 상담기록 외부 공유 링크  (2) 상담(AI) 사용량 사용자별 집계(최고관리자 전용)

-- ── (1) 상담기록 외부 공유 ────────────────────────────────────────
-- 상담기록에 랜덤 공유 토큰을 부여하면 비로그인(외부)에서도 그 1건을 링크로 열람할 수 있다.
-- 토큰이 없으면(null) 공유 안 됨. 토큰은 작성자/확정권한자가 켜고 끌 수 있다(update RLS).
alter table public.consultations add column if not exists share_token uuid unique;
create index if not exists idx_consultations_share on public.consultations (share_token);

-- 토큰 일치 시에만 해당 상담 1건 반환(anon 접근용). SECURITY DEFINER로 RLS 우회하되 토큰으로 한정.
create or replace function public.get_shared_consult(p_token uuid)
returns table (
  title text, question text, answer_md text, citations jsonb, tags text[],
  status text, created_at timestamptz, author_name text
)
language sql stable security definer set search_path to 'public' as $$
  select c.title, c.question, c.answer_md, c.citations, c.tags, c.status, c.created_at,
         coalesce(p.name, c.author_email, '') as author_name
  from public.consultations c
  left join public.profiles p on p.id = c.author_id
  where p_token is not null and c.share_token = p_token
  limit 1;
$$;
revoke all on function public.get_shared_consult(uuid) from public;
grant execute on function public.get_shared_consult(uuid) to anon, authenticated;

-- ── (2) 상담(AI) 사용량 로그 + 집계 ───────────────────────────────
-- '회신 초안 작성/보완'으로 AI를 사용할 때마다 한 줄씩 기록. 열람·집계는 최고관리자(superuser)만.
create table if not exists public.consult_usage (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  user_email text,
  model      text,
  domain     text,
  action     text not null default 'generate',   -- generate | refine
  created_at timestamptz not null default now()
);
create index if not exists idx_consult_usage_user on public.consult_usage (user_id);
create index if not exists idx_consult_usage_created on public.consult_usage (created_at desc);

alter table public.consult_usage enable row level security;

-- 기록: 로그인 직원 본인 명의(외부인 제외 — 데모 사용량 오염 방지).
create policy consult_usage_ins on public.consult_usage
  for insert to authenticated
  with check (user_id = auth.uid() and not public.is_external());

-- 열람: 최고관리자만.
create policy consult_usage_sel on public.consult_usage
  for select to authenticated
  using (auth_role() = 'superuser');

-- 사용자별 집계(최고관리자만 — 아니면 0행).
create or replace function public.ai_usage_by_user()
returns table (
  user_id uuid, user_name text, user_email text,
  total bigint, this_month bigint, last_used timestamptz
)
language sql stable security definer set search_path to 'public' as $$
  select u.user_id,
         coalesce(p.name, u.user_email, '') as user_name,
         u.user_email,
         count(*) as total,
         count(*) filter (where u.created_at >= date_trunc('month', now())) as this_month,
         max(u.created_at) as last_used
  from public.consult_usage u
  left join public.profiles p on p.id = u.user_id
  where auth_role() = 'superuser'
  group by u.user_id, p.name, u.user_email
  order by total desc;
$$;
revoke all on function public.ai_usage_by_user() from public;
grant execute on function public.ai_usage_by_user() to authenticated;
