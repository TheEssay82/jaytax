-- 0006: profiles 에 email 추가 (사용자 관리에서 직원 이메일 표시용)
-- 적용: Supabase SQL Editor 에서 실행

alter table public.profiles add column if not exists email text;

-- 가입 트리거: 이름 + 이메일 저장 (대시보드/Edge Function 생성 모두 커버)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email), new.email)
  on conflict (id) do nothing;
  return new;
exception when others then
  raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
  return new;
end;
$$;

-- 기존 프로필 이메일 백필 (auth.users 에서 가져옴)
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and coalesce(p.email, '') = '';
