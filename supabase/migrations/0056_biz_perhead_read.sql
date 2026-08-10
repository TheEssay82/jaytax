-- 0056_biz_perhead_read
-- 인당회계사(per_head_accountant)에게 거래처관리(biz_*) 조회 허용.
-- SELECT 정책에서 is_perhead 차단만 제거한다. 쓰기(INSERT/UPDATE/DELETE)와 PII 복호(biz_reveal_*)는
-- 계속 차단(그 정책들엔 NOT is_perhead() 유지). 외부인(is_external)은 조회도 계속 차단.
-- 프론트: PER_HEAD_ALLOWED_GROUPS 에 'clients-hub' 추가 + 거래처관리 탭 canWrite 에서 per_head 제외(조회 전용).
alter policy biz_entity_sel               on biz_entity               using (not is_external());
alter policy biz_place_sel                on biz_place                using (not is_external());
alter policy biz_representative_sel       on biz_representative       using (not is_external());
alter policy biz_place_partner_sel        on biz_place_partner        using (not is_external());
alter policy biz_place_staff_sel          on biz_place_staff          using (not is_external());
alter policy biz_entity_relation_sel      on biz_entity_relation      using (not is_external());
alter policy biz_sales_contract_sel       on biz_sales_contract       using (not is_external());
alter policy biz_contract_staff_sel       on biz_contract_staff       using (not is_external());
alter policy biz_contract_installment_sel on biz_contract_installment using (not is_external());
alter policy biz_contract_discount_sel    on biz_contract_discount    using (not is_external());
alter policy biz_contact_sel              on biz_contact              using (not is_external());
