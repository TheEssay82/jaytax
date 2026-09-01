-- 0083_place_status_closed.sql
-- 사업장 상태에 '종료'를 추가한다.
--
-- 왜: 지금 값은 정상·폐업·이관 셋뿐이라, **회사는 살아있는데 우리 업무만 끝난 건**을 담을 자리가 없었다.
--     연건아트레지던스처럼 단발 수임 후 마무리되는 건이 앞으로도 생긴다.
--     · 폐업 = 사업자등록이 없어진 것       · 이관 = 다른 사무소로 넘어간 것
--     · 종료 = 우리 업무가 끝난 것(회사는 그대로)
-- 연건아트레지던스는 사장님 지시대로 '폐업'으로 둔다.

alter table public.biz_place drop constraint if exists biz_place_status_check;
alter table public.biz_place add  constraint biz_place_status_check
  check (status in ('정상', '폐업', '이관', '종료'));

update public.biz_place p
   set status = '폐업', status_month = '2026-07'
  from public.biz_entity e
 where e.id = p.entity_id and e.code = 'L0148';
