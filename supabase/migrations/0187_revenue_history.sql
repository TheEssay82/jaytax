-- 0187 팀별 연도 매출 — 앱을 쓰기 전 해들(성장 그래프용).
--
-- 사용자 요구(2026-10-29) 「기장팀 및 감사팀의 연도별 성장그래프도 보고싶어」.
-- 앱에 매출 자료가 있는 것은 FY2025(biz_revenue_actual)부터다. 그 앞 해는 해마다의
-- 팀결산 엑셀(「20xx년 계약관리」)에서 팀 합계만 옮겨 둔다 — 거래처별 줄은 없다.
-- FY2025 부터는 이 표를 보지 않고 실적 · 청구 · 계약에서 바로 센다(이중계상 방지).
create table if not exists public.biz_revenue_history (
  fy      integer not null,          -- 정산연도. FY2024 = 2024-07~2025-06
  team    text    not null check (team in ('감사team', 'taxteam')),
  grp     text    not null,          -- 감사팀: 감사·용역·세무조정 / 기장팀: 기장료·조정수수료·기타
  amount  numeric not null default 0,   -- 공급가액(부가세 별도)
  source  text,                      -- 원본 파일 › 시트!셀
  note    text,
  updated_at timestamptz not null default now(),
  primary key (fy, team, grp)
);
comment on table public.biz_revenue_history is
  'FY2025 이전 팀별 연 매출(팀결산 엑셀에서 옮김). 성장 그래프에만 쓴다.';

alter table public.biz_revenue_history enable row level security;
drop policy if exists rev_hist_sel on public.biz_revenue_history;
create policy rev_hist_sel on public.biz_revenue_history for select
  using (public.can_see_staff_cost());
drop policy if exists rev_hist_write on public.biz_revenue_history;
create policy rev_hist_write on public.biz_revenue_history for all
  using (public.can_see_staff_cost() and not public.is_readonly())
  with check (public.can_see_staff_cost() and not public.is_readonly());
drop policy if exists sbx_select on public.biz_revenue_history;
create policy sbx_select on public.biz_revenue_history as restrictive for select
  using (not public.is_sandbox());

-- 옮겨 둔 값(2026-10-29) — 감사·용역 = 그해 팀결산 예산 시트 계약금액, 감사팀 세무조정 = 자가 세무조정 입금÷1.1.
-- 기장팀: FY2022~2024 = 기장사업부 실적표(청구 기준, 앱의 FY2025 와 같은 기준) / FY2019~2021 = 팀결산 입금÷1.1.
-- FY2019 는 2019-04~2020-03, FY2020 은 결산월을 바꾼 해라 15개월(2020-04~2021-06).
-- 값은 이 마이그레이션을 적용할 때 SQL 로 넣었다(biz_revenue_history 의 source 열에 원본 셀이 있다).
