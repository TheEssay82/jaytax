-- 0089_taxteam_contract_reconcile.sql
-- 2026-09 청구예정을 taxteam 엑셀(2. 세금계산서 발행현황 › 대조용)과 맞춰 계약 데이터를 바로잡았다.
-- 차이 1,600,000(57건 vs 63건)의 내역:
--   +2,150,000 엑셀에 있는데 계약이 없음   -350,000 해지됐는데 계약이 안 닫힘   -200,000 금액 과다

-- (1) 사업장별로 청구하는데 계약이 본점 하나만 걸려 있던 3건 — 지점 계약 추가
insert into public.biz_sales_contract
  (entity_id, place_id, occurrence_unit, team, category_code, billing_cycle, is_installment,
   amount, start_date, confirmed, contract_code, note)
select p.entity_id, p.id, '사업장', 'taxteam', 'TAX.BOOK', '월', false,
       v.amt, date '2026-07-01', true,
       e.code || '-' || lpad(p.place_no::text, 2, '0') || '-R-BK-T-2026-01',
       '2026-09-01 엑셀 대사로 확인 — 사업장별 청구인데 계약이 본점에만 있었다.'
  from (values ('L0098', 3, 200000), ('L0084', 2, 200000), ('L0083', 2, 100000))
         as v(ecode, pno, amt)
  join public.biz_entity e on e.code = v.ecode
  join public.biz_place p on p.entity_id = e.id and p.place_no = v.pno
 where not exists (
   select 1 from public.biz_sales_contract c
    where c.place_id = p.id and c.team='taxteam' and c.billing_cycle='월' and c.end_date is null);

-- (2) 나우오어네버 — 싶싶싶이 위고하드로 넘어갔는데 금액에 그 몫(200,000)이 남아 있었다.
update public.biz_sales_contract c
   set amount = 100000,
       note = trim(coalesce(c.note,'') || ' 2026-09-01 싶싶싶(200,000)이 위고하드로 이관되어 300,000 → 100,000.')
  from public.biz_entity e
 where e.id = c.entity_id and e.code = 'L0009'
   and c.team='taxteam' and c.billing_cycle='월' and c.amount = 300000;

-- (3) 제이엠스토리 — 2026-08 청구까지 하고 해지.
update public.biz_sales_contract c
   set end_date = date '2026-08-31',
       note = trim(coalesce(c.note,'') || ' 2026-08 청구까지 하고 해지.')
  from public.biz_entity e
 where e.id = c.entity_id and e.code = 'L0103'
   and c.team='taxteam' and c.billing_cycle='월' and c.end_date is null;

-- (4) 파인즈플래닝 — 2026-04부터 청구하지 않았다(7월분까지 청구했으나 오청구라 4월분부터 (-)수정발행).
--     그런데 이 계약은 2026-07-01 개시로 갱신돼 있었다. 애초에 있어서는 안 되는 계약이라 지운다.
--     종료일로 막을 수 없다 — 개시일이 이미 해지 시점보다 뒤다.
delete from public.biz_sales_contract c
 using public.biz_entity e
 where e.id = c.entity_id and e.code = 'L0115'
   and c.team='taxteam' and c.billing_cycle='월' and c.start_date = date '2026-07-01';
