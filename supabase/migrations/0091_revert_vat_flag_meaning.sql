-- 0091_revert_vat_flag_meaning.sql
-- 0090 을 되돌린다.
--
-- includes_vat / includes_wht 는 '금액에 부가세가 포함됐는가'가 아니라
-- **기장 계약에 부가세·원천세 신고업무가 포함되는가**라는 업무 범위 표시다.
-- (매출계약 등록 화면 라벨도 「기장 포함: 부가가치세 / 원천세」)
--
-- 금액이 200,000 → 181,818 로 깎여 보인 진짜 원인은 청구 전개 엔진(billingSchedule.toNet)이
-- 이 값을 금액 의미로 오해해 /1.1 한 것이었다. 엔진을 고쳤고, 업무 정보인 체크는 되살린다.
update public.biz_sales_contract
   set includes_vat = true,
       note = nullif(trim(replace(coalesce(note, ''),
         '2026-09-01 대사 — 계약금액이 공급가액이라 부가세포함 해제(ERP 실제 발행 200,000/150,000).', '')), '')
 where contract_code in (
   'L0138-01-R-BK-T-2026-01', 'L0138-02-R-BK-T-2026-01',
   'L0138-03-R-BK-T-2026-01', 'L0139-01-R-BK-T-2026-01');
