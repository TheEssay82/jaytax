-- 0105_receipt_line_no.sql
-- 한 전표에 입금 줄이 여럿일 수 있다(원장에 '번호' 열이 따로 있는 이유).
-- unique(ym, team, slip_no) 로는 두 번째 줄부터 저장이 막힌다 — 2026-07 taxteam 에서 실제로 막혔다.
alter table public.biz_receipt add column if not exists line_no integer not null default 1;
alter table public.biz_receipt drop constraint if exists biz_receipt_ym_team_slip_no_key;
create unique index if not exists biz_receipt_ym_team_slip_line_key
  on public.biz_receipt (ym, team, slip_no, line_no);

comment on column public.biz_receipt.line_no is
  '원장의 줄번호. 한 전표에 여러 줄이 붙을 수 있어 전표번호만으로는 구분되지 않는다.';
