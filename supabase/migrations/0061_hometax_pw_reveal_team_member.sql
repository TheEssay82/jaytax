-- 홈택스PW 열람 권한을 기장 실무자(team_member)까지 확대.
-- 배경: biz_can_reveal()(superuser·accountant·team_lead) 하나가 주민번호·홈택스PW를 모두 막고 있었다.
--   홈택스PW는 기장 실무자(김민섭·김동주 등 team_member)가 홈택스 로그인·신고 업무에 필요 → 별도 게이트로 분리해 확대.
--   주민번호(entity/rep resident)는 민감도가 높아 기존 게이트(biz_can_reveal) 유지.

-- 홈택스PW 전용 게이트: 내부 실무 역할까지 허용.
create or replace function public.biz_can_reveal_hometax_pw()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role in ('superuser','accountant','team_lead','team_member') from public.profiles where id = auth.uid()),
    false);
$$;

-- 홈택스PW 복호 함수가 새 게이트를 쓰도록 교체(주민번호 함수는 변경 없음).
create or replace function public.biz_reveal_place_hometax_pw(p_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v bytea;
begin
  if not public.biz_can_reveal_hometax_pw() then raise exception '홈택스PW 열람 권한이 없습니다'; end if;
  select hometax_pw_enc into v from public.biz_place where id = p_id;
  return case when v is null then null else extensions.pgp_sym_decrypt(v, public.biz_pii_key()) end;
end; $$;

grant execute on function public.biz_can_reveal_hometax_pw() to authenticated;
