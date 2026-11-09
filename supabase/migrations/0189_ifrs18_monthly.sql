-- 0189 K-IFRS 1118 월결산 — 회사가 jaytax 에서 직접 쓰는 화면(사용자 2026-11-09).
--
-- 원장(분개장)은 **서버에 두지 않는다** — 브라우저 안에서만 읽고 계산한다(주석·DSD 관리와 같은 방식).
-- 서버에 두는 것은 둘뿐이다:
--   ① ifrs18_client   — 회사별 계정 판단표(JSON). 인덕 회계사가 올리고 고친다.
--   ② ifrs18_judgment — 주의계정 라인 판단 기록(전표번호 · G/L · 영업 유지/조정 · 근거). 회사 담당자가 쓴다.
-- 회사 담당자(외부인 등급)는 ifrs18_access 로 연결된 회사만 본다. 인덕 직원(외부인 아님)은 전부 본다.
--
-- 판단표는 이 저장소에 넣지 않는다 — 저장소가 공개라서 회사 계정 체계가 드러나면 안 된다.
-- 화면 「판단표 올리기」로 JSON 을 올린다.

create table if not exists public.ifrs18_client (
  key         text primary key check (key ~ '^[a-z0-9-]{2,40}$'),
  name        text not null,
  config      jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid() references auth.users (id) on delete set null
);

create table if not exists public.ifrs18_access (
  user_id     uuid not null references auth.users (id) on delete cascade,
  client_key  text not null references public.ifrs18_client (key) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, client_key)
);

create table if not exists public.ifrs18_judgment (
  client_key  text not null references public.ifrs18_client (key) on delete cascade,
  doc_no      text not null,
  gl          text not null,
  decision    text not null check (decision in ('영업 유지', '조정')),
  target      text,
  reason      text not null default '',
  by_name     text,
  by_id       uuid default auth.uid() references auth.users (id) on delete set null,
  at          timestamptz not null default now(),
  primary key (client_key, doc_no, gl)
);

-- 이 회사를 볼 수 있는가 — 인덕 직원이거나, 연결된 회사 담당자.
create or replace function public.ifrs18_can(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(not public.is_external(), false)
      or exists (select 1 from public.ifrs18_access a where a.user_id = auth.uid() and a.client_key = p_key);
$$;
revoke all on function public.ifrs18_can(text) from public, anon;
grant execute on function public.ifrs18_can(text) to authenticated;

-- 판단표를 고칠 수 있는가 — 최고관리자 · 회계사(감사팀)만.
create or replace function public.ifrs18_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('superuser', 'accountant') and not coalesce(readonly, false) from public.profiles where id = auth.uid()), false);
$$;
revoke all on function public.ifrs18_admin() from public, anon;
grant execute on function public.ifrs18_admin() to authenticated;

alter table public.ifrs18_client enable row level security;
alter table public.ifrs18_access enable row level security;
alter table public.ifrs18_judgment enable row level security;

create policy ifrs18_client_sel on public.ifrs18_client for select to authenticated using ((select public.ifrs18_can(key)));
create policy ifrs18_client_ins on public.ifrs18_client for insert to authenticated with check ((select public.ifrs18_admin()));
create policy ifrs18_client_upd on public.ifrs18_client for update to authenticated using ((select public.ifrs18_admin())) with check ((select public.ifrs18_admin()));
create policy ifrs18_client_del on public.ifrs18_client for delete to authenticated using ((select public.ifrs18_admin()));

create policy ifrs18_access_sel on public.ifrs18_access for select to authenticated using (user_id = (select auth.uid()) or (select public.ifrs18_admin()));
create policy ifrs18_access_all on public.ifrs18_access for all to authenticated using ((select public.ifrs18_admin())) with check ((select public.ifrs18_admin()));

create policy ifrs18_judgment_sel on public.ifrs18_judgment for select to authenticated using ((select public.ifrs18_can(client_key)));
create policy ifrs18_judgment_ins on public.ifrs18_judgment for insert to authenticated with check ((select public.ifrs18_can(client_key)) and not coalesce((select public.is_readonly()), false));
create policy ifrs18_judgment_upd on public.ifrs18_judgment for update to authenticated using ((select public.ifrs18_can(client_key)) and not coalesce((select public.is_readonly()), false)) with check ((select public.ifrs18_can(client_key)));
create policy ifrs18_judgment_del on public.ifrs18_judgment for delete to authenticated using ((select public.ifrs18_can(client_key)) and not coalesce((select public.is_readonly()), false));

create index if not exists idx_ifrs18_access_client on public.ifrs18_access (client_key);

comment on table public.ifrs18_client is 'K-IFRS 1118 월결산 — 회사별 계정 판단표(JSON). 원장은 서버에 두지 않는다.';
comment on table public.ifrs18_judgment is 'K-IFRS 1118 월결산 — 주의계정 라인 판단 기록(누적). 다음 달 누적 분개장에서도 다시 판단하지 않게 한다.';
