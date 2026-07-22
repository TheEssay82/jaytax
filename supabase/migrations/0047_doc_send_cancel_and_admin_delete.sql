-- 문서발송은 '업무처리' 시스템이라(감사증빙인 조회서와 다르다) 삭제 전면 차단은 과했다.
-- 두 가지를 연다.
--  1) 취소: 처리 시작 후에도 요청을 무를 수 있게 한다(사유는 status_note 에 남는다).
--     기록은 남기되 대기열·현황 집계에서 빠진다. 실무에서 흔한 '요청했다가 필요 없어짐'용.
--     status 에 CHECK 제약이 없어 값 추가만으로 동작한다(앱의 CANCELED 상수와 짝).
--  2) 최고관리자 하드 삭제: 테스트·오등록 정리용. 삭제해도 doc_audit_log 에
--     원본 JSON(before)이 남아 복구할 수 있다.

create or replace function public.doc_send_block_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 최고관리자는 정리 목적의 삭제를 허용한다(감사로그에 원본이 남는다).
  if public.is_superuser() then
    return old;
  end if;
  if old.status <> '미접수' then
    raise exception '처리가 시작된 발송요청(상태: %)은 삭제할 수 없습니다. 필요 없어진 요청은 ‘취소’로 처리하세요. (삭제는 최고관리자만 가능)', old.status;
  end if;
  return old;
end; $$;
