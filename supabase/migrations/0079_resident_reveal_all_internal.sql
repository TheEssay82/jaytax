-- 0079: 주민번호 열람 권한을 내부자 전체로 확대 (사용자 결정 2026-09-01)
--
-- 배경: 거래처등록 표를 보고 신고서식에 옮겨 적는 일이 잦은데, 열람이 회계사·팀장·최고관리자로
--       묶여 있어 실무가 막혔다. 외부에 열린 서비스가 아니라 내부 전용이라는 판단.
-- 범위: 주민번호(개인 본인 / 법인 대표자)만. 외부인(is_external)은 계속 차단하고,
--       홈텍스 비밀번호는 별도 함수(biz_can_reveal_hometax_pw)라 영향 없다.
create or replace function public.biz_can_reveal()
returns boolean language sql stable security definer set search_path = public as $fn$
  select not public.is_external();
$fn$;

-- 문지훈(I0004): 2019-09 사업자등록은 폐업했으나 주민번호로 소득세 신고가 계속되는 개인.
-- 상태값은 '우리와의 거래 상태'라 계속 거래 중이면 '정상'이 맞다. 폐업 사실은 비고에 남긴다.
update public.biz_place p
   set status = '정상', status_month = null,
       note = '2019-09-30 사업자등록 폐업 — 이후 주민번호로 소득세 신고 계속(사업자없음)'
  from public.biz_entity e
 where e.id = p.entity_id and e.code = 'I0004';
