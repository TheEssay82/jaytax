-- 0104_receipts.sql — 수금(입금) 기록
--
-- 미수금 = 기초 + 발행 − 입금. 앞의 둘은 채웠고 마지막이 비어 있었다.
-- 입금의 원천은 **ERP 부서별원장의 외상매출금 대변**이다.
--   전표번호 · 거래처코드 · 거래처 · 적요('cms입금 …') · 대변금액
-- 거래전표(발행)와 달리 원장에는 사업자번호가 없다 → **거래처코드로 맞춘다**
-- (그래서 biz_place.erp_client_code 를 먼저 채워 둔 것이다).
--
-- ERP 는 입금을 청구건에 연결하지 않는다(입금 전표에 '거래#'가 하나도 없다 — 2026-07 실측).
-- 그래서 우리도 **사업장 단위**로만 잡는다. 계약별 미수는 원천 자료가 없다.

create table if not exists public.biz_receipt (
  id           uuid primary key default gen_random_uuid(),
  ym           text not null,                       -- 'YYYY-MM' (원장 조회월)
  team         text not null default 'taxteam',
  slip_no      text not null,                       -- 원장 전표번호
  paid_date    date,                                -- 전표번호에서 읽는다 (26-0701-0010 → 2026-07-01)
  client_code  text,                                -- ERP 거래처코드 — 매칭 키
  client_name  text not null default '',
  summary      text,                                -- 적요
  amount       numeric not null default 0,          -- 대변(입금액, VAT 포함)
  place_id     uuid references public.biz_place(id) on delete set null,
  entity_id    uuid references public.biz_entity(id) on delete set null,
  note         text,
  created_by   uuid references auth.users(id),
  updated_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  unique (ym, team, slip_no)
);
create index if not exists biz_receipt_ym_idx    on public.biz_receipt (ym, team);
create index if not exists biz_receipt_place_idx on public.biz_receipt (place_id);

comment on table public.biz_receipt is
  'ERP 부서별원장 외상매출금 대변(입금). 거래처코드로 사업장에 붙인다. 금액은 VAT 포함.';

-- 달·팀별 원장 업로드 상태
create table if not exists public.biz_receipt_upload (
  ym           text not null,
  team         text not null,
  file_name    text,
  row_count    integer not null default 0,
  amount_total numeric not null default 0,
  opening      numeric,                             -- 원장 이월액(검산용)
  debit_total  numeric,                             -- 원장 차변 합(발행)
  uploaded_at  timestamptz not null default now(),
  uploaded_by  uuid references auth.users(id),
  primary key (ym, team)
);
comment on table public.biz_receipt_upload is
  '원장 업로드 기록. 이월·차변·대변을 함께 담아 우리 계산과 원장이 맞는지 바로 검산한다.';

alter table public.biz_receipt        enable row level security;
alter table public.biz_receipt_upload enable row level security;

drop policy if exists biz_receipt_all on public.biz_receipt;
create policy biz_receipt_all on public.biz_receipt
  for all to authenticated
  using (not public.is_external()) with check (not public.is_external());

drop policy if exists biz_receipt_upload_all on public.biz_receipt_upload;
create policy biz_receipt_upload_all on public.biz_receipt_upload
  for all to authenticated
  using (not public.is_external()) with check (not public.is_external());

grant select, insert, update, delete on table public.biz_receipt        to authenticated;
grant select, insert, update, delete on table public.biz_receipt_upload to authenticated;

drop trigger if exists trg_biz_receipt_bi on public.biz_receipt;
create trigger trg_biz_receipt_bi before insert on public.biz_receipt
  for each row execute function public.biz_set_created_by();
