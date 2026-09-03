-- 거래 종료 판정에 「살아있는 계약이 없을 것」을 더한다.
--
-- 종전에는 '정상 사업장 0곳' 만 보았다. 그런데 사업장이 폐업·이관해도 **마지막 세무조정은
-- 남는다**(폐업 연도 신고). 그 사이에 홈택스 비밀번호가 파기되면 정작 그 일을 못 한다.
-- 지금은 가장 빠듯한 곳이 2개월 여유뿐이다
-- (공주는아무것도몰라요 — 계약 종료 2027-06-01, 홈택스PW 파기 2027-08).
--
-- 반대 방향(영원히 안 지워짐)은 확인했다: 거래종료로 잡힌 22곳 모두 계약에 종료일이
-- 들어 있어, 이 조건 때문에 파기가 막히는 거래처는 없다. 종료일 없는 계속계약은 0건.
--
-- 적용 결과(2026-09-04): 공주는아무것도몰라요·히츠 두 곳이 '거래종료 → 거래중' 으로 바뀐다.
-- 둘 다 폐업·이관했지만 2026 귀속 세무조정이 2027-06 까지 남아 있는 경우다.
create or replace function public.biz_entity_closed(p_entity_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select not exists (
           select 1 from public.biz_place p
            where p.entity_id = p_entity_id and p.status = '정상')
     and not exists (
           -- 아직 유효한 계약이 있으면 거래 중이다. 종료일이 없으면 계속계약.
           select 1 from public.biz_sales_contract s
            where s.entity_id = p_entity_id
              and (s.end_date is null or s.end_date >= current_date));
$function$;
