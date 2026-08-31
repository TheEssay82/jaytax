-- 0077: 기초 미수금에 VAT포함 금액 추가
--
-- ERP(부서별 미수금현황) 기준: 잔금_부가세(R) 합계 = 기초 미수금(공급가액).
-- 다만 거래처가 부가세를 뺀 금액만 입금하는 일이 있어(예: 김효주 프로골퍼 2306 청구분),
-- 대사할 근거로 부가세 포함 잔금(I)도 함께 보관한다.

alter table public.biz_receivable_opening
  add column if not exists amount_gross numeric not null default 0;

comment on column public.biz_receivable_opening.amount is '기초 미수 잔액 — 공급가액(부가세 제외) 기준. ERP 잔금_부가세(R) 합계';
comment on column public.biz_receivable_opening.amount_gross is '기초 미수 잔액 — 부가세 포함. 거래처가 VAT 뺀 금액만 입금하는 경우를 가려내기 위해 함께 보관';
