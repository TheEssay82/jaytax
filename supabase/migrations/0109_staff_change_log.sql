-- 담당직원 변경 이력.
--
-- 담당은 청구 시점에 정해진다. 그래서 변경의 출발점은 '세금계산서 발행요청' 화면이고,
-- 거기서 바꾼 것이 매출계약의 담당 이력까지 갔는지(propagated)를 함께 남겨야
-- "이 달 한 건만 대신 처리한 것"과 "담당이 아예 바뀐 것"을 나중에 구분할 수 있다.
create table if not exists public.biz_staff_change_log (
  id uuid primary key default gen_random_uuid(),
  ym text not null,                       -- 적용월(그 달 청구부터)
  contract_id uuid references public.biz_sales_contract(id) on delete set null,
  place_id    uuid references public.biz_place(id) on delete set null,
  request_id  uuid references public.biz_invoice_request(id) on delete set null,
  company text not null default '',
  before_staff text not null default '',
  after_staff  text not null default '',
  source text not null default '발행요청',   -- 발행요청 | 매출계약
  propagated boolean not null default false,
  note text,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

create index if not exists idx_staff_change_log_ym on public.biz_staff_change_log(ym);
create index if not exists idx_staff_change_log_contract on public.biz_staff_change_log(contract_id);

alter table public.biz_staff_change_log enable row level security;

drop policy if exists staff_change_log_read on public.biz_staff_change_log;
create policy staff_change_log_read on public.biz_staff_change_log
  for select to authenticated using (public.is_internal());

drop policy if exists staff_change_log_write on public.biz_staff_change_log;
create policy staff_change_log_write on public.biz_staff_change_log
  for insert to authenticated with check (public.is_internal());

grant select, insert on public.biz_staff_change_log to authenticated;
