-- 0190 넵튠이용자(client_user) 등급 — 회사 담당자 계정(사용자 2026-11-09 「[넵튠이용자] 등급으로 신설」).
--
-- 서버 쪽 차단은 이미 되어 있다: is_external() 는 직원 등급 **화이트리스트**(superuser · accountant · team_lead ·
-- team_member · per_head_accountant)가 아니면 참이라, client_user 는 외부인과 똑같이 고객정보가 한 줄도 안 보인다.
-- 등급별 쓰기 정책도 모두 직원 등급을 나열하는 방식이라 client_user 는 들어가지 않는다(정책 전수 확인 2026-11-09).
-- 여기서는 등급 값만 허용한다. 1118 화면은 ifrs18_access(0189)로 연결된 회사만 보인다.
alter table public.profiles drop constraint if exists profiles_role_chk;
alter table public.profiles add constraint profiles_role_chk
  check (role in ('superuser','accountant','team_lead','team_member','per_head_accountant','external','client_user'));
