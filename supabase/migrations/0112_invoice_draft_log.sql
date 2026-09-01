-- 청구예정 초안을 누가 무엇을 고쳤는가.
--
-- 담당자 3인이 각자 맡은 곳을 고치고 '확인'을 누르면, 김민섭은 그 확인만 보고 등록해야 한다.
-- 그런데 '확인했다'만으로는 무엇을 손댔는지 알 수 없다 — 특히 **삭제**는 행이 사라져 흔적이 없다.
-- 그래서 고침·추가·삭제를 여기에 남기고, 확인 기록에 '수정 3 · 추가 1 · 삭제 2' 처럼 붙인다.
create table if not exists public.biz_invoice_draft_log (
  id         uuid primary key default gen_random_uuid(),
  ym         text not null,
  team       text not null default 'taxteam',
  draft_id   uuid,                                  -- 삭제되면 남지 않으므로 참조하지 않는다
  company    text not null default '',
  place      text not null default '',
  action     text not null,                         -- 추가 | 수정 | 삭제
  field      text not null default '',              -- 금액 | 담당직원 | 적요 | ''
  before_val text not null default '',
  after_val  text not null default '',
  amount     numeric not null default 0,            -- 추가·삭제된 금액(집계용)
  actor      uuid references auth.users(id),
  at         timestamptz not null default now()
);
create index if not exists biz_invoice_draft_log_ym_idx on public.biz_invoice_draft_log (ym, team);

comment on table public.biz_invoice_draft_log is
  '청구예정 초안의 수정·추가·삭제 기록. 담당자 확인 요약과 김민섭의 검토에 쓴다.';

alter table public.biz_invoice_draft_log enable row level security;

drop policy if exists biz_invoice_draft_log_sel on public.biz_invoice_draft_log;
create policy biz_invoice_draft_log_sel on public.biz_invoice_draft_log
  for select to authenticated using (not public.is_external());

drop policy if exists biz_invoice_draft_log_ins on public.biz_invoice_draft_log;
create policy biz_invoice_draft_log_ins on public.biz_invoice_draft_log
  for insert to authenticated
  with check (not public.is_external() and not public.is_readonly() and not public.is_perhead());

-- 월 초기화 때 함께 지운다.
drop policy if exists biz_invoice_draft_log_del on public.biz_invoice_draft_log;
create policy biz_invoice_draft_log_del on public.biz_invoice_draft_log
  for delete to authenticated
  using (not public.is_external() and not public.is_readonly() and not public.is_perhead());

grant select, insert, delete on public.biz_invoice_draft_log to authenticated;
