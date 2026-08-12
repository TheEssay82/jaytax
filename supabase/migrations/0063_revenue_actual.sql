-- 0063: 월별 매출 실적(actuals). 계약(projection)과 분리된 실제 청구실적 보관.
--   현황조회에서 '실적 vs 예산/계약' 비교용. 외부 정산자료(엑셀 등) 이관 + 향후 청구시스템 연동.
--   금액은 공급가액(순액). category=업무 세분류(기장/신고대리/원천/컨설팅/세무조정 등).

create table if not exists public.biz_revenue_actual (
  id             uuid primary key default gen_random_uuid(),
  ym             text not null,                                     -- 청구 귀속 월 'YYYY-MM'
  settlement_year int,                                              -- 정산연도(회계연도 7/1~익6/30) — 월에서 도출
  entity_id      uuid references public.biz_entity(id) on delete set null,  -- 거래처등록 매칭(미매칭 null)
  entity_name    text,                                              -- 원본 거래처명 스냅샷
  team           text not null default 'taxteam' check (team in ('감사team','taxteam')),
  category       text,                                              -- 기장/신고대리/원천/컨설팅/세무조정 등
  biz_type       text,                                              -- 법인/개인
  cpa            text,                                              -- 담당회계사
  manager        text,                                              -- 담당자
  amount         numeric(15,2) not null default 0,                  -- 공급가액(순액)
  invoice_no     text,                                              -- 원본 invoiceNo(추적)
  source         text,                                              -- 출처(예: 2025실적xlsx)
  note           text,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id),
  updated_at     timestamptz not null default now()
);
create index if not exists biz_revactual_ym_idx on public.biz_revenue_actual(ym);
create index if not exists biz_revactual_sy_idx on public.biz_revenue_actual(settlement_year);
create index if not exists biz_revactual_entity_idx on public.biz_revenue_actual(entity_id);
create index if not exists biz_revactual_team_idx on public.biz_revenue_actual(team);

drop trigger if exists trg_biz_revactual_bi on public.biz_revenue_actual;
create trigger trg_biz_revactual_bi before insert on public.biz_revenue_actual for each row execute function public.biz_set_created_by();
drop trigger if exists trg_biz_revactual_bu on public.biz_revenue_actual;
create trigger trg_biz_revactual_bu before update on public.biz_revenue_actual for each row execute function public.biz_touch_updated();

-- RLS: 조회=내부(외부·인당회계사 차단) / 편집=회계사·팀장·최고관리자 & not readonly
grant execute on function public.biz_can_reveal() to authenticated;
alter table public.biz_revenue_actual enable row level security;
drop policy if exists biz_revactual_sel on public.biz_revenue_actual;
create policy biz_revactual_sel on public.biz_revenue_actual for select to authenticated
  using (not public.is_external() and not public.is_perhead());
drop policy if exists biz_revactual_ins on public.biz_revenue_actual;
create policy biz_revactual_ins on public.biz_revenue_actual for insert to authenticated
  with check (public.biz_can_reveal() and not public.is_readonly());
drop policy if exists biz_revactual_upd on public.biz_revenue_actual;
create policy biz_revactual_upd on public.biz_revenue_actual for update to authenticated
  using (public.biz_can_reveal() and not public.is_readonly()) with check (public.biz_can_reveal() and not public.is_readonly());
drop policy if exists biz_revactual_del on public.biz_revenue_actual;
create policy biz_revactual_del on public.biz_revenue_actual for delete to authenticated
  using (public.biz_can_reveal() and not public.is_readonly());
