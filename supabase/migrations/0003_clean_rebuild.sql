-- 0003: 깨끗한 재구축
-- 사유: clients·profiles 가 이전에 다른 스키마/소유자로 존재해
--       (1) 컬럼 누락, (2) 가입 트리거 INSERT 가 RLS 에 막혀 프로필 미생성.
-- 조치: 6개 테이블 전부 drop 후 정본으로 재생성 → 모두 postgres 소유 → owner 가 RLS 우회.
--       실데이터 없음(테스트만)이라 안전. 마지막에 시드 + 기존 가입자 프로필 백필.

-- ── 기존 객체 정리 ──────────────────────────────
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user() cascade;

drop table if exists public.billing_targets cascade;
drop table if exists public.billing_records cascade;
drop table if exists public.update_requests cascade;
drop table if exists public.app_config     cascade;
drop table if exists public.clients         cascade;
drop table if exists public.profiles        cascade;

-- 공통 트리거 함수 (재정의)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- ── 1. profiles ─────────────────────────────────
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null default '',
  role        text not null default 'staff',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email))
  on conflict (id) do nothing;
  return new;
exception when others then
  raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 2. clients ──────────────────────────────────
create table public.clients (
  id            uuid primary key default gen_random_uuid(),
  biz_type      text not null default '법인',
  company_name  text not null default '',
  trade_name    text not null default '',
  tax_id        text not null default '',
  rep_name      text not null default '',
  manager       text not null default '',
  bank_account  text not null default '',
  is_model      boolean not null default false,
  revenues      jsonb not null default '{}'::jsonb,
  managers      jsonb not null default '{}'::jsonb,
  model_years   jsonb not null default '{}'::jsonb,
  loss_years    integer[] not null default '{}',
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_clients_tax_id on public.clients (tax_id);
create index idx_clients_company on public.clients (company_name);
create trigger trg_clients_updated before update on public.clients
  for each row execute function public.set_updated_at();

-- ── 3. billing_records ──────────────────────────
create table public.billing_records (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid references public.clients(id) on delete set null,
  fiscal_year      integer not null,
  biz_type         text not null default '법인',
  company_name     text not null default '',
  manager          text not null default '',
  revenue          numeric not null default 0,
  grand_total      numeric not null default 0,
  cfg_version_id   text not null default 'v0',
  cfg_version_label text not null default '기본',
  payload          jsonb not null,
  created_by       uuid references auth.users(id),
  saved_at         timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index idx_billing_client_year on public.billing_records (client_id, fiscal_year);
create index idx_billing_year on public.billing_records (fiscal_year);
create trigger trg_billing_updated before update on public.billing_records
  for each row execute function public.set_updated_at();

-- ── 4. billing_targets ──────────────────────────
create table public.billing_targets (
  fiscal_year  integer not null,
  client_id    uuid not null references public.clients(id) on delete cascade,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  primary key (fiscal_year, client_id)
);

-- ── 5. update_requests ──────────────────────────
create table public.update_requests (
  id          uuid primary key default gen_random_uuid(),
  requester   text not null default '',
  content     text not null default '',
  status      text not null default 'open',
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_requests_updated before update on public.update_requests
  for each row execute function public.set_updated_at();

-- ── 6. app_config ───────────────────────────────
create table public.app_config (
  id            uuid primary key default gen_random_uuid(),
  version_id    text not null default 'v0',
  version_label text not null default '기본',
  config        jsonb not null,
  is_active     boolean not null default true,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index uniq_active_config on public.app_config (is_active) where is_active;
create trigger trg_config_updated before update on public.app_config
  for each row execute function public.set_updated_at();

-- ── RLS ─────────────────────────────────────────
alter table public.profiles         enable row level security;
alter table public.clients          enable row level security;
alter table public.billing_records  enable row level security;
alter table public.billing_targets  enable row level security;
alter table public.update_requests  enable row level security;
alter table public.app_config       enable row level security;

create policy "profiles_select_all" on public.profiles
  for select to authenticated using (true);
create policy "profiles_update_self" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

do $$
declare t text;
begin
  foreach t in array array['clients','billing_records','billing_targets','update_requests','app_config']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (true);', t||'_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (true);', t||'_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (true) with check (true);', t||'_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (true);', t||'_del', t);
  end loop;
end $$;

-- auth admin 가 트리거로 profiles 쓰도록 권한 부여
grant usage on schema public to supabase_auth_admin;
grant insert, select, update on public.profiles to supabase_auth_admin;

-- ── 시드: 기본 설정 1행 ─────────────────────────
insert into public.app_config (version_id, version_label, config, is_active)
select 'v0', '기본', $${
  "성실신고기본": 2000000,
  "방문횟수": {"없음":0,"2회이하":0.02,"5회이하":0.04,"10회이하":0.06,"10회초과":0.1},
  "전화횟수": {"없음":0,"10회이하":0.02,"30회이하":0.04,"60회이하":0.06,"60회초과":0.1},
  "상담난이도": {"해당없음":0,"쉬움":0,"보통":0.02,"어려움":0.05},
  "업무해당": {"O":0.1,"X":0},
  "업무량": {"X":0,"적음":0.02,"보통":0.05,"많음":0.1},
  "업무난이도": {"해당없음":0,"쉬움":0.05,"보통":0.1,"어려움":0.15},
  "증빙금액": {"없음":0,"2회이하":10000,"5회이하":30000,"10회이하":50000,"10회초과":100000},
  "lawBrackets": [
    {"upTo":100000000,"flat":500000},{"upTo":200000000,"rate":0.0018},{"upTo":300000000,"rate":0.0016},
    {"upTo":500000000,"rate":0.0013},{"upTo":1000000000,"rate":0.001},{"upTo":1500000000,"rate":0.0008},
    {"upTo":3000000000,"rate":0.0007},{"upTo":5000000000,"rate":0.0005},{"upTo":7500000000,"rate":0.0004},
    {"upTo":10000000000,"rate":0.00035},{"upTo":20000000000,"rate":0.00025},{"upTo":30000000000,"rate":0.0002},
    {"upTo":50000000000,"rate":0.00015},{"upTo":9.9e15,"rate":0.0001}
  ],
  "perBrackets": [
    {"upTo":100000000,"flat":400000},{"upTo":200000000,"rate":0.0017},{"upTo":300000000,"rate":0.0015},
    {"upTo":500000000,"rate":0.0012},{"upTo":1000000000,"rate":0.0009},{"upTo":1500000000,"rate":0.0008},
    {"upTo":3000000000,"rate":0.0007},{"upTo":5000000000,"rate":0.0006},{"upTo":7500000000,"rate":0.0005},
    {"upTo":10000000000,"rate":0.0004},{"upTo":20000000000,"rate":0.0003},{"upTo":30000000000,"rate":0.0002},
    {"upTo":50000000000,"rate":0.0001},{"upTo":9.9e15,"rate":0.00008}
  ],
  "cfgVersionLabel": "기본", "cfgVersionId": "v0", "cfgHistory": [], "helpTexts": {}
}$$::jsonb, true;

-- ── 기존 가입자 프로필 백필 ─────────────────────
insert into public.profiles (id, name)
select id, coalesce(raw_user_meta_data->>'name', email) from auth.users
on conflict (id) do nothing;
