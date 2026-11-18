-- 0198 매출계약등록 — 인당회계사도 계약 등록·수정(사용자 2026-11-18). 계약 자체 지우기는 계속 막는다(0196 과 같은 선).
-- 분할·할인·담당은 저장할 때 지우고 다시 넣는 방식이라(saveInstallments 등) 지우기까지 연다.
drop policy if exists biz_sales_contract_ins_perhead on public.biz_sales_contract;
create policy biz_sales_contract_ins_perhead on public.biz_sales_contract for insert to authenticated
  with check (public.is_perhead() and not public.is_readonly());
drop policy if exists biz_sales_contract_upd_perhead on public.biz_sales_contract;
create policy biz_sales_contract_upd_perhead on public.biz_sales_contract for update to authenticated
  using (public.is_perhead() and not public.is_readonly())
  with check (public.is_perhead() and not public.is_readonly());
do $$
declare t text;
begin
  foreach t in array array['biz_contract_installment','biz_contract_discount','biz_contract_staff'] loop
    execute format('drop policy if exists %I on public.%I', t||'_all_perhead', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_perhead() and not public.is_readonly()) with check (public.is_perhead() and not public.is_readonly())', t||'_all_perhead', t);
  end loop;
end $$;
