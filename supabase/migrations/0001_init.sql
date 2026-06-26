-- 인덕회계법인 세무조정수수료 관리 시스템 — 초기 스키마
-- 구조: 직원(staff) 로그인 + 공용 DB. 로그인한 직원은 모든 데이터를 공유한다.
-- RLS: 인증된 사용자(authenticated)는 전 테이블 읽기/쓰기 가능. 익명은 차단.

-- ──────────────────────────────────────────────
-- 0. 공통: updated_at 자동 갱신 트리거 함수
-- ──────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ──────────────────────────────────────────────
-- 1. 직원 프로필 (auth.users 1:1)
-- ──────────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null default '',
  role        text not null default 'staff',   -- 'admin' | 'staff'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_profiles_updated
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- 신규 가입 시 프로필 자동 생성
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ──────────────────────────────────────────────
-- 2. 거래처 (원본 ind_cli4)
-- ──────────────────────────────────────────────
create table if not exists public.clients (
  id            uuid primary key default gen_random_uuid(),
  biz_type      text not null default '법인',       -- '법인' | '개인'
  company_name  text not null default '',
  trade_name    text not null default '',
  tax_id        text not null default '',           -- 사업자등록번호
  rep_name      text not null default '',
  manager       text not null default '',
  bank_account  text not null default '',
  is_model      boolean not null default false,     -- 성실신고
  revenues      jsonb not null default '{}'::jsonb,  -- {year: amount}
  managers      jsonb not null default '{}'::jsonb,  -- {year: name}
  model_years   jsonb not null default '{}'::jsonb,  -- {year: boolean}
  loss_years    integer[] not null default '{}',     -- 상실 연도
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_clients_tax_id on public.clients (tax_id);
create index if not exists idx_clients_company on public.clients (company_name);

create trigger trg_clients_updated
  before update on public.clients
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────
-- 3. 청구기록 (원본 ind_hist4)
--    조회용 핵심 컬럼 + payload(전체 스냅샷 jsonb)
-- ──────────────────────────────────────────────
create table if not exists public.billing_records (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid references public.clients(id) on delete set null,
  fiscal_year      integer not null,
  biz_type         text not null default '법인',
  company_name     text not null default '',
  manager          text not null default '',
  revenue          numeric not null default 0,
  grand_total      numeric not null default 0,        -- 최종 청구금액(VAT 포함)
  cfg_version_id   text not null default 'v0',
  cfg_version_label text not null default '기본',
  payload          jsonb not null,                    -- WizardState + CalcResult 전체
  created_by       uuid references auth.users(id),
  saved_at         timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_billing_client_year on public.billing_records (client_id, fiscal_year);
create index if not exists idx_billing_year on public.billing_records (fiscal_year);

create trigger trg_billing_updated
  before update on public.billing_records
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────
-- 4. 청구대상 (원본 ind_tgt4): {year: {clientId: true}}
--    → (fiscal_year, client_id) 한 행 = 대상 선택됨
-- ──────────────────────────────────────────────
create table if not exists public.billing_targets (
  fiscal_year  integer not null,
  client_id    uuid not null references public.clients(id) on delete cascade,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  primary key (fiscal_year, client_id)
);

-- ──────────────────────────────────────────────
-- 5. 업데이트요청 (원본 ind_reqs4)
-- ──────────────────────────────────────────────
create table if not exists public.update_requests (
  id          uuid primary key default gen_random_uuid(),
  requester   text not null default '',
  content     text not null default '',
  status      text not null default 'open',   -- 'open' | 'done'
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_requests_updated
  before update on public.update_requests
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────
-- 6. 설정 (원본 ind_cfg4 / DEF) — 공용 단일 설정 + 버전
-- ──────────────────────────────────────────────
create table if not exists public.app_config (
  id            uuid primary key default gen_random_uuid(),
  version_id    text not null default 'v0',
  version_label text not null default '기본',
  config        jsonb not null,                 -- AppConfig 전체
  is_active     boolean not null default true,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists uniq_active_config
  on public.app_config (is_active) where is_active;

create trigger trg_config_updated
  before update on public.app_config
  for each row execute function public.set_updated_at();

-- ──────────────────────────────────────────────
-- RLS: 인증된 직원은 전부 접근, 익명은 차단
-- ──────────────────────────────────────────────
alter table public.profiles         enable row level security;
alter table public.clients          enable row level security;
alter table public.billing_records  enable row level security;
alter table public.billing_targets  enable row level security;
alter table public.update_requests  enable row level security;
alter table public.app_config       enable row level security;

-- 프로필: 본인 것 + 전체 조회 가능, 본인 것만 수정
create policy "profiles_select_all" on public.profiles
  for select to authenticated using (true);
create policy "profiles_update_self" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- 공용 데이터 테이블: 인증 사용자 전체 권한
do $$
declare t text;
begin
  foreach t in array array[
    'clients','billing_records','billing_targets','update_requests','app_config'
  ]
  loop
    execute format('create policy %I on public.%I for select to authenticated using (true);', t||'_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (true);', t||'_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (true) with check (true);', t||'_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (true);', t||'_del', t);
  end loop;
end $$;
