-- 0039: 반송 → 재발송요청 (원 요청자만) — 처리 가드 부분 완화
-- 흐름: 발송완료 → [처리자] 반송(사유) → [원 요청자] 재발송요청(메모) → [처리자] 재발송완료
-- 상태/발송일/등기/사유 변경은 원칙적으로 처리자(최고관리자·기장팀장·기장팀원)만 가능하되,
-- '반송 → 재발송요청' 전이 한 가지만 원 요청자(requester_id 또는 created_by)에게 허용한다.
-- 이때 발송일·등기번호는 그대로여야 한다(1차 발송 기록 보존). 사유(메모) 변경은 함께 허용.
-- 모든 변경은 기존 doc_audit 트리거로 before/after와 함께 로그에 남는다.

create or replace function public.doc_send_process_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_processor boolean := coalesce(public.auth_role(), 'none') in ('superuser', 'team_lead', 'team_member');
  is_owner     boolean := auth.uid() is not null
                          and (auth.uid() = old.requester_id or auth.uid() = old.created_by);
  owner_resend boolean := is_owner
                          and old.status = '반송' and new.status = '재발송요청'
                          and new.sent_date  is not distinct from old.sent_date
                          and new.tracking_no is not distinct from old.tracking_no;
begin
  if (new.status is distinct from old.status
      or new.sent_date is distinct from old.sent_date
      or new.tracking_no is distinct from old.tracking_no
      or new.status_note is distinct from old.status_note)
     and not is_processor and not owner_resend then
    raise exception '발송요청 처리 권한이 없습니다 (처리는 최고관리자·기장팀장·기장팀원, 반송 건의 재발송요청은 원 요청자만 가능).';
  end if;
  return new;
end; $$;
