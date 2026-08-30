-- 0073: 매출계약에 '계약확정/미계약' 상태 추가
--
-- 배경: 예산·projection 때문에 미리 넣어 둔 계약(전년 갱신분 등)은 아직 체결된 것이 아니다.
--       연말(귀속연도 12/31)이 지나기 전에는 매출확정으로 보기 어렵다는 사용자 기준.
--       지금까지는 (주)알엑스씨처럼 비고에 '미계약'이라고 적어두는 수밖에 없어서
--       걸러보거나 집계에서 구분할 수 없었다.
-- 규칙: confirmed = true(계약확정, 기본) / false(미계약 — 예정·검토 단계).
--       전년 갱신으로 만든 계약은 미계약으로 시작한다.

alter table public.biz_sales_contract
  add column if not exists confirmed boolean not null default true;

comment on column public.biz_sales_contract.confirmed is '계약확정 여부. false=미계약(예산 반영용 예정 계약)';

create index if not exists biz_sales_contract_confirmed_idx
  on public.biz_sales_contract(confirmed) where not confirmed;

-- 기존 데이터 정리
--  (a) 전년 갱신으로 만든 2026 귀속 세무조정 계약 → 미계약
update public.biz_sales_contract
   set confirmed = false
 where fiscal_year = 2026
   and category_code in ('TAX.FILING.CORP', 'TAX.FILING.INCOME')
   and note like '%계약 갱신%';

--  (b) 비고에 '미계약'이라고 적어둔 건 → 미계약 (비고 문구는 사용자 기록이므로 그대로 둔다)
update public.biz_sales_contract
   set confirmed = false
 where note ilike '%미계약%';
