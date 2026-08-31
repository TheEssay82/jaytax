-- 0076: 매출계약에 '청구월' 추가 — 연 1회 계약의 청구 시점을 개시월과 분리
--
-- 배경: 세무조정(법인세·종합소득세)은 정산기간(7/1~익6/30) 시작이 아니라 **신고를 마친 뒤**
--       익년 상반기에 청구한다(2025 귀속은 2026-06말 이전 청구 완료). 그런데 엔진이 청구주의
--       정기청구를 '개시월부터 주기마다'로 전개해서 7월에 청구예정으로 잡혔다.
-- 규칙(사용자 확정 2026-08-31): 법인세 = 익년 3월 · 종합소득세 = 익년 5월,
--       단 **성실신고대상 소득세는 6월**.
-- 적용: billing_month(1~12)가 있으면 연 1회 계약은 계약기간 안의 그 달에 청구된다.
--       비어 있으면 기존대로 개시월 기준(월·분기·반기 계약은 영향 없음).

alter table public.biz_sales_contract
  add column if not exists billing_month int
    check (billing_month is null or billing_month between 1 and 12);

comment on column public.biz_sales_contract.billing_month is '연 1회 계약의 청구월(1~12). null=개시월 기준';

-- 기존 세무조정 계약 백필
--  · 법인세 → 3월
update public.biz_sales_contract
   set billing_month = 3
 where category_code = 'TAX.FILING.CORP' and billing_month is null;

--  · 종합소득세 → 5월, 성실신고대상이면 6월
--    성실신고 여부는 청구 거래처(clients.model_years)의 해당 귀속연도 값을 본다.
update public.biz_sales_contract c
   set billing_month = case
         when (select (cl.model_years ->> c.fiscal_year::text)::boolean
                 from public.clients cl where cl.entity_id = c.entity_id limit 1) is true then 6
         else 5 end
 where c.category_code = 'TAX.FILING.INCOME' and c.billing_month is null;
