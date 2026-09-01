-- 월 초기화(전개 취소)에 필요한 삭제 권한.
--
-- 지금까지 '전개'는 되돌릴 수 없었다. 테스트로 열었거나 잘못 연 달을 되돌리려면
-- 진행 상태(biz_invoice_month)와 확인 표시(biz_invoice_check)를 지울 수 있어야 한다.
-- 확인 표시는 본인 것만 지울 수 있었는데(biz_invoice_check_del), 초기화는 3인분을 함께 지운다.
-- 발행요청 자체의 삭제 권한은 이미 있고, 발행완료 건이 있으면 앱에서 막는다.
drop policy if exists biz_invoice_month_del on public.biz_invoice_month;
create policy biz_invoice_month_del on public.biz_invoice_month
  for delete to authenticated
  using (not public.is_external() and not public.is_readonly() and not public.is_perhead());

drop policy if exists biz_invoice_check_del_all on public.biz_invoice_check;
create policy biz_invoice_check_del_all on public.biz_invoice_check
  for delete to authenticated
  using (not public.is_external() and not public.is_readonly() and not public.is_perhead());
