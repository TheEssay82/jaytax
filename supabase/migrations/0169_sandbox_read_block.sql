-- 0169 체험 계정 — **읽기**도 감사업무 밖은 막는다(사용자 2026-10-06 「감사팀·기장팀의 매출 등 모든 자료가 보여지는지 확인」).
--
-- 0168 은 쓰기만 막았다. 화면은 감사업무관리만 보였지만, 인당회계사 등급의 읽기 권한이 그대로라
-- 서버에 직접 물으면 매출계약 273 · 발행요청 220 · 수금 204 · 미수금 504 · 청구기록 175 · 인건비 · 담당자·대표이사 ·
-- 상담기록이 읽혔다(실측). 체험 계정은 감사업무에 필요한 것만 읽게 한다.
--   · 막음(restrictive select): 매출·청구·수금·미수금·ERP·인건비·예산·거래처 사업장/담당자/대표이사/관계·상담·문서발송·자료실·요청·습작·보존 …
--   · 좁힘: biz_entity 는 감사 작업 건(dsd_engagement)이 있는 회사만, doc_clients 는 조회서가 있는 회사만.
--   · 둠: 감사업무 표(dsd_*·gwp_*·engagement_file·wtb_account_map·조회서), 직원 이름(profiles — 검토자·작성자 고르기), 기준서·공지·본인 알림.

do $$
declare t text;
  deny text[] := array[
    'billing_records','clients','staff_cost','budget_renewal','biz_budget_renewal',
    'biz_sales_contract','biz_contract_staff','biz_contract_discount','biz_contract_installment','biz_revenue_actual',
    'biz_invoice_request','biz_invoice_draft','biz_invoice_draft_log','biz_invoice_check','biz_invoice_month','biz_invoice_reconcile','biz_invoice_staff',
    'biz_erp_slip','biz_receipt','biz_receipt_upload','biz_ar_item','biz_ar_upload','biz_receivable_notice','biz_receivable_opening',
    'biz_tax_email_history','biz_staff_change_log','biz_audit_log','biz_audit_proposal_notice',
    'biz_place','biz_place_staff','biz_place_partner','biz_contact','biz_representative','biz_entity_relation',
    'consultations','consult_usage','doc_send_requests','doc_send_attachments','doc_contacts','doc_client_name_history','doc_audit_log',
    'evidence_documents','library_documents','library_fulltext','update_requests','access_log','login_attempt',
    'essay_piece','essay_ranking','essay_read','essay_reader','retention_policy','purge_log'];
begin
  foreach t in array deny loop
    if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = t) then continue; end if;
    execute format('drop policy if exists sbx_select on public.%I', t);
    execute format('create policy sbx_select on public.%I as restrictive for select using (not public.is_sandbox())', t);
  end loop;
end $$;

drop policy if exists sbx_select on public.biz_entity;
create policy sbx_select on public.biz_entity as restrictive for select
  using (not public.is_sandbox() or exists (select 1 from public.dsd_engagement e where e.entity_id = biz_entity.id));

drop policy if exists sbx_select on public.doc_clients;
create policy sbx_select on public.doc_clients as restrictive for select
  using (not public.is_sandbox() or exists (select 1 from public.confirmations c where c.client_id = doc_clients.id));

-- 파일 저장소 읽기 — 감사업무 버킷(gwp·dsd-notes)과 기준서 PDF 만. 문서발송·자료실·증빙 파일은 못 받는다.
drop policy if exists sbx_select on storage.objects;
create policy sbx_select on storage.objects as restrictive for select
  using (not public.is_sandbox() or bucket_id in ('gwp', 'dsd-notes', 'standard-pdfs'));
