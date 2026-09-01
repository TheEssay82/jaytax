-- 0095_erp_reconcile.sql — ERP 발행내역 대사 (엑셀 '대조용' 시트 대체)
--
-- 담당자(김민섭)가 매달 ERP 에서 내려받던 거래전표 엑셀을 jaytax 에 올리면,
-- 사업자번호로 우리 발행요청과 맞춰 네 갈래로 나눈다.
--   ✅ 일치 / ⚠️ 금액다름 / ❓ ERP에만 있음(건별매출·신규) / ❗ 우리에만 있음(발행누락)
-- 터미널·스크립트는 등장하지 않는다. 그녀가 지금 하는 '내려받아 붙여넣기'가 '끌어다 놓기'로 바뀔 뿐이다.

-- ── 1) (−)수정발행을 담을 자리 ────────────────────────────
-- 사용자 확정: 별도 표로 빼지 않고 **같은 표에 상태만 추가**한다. 미수금이 한 줄로 계산되게.
alter table public.biz_invoice_request drop constraint if exists biz_invoice_request_status_check;
alter table public.biz_invoice_request add  constraint biz_invoice_request_status_check
  check (status in ('요청', '발행완료', '취소', '수정발행'));

alter table public.biz_invoice_request
  add column if not exists corrects_request_id uuid references public.biz_invoice_request(id) on delete set null;

comment on column public.biz_invoice_request.corrects_request_id is
  '(−)수정발행이 어느 발행건을 정정한 것인지. 금액은 음수로 들어간다.';

-- ── 2) 올린 ERP 전표 원본 ─────────────────────────────────
-- 파일을 다시 올리지 않아도 화면을 다시 열 수 있게 그대로 보관한다.
-- 나중에 미수금(기초 + 발행 − 입금) 계산의 '발행' 쪽 근거도 여기서 나온다.
create table if not exists public.biz_erp_slip (
  id            uuid primary key default gen_random_uuid(),
  ym            text not null,                    -- 대사 대상 월 'YYYY-MM'
  slip_no       text not null,                    -- ERP 전표번호 (26-0818-0003)
  acct_slip_no  text,                             -- 회계전표번호
  biz_no        text,                             -- 사업자등록증(숫자만) — 매칭 키
  client_name   text not null default '',
  description   text not null default '',         -- 내역 ('기장대행', '2026년 2분기 결산료')
  kind          text not null default '매출',      -- 매출 | 매입
  contract_kind text,                             -- ERP 계약유형 (기장/세무조정)
  supply_amount numeric not null default 0,       -- 음수면 (−)수정전표
  vat           numeric not null default 0,
  total         numeric not null default 0,
  dept_name     text,
  request_id    uuid references public.biz_invoice_request(id) on delete set null,  -- 맞춘 요청
  created_by    uuid references auth.users(id),
  -- biz_set_created_by 트리거가 updated_by 도 채운다. 빠뜨리면 insert 가 통째로 죽는다(0075 전례).
  updated_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  unique (ym, slip_no)
);
create index if not exists biz_erp_slip_ym_idx    on public.biz_erp_slip (ym);
create index if not exists biz_erp_slip_bizno_idx on public.biz_erp_slip (ym, biz_no);

comment on table public.biz_erp_slip is
  'ERP 거래전표 엑셀을 올린 원본. 대사 근거이자 나중에 미수금 계산의 발행 쪽 자료.';

-- ── 3) 달별 대사 상태 ────────────────────────────────────
create table if not exists public.biz_invoice_reconcile (
  ym            text primary key,
  file_name     text,
  slip_count    integer not null default 0,
  supply_total  numeric not null default 0,
  uploaded_at   timestamptz,
  uploaded_by   uuid references auth.users(id),
  done_at       timestamptz,
  done_by       uuid references auth.users(id),
  note          text
);
comment on table public.biz_invoice_reconcile is
  '달별 ERP 대사 상태. 누가 언제 올리고 마감했는지 남긴다(마감은 김민섭·기장팀장·최고관리자).';

-- ── 4) RLS — 내부자만 ────────────────────────────────────
alter table public.biz_erp_slip           enable row level security;
alter table public.biz_invoice_reconcile  enable row level security;

drop policy if exists biz_erp_slip_all on public.biz_erp_slip;
create policy biz_erp_slip_all on public.biz_erp_slip
  for all to authenticated
  using (not public.is_external()) with check (not public.is_external());

drop policy if exists biz_invoice_reconcile_all on public.biz_invoice_reconcile;
create policy biz_invoice_reconcile_all on public.biz_invoice_reconcile
  for all to authenticated
  using (not public.is_external()) with check (not public.is_external());

grant select, insert, update, delete on table public.biz_erp_slip          to authenticated;
grant select, insert, update, delete on table public.biz_invoice_reconcile to authenticated;

-- 만든이 자동기입(다른 biz_* 표와 같은 방식)
drop trigger if exists trg_biz_erp_slip_bi on public.biz_erp_slip;
create trigger trg_biz_erp_slip_bi before insert on public.biz_erp_slip
  for each row execute function public.biz_set_created_by();
