-- 0012: 수정 시 덮어쓰기 지원 — 팀원이 '본인 작성중(draft)' 건을 UPDATE 가능하게
-- 적용: Supabase SQL Editor 에서 실행. (0007의 UPDATE 정책 확장)
-- 팀장+ : 모든 건 수정(확정 전환 포함). 팀원 : 본인+draft 건만, 결과도 draft 유지(자가확정 불가).

drop policy if exists billing_records_upd on public.billing_records;
create policy billing_records_upd on public.billing_records
  for update to authenticated
  using (
    public.auth_role() in ('superuser', 'accountant', 'team_lead')
    or (created_by = auth.uid() and coalesce(status, 'final') = 'draft')
  )
  with check (
    public.auth_role() in ('superuser', 'accountant', 'team_lead')
    or (created_by = auth.uid() and coalesce(status, 'final') = 'draft')
  );
