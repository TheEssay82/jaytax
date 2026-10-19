-- 0173 팀결산 경비 귀속 — 결산 제외 표시(비용이 아닌 줄, 예: 외상매출금 전환 3,300,000. 정우철 FY2026 작업본).
alter table public.expense_line add column if not exists excluded boolean not null default false;
comment on column public.expense_line.excluded is '결산 제외(비용이 아님 — 예: 외상매출금 전환). 업무·개인 어디에도 넣지 않는다.';
