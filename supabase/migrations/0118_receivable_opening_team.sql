-- 기초미수금에도 팀을 적어 둔다.
--
-- 수금·미수금 화면의 팀 셀렉터가 원장 업로드와 나이 분석에만 걸리고
-- 거래처별 잔액 표에는 걸리지 않았다. 기초미수금에 팀이 없어서였다 —
-- 그래서 taxteam 을 골라 놓고도 잔액에는 감사팀 기초가 섞여 들어갔다.
alter table public.biz_receivable_opening
  add column if not exists team text not null default 'taxteam';

-- 지금 들어 있는 값은 적재할 때 note 로 구분해 두었다(감사팀분은 '감사팀…'으로 시작).
update public.biz_receivable_opening
   set team = '감사team'
 where note like '감사팀%' and team <> '감사team';

create index if not exists biz_receivable_opening_team_idx on public.biz_receivable_opening (team);

comment on column public.biz_receivable_opening.team is
  '어느 팀의 기초미수금인가 — 화면의 팀 필터가 이 값을 쓴다.';
