-- 0178 기장배분 — 거래처 줄에 기초·기말 미수금과 자료 출처(사용자 2026-10-19 「25.6.30 미수금이 맞나 · 거래처별 내역부터 보고 싶다」).
--
-- ERP 「기간 미수금대장」(부서별 미수금현황, 청구서마다 계약구분 · 기초이월액 · 당기입금액 · 대손 · 잔금)을 쓰면
-- 원장으로 입금 성격을 추정할 필요가 없다. 거래처별 기초(2025-06-30)·기말(2026-06-30) 미수금도 같은 자료에서 나온다.
-- 감사팀 미수금대장의 「회계사」 칸은 담당 회계사다(2본부5팀에는 다른 회계사 거래처도 섞여 있다).

alter table public.bk_settle_client
  add column if not exists ar_open  numeric not null default 0,
  add column if not exists ar_close numeric not null default 0,
  add column if not exists source   text,
  add column if not exists erp_cpa  text;
comment on column public.bk_settle_client.ar_open  is '기초 미수금(VAT 제외) — ERP 기간 미수금대장의 기초이월액_부가세';
comment on column public.bk_settle_client.ar_close is '기말 미수금(VAT 제외) — ERP 기간 미수금대장의 잔금_부가세';
comment on column public.bk_settle_client.source   is '이 줄을 만든 자료: 미수금대장(청구서별 계약구분) | 원장(선입선출 추정)';
comment on column public.bk_settle_client.erp_cpa  is 'ERP 미수금대장의 「회계사」 칸(감사팀만 담당 회계사, 기장팀은 담당 직원)';
