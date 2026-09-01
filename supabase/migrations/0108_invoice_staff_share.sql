-- 0108_invoice_staff_share.sql — 청구 건별 실적 배분
--
-- 원칙(사용자 확정 2026-09-01)
--  · 기본은 **주담당 1명이 전액**. 대부분 1명이고 여럿인 건 예외다.
--  · 다만 **청구할 때 비율을 지정할 수 있어야** 한다 — 실적이 청구 시점에 정해지므로.
--  · 그 달 청구는 그 달 담당자 몫이다(계약의 담당 이력을 청구 시점에 읽어 굳힌다).
--  · 건별매출은 사후에 발견되므로 기본값은 그 사업장 담당직원.
create table if not exists public.biz_invoice_staff (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.biz_invoice_request(id) on delete cascade,
  staff_name text not null,
  share      numeric not null default 100,
  seq        integer not null default 1,
  created_at timestamptz not null default now(),
  unique (request_id, staff_name)
);
create index if not exists biz_invoice_staff_req_idx   on public.biz_invoice_staff (request_id);
create index if not exists biz_invoice_staff_name_idx  on public.biz_invoice_staff (staff_name);

comment on table public.biz_invoice_staff is
  '청구 건별 실적 배분. 기본은 주담당 100%, 필요하면 청구할 때 비율을 나눈다.';

alter table public.biz_invoice_staff enable row level security;
drop policy if exists biz_invoice_staff_all on public.biz_invoice_staff;
create policy biz_invoice_staff_all on public.biz_invoice_staff
  for all to authenticated
  using (not public.is_external()) with check (not public.is_external());
grant select, insert, update, delete on table public.biz_invoice_staff to authenticated;

-- 이미 쌓인 요청의 staff 문자열을 행으로 편다. 첫 사람이 주담당 100%, 나머지는 0%.
insert into public.biz_invoice_staff (request_id, staff_name, share, seq)
select r.id, trim(x.name), case when x.ord = 1 then 100 else 0 end, x.ord
  from public.biz_invoice_request r
  cross join lateral unnest(string_to_array(r.staff, ',')) with ordinality as x(name, ord)
 where coalesce(r.staff, '') <> '' and trim(x.name) <> ''
   and not exists (select 1 from public.biz_invoice_staff s where s.request_id = r.id)
on conflict (request_id, staff_name) do nothing;
