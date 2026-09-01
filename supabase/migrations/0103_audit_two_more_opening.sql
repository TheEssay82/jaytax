-- 0103_audit_two_more_opening.sql
-- 0102 에서 기초미수금이 함께 들어가지 않았다.
-- 같은 문장 안의 data-modifying CTE 로 만든 행은 그 문장의 다른 테이블 읽기에 보이지 않는다
-- (스냅샷이 문장 시작 시점이라 방금 insert 한 biz_entity 를 join 으로 찾지 못했다).
-- 앞으로 '만들고 바로 그것을 join 으로 찾는' 마이그레이션은 문장을 나눌 것.
insert into public.biz_receivable_opening (place_id, as_of, amount, amount_gross, note)
select p.id, date '2026-07-01', round(v.gross / 1.1), v.gross,
       '감사팀 미수금대장(2026-07) 기초이월액'
  from (values ('L0151', 7150000), ('L0152', 880000)) as v(ecode, gross)
  join public.biz_entity e on e.code = v.ecode
  join public.biz_place p on p.entity_id = e.id and p.place_no = 1
 where not exists (select 1 from public.biz_receivable_opening o where o.place_id = p.id);
