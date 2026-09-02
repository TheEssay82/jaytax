-- 상기(reminder) 알림은 **자기 자신에게도** 보낸다.
--
-- notify_user() 는 'p_user = auth.uid() 이면 보내지 않는다' — 내가 한 일을 나에게 알리지
-- 않으려는 규칙이고, 문서발송·상담처럼 '누가 무엇을 했다'를 알리는 데는 옳다.
-- 그런데 감사팀 청구기한 알림과 미수금 알림은 성격이 다르다. '이 일을 하라'는 상기이고,
-- 누르는 사람과 담당이 같을 수 있다(정우철이 눌렀는데 담당도 정우철). 그때 조용히 사라졌다 —
-- 화면에는 '보냄'으로 남고 알림함은 비어 있었다. 그래서 이 둘만 직접 넣는다.
create or replace function public.biz_audit_notify(
  p_name text, p_kind text, p_title text, p_body text
) returns integer language plpgsql security definer set search_path = public as $fn$
declare n integer := 0;
begin
  if public.is_external() then raise exception '권한이 없습니다'; end if;
  if p_kind not in ('audit_proposal', 'audit_request', 'audit_issued') then
    raise exception '알 수 없는 알림 종류입니다: %', p_kind;
  end if;
  if coalesce(trim(p_name), '') = '' then return 0; end if;
  insert into public.notifications (user_id, kind, title, body, tab, entity_id)
  select id, p_kind, p_title, p_body, 'audit-invoice', null
    from public.profiles where trim(coalesce(name, '')) = trim(p_name);
  get diagnostics n = row_count;
  return n;
end $fn$;

create or replace function public.biz_receivable_notify(
  p_name text, p_title text, p_body text
) returns integer language plpgsql security definer set search_path = public as $fn$
declare n integer := 0;
begin
  if public.is_external() then raise exception '권한이 없습니다'; end if;
  if coalesce(trim(p_name), '') = '' then return 0; end if;
  insert into public.notifications (user_id, kind, title, body, tab, entity_id)
  select id, 'receivable_aging', p_title, p_body, 'receivable', null
    from public.profiles where trim(coalesce(name, '')) = trim(p_name);
  get diagnostics n = row_count;
  return n;
end $fn$;

-- 조용히 사라진 4건은 '보냄'으로 잘못 남았다. 다시 보낼 수 있게 지운다.
delete from public.biz_audit_proposal_notice;
