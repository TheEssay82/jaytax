-- 0027: 기장팀원이 본인 '작성중(draft)' 청구기록을 삭제할 수 있게 허용.
-- 종전 삭제 정책은 팀장+만 가능 → 팀원이 임시저장한 초안을 스스로 지울 수 없었다.
-- 저장·수정 정책(0026)과 동일 기준으로, 본인이 만든 draft는 삭제 허용한다.
-- 확정(final) 건·남의 건 삭제는 여전히 팀장+만. readonly 가드(ro_block_delete)는 그대로.

drop policy if exists billing_records_del on public.billing_records;
create policy billing_records_del on public.billing_records
  for delete to authenticated
  using (
    auth_role() = any (array['superuser', 'accountant', 'team_lead'])
    or (created_by = auth.uid() and coalesce(status, 'final') = 'draft')
  );
