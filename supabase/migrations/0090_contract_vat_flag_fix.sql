-- 0090_contract_vat_flag_fix.sql
-- 오늘 등록된 시파사 3건·엘케이씨파트너스 1건에 '부가세 포함'이 켜져 있어
-- 공급가액이 200,000 → 181,818 로 깎여 잡혔다.
-- ERP 실제 발행분(2026-08 대조용)은 공급가액 200,000 / 150,000 이므로 계약금액이 곧 공급가액이다.
update public.biz_sales_contract
   set includes_vat = false,
       note = trim(coalesce(note, '') || ' 2026-09-01 대사 — 계약금액이 공급가액이라 부가세포함 해제(ERP 실제 발행 200,000/150,000).')
 where contract_code in (
   'L0138-01-R-BK-T-2026-01', 'L0138-02-R-BK-T-2026-01',
   'L0138-03-R-BK-T-2026-01', 'L0139-01-R-BK-T-2026-01')
   and includes_vat;
