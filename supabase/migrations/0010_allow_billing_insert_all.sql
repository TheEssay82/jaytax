-- 0010: 청구서 저장(billing_records INSERT)을 전 직원 허용 (기장팀원 포함) — 작성분 유실 방지
-- 적용: Supabase SQL Editor 에서 실행. (UPDATE/DELETE 는 0007대로 팀장+ 유지)

drop policy if exists billing_records_ins on public.billing_records;
create policy billing_records_ins on public.billing_records
  for insert to authenticated
  with check (true);
