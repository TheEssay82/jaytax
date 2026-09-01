-- 0093_hongjeongmin_book_contract.sql
-- 홍정민(I0025) — ERP 2026-07 에 기장대행 200,000 이 발행됐는데 기장 매출계약이 없었다.
-- (등록된 계약은 소득세 연 1회뿐이고 그건 2026-06 에 이미 끝났다. 종료일을 넣을 계약 자체가 없었다.)
-- 8월 해지이므로 7월 한 달만 청구되도록 2026-07-01 ~ 2026-07-31 로 넣는다.
insert into public.biz_sales_contract
  (entity_id, place_id, occurrence_unit, team, category_code, billing_cycle, is_installment,
   amount, start_date, end_date, confirmed, contract_code, note)
select p.entity_id, p.id, '개인', 'taxteam', 'TAX.BOOK', '월', false,
       200000, date '2026-07-01', date '2026-07-31', true,
       'I0025-00-F-BK-T-2026-01',
       '2026-08 해지. ERP 2026-07 기장대행 200,000 발행분에 맞춰 등록(계약이 없던 건).'
  from public.biz_place p
  join public.biz_entity e on e.id = p.entity_id
 where e.code = 'I0025' and p.place_no = 1
   and not exists (
     select 1 from public.biz_sales_contract c
      where c.entity_id = e.id and c.category_code = 'TAX.BOOK');
