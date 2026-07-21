-- [보안] 알 수 없는 역할이 '내부인'으로 통과하던 구멍을 막는다.
--
-- 문제: profiles.role 기본값이 'staff'(역할 체계에 없는 값)이고 CHECK 도 없었다.
--       is_external() 이 role='external' 인지만 보는 블랙리스트라,
--       'staff' 나 profile 자체가 없는 계정이 "외부인이 아님"으로 판정되어
--       'not is_external()' 로 보호되던 전 테이블(거래처·청구·조회서·상담)에 접근했다.
--       실제로 신규 계정 생성 시 role='staff' 로 들어간 사례가 있었다.
--
-- 해결: 화이트리스트로 뒤집는다. 인정된 내부 역할이 아니면 전부 외부인으로 본다.
--       (알 수 없는 값·null·profile 없음 → 외부인)

create or replace function public.is_external()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role not in ('superuser','accountant','team_lead','team_member','per_head_accountant')
       from public.profiles where id = auth.uid()),
    true);   -- profile 행이 없으면 외부인으로 취급(가장 안전한 쪽)
$$;

-- 기본값을 최소권한으로. 신규 가입자는 관리자가 역할을 줄 때까지 아무것도 못 본다.
alter table public.profiles alter column role set default 'external';

-- 정의되지 않은 역할이 애초에 들어가지 못하게 한다.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_role_chk') then
    alter table public.profiles add constraint profiles_role_chk
      check (role in ('superuser','accountant','team_lead','team_member','per_head_accountant','external'));
  end if;
end $$;

-- 가입 트리거도 역할을 명시한다(기본값에 기대지 않는다).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', new.email), new.email, 'external')
  on conflict (id) do nothing;
  return new;
exception when others then
  raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
  return new;
end; $$;
