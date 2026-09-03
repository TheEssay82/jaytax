-- 0133 직원 인건비 (예산 탭)
--
-- 사용자의 엑셀 '기장팀 인건비 예측' 표를 그대로 옮긴다 —
--   성명 · 세전(월) · 연봉 · 상여 · 퇴직금 · 4대보험 · 기타 지출비용 → 총부담비용
--
-- **급여는 민감정보다. 등급이 아니라 이름으로 막는다.**
-- 김민섭·김동주·정남지는 자기 급여가 걸린 자리라 보면 안 된다. 그런데 등급으로 막을 수
-- 없다 — 세 사람은 team_member·team_lead 로 갈려 있고, 그 등급에 막으면 막으면 안 되는
-- 사람(송현주 회계사는 accountant, 정남지는 team_lead)까지 걸리거나 반대로 샌다.
-- 화면(menu.ts hideFor)과 표(RLS) 양쪽에 같은 목록을 둔다.

create table if not exists public.staff_cost (
  id          uuid primary key default gen_random_uuid(),
  fy          integer not null,              -- 정산연도(7/1~익6/30). FY2026 = 2026-07~2027-06
  staff_name  text not null,
  monthly     numeric not null default 0,    -- 세전 월급
  annual      numeric not null default 0,    -- 연봉
  bonus       numeric not null default 0,    -- 상여
  severance   numeric not null default 0,    -- 퇴직금
  insurance   numeric not null default 0,    -- 4대보험
  etc_cost    numeric not null default 0,    -- 기타 지출비용
  note        text,
  created_by  uuid, created_at timestamptz not null default now(),
  updated_by  uuid, updated_at timestamptz not null default now(),
  unique (fy, staff_name)
);
comment on table public.staff_cost is
  '직원 인건비(예산). 급여 자료라 예산 탭에서만 다루고 김민섭·김동주·정남지는 볼 수 없다.';

/** 총부담비용 — 엑셀과 같은 셈. 연봉+상여+퇴직금+4대보험+기타. 세전(월)은 참고값이다. */
create or replace function public.staff_cost_total(c public.staff_cost)
returns numeric language sql immutable as $fn$
  select coalesce(c.annual,0) + coalesce(c.bonus,0) + coalesce(c.severance,0)
       + coalesce(c.insurance,0) + coalesce(c.etc_cost,0);
$fn$;

/** 급여를 봐도 되는 사람인가 — 자기 급여가 걸린 세 사람은 뺀다. */
create or replace function public.can_see_staff_cost()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((
    select p.role in ('superuser','accountant','per_head_accountant','team_lead')
       and coalesce(p.name,'') not in ('김민섭','김동주','정남지')
      from public.profiles p where p.id = auth.uid()), false);
$fn$;
revoke all on function public.can_see_staff_cost() from public, anon;
grant execute on function public.can_see_staff_cost() to authenticated;

alter table public.staff_cost enable row level security;
drop policy if exists staff_cost_sel on public.staff_cost;
create policy staff_cost_sel on public.staff_cost for select using (public.can_see_staff_cost());
drop policy if exists staff_cost_write on public.staff_cost;
create policy staff_cost_write on public.staff_cost for all
  using (public.can_see_staff_cost() and not public.is_readonly())
  with check (public.can_see_staff_cost() and not public.is_readonly());

-- 사용자의 엑셀 '2026.7.1~2027.6.30 기장팀 인건비 예측' 을 그대로 넣는다.
insert into public.staff_cost (fy, staff_name, monthly, annual, bonus, severance, insurance, etc_cost, note) values
  (2026, '정남지', 4360000, 52320000, 4160000, 4706667, 5648000, 5648000, '엑셀 기장사업부현황정리 인건비 예측'),
  (2026, '김민섭', 4040000, 48480000, 3840000, 4360000, 5232000, 5232000, '엑셀 기장사업부현황정리 인건비 예측'),
  (2026, '김동주', 3220000, 38640000, 3020000, 3471667, 4166000, 4166000, '엑셀 기장사업부현황정리 인건비 예측')
on conflict (fy, staff_name) do nothing;
