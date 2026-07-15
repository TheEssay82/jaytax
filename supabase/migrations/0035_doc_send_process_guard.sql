-- 0035: 발송요청 처리 서버 가드 — 상태/발송일/등기번호 변경은 처리 권한자만
-- 처리 권한: 최고관리자(superuser)·기장팀장(team_lead)·기장팀원(team_member).
-- 요청자(작성자)의 '미접수' 건 수정은 이 필드를 건드리지 않으므로 영향 없음.

create or replace function public.doc_send_process_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- NULL role(비인증/프로필 없음)은 coalesce 로 확실히 차단(NULL not in (...) 은 NULL 이 되어 통과되는 함정 방지)
  if (new.status is distinct from old.status
      or new.sent_date is distinct from old.sent_date
      or new.tracking_no is distinct from old.tracking_no)
     and coalesce(public.auth_role(), 'none') not in ('superuser', 'team_lead', 'team_member') then
    raise exception '발송요청 처리 권한이 없습니다 (최고관리자·기장팀장·기장팀원만 가능).';
  end if;
  return new;
end; $$;

drop trigger if exists trg_doc_send_process_guard on public.doc_send_requests;
create trigger trg_doc_send_process_guard before update on public.doc_send_requests
  for each row execute function public.doc_send_process_guard();
