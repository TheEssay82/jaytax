-- 0026: 기장팀원 임시저장 복원 (0025 되돌림).
-- 0025로 팀원 저장을 전면 차단했으나, 팀원이 작업 중인 청구서를 저장·재수정할 수 없어
-- 매번 처음부터 다시 작성해야 하는 문제가 있었다. → 팀원도 '작성중(draft)' 청구서는 저장/수정 가능하게
-- 되돌린다(0014 원안). 확정(final) 저장은 여전히 팀장+만(finalizeInvoice), 남의 건 수정도 불가.

drop policy if exists billing_records_ins on public.billing_records;
create policy billing_records_ins on public.billing_records
  for insert to authenticated
  with check (
    coalesce(status, 'final') = 'draft'
    or auth_role() = any (array['superuser', 'accountant', 'team_lead'])
  );

drop policy if exists billing_records_upd on public.billing_records;
create policy billing_records_upd on public.billing_records
  for update to authenticated
  using (
    auth_role() = any (array['superuser', 'accountant', 'team_lead'])
    or (created_by = auth.uid() and coalesce(status, 'final') = 'draft')
  )
  with check (
    auth_role() = any (array['superuser', 'accountant', 'team_lead'])
    or (created_by = auth.uid() and coalesce(status, 'final') = 'draft')
  );
