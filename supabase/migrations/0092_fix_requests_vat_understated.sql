-- 0092_fix_requests_vat_understated.sql
-- (1) 2026-07·08 발행요청 중 시파사 3건·엘케이씨파트너스 1건이 **옛 엔진 기준**으로 등록돼
--     공급가액이 /1.1 되어 있었다(200,000 → 181,818). 계약금액(=공급가액)으로 되돌린다.
update public.biz_invoice_request r
   set supply_amount = c.amount,
       vat   = round(c.amount * 0.1),
       total = c.amount + round(c.amount * 0.1),
       note  = trim(coalesce(r.note, '') || ' 2026-09-01 청구엔진 수정분 반영(부가세 오차감 정정).')
  from public.biz_sales_contract c
 where c.id = r.contract_id
   and r.ym in ('2026-07', '2026-08')
   and r.status <> '취소'
   and r.supply_amount <> c.amount
   and c.contract_code in (
     'L0138-01-R-BK-T-2026-01', 'L0138-02-R-BK-T-2026-01',
     'L0138-03-R-BK-T-2026-01', 'L0139-01-R-BK-T-2026-01');

-- (2) 감사 계약(회계감사 중도금 10,000,000)이 taxteam 목록에 섞여 등록된 건 취소.
--     후보 전개에 팀 필터가 없어 생긴 일이고, 화면 쪽은 코드로 막았다.
update public.biz_invoice_request r
   set status = '취소',
       note = trim(coalesce(r.note, '') || ' 2026-09-01 감사팀 계약이 taxteam 목록에 섞여 등록된 건 — 취소.')
  from public.biz_sales_contract c
 where c.id = r.contract_id and c.team = '감사team'
   and r.team = 'taxteam' and r.status = '요청';
