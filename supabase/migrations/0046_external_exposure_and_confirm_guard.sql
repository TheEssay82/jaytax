-- [보안] 외부인 노출 축소 + 조회서(감사조서) 확정 보호
--
-- 1) demo_clients(): 회사명·사업자번호는 가리면서 실제 매출액과 담당자 실명이
--    그대로 외부인에게 나갔다. 외부 시연용이므로 금액·담당자도 합성값으로 바꾼다.
--    (연도 구성은 유지해 화면 모양은 그대로, 값은 행번호+키 해시 기반이라 재현 가능)
-- 2) update_requests: 정책이 전부 true 라 외부인이 사내 개선요청을 읽고 지울 수 있었다.
-- 3) profiles: 외부인이 전 직원 실명·회사이메일·역할을 조회할 수 있었다.
--    본인 행은 로그인 후 역할 판정에 필요하므로 남긴다.
-- 4) 조회서: '등록완료' 세트의 명세를 잠그고(발송·회수 처리는 계속 허용),
--    세트 삭제는 최고관리자·회계사·기장팀장만 가능하게 한다.
--    (청구서는 확정건 가드, 문서발송은 삭제 차단 트리거가 있는데 조회서만 무방비였다)

create or replace function public.demo_clients()
returns table(id uuid, biz_type text, company_name text, trade_name text, tax_id text,
              rep_name text, manager text, bank_account text, is_model boolean,
              revenues jsonb, managers jsonb, model_years jsonb, loss_years integer[],
              created_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_external() then
    return;
  end if;
  return query
    select
      c.id, c.biz_type,
      '거래처 ' || lpad(c.rn::text, 3, '0'),
      ''::text, '***'::text, '***'::text,
      '담당 ' || chr(65 + (c.rn % 5)::int),                    -- 담당자 실명 → 익명
      case when coalesce(c.bank_account,'') <> '' then '***' else '' end,
      c.is_model,
      coalesce((                                               -- 실제 매출액 → 합성값
        select jsonb_object_agg(e.key,
                 (((c.rn * 37 + abs(hashtext(e.key))) % 50) + 5) * 10000000)
          from jsonb_each(coalesce(c.revenues, '{}'::jsonb)) e
      ), '{}'::jsonb),
      coalesce((
        select jsonb_object_agg(m.key, '담당 ' || chr(65 + (c.rn % 5)::int))
          from jsonb_each(coalesce(c.managers, '{}'::jsonb)) m
      ), '{}'::jsonb),
      c.model_years, c.loss_years, c.created_at, c.updated_at
    from (
      select cl.*, row_number() over (order by cl.company_name) as rn
      from public.clients cl
    ) c;
end;
$$;

drop policy if exists update_requests_sel on public.update_requests;
create policy update_requests_sel on public.update_requests
  for select to authenticated using (not public.is_external());
drop policy if exists update_requests_ins on public.update_requests;
create policy update_requests_ins on public.update_requests
  for insert to authenticated with check (not public.is_external());
drop policy if exists update_requests_upd on public.update_requests;
create policy update_requests_upd on public.update_requests
  for update to authenticated using (not public.is_external()) with check (not public.is_external());
drop policy if exists update_requests_del on public.update_requests;
create policy update_requests_del on public.update_requests
  for delete to authenticated using (not public.is_external());

drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all on public.profiles
  for select to authenticated
  using (id = auth.uid() or not public.is_external());

create or replace function public.confirm_set_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce(public.auth_role(), 'none');
begin
  if TG_OP = 'DELETE' then
    if old.status = '등록완료' and v_role not in ('superuser','accountant','team_lead') then
      raise exception '등록완료된 조회서는 삭제할 수 없습니다 (최고관리자·회계사·기장팀장만 가능). 먼저 ‘작성중’으로 되돌리세요.';
    end if;
    return old;
  end if;
  if old.status = '등록완료'
     and (new.fiscal_year is distinct from old.fiscal_year or new.client_id is distinct from old.client_id) then
    raise exception '등록완료된 조회서의 회계연도·거래처는 변경할 수 없습니다. 먼저 ‘작성중’으로 되돌리세요.';
  end if;
  return new;
end; $$;

drop trigger if exists trg_confirm_set_guard on public.confirmations;
create trigger trg_confirm_set_guard
  before update or delete on public.confirmations
  for each row execute function public.confirm_set_guard();

create or replace function public.confirm_item_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_conf uuid := coalesce(new.confirmation_id, old.confirmation_id);
  v_status text;
begin
  select status into v_status from public.confirmations where id = v_conf;
  if v_status is distinct from '등록완료' then
    if TG_OP = 'DELETE' then return old; else return new; end if;
  end if;

  if TG_OP = 'INSERT' then
    raise exception '등록완료된 조회서에는 조회처를 추가할 수 없습니다. 먼저 ‘작성중’으로 되돌리세요.';
  elsif TG_OP = 'DELETE' then
    raise exception '등록완료된 조회서의 조회처는 삭제할 수 없습니다. 먼저 ‘작성중’으로 되돌리세요.';
  end if;

  -- 명세는 잠그고, 발송·회수 처리 필드는 계속 허용한다
  if new.kind is distinct from old.kind
     or new.institution is distinct from old.institution
     or new.is_electronic is distinct from old.is_electronic
     or new.address is distinct from old.address
     or new.postal_code is distinct from old.postal_code
     or new.phone is distinct from old.phone
     or new.dept is distinct from old.dept
     or new.contact_name is distinct from old.contact_name
     or new.contact_title is distinct from old.contact_title then
    raise exception '등록완료된 조회서의 조회처 명세는 수정할 수 없습니다. 먼저 ‘작성중’으로 되돌리세요.';
  end if;
  return new;
end; $$;

drop trigger if exists trg_confirm_item_guard on public.confirmation_items;
create trigger trg_confirm_item_guard
  before insert or update or delete on public.confirmation_items
  for each row execute function public.confirm_item_guard();
