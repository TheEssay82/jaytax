-- 0057_installment_billed_at
-- 분할 회차 '청구완료(확인)' 플래그 — 매출계약 청구예정일 경과 알람의 CONFIRM.
-- null=미확인(알람에 뜸), 값 있으면 확인됨(알람 제외). 실청구/수금 시스템(기장등청구관리)과는 별개의 가벼운 확인.
alter table biz_contract_installment add column if not exists billed_at timestamptz;
comment on column biz_contract_installment.billed_at is '청구완료(확인) 시각 — 알람 CONFIRM. null=미확인';
