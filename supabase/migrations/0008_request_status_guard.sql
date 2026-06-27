-- 0008: 업데이트요청 '접수상태(status)' 변경은 최고관리자만.
--       요청 등록(insert)·댓글(comments 수정)은 전원 허용 유지 → status 변경만 트리거로 차단.
-- 적용: Supabase SQL Editor 에서 실행. (is_superuser()는 0005에서 생성됨)

create or replace function public.prevent_request_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and not public.is_superuser() then
    raise exception '접수상태 변경 권한이 없습니다 (최고관리자만 가능).';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_request_status_guard on public.update_requests;
create trigger trg_request_status_guard
  before update on public.update_requests
  for each row execute function public.prevent_request_status_change();
