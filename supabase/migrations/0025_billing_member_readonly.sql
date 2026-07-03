-- 0025: 기장팀원(team_member) 청구서 저장 차단 — 조회는 유지, 저장(insert/update)만 불가.
-- 종전 정책은 팀원도 본인 draft를 저장/수정할 수 있었다(status='draft' OR 관리자).
-- 요청에 따라 청구서 저장 권한을 팀장+(superuser/accountant/team_lead)로 한정한다.
-- SELECT(billing_records_sel=true, ext_block_select)·DELETE(관리자)·readonly 가드는 그대로 둔다.

drop policy if exists billing_records_ins on public.billing_records;
create policy billing_records_ins on public.billing_records
  for insert to authenticated
  with check (auth_role() = any (array['superuser', 'accountant', 'team_lead']));

drop policy if exists billing_records_upd on public.billing_records;
create policy billing_records_upd on public.billing_records
  for update to authenticated
  using (auth_role() = any (array['superuser', 'accountant', 'team_lead']))
  with check (auth_role() = any (array['superuser', 'accountant', 'team_lead']));
