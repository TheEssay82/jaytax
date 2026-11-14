-- 0195 기말감사일정 — 나가는 사람 · 연도 마감 · 상장사 주총일(사용자 2026-11-15 두 번째 요청).
--
-- · 나가는 사람(staff): 성 한 글자(조=조현규 · 김=김준성 · 정=정우철 · 윤=윤영미). 기말감사 줄은 기본 조·김·정,
--   윤영미가 같이 가는 거래처(윤성·제이스튜디오·더그림·아비즈·오톰·알티스트·휴식·대양이티에스·유니퓨전)는 윤까지.
--   재고실사는 날마다 사람이 달라 날짜 칸 글(mark, 「조정김」)로 둔다.
-- · 마감(closed): 지난 연도(FY2025)는 실제 진행 내역으로 닫는다 — 닫힌 해는 일정을 고칠 수 없다(다시 열기는 기준에서).
-- · 상장사 주총일: 주총 6주 전까지 제시재무제표를 증선위에 제출해야 한다(사용자) — 달력에 🚩 로 보인다.

alter table public.audit_schedule_item add column if not exists staff text[] not null default '{}';
alter table public.audit_schedule_setting add column if not exists closed boolean not null default false;

create table if not exists public.audit_schedule_company (
  fiscal_year  integer not null,
  company      text not null,
  agm_date     date,                -- 정기주주총회 예정일
  primary key (fiscal_year, company)
);
alter table public.audit_schedule_company enable row level security;
drop policy if exists audit_schedule_company_sel on public.audit_schedule_company;
create policy audit_schedule_company_sel on public.audit_schedule_company for select using (public.is_audit_staff() and not public.is_sandbox());
drop policy if exists audit_schedule_company_ins on public.audit_schedule_company;
create policy audit_schedule_company_ins on public.audit_schedule_company for insert with check (public.is_audit_staff() and not public.is_readonly() and not public.is_sandbox());
drop policy if exists audit_schedule_company_upd on public.audit_schedule_company;
create policy audit_schedule_company_upd on public.audit_schedule_company for update using (public.is_audit_staff() and not public.is_readonly() and not public.is_sandbox()) with check (public.is_audit_staff() and not public.is_readonly() and not public.is_sandbox());
drop policy if exists audit_schedule_company_del on public.audit_schedule_company;
create policy audit_schedule_company_del on public.audit_schedule_company for delete using (public.is_audit_staff() and not public.is_readonly() and not public.is_sandbox());

-- 마감한 해는 줄 · 칸을 바꿀 수 없다(제한 정책 — 위 0194 정책과 함께 걸린다).
create or replace function public.audit_schedule_open(p_fy integer) returns boolean
language sql stable security definer set search_path = public as $$
  select not coalesce((select closed from public.audit_schedule_setting where fiscal_year = p_fy), false)
$$;
revoke all on function public.audit_schedule_open(integer) from public, anon;
grant execute on function public.audit_schedule_open(integer) to authenticated;

drop policy if exists open_ins on public.audit_schedule_item;
create policy open_ins on public.audit_schedule_item as restrictive for insert with check (public.audit_schedule_open(fiscal_year));
drop policy if exists open_upd on public.audit_schedule_item;
create policy open_upd on public.audit_schedule_item as restrictive for update using (public.audit_schedule_open(fiscal_year)) with check (public.audit_schedule_open(fiscal_year));
drop policy if exists open_del on public.audit_schedule_item;
create policy open_del on public.audit_schedule_item as restrictive for delete using (public.audit_schedule_open(fiscal_year));
drop policy if exists open_ins on public.audit_schedule_day;
create policy open_ins on public.audit_schedule_day as restrictive for insert
  with check (public.audit_schedule_open((select i.fiscal_year from public.audit_schedule_item i where i.id = item_id)));
drop policy if exists open_upd on public.audit_schedule_day;
create policy open_upd on public.audit_schedule_day as restrictive for update
  using (public.audit_schedule_open((select i.fiscal_year from public.audit_schedule_item i where i.id = item_id)))
  with check (public.audit_schedule_open((select i.fiscal_year from public.audit_schedule_item i where i.id = item_id)));
drop policy if exists open_del on public.audit_schedule_day;
create policy open_del on public.audit_schedule_day as restrictive for delete
  using (public.audit_schedule_open((select i.fiscal_year from public.audit_schedule_item i where i.id = item_id)));
drop policy if exists open_ins on public.audit_schedule_company;
create policy open_ins on public.audit_schedule_company as restrictive for insert with check (public.audit_schedule_open(fiscal_year));
drop policy if exists open_upd on public.audit_schedule_company;
create policy open_upd on public.audit_schedule_company as restrictive for update using (public.audit_schedule_open(fiscal_year)) with check (public.audit_schedule_open(fiscal_year));

-- FY2026 기존 줄 — 재고실사가 아닌 줄에 기본 사람(조·김·정, 윤영미 동행 거래처는 윤까지).
update public.audit_schedule_item set staff =
  case when company ~ '윤성에프앤씨|제이스튜디오|더그림엔터테인먼트|에이치앤아비즈|오톰|알티스트|휴식|대양이티에스|유니퓨전'
       then array['조', '김', '정', '윤'] else array['조', '김', '정'] end
where fiscal_year = 2026 and task !~ '재고실사' and staff = '{}';

-- 윤성에프앤씨 FY2026 주총 3/31(2026-11-04 일정 대화 기준) → 제시재무제표 제출 2/17까지.
insert into public.audit_schedule_company (fiscal_year, company, agm_date)
values (2026, '㈜윤성에프앤씨', '2027-03-31')
on conflict (fiscal_year, company) do nothing;
