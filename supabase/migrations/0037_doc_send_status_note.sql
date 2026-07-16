-- 0037: 발송요청 처리 — 발송완료 이후 상태(반송/재발송완료) + 사유(status_note)
-- status는 CHECK 제약 없는 text라 값 추가는 자유. 사유 컬럼만 추가하고, 처리가드에 status_note를 포함해
-- 상태·발송일·등기번호와 동일하게 '처리 권한자(최고관리자·기장팀장·기장팀원)'만 변경 가능하게 한다.

alter table public.doc_send_requests add column if not exists status_note text;  -- 반송/재발송 등 사유

create or replace function public.doc_send_process_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.status is distinct from old.status
      or new.sent_date is distinct from old.sent_date
      or new.tracking_no is distinct from old.tracking_no
      or new.status_note is distinct from old.status_note)
     and coalesce(public.auth_role(), 'none') not in ('superuser', 'team_lead', 'team_member') then
    raise exception '발송요청 처리 권한이 없습니다 (최고관리자·기장팀장·기장팀원만 가능).';
  end if;
  return new;
end; $$;
