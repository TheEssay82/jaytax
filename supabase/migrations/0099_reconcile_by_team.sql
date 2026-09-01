-- 0099_reconcile_by_team.sql
-- 대사를 **팀별로** 나눈다.
--
-- 감사팀 거래전표를 올렸는데 taxteam 발행요청 63건이 '❗우리에만 있음'으로 쏟아졌다.
-- 대사가 팀을 구분하지 않고 그 달 요청 전체와 비교했기 때문이다.
-- 한 달에 두 팀의 파일이 각각 올라오므로 (ym, team) 이 대사의 단위다.
alter table public.biz_erp_slip          add column if not exists team text not null default 'taxteam';
alter table public.biz_invoice_reconcile add column if not exists team text not null default 'taxteam';

do $$ begin
  alter table public.biz_erp_slip add constraint biz_erp_slip_team_chk
    check (team in ('감사team', 'taxteam'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.biz_invoice_reconcile add constraint biz_invoice_reconcile_team_chk
    check (team in ('감사team', 'taxteam'));
exception when duplicate_object then null; end $$;

alter table public.biz_erp_slip drop constraint if exists biz_erp_slip_ym_slip_no_key;
create unique index if not exists biz_erp_slip_ym_team_slip_key
  on public.biz_erp_slip (ym, team, slip_no);
drop index if exists biz_erp_slip_bizno_idx;
create index if not exists biz_erp_slip_bizno_idx on public.biz_erp_slip (ym, team, biz_no);

alter table public.biz_invoice_reconcile drop constraint if exists biz_invoice_reconcile_pkey;
alter table public.biz_invoice_reconcile add primary key (ym, team);

comment on column public.biz_erp_slip.team is
  '이 전표가 속한 팀. ERP 부서명(기장24팀=taxteam, 2본부5팀=감사team)에서 정한다.';
