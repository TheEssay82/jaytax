-- 0139 계약갱신 대상 — 예산에서만 체크로 반영한다.
--
-- 법인세조정·종합소득세처럼 해마다 새 계약 줄이 필요한 일은 갱신을 잊으면 아무 표시 없이
-- 예상매출만 낮아진다. 2026-09-06 에 FY2025 연 계약 8건이 FY2026 으로 넘어오지 않은 것이
-- 드러났고, 그중 문지훈 님 종합소득세는 계속해야 할 건이었다.
--
-- ⚠️ **여기서 계약을 만들지 않는다**(사장님 지시 2026-09-06). 매출계약등록은 실제로 맺은
--    것만 담고, 예산은 "이렇게 될 것 같다"를 세는 자리라 계약이 없어도 넣을 수 있어야 한다.
--    그래서 체크는 biz_sales_contract 를 건드리지 않고 이 표에만 남는다.
--
-- 예산 화면 안에 있으므로 **급여를 볼 수 있는 사람만** 다룬다(can_see_staff_cost).
-- 매출 자료 자체는 민감하지 않지만, 화면이 하나라 권한을 둘로 가르면 반쪽만 보이는
-- 예산이 나온다 — 그게 더 위험하다.
create table if not exists public.budget_renewal (
  id              uuid primary key default gen_random_uuid(),
  fy              integer not null,          -- 반영할 정산연도. FY2026 = 2026-07~2027-06
  prev_contract_id uuid not null references public.biz_sales_contract(id) on delete cascade,
  include         boolean not null default true,
  amount          numeric,                   -- null = 앞 해 금액 그대로
  note            text,
  created_by      uuid, created_at timestamptz not null default now(),
  updated_by      uuid, updated_at timestamptz not null default now(),
  unique (fy, prev_contract_id)
);
comment on table public.budget_renewal is
  '계약갱신 대상의 예산 반영 체크. 계약을 만들지 않고 예산에서만 더한다(2026-09-06 지시).';
comment on column public.budget_renewal.prev_contract_id is
  '앞 해 계약. 이것이 체크를 기억하는 열쇠다 — 이번 해에는 아직 계약이 없다.';
comment on column public.budget_renewal.amount is
  'null 이면 앞 해 금액을 그대로 쓴다. 0 은 "0원"이라는 뜻이라 null 과 다르다.';

alter table public.budget_renewal enable row level security;
drop policy if exists budget_renewal_sel on public.budget_renewal;
create policy budget_renewal_sel on public.budget_renewal for select
  using (public.can_see_staff_cost());
drop policy if exists budget_renewal_write on public.budget_renewal;
create policy budget_renewal_write on public.budget_renewal for all
  using (public.can_see_staff_cost() and not public.is_readonly())
  with check (public.can_see_staff_cost() and not public.is_readonly());
