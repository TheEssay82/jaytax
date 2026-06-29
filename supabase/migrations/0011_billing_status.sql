-- 0011: 청구기록 상태(작성중/확정) — 팀원=저장(작성중)까지, 확정은 팀장+
-- 적용: Supabase SQL Editor 에서 실행. (0010의 INSERT 정책을 상태 가드로 교체)

alter table public.billing_records
  add column if not exists status text not null default 'final';

-- INSERT: 팀원은 'draft'만 생성 가능, 팀장+ 는 'final'(확정)도 가능
drop policy if exists billing_records_ins on public.billing_records;
create policy billing_records_ins on public.billing_records
  for insert to authenticated
  with check (
    coalesce(status, 'final') = 'draft'
    or public.auth_role() in ('superuser', 'accountant', 'team_lead')
  );

-- UPDATE(확정 전환 포함)·DELETE 는 0007대로 팀장+ 유지 (별도 변경 없음)
