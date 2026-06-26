-- 0005: 사용자 관리 — 최고관리자(superuser)가 역할 배정, 본인 역할 자가변경 차단
-- 적용: Supabase SQL Editor 에서 실행

-- 현재 사용자가 superuser 인지 (RLS 재귀 방지 위해 SECURITY DEFINER = postgres 권한으로 profiles 조회)
create or replace function public.is_superuser()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'superuser');
$$;

-- superuser 는 모든 프로필(역할·이름) 수정 가능
drop policy if exists "profiles_update_superuser" on public.profiles;
create policy "profiles_update_superuser" on public.profiles
  for update to authenticated
  using (public.is_superuser())
  with check (public.is_superuser());

-- 본인 role 자가 변경 차단 (superuser 만 role 변경 가능). 이름 등 다른 필드 자가수정은 허용.
create or replace function public.prevent_role_self_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_superuser() then
    raise exception '역할 변경 권한이 없습니다 (최고관리자만 가능).';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_role_guard on public.profiles;
create trigger trg_profiles_role_guard
  before update on public.profiles
  for each row execute function public.prevent_role_self_change();
