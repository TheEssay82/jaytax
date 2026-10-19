-- 0174 팀결산 경비 귀속 — ERP 지출결의서번호별리스트(결의서 머리). 산출물 첫 시트(자금집행예정일자·결재진행상태)용.
-- 상세검색 엑셀에는 이 칸들이 없어 리스트 엑셀을 따로 받는다(사용자 2026-10-19 「산출물이 지금 엑셀 양식으로 나와야」).
create table if not exists public.expense_voucher (
  id              uuid primary key default gen_random_uuid(),
  exjunpyo_no     text not null unique,
  plan_date       date,
  writer          text,
  dept            text,
  title           text,
  vendor_summary  text,
  amount          numeric not null default 0,
  inv_slip        text,
  acct_slip       text,
  approval        text,
  wf_no           text,
  approval_status text,
  updated_at      timestamptz not null default now()
);
comment on table public.expense_voucher is '팀결산 경비 귀속 — ERP 지출결의서번호별리스트(결의서 머리: 자금집행예정일자·결재진행상태). 산출물 첫 시트용.';
alter table public.expense_voucher enable row level security;
drop policy if exists expense_voucher_sel on public.expense_voucher;
create policy expense_voucher_sel on public.expense_voucher for select using (public.expense_member_name() is not null);
drop policy if exists expense_voucher_ins on public.expense_voucher;
create policy expense_voucher_ins on public.expense_voucher for insert with check (public.expense_member_name() is not null and not public.is_readonly());
drop policy if exists expense_voucher_upd on public.expense_voucher;
create policy expense_voucher_upd on public.expense_voucher for update using (public.expense_member_name() is not null and not public.is_readonly()) with check (public.expense_member_name() is not null and not public.is_readonly());
drop policy if exists expense_voucher_del on public.expense_voucher;
create policy expense_voucher_del on public.expense_voucher for delete using (public.expense_member_name() is not null and not public.is_readonly());
