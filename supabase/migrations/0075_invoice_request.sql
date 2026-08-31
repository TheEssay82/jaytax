-- 0075: 세금계산서 발행요청 + 기초 미수금
--
-- 배경: 세금계산서 발행요청을 Excel 로 주고받던 것을 앱으로 옮긴다(로드맵 과제3).
--       흐름 = 매출계약에서 그 달 청구예정을 전개 → 발행요청 → 발행완료(세계번호·발행일).
--       수금/미수 상계는 다음 단계이고, 여기서는 '기초 미수금' 그릇만 함께 만든다.
--
-- 미수금 단위(2026-08-31 사용자 확정): **사업장 단위**.
--   · 세금계산서가 사업자번호(사업장) 단위로 발행되므로 그 단위를 따른다.
--   · 기초(2026-07-01) 잔액은 과거 청구에 계약 연결이 없어 계약별로 쪼갤 근거가 없다.
--     이후 발행분은 계약·회차에 걸리므로 그때부터 계약별 추적이 가능하다.

-- ── 1) 세금계산서 발행요청 ──────────────────────────────────
create table if not exists public.biz_invoice_request (
  id             uuid primary key default gen_random_uuid(),
  ym             text not null,                                        -- 청구월 'YYYY-MM'
  entity_id      uuid not null references public.biz_entity(id) on delete restrict,
  place_id       uuid references public.biz_place(id) on delete set null,
  contract_id    uuid references public.biz_sales_contract(id) on delete set null,
  installment_id uuid references public.biz_contract_installment(id) on delete set null,
  -- 금액은 요청 시점 스냅샷(계약이 나중에 바뀌어도 요청·발행 이력은 그대로 남아야 한다)
  supply_amount  numeric not null default 0,                           -- 공급가액
  vat            numeric not null default 0,                           -- 부가세
  total          numeric not null default 0,                           -- 합계
  status         text not null default '요청' check (status in ('요청', '발행완료', '취소')),
  invoice_no     text,                                                 -- 세금계산서 승인번호
  issued_date    date,
  company_name   text not null default '',                             -- 요청 시점 표기 스냅샷
  place_name     text not null default '',
  contract_code  text not null default '',
  note           text,
  requested_by   uuid references auth.users(id),
  requested_at   timestamptz not null default now(),
  issued_by      uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id),
  updated_at     timestamptz not null default now()
);
create index if not exists biz_invoice_request_ym_idx     on public.biz_invoice_request(ym);
create index if not exists biz_invoice_request_status_idx on public.biz_invoice_request(status);
create index if not exists biz_invoice_request_entity_idx on public.biz_invoice_request(entity_id);
-- 같은 달·같은 계약(회차)로 두 번 요청되지 않게. 취소분은 다시 요청할 수 있어야 하므로 제외.
create unique index if not exists biz_invoice_request_uk
  on public.biz_invoice_request(ym, contract_id, coalesce(installment_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status <> '취소' and contract_id is not null;

-- ── 2) 기초 미수금(사업장 단위) ─────────────────────────────
create table if not exists public.biz_receivable_opening (
  id         uuid primary key default gen_random_uuid(),
  place_id   uuid not null references public.biz_place(id) on delete cascade,
  as_of      date not null default '2026-07-01',                       -- 기초 기준일
  amount     numeric not null default 0,                               -- 미수 잔액(부가세 포함 청구액 기준)
  note       text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (place_id, as_of)
);

-- ── 3) 트리거(0050 공통 함수 재사용) ────────────────────────
drop trigger if exists trg_biz_invoice_request_bi on public.biz_invoice_request;
create trigger trg_biz_invoice_request_bi before insert on public.biz_invoice_request
  for each row execute function public.biz_set_created_by();
drop trigger if exists trg_biz_invoice_request_bu on public.biz_invoice_request;
create trigger trg_biz_invoice_request_bu before update on public.biz_invoice_request
  for each row execute function public.biz_touch_updated();

drop trigger if exists trg_biz_receivable_opening_bi on public.biz_receivable_opening;
create trigger trg_biz_receivable_opening_bi before insert on public.biz_receivable_opening
  for each row execute function public.biz_set_created_by();
drop trigger if exists trg_biz_receivable_opening_bu on public.biz_receivable_opening;
create trigger trg_biz_receivable_opening_bu before update on public.biz_receivable_opening
  for each row execute function public.biz_touch_updated();

-- ── 4) RLS — 거래처관리(biz_*) 와 같은 기준 ─────────────────
alter table public.biz_invoice_request     enable row level security;
alter table public.biz_receivable_opening  enable row level security;

drop policy if exists biz_invoice_request_sel on public.biz_invoice_request;
create policy biz_invoice_request_sel on public.biz_invoice_request for select to authenticated
  using (not public.is_external());
drop policy if exists biz_invoice_request_ins on public.biz_invoice_request;
create policy biz_invoice_request_ins on public.biz_invoice_request for insert to authenticated
  with check (not public.is_external() and not public.is_readonly() and not public.is_perhead());
drop policy if exists biz_invoice_request_upd on public.biz_invoice_request;
create policy biz_invoice_request_upd on public.biz_invoice_request for update to authenticated
  using (not public.is_external() and not public.is_readonly() and not public.is_perhead())
  with check (not public.is_external() and not public.is_readonly() and not public.is_perhead());
drop policy if exists biz_invoice_request_del on public.biz_invoice_request;
create policy biz_invoice_request_del on public.biz_invoice_request for delete to authenticated
  using (not public.is_external() and not public.is_readonly() and not public.is_perhead());

drop policy if exists biz_receivable_opening_sel on public.biz_receivable_opening;
create policy biz_receivable_opening_sel on public.biz_receivable_opening for select to authenticated
  using (not public.is_external());
drop policy if exists biz_receivable_opening_ins on public.biz_receivable_opening;
create policy biz_receivable_opening_ins on public.biz_receivable_opening for insert to authenticated
  with check (not public.is_external() and not public.is_readonly() and not public.is_perhead());
drop policy if exists biz_receivable_opening_upd on public.biz_receivable_opening;
create policy biz_receivable_opening_upd on public.biz_receivable_opening for update to authenticated
  using (not public.is_external() and not public.is_readonly() and not public.is_perhead())
  with check (not public.is_external() and not public.is_readonly() and not public.is_perhead());
drop policy if exists biz_receivable_opening_del on public.biz_receivable_opening;
create policy biz_receivable_opening_del on public.biz_receivable_opening for delete to authenticated
  using (not public.is_external() and not public.is_readonly() and not public.is_perhead());
