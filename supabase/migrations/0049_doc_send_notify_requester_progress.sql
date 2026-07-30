-- 요청자에게 진행 상황을 더 알려준다. 지금은 반송만 통지했는데,
-- 요청자 입장에선 '내 요청이 어떻게 되고 있나'가 궁금하므로 진행중·발송완료·재발송완료도 알린다.
-- (처리 담당자 대상 알림 — 새 발송요청·재발송요청 — 은 그대로)

create or replace function public.doc_send_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_target text := trim(coalesce(new.company_name,'') || ' ' || coalesce(new.send_kind,''));
  v_owner  uuid;
  r record;
begin
  if TG_OP = 'INSERT' then
    for r in select id from public.profiles
             where role in ('superuser','team_lead','team_member') and not coalesce(readonly,false)
    loop
      perform public.notify_user(r.id, 'dispatch_new',
        '새 발송요청', v_target || ' — ' || coalesce(new.requester,'') || ' 요청', 'doc-process', new.id);
    end loop;
    return new;
  end if;

  if TG_OP = 'UPDATE' and new.status is distinct from old.status then
    v_owner := coalesce(new.requester_id, new.created_by);

    if new.status = '진행중' then
      perform public.notify_user(v_owner, 'dispatch_progress',
        '발송 처리 시작', v_target || ' — 발송을 처리하기 시작했습니다', 'doc-request', new.id);
    elsif new.status = '발송완료' then
      perform public.notify_user(v_owner, 'dispatch_done',
        '발송 완료',
        v_target || ' — 발송이 완료되었습니다'
          || case when coalesce(new.tracking_no,'') <> '' then ' (등기 ' || new.tracking_no || ')' else '' end,
        'doc-request', new.id);
    elsif new.status = '재발송완료' then
      perform public.notify_user(v_owner, 'dispatch_done',
        '재발송 완료',
        v_target || ' — 재발송이 완료되었습니다'
          || case when coalesce(new.tracking_no,'') <> '' then ' (등기 ' || new.tracking_no || ')' else '' end,
        'doc-request', new.id);
    elsif new.status = '반송' then
      perform public.notify_user(v_owner, 'dispatch_returned',
        '발송 반송됨', v_target || ' — 사유: ' || coalesce(new.status_note,'(미기재)'), 'doc-request', new.id);
    elsif new.status = '재발송요청' then
      for r in select id from public.profiles
               where role in ('superuser','team_lead','team_member') and not coalesce(readonly,false)
      loop
        perform public.notify_user(r.id, 'dispatch_resend',
          '재발송요청', v_target || ' — 재발송이 필요합니다', 'doc-process', new.id);
      end loop;
    end if;
  end if;
  return new;
end; $$;
