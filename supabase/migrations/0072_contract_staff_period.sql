-- 0072: 매출계약 담당직원에 귀속월 기간(이력) 추가
--
-- 배경: 기장처럼 매월 청구하는 계속계약은 담당직원이 수시로 바뀐다. 사용자 기준은
--       "청구하는 직원이 곧 그 달의 담당직원" — 그래서 담당직원을 '언제부터/언제까지'로 관리한다.
-- 범위: taxteam + 청구주기 '월' 계약(현재 58건)에서만 변경 시 귀속월을 묻는다.
--       연 1회 청구(세무조정·감사)는 청구 시점이 한 번뿐이라 기존처럼 단순 교체한다.
-- 규칙: from_month(포함) ~ to_month(포함), 둘 다 매월 1일로 저장. to_month 가 비면 현재까지.
--       from_month 가 비면 '처음부터'로 본다(기존 행 호환).

alter table public.biz_contract_staff
  add column if not exists from_month date,
  add column if not exists to_month   date;

comment on column public.biz_contract_staff.from_month is '담당 시작 귀속월(해당 월 1일). null=처음부터';
comment on column public.biz_contract_staff.to_month   is '담당 종료 귀속월(해당 월 1일, 포함). null=현재까지';

create index if not exists biz_contract_staff_period_idx
  on public.biz_contract_staff(contract_id, from_month, to_month);
