-- 0084_table_view_prefs.sql
-- (1) 표뷰 화면설정(열 너비·숨김)을 **사람마다** 저장한다.
--     브라우저(localStorage)에 두면 데스크톱앱·웹·다른 PC에서 따로 놀아서 계정에 붙인다.
--     settings 는 { widths: {열키: px}, hidden: [열키] } 형태의 jsonb — 열이 늘거나 줄어도 스키마 변경이 없다.
-- (2) 홈택스PW 일괄 열람 RPC — 주민번호처럼 표에서 한 번에 펼치기 위한 것.
--     권한은 기존 단건 함수와 **같은 게이트**(biz_can_reveal_hometax_pw: 기장 실무자까지)를 그대로 쓴다.

create table if not exists public.user_table_view (
  user_id    uuid not null references auth.users(id) on delete cascade,
  view_key   text not null,                          -- 화면 식별자 (예: 'biz_registry')
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, view_key)
);

comment on table public.user_table_view is
  '표뷰 개인 화면설정(열 너비·숨김). 사람마다 한 화면당 한 행.';

alter table public.user_table_view enable row level security;

-- 본인 것만 읽고 쓴다. 남의 화면설정을 볼 이유가 없다.
create policy user_table_view_own on public.user_table_view
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on table public.user_table_view to authenticated;

-- 홈택스PW 일괄 열람. 값이 있는 사업장만 돌려준다.
create or replace function public.biz_reveal_hometax_pws()
returns table (place_id uuid, hometax_pw text)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if not public.biz_can_reveal_hometax_pw() then raise exception '홈택스PW 열람 권한이 없습니다'; end if;
  return query
    select p.id, extensions.pgp_sym_decrypt(p.hometax_pw_enc, public.biz_pii_key())
      from public.biz_place p
     where p.hometax_pw_enc is not null;
end $fn$;

revoke execute on function public.biz_reveal_hometax_pws() from public;
grant execute on function public.biz_reveal_hometax_pws() to authenticated;
