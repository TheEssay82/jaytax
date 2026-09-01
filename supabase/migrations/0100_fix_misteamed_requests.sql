-- 0100_fix_misteamed_requests.sql
-- 대사가 팀을 구분하지 않던 때(0099 이전) 감사팀 발행을 taxteam 으로 들여온 2건을 바로잡는다.
--   2026-07 라인넥스트 15,000,000 · 미니소코리아 5,000,000
-- 그때는 계약도 없어서 '매출계약 미연결'로 들어왔는데, 0098 로 계약이 생겼으니 함께 붙인다.
update public.biz_invoice_request r
   set team = '감사team',
       contract_id = c.id,
       contract_code = c.contract_code,
       erp_account = '기타용역수입',
       note = 'ERP 대사에서 들여옴 — 2026-09-01 팀·계약 정정'
  from public.biz_entity e
  join public.biz_sales_contract c
    on c.entity_id = e.id and c.team = '감사team' and c.start_date = date '2026-07-01'
 where e.id = r.entity_id
   and r.ym = '2026-07' and r.team = 'taxteam' and r.status <> '취소'
   and e.code in ('L0022', 'L0149');

-- 미니소코리아는 1차 회차(2026-07-28)에 붙인다.
update public.biz_invoice_request r
   set installment_id = i.id
  from public.biz_entity e
  join public.biz_sales_contract c on c.entity_id = e.id and c.contract_code = 'L0149-00-F-CETC-A-2026-01'
  join public.biz_contract_installment i on i.contract_id = c.id and i.seq = 1
 where e.id = r.entity_id and e.code = 'L0149' and r.ym = '2026-07' and r.status <> '취소';
