-- 0175 팀결산 경비 귀속 — ERP 상세 엑셀의 증빙유형·계정코드·거래처코드·사원코드를 산출물에 그대로 쓰려고 담는다.
alter table public.expense_line add column if not exists evid_type text;
alter table public.expense_line add column if not exists account_code text;
alter table public.expense_line add column if not exists vendor_code text;
alter table public.expense_line add column if not exists emp_code text;
comment on column public.expense_line.evid_type is 'ERP 증빙유형(과세신용카드 등) — 산출물에 그대로';
