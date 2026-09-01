-- ERP 부서별 미수금대장(건별).
--
-- 지금까지 미수금의 나이는 추정이었다. 기초미수금은 2026-07-01 한 덩어리였고,
-- 입금이 어느 청구를 갚았는지 몰라 오래된 것부터 갚은 것으로 가정(FIFO)했다.
-- 그런데 ERP 미수금대장은 **건별로** 그것을 이미 알고 있다 —
--   invoiceNo(= 거래전표번호, 26-0225-0099 → 2026-02-25) · 청구액 · 기초이월액 · 당기입금액 · 잔금
-- 그래서 이 표를 올리면 나이를 추정하지 않고 **실제 발행일**로 잰다.
create table if not exists public.biz_ar_item (
  id           uuid primary key default gen_random_uuid(),
  ym           text not null,                    -- 대장 조회월
  team         text not null default 'taxteam',
  invoice_no   text not null,                    -- 거래전표번호
  issued_date  date,                             -- 전표번호에서 읽은 발행일
  acct         text not null default '',         -- 계정명(외상매출금 등)
  client_name  text not null default '',         -- 대장의 거래처명(코드 없음)
  billed       numeric not null default 0,       -- 당기 청구액
  opening      numeric not null default 0,       -- 기초이월액
  paid         numeric not null default 0,       -- 당기 입금액
  writeoff     numeric not null default 0,       -- 당기 대손액
  balance      numeric not null default 0,       -- 잔금 = 기초 + 청구 − 입금 − 대손
  contract_no  text,                             -- ERP 계약번호
  phase        text,                             -- 청구구분(잔금·중도금 …)
  kind         text,                             -- 계약구분(기장·세무조정 …)
  cpa          text,                             -- 대장에 적힌 회계사(= 사원)
  entity_id    uuid references public.biz_entity(id) on delete set null,
  place_id     uuid references public.biz_place(id) on delete set null,
  -- 우리 담당이 아니라고 접어 둔 줄(부서 전체가 나오므로 남의 건이 섞인다).
  excluded     boolean not null default false,
  note         text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  unique (ym, team, invoice_no)
);
create index if not exists biz_ar_item_ym_idx     on public.biz_ar_item (ym, team);
create index if not exists biz_ar_item_entity_idx on public.biz_ar_item (entity_id);

comment on table public.biz_ar_item is
  'ERP 부서별 미수금대장의 건별 잔액. invoiceNo 의 전표일이 곧 발행일이라 미수금 나이를 추정 없이 잰다.';

create table if not exists public.biz_ar_upload (
  ym            text not null,
  team          text not null,
  file_name     text,
  row_count     integer not null default 0,
  opening_total numeric not null default 0,
  billed_total  numeric not null default 0,
  paid_total    numeric not null default 0,
  balance_total numeric not null default 0,
  uploaded_at   timestamptz not null default now(),
  uploaded_by   uuid references auth.users(id),
  primary key (ym, team)
);
comment on table public.biz_ar_upload is '미수금대장 업로드 기록. 어느 달까지 올렸는지와 통제합계.';

alter table public.biz_ar_item   enable row level security;
alter table public.biz_ar_upload enable row level security;

drop policy if exists biz_ar_item_sel on public.biz_ar_item;
create policy biz_ar_item_sel on public.biz_ar_item
  for select to authenticated using (not public.is_external());
drop policy if exists biz_ar_item_write on public.biz_ar_item;
create policy biz_ar_item_write on public.biz_ar_item
  for all to authenticated
  using (not public.is_external() and not public.is_readonly() and not public.is_perhead())
  with check (not public.is_external() and not public.is_readonly() and not public.is_perhead());

drop policy if exists biz_ar_upload_sel on public.biz_ar_upload;
create policy biz_ar_upload_sel on public.biz_ar_upload
  for select to authenticated using (not public.is_external());
drop policy if exists biz_ar_upload_write on public.biz_ar_upload;
create policy biz_ar_upload_write on public.biz_ar_upload
  for all to authenticated
  using (not public.is_external() and not public.is_readonly() and not public.is_perhead())
  with check (not public.is_external() and not public.is_readonly() and not public.is_perhead());

grant select, insert, update, delete on public.biz_ar_item   to authenticated;
grant select, insert, update, delete on public.biz_ar_upload to authenticated;
