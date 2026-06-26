-- 0002: 회원 생성 시 "Database error creating new user" 수정
-- 원인: auth.users INSERT → 트리거 handle_new_user() → profiles INSERT 가 실패하면
--       회원 생성 트랜잭션 전체가 롤백된다.
-- 조치:
--   1) auth 서비스 역할(supabase_auth_admin)에 profiles 쓰기 권한 부여
--   2) 트리거 함수에 예외 처리 추가 → 프로필 생성 실패가 회원 가입을 막지 않도록

-- 1) 권한 부여
grant usage on schema public to supabase_auth_admin;
grant insert, select, update on public.profiles to supabase_auth_admin;

-- 2) 트리거 함수 재정의 (예외 안전 + 중복 안전)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email))
  on conflict (id) do nothing;
  return new;
exception when others then
  -- 프로필 생성에 실패하더라도 회원 생성은 진행 (로그만 남김)
  raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
  return new;
end;
$$;
