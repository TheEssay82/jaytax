-- 그 달의 청구예정 초안(taxteam 월 마감의 출발점).
--
-- 순서가 뒤집혔다. 지금까지 ①청구예정은 매출계약을 그때그때 전개한 '예상'이었고,
-- 담당자가 손댈 수 없었다. 실제 업무는 반대다 —
--   엑셀에서 **전월 세금계산서를 그대로 복사**해 놓고, 담당자가 그 위에서 고치고 지우고 더한다.
--   매출계약은 '맞게 하고 있나'를 **대사**하는 참고자료다.
-- 그래서 복사본을 저장해 두는 자리가 필요하다. 그것이 이 표다.
--
-- 흐름: 전개(전월 복사) → 담당자 수정·확인 → 김민섭이 발행요청으로 등록(초안은 사라진다).
create table if not exists public.biz_invoice_draft (
  id             uuid primary key default gen_random_uuid(),
  ym             text not null,                     -- 'YYYY-MM' 귀속월
  team           text not null default 'taxteam',
  entity_id      uuid references public.biz_entity(id) on delete cascade,
  place_id       uuid references public.biz_place(id) on delete set null,
  contract_id    uuid references public.biz_sales_contract(id) on delete set null,
  installment_id uuid,
  -- 스냅샷 — 계약이 나중에 바뀌어도 이 달의 초안은 그대로여야 한다.
  company_name   text not null default '',
  place_name     text not null default '',
  contract_code  text not null default '',
  type_label     text not null default '',
  erp_account    text not null default '',
  cpa            text not null default '',
  staff          text not null default '',
  doc_email      text,
  supply_amount  numeric not null default 0,
  label          text not null default '',          -- 분할 회차명
  summary        text,                              -- 발행 시 적요
  billing_cycle  text not null default '',
  billing_month  integer,
  confirmed      boolean not null default true,
  -- 어디서 왔는가 · 전월엔 얼마였는가(변동 표시용)
  source         text not null default '전월복사',    -- 전월복사 | 계약추가 | 수동추가
  prev_amount    numeric not null default 0,
  note           text,
  created_by     uuid references auth.users(id),
  updated_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists biz_invoice_draft_ym_idx on public.biz_invoice_draft (ym, team);
create index if not exists biz_invoice_draft_contract_idx on public.biz_invoice_draft (contract_id);

comment on table public.biz_invoice_draft is
  '그 달 청구예정 초안. 전월 발행요청을 복사해 만들고, 담당자가 고친 뒤 발행요청으로 등록한다.';

alter table public.biz_invoice_draft enable row level security;

drop policy if exists biz_invoice_draft_sel on public.biz_invoice_draft;
create policy biz_invoice_draft_sel on public.biz_invoice_draft
  for select to authenticated using (not public.is_external());

drop policy if exists biz_invoice_draft_write on public.biz_invoice_draft;
create policy biz_invoice_draft_write on public.biz_invoice_draft
  for all to authenticated
  using (not public.is_external() and not public.is_readonly() and not public.is_perhead())
  with check (not public.is_external() and not public.is_readonly() and not public.is_perhead());

drop trigger if exists biz_invoice_draft_created_by on public.biz_invoice_draft;
create trigger biz_invoice_draft_created_by
  before insert or update on public.biz_invoice_draft
  for each row execute function public.biz_set_created_by();

grant select, insert, update, delete on public.biz_invoice_draft to authenticated;
