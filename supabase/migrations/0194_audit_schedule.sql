-- 0194 기말감사일정 — 감사 대상 연도(fiscal_year)마다 회사 × 일(별도감사 · 재고실사 …)을 다음 해 1~3월 달력에 배정한다(사용자 2026-11-15).
--
-- 원본은 엑셀 「거래처관리등_FY26.xlsx」 [기말일정검토26] 시트(2026-11-04 claude.ai 대화에서 v9 까지 다듬음).
-- 사용자 원칙: 배정(미확정)=노랑 · 확정=녹색 · 같은 날 필드가 팀 수보다 많으면 분홍 · 외감·상장은 3/23 이전 현장 종료 ·
--             PEF·SPC 는 주말 · 기말 착수는 1/25 · 설 전날·다음날은 감사 곤란. 점검·색은 화면에서 계산하고 여기엔 배정만 둔다.
-- 감사팀(is_audit_staff)만 읽고 쓴다. 체험 계정은 보지 않는다.

create table if not exists public.audit_schedule_item (
  id             uuid primary key default gen_random_uuid(),
  fiscal_year    integer not null check (fiscal_year between 2020 and 2100),   -- 감사 대상 연도(2026 → 2027년 1~3월 일정)
  entity_id      uuid references public.biz_entity(id) on delete set null,    -- 거래처(없으면 이름만)
  company        text not null check (length(trim(company)) > 0),
  kind           text not null default '외감' check (kind in ('상장', '외감', '임의', 'PEF', 'SPC', '용역')),
  task           text not null default '개별감사' check (length(trim(task)) > 0),   -- 별도감사 · 연결감사 · 내부회계 · 재고실사 · 중간감사 …
  days_needed    numeric(4,1) not null default 1 check (days_needed >= 0),
  days_uncertain boolean not null default false,                               -- 「2?」 — 늘거나 줄 수 있음(오톰 의견거절 가능)
  confirmed      boolean not null default false,                               -- 회사와 날짜 확정(녹색)
  sort           integer not null default 0,
  note           text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id) on delete set null,
  updated_at     timestamptz not null default now()
);
comment on table public.audit_schedule_item is
  '기말감사일정 — 회사 × 일(별도감사·재고실사 …). 배정한 날은 audit_schedule_day. 사용자 2026-11-15, 원본 엑셀 기말일정검토26.';
create index if not exists audit_schedule_item_fy_idx on public.audit_schedule_item(fiscal_year, sort);

-- 배정한 날 — 칸에 적는 글(현장 n일차는 화면이 세고, 재고실사 담당 이니셜 「조정김」 같은 것만 mark 에).
create table if not exists public.audit_schedule_day (
  item_id  uuid not null references public.audit_schedule_item(id) on delete cascade,
  day      date not null,
  mark     text not null default '',
  primary key (item_id, day)
);
create index if not exists audit_schedule_day_day_idx on public.audit_schedule_day(day);

-- 연도별 기준 — 팀 수 · 착수 가능일 · 한도(엑셀 DG·DH 열).
create table if not exists public.audit_schedule_setting (
  fiscal_year     integer primary key,
  teams           integer not null default 1 check (teams between 1 and 9),
  start_day       date not null,          -- 기말 필드 착수 가능일(1/25)
  deadline        date not null,          -- 외감·상장 현장 종료 한도(3/22 — 3/23 이전)
  deadline_other  date not null,          -- 임의·PEF·SPC 한도(3/31)
  updated_by      uuid references auth.users(id) on delete set null,
  updated_at      timestamptz not null default now()
);

create or replace function public.audit_schedule_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists audit_schedule_item_touch on public.audit_schedule_item;
create trigger audit_schedule_item_touch before insert or update on public.audit_schedule_item
  for each row execute function public.audit_schedule_touch();

create or replace function public.audit_schedule_setting_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists audit_schedule_setting_touch on public.audit_schedule_setting;
create trigger audit_schedule_setting_touch before insert or update on public.audit_schedule_setting
  for each row execute function public.audit_schedule_setting_touch();

revoke execute on function public.audit_schedule_touch(), public.audit_schedule_setting_touch() from public, anon, authenticated;

alter table public.audit_schedule_item enable row level security;
alter table public.audit_schedule_day enable row level security;
alter table public.audit_schedule_setting enable row level security;

do $$
declare t text;
begin
  foreach t in array array['audit_schedule_item', 'audit_schedule_day', 'audit_schedule_setting'] loop
    execute format('drop policy if exists %1$s_sel on public.%1$s', t);
    execute format('create policy %1$s_sel on public.%1$s for select using (public.is_audit_staff() and not public.is_sandbox())', t);
    execute format('drop policy if exists %1$s_ins on public.%1$s', t);
    execute format('create policy %1$s_ins on public.%1$s for insert with check (public.is_audit_staff() and not public.is_readonly() and not public.is_sandbox())', t);
    execute format('drop policy if exists %1$s_upd on public.%1$s', t);
    execute format('create policy %1$s_upd on public.%1$s for update using (public.is_audit_staff() and not public.is_readonly() and not public.is_sandbox()) with check (public.is_audit_staff() and not public.is_readonly() and not public.is_sandbox())', t);
    execute format('drop policy if exists %1$s_del on public.%1$s', t);
    execute format('create policy %1$s_del on public.%1$s for delete using (public.is_audit_staff() and not public.is_readonly() and not public.is_sandbox())', t);
  end loop;
end $$;

insert into public.audit_schedule_setting (fiscal_year, teams, start_day, deadline, deadline_other)
values (2026, 1, '2027-01-25', '2027-03-22', '2027-03-31')
on conflict (fiscal_year) do nothing;
