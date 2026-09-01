-- 0101_audit_opening_and_aug_requests.sql
-- (1) 감사팀 기초미수금 — 2026-07-01. 감사팀 미수금대장의 기초이월액(VAT포함) 기준.
--     감사팀 기초는 15곳 137,376,250 인데, 그중 우리 거래처관리에 등록된 6곳(81,455,000)만 넣는다.
--     나머지는 다른 회계사(김영식·정훈석·김중한·전현수·이용기) 담당이거나 미등록이다.
insert into public.biz_receivable_opening (place_id, as_of, amount, amount_gross, note)
select p.id, date '2026-07-01', round(v.gross / 1.1), v.gross,
       '감사팀 미수금대장(2026-07) 기초이월액'
  from (values
    ('로이비쥬얼',   36410000),
    ('오큘러스제1호', 12732500),
    ('오큘러스제2호', 12732500),
    ('오톰',         11000000),
    ('세원특수금속',   7480000),
    ('이미래디펜스',   1100000)
  ) as v(ename, gross)
  join public.biz_entity e on e.name = v.ename
  join public.biz_place p on p.entity_id = e.id and p.place_no = 1
 where not exists (select 1 from public.biz_receivable_opening o where o.place_id = p.id);

-- (2) 감사팀 2026-08 발행 — 우리 3인 담당 8건. ERP 거래전표 그대로 채운다.
--     계약이 하나로 좁혀지므로 그 계약의 부분청구로 붙인다.
insert into public.biz_invoice_request (
  ym, team, entity_id, place_id, contract_id, contract_code,
  supply_amount, vat, total, status, issued_date, issue_date, invoice_no,
  erp_account, phase, summary, company_name, place_name, note)
select '2026-08', '감사team', e.id, p.id, c.id, c.contract_code,
       v.amt, round(v.amt * 0.1), v.amt + round(v.amt * 0.1),
       '발행완료', v.d, v.d, v.slip,
       case when c.category_code = 'AUD.AUDIT' then '회계감사수입' else '기타용역수입' end,
       case when v.desc like '%착수금%' then '계약금' else '총액' end,
       v.desc, e.name, p.place_name,
       'ERP 감사팀 거래전표(2026-08)에서 채움'
  from (values
    ('L0149', '26-0813-0002',  5000000, date '2026-08-13', '약식실사'),
    ('L0122', '26-0813-0003',  2500000, date '2026-08-13', 'BW평가용역: 반기'),
    ('L0150', '26-0813-0004',  2500000, date '2026-08-13', 'BW평가용역: 반기'),
    ('L0100', '26-0812-0010',  8000000, date '2026-08-12', '2026년 회계감사 착수금'),
    ('L0088', '26-0812-0009', 70000000, date '2026-08-12', '2026년 회계감사 착수금'),
    ('L0008', '26-0812-0008',   500000, date '2026-08-12', '부품소재매출확인서'),
    ('L0042', '26-0812-0007',  7000000, date '2026-08-12', '2026년 회계감사 착수금')
  ) as v(ecode, slip, amt, d, "desc")
  join public.biz_entity e on e.code = v.ecode
  join public.biz_place p on p.entity_id = e.id and p.place_no = 1
  join public.biz_sales_contract c on c.entity_id = e.id and c.team = '감사team'
 where not exists (
   select 1 from public.biz_invoice_request r
    where r.ym = '2026-08' and r.entity_id = e.id and r.status <> '취소');

-- 미니소코리아 8월분은 2차 회차에 붙인다.
update public.biz_invoice_request r
   set installment_id = i.id
  from public.biz_entity e
  join public.biz_sales_contract c on c.entity_id = e.id and c.contract_code = 'L0149-00-F-CETC-A-2026-01'
  join public.biz_contract_installment i on i.contract_id = c.id and i.seq = 2
 where e.id = r.entity_id and e.code = 'L0149' and r.ym = '2026-08' and r.status <> '취소';

-- 백련은 이미 '요청'으로 들어와 있다 — 발행완료로 바꾸고 계약에 붙인다.
update public.biz_invoice_request r
   set status = '발행완료', issued_date = date '2026-08-12', issue_date = date '2026-08-12',
       invoice_no = '26-0812-0006', erp_account = '회계감사수입', phase = '계약금',
       summary = '2026년 회계감사 착수금',
       contract_id = c.id, contract_code = c.contract_code,
       note = 'ERP 감사팀 거래전표(2026-08)로 확인'
  from public.biz_entity e
  join public.biz_sales_contract c on c.entity_id = e.id and c.team = '감사team'
 where e.id = r.entity_id and e.code = 'L0035' and r.ym = '2026-08' and r.status = '요청';
