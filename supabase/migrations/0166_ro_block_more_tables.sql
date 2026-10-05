-- 0166 쓰기 잠금(profiles.readonly) 계정 — 서버가 막지 않던 표에도 막기를 단다(2026-10-05 권한 점검).
-- 조회서(confirmations·confirmation_items)와 청구·대사 표 일부는 화면만 믿고 서버 막기가 없었다.
-- 다른 표와 같은 restrictive ro_block_* 세 개. 서비스 키(엣지 함수)는 RLS 를 타지 않아 상관없다.
-- 알림·내 표 보기·상담 사용량처럼 본인 것만 쓰는 표는 잠금 계정도 쓸 수 있게 둔다.
do $$
declare t text;
begin
  foreach t in array array['confirmations','confirmation_items','biz_erp_slip','biz_invoice_check','biz_invoice_month',
                           'biz_invoice_reconcile','biz_invoice_staff','biz_receipt','biz_receipt_upload'] loop
    execute format('drop policy if exists ro_block_insert on public.%I', t);
    execute format('drop policy if exists ro_block_update on public.%I', t);
    execute format('drop policy if exists ro_block_delete on public.%I', t);
    execute format('create policy ro_block_insert on public.%I as restrictive for insert with check (not public.is_readonly())', t);
    execute format('create policy ro_block_update on public.%I as restrictive for update using (not public.is_readonly()) with check (not public.is_readonly())', t);
    execute format('create policy ro_block_delete on public.%I as restrictive for delete using (not public.is_readonly())', t);
  end loop;
end $$;
