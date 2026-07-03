-- 0028: 기장팀원 거래처 일부수정 허용 (사업자번호·대표자명·가상계좌·성실신고만).
-- 거래처 등록(INSERT)·삭제(DELETE)는 팀장+ 유지. UPDATE만 팀원까지 허용하되,
-- RLS는 컬럼 단위 제한을 못 하므로 BEFORE UPDATE 트리거로 팀원이 바꿀 수 있는 컬럼을
--   tax_id, rep_name, bank_account, is_model 4개로 강제한다(그 외 변경 시 예외).
-- 장기적으로 '거래처등록' 메뉴를 분리할 예정이라, 지금은 수정 권한만 연다.

-- UPDATE 정책: 팀원까지 허용 (컬럼 제한은 아래 트리거가 담당). readonly 가드는 그대로.
drop policy if exists clients_upd on public.clients;
create policy clients_upd on public.clients
  for update to authenticated
  using (auth_role() = any (array['superuser', 'accountant', 'team_lead', 'team_member']))
  with check (auth_role() = any (array['superuser', 'accountant', 'team_lead', 'team_member']));

-- 팀원 수정 컬럼 가드: 허용 4개 외 컬럼이 바뀌면 거부.
create or replace function public.clients_member_update_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth_role() = 'team_member' then
    if (new.biz_type      is distinct from old.biz_type)
      or (new.company_name is distinct from old.company_name)
      or (new.trade_name   is distinct from old.trade_name)
      or (new.manager      is distinct from old.manager)
      or (new.revenues     is distinct from old.revenues)
      or (new.managers     is distinct from old.managers)
      or (new.model_years  is distinct from old.model_years)
      or (new.loss_years   is distinct from old.loss_years)
      or (new.created_by   is distinct from old.created_by)
      or (new.created_at   is distinct from old.created_at)
      or (new.id           is distinct from old.id)
    then
      raise exception '기장팀원은 사업자번호·대표자명·가상계좌·성실신고만 수정할 수 있습니다.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clients_member_guard on public.clients;
create trigger trg_clients_member_guard
  before update on public.clients
  for each row execute function public.clients_member_update_guard();
