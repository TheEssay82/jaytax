-- readonly(쓰기잠금)도 role 과 같이 최고관리자만 바꿀 수 있게 한다.
-- 읽기전용 계정은 restrictive 정책(ro_block_update)에 막혀 스스로 풀 수 없지만,
-- 일반 사용자가 자기 계정을 잠그면 관리자 없이 복구할 수 없으므로 함께 막는다.
create or replace function public.prevent_role_self_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not public.is_superuser() then
    raise exception '역할 변경 권한이 없습니다 (최고관리자만 가능).';
  end if;
  if new.readonly is distinct from old.readonly and not public.is_superuser() then
    raise exception '쓰기잠금 변경 권한이 없습니다 (최고관리자만 가능).';
  end if;
  return new;
end; $$;
