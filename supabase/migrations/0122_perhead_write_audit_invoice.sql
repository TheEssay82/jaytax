-- 인당회계사에게 **감사팀 발행요청만** 쓰기를 연다 (2026-09-03 정우철 확정).
--
-- 인당회계사도 담당 회계사로서 자기 건을 요청해야 한다. 다만 딱 그 화면뿐이다 —
-- taxteam 발행요청·거래처·계약 등은 계속 조회만이다. 그래서 기존 정책은 그대로 두고
-- `team = '감사team'` 으로 좁힌 정책을 **따로 얹는다**(permissive 는 OR 로 묶인다).
-- 쓰기잠금(is_readonly)은 여기서도 그대로 지킨다.

-- ① 발행요청 등록(제안→요청 · 건별 등록 · (−)수정발행)
drop policy if exists biz_invoice_request_ins_perhead_audit on public.biz_invoice_request;
create policy biz_invoice_request_ins_perhead_audit on public.biz_invoice_request
  for insert to authenticated
  with check (public.is_perhead() and not public.is_readonly() and team = '감사team');

-- ② 자기 팀 건의 수정(취소·적요 정정 등). 발행완료 처리는 화면에서 승인자만 누를 수 있다.
drop policy if exists biz_invoice_request_upd_perhead_audit on public.biz_invoice_request;
create policy biz_invoice_request_upd_perhead_audit on public.biz_invoice_request
  for update to authenticated
  using (public.is_perhead() and not public.is_readonly() and team = '감사team')
  with check (public.is_perhead() and not public.is_readonly() and team = '감사team');

-- ③ '이미 청구함 · 제안에서 빼기' — 감사팀 계약의 분할회차만 닫을 수 있다.
drop policy if exists biz_contract_installment_upd_perhead_audit on public.biz_contract_installment;
create policy biz_contract_installment_upd_perhead_audit on public.biz_contract_installment
  for update to authenticated
  using (public.is_perhead() and not public.is_readonly()
         and exists (select 1 from public.biz_sales_contract c
                      where c.id = contract_id and c.team = '감사team'))
  with check (public.is_perhead() and not public.is_readonly()
         and exists (select 1 from public.biz_sales_contract c
                      where c.id = contract_id and c.team = '감사team'));

-- ④ 제안 알림을 보낸 기록(같은 회차로 두 번 보내지 않기 위한 표).
drop policy if exists biz_audit_proposal_notice_perhead on public.biz_audit_proposal_notice;
create policy biz_audit_proposal_notice_perhead on public.biz_audit_proposal_notice
  for all to authenticated
  using (public.is_perhead() and not public.is_readonly())
  with check (public.is_perhead() and not public.is_readonly());
