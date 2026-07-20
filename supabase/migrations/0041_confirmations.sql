-- 조회서발송관리 › 조회서등록
-- 2계층: confirmations(거래처 × 회계연도 세트) → confirmation_items(조회처 명세)
-- 회수율 등 집계는 items 에서 계산한다(2025 엑셀에서 총괄/개별이 어긋났던 문제 방지).

create table if not exists public.confirmations (
  id             uuid primary key default gen_random_uuid(),
  fiscal_year    integer not null check (fiscal_year between 2000 and 2100),
  -- 회사 마스터는 문서발송 거래처(doc_clients)를 공유한다. 표기가 달라져도 끊기지 않도록 id 로 연결.
  client_id      uuid not null references public.doc_clients(id) on delete restrict,
  company_name   text not null,            -- 등록 시점 표기 스냅샷(조서 출력용)
  base_date      date not null,            -- 조회발송기준일 (기본 해당 회계연도 12/31)
  accountant_id  uuid references public.profiles(id),
  accountant_name text not null default '',-- 스냅샷
  status         text not null default '작성중' check (status in ('작성중','등록완료')),
  created_by     uuid references auth.users(id),
  updated_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- 한 거래처는 한 회계연도에 하나의 조회서 세트만 갖는다.
  unique (fiscal_year, client_id)
);

create index if not exists confirmations_year_idx on public.confirmations (fiscal_year desc, company_name);

create table if not exists public.confirmation_items (
  id              uuid primary key default gen_random_uuid(),
  confirmation_id uuid not null references public.confirmations(id) on delete cascade,
  seq             integer not null default 0,          -- 조서의 No.
  kind            text not null check (kind in ('은행','보험','보증기관','증권','여신전문','비은행금융')),
  institution     text not null check (length(btrim(institution)) > 0),
  -- 전자조회면 주소 대신 '전자조회'로 출력한다. 2025년 260건 중 194건이 전자조회.
  is_electronic   boolean not null default false,
  address         text,
  postal_code     text,
  phone           text,
  dept            text,
  contact_name    text,
  contact_title   text,
  note            text,                                 -- 기관별 신청 노하우 등 비고
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists confirmation_items_parent_idx
  on public.confirmation_items (confirmation_id, seq);

drop trigger if exists trg_confirmations_touch on public.confirmations;
create trigger trg_confirmations_touch before update on public.confirmations
  for each row execute function public.doc_touch_updated();

-- items 는 updated_by 컬럼이 없으므로 updated_at 만 갱신하는 전용 함수를 쓴다.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists trg_confirmation_items_touch on public.confirmation_items;
create trigger trg_confirmation_items_touch before update on public.confirmation_items
  for each row execute function public.touch_updated_at();

alter table public.confirmations enable row level security;
alter table public.confirmation_items enable row level security;

-- 조회·쓰기 모두 내부 구성원(외부인 제외). 읽기전용 계정은 restrictive 로 쓰기 차단.
drop policy if exists confirmations_all on public.confirmations;
create policy confirmations_all on public.confirmations
  for all to authenticated
  using (not public.is_external()) with check (not public.is_external());

drop policy if exists confirmations_ro_upd on public.confirmations;
create policy confirmations_ro_upd on public.confirmations
  as restrictive for update to authenticated using (not public.is_readonly());
drop policy if exists confirmations_ro_del on public.confirmations;
create policy confirmations_ro_del on public.confirmations
  as restrictive for delete to authenticated using (not public.is_readonly());
drop policy if exists confirmations_ro_ins on public.confirmations;
create policy confirmations_ro_ins on public.confirmations
  as restrictive for insert to authenticated with check (not public.is_readonly());

drop policy if exists confirmation_items_all on public.confirmation_items;
create policy confirmation_items_all on public.confirmation_items
  for all to authenticated
  using (not public.is_external()) with check (not public.is_external());

drop policy if exists confirmation_items_ro_upd on public.confirmation_items;
create policy confirmation_items_ro_upd on public.confirmation_items
  as restrictive for update to authenticated using (not public.is_readonly());
drop policy if exists confirmation_items_ro_del on public.confirmation_items;
create policy confirmation_items_ro_del on public.confirmation_items
  as restrictive for delete to authenticated using (not public.is_readonly());
drop policy if exists confirmation_items_ro_ins on public.confirmation_items;
create policy confirmation_items_ro_ins on public.confirmation_items
  as restrictive for insert to authenticated with check (not public.is_readonly());
