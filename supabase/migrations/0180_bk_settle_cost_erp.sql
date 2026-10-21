-- 0180 기장배분 — 기장팀 비용의 ERP 실제 발생분(사용자 2026-10-21).
--
-- 비용 칸(bk_settle_cost)은 결산 엑셀(급여_연도 · (FY연도) 기장팀 칸)에서 옮겨 적은 숫자다.
-- 여기에는 ERP 부서별원장(기장24팀)의 비용 계정을 계정 · 소분류 · 사원으로 모은 실제 발생분을 담아 나란히 대 본다.
--   · 계정 → 비용 항목(1) 급여+상여 … 12) 퇴직연금수수료)은 앱이 정한다(bkSettle.ts erpCostItem) — 표에는 원장 그대로.
--   · 다시 올리면 같은 칸은 덮어쓰고, 이번 파일에 없는 칸은 0으로 둔다(지우기 정책 없음).
--   · lines = 그 칸의 원장 줄(전표번호 · 날짜 · 적요 · 금액) — 화면에서 펼쳐 본다.

create table if not exists public.bk_settle_cost_erp (
  fy            integer not null references public.bk_settle(fy),
  acct          text not null,                 -- ERP 계정(직원급여 · 세금과공과금 …)
  sub           text not null default '',      -- 소분류(4대보험 · 주민세 종업원분 · 퇴직연금수수료 …)
  staff         text not null default '',      -- 원장 사원명(팀 공통이면 '')
  amount        numeric not null default 0,    -- 차변 − 대변
  n             integer not null default 0,    -- 원장 줄 수
  lines         jsonb not null default '[]'::jsonb,
  source        text,
  updated_at    timestamptz not null default now(),
  updated_name  text,
  primary key (fy, acct, sub, staff)
);
comment on table public.bk_settle_cost_erp is '기장배분 — 기장팀 비용 ERP 실제 발생분(부서별원장 비용 계정, 계정·소분류·사원별).';

drop trigger if exists bk_settle_cost_erp_touch on public.bk_settle_cost_erp;
create trigger bk_settle_cost_erp_touch before update on public.bk_settle_cost_erp for each row execute function public.dsd_touch();
alter table public.bk_settle_cost_erp enable row level security;
revoke all on public.bk_settle_cost_erp from anon;
drop policy if exists bk_settle_cost_erp_sel on public.bk_settle_cost_erp;
create policy bk_settle_cost_erp_sel on public.bk_settle_cost_erp for select using (public.expense_member_name() is not null);
drop policy if exists bk_settle_cost_erp_ins on public.bk_settle_cost_erp;
create policy bk_settle_cost_erp_ins on public.bk_settle_cost_erp for insert with check (public.expense_member_name() is not null and not public.is_readonly());
drop policy if exists bk_settle_cost_erp_upd on public.bk_settle_cost_erp;
create policy bk_settle_cost_erp_upd on public.bk_settle_cost_erp for update using (public.expense_member_name() is not null and not public.is_readonly()) with check (public.expense_member_name() is not null and not public.is_readonly());
