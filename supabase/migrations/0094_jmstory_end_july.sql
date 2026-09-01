-- 0094_jmstory_end_july.sql
-- 제이엠스토리(L0103) — 마지막 청구는 2026-07 이다.
-- 0089 에서 '8월까지 청구 후 해지'로 듣고 8/31 로 넣었으나, 엑셀은 8월을 X(해지)로 처리했고
-- ERP 8월 발행분에도 없다. 종료일을 7/31 로 당긴다.
update public.biz_sales_contract c
   set end_date = date '2026-07-31',
       note = trim(coalesce(c.note, '') || ' 2026-09-01 정정 — 마지막 청구는 2026-07(엑셀 X·ERP 8월 발행 없음).')
  from public.biz_entity e
 where e.id = c.entity_id and e.code = 'L0103'
   and c.team = 'taxteam' and c.billing_cycle = '월';

-- 그에 맞춰 이미 등록된 2026-08 발행요청은 취소한다.
update public.biz_invoice_request r
   set status = '취소',
       note = trim(coalesce(r.note, '') || ' 2026-09-01 계약 종료일을 2026-07-31 로 정정하여 취소.')
  from public.biz_entity e
 where e.id = r.entity_id and e.code = 'L0103'
   and r.ym = '2026-08' and r.status = '요청';
