-- 우리와 무관한 입금을 접어 두는 자리.
--
-- 부서별원장은 **그 부서 전체**가 나온다. 다른 회계사 담당이거나 우리 거래처가 아닌 입금이
-- 섞여 있고, 그것들은 영영 거래처가 붙지 않는다. 매달 '거래처를 못 찾은 입금'에 그대로 쌓이면
-- 진짜로 붙여야 할 건이 묻힌다. 그래서 한 번 판단한 것은 제외로 접어 둔다(지우지는 않는다 —
-- 원장 합계와 검산할 때 그 금액이 필요하다).
alter table public.biz_receipt
  add column if not exists excluded boolean not null default false,
  add column if not exists exclude_note text;

create index if not exists biz_receipt_unmatched_idx
  on public.biz_receipt (ym, team) where place_id is null and not excluded;

comment on column public.biz_receipt.excluded is
  '우리 팀과 무관하다고 판단해 접어 둔 입금. 미수금 계산에는 원래 들어가지 않고(거래처 미연결), 미매칭 목록에서만 빠진다.';
