-- 0207: 쏭비서 결재에 「세금계산서 발행의뢰」 추가(대표님 2026-11-21)
--
-- 쏭비서는 결재만 올리고, 대표님이 결재함에서 승인하면 앱의 건별 발행요청 등록
-- (invoiceRequestApi.createManualInvoiceRequest — 감사팀 「건별 등록」과 같은 함수)이 biz_invoice_request 를 만든다.
-- 받는 메일 주소는 쏭비서가 보내지 않는다 — 승인 때 앱이 사업장 「세금계산서 메일」→ 과거 발행 순으로 채운다.

alter table public.ssong_requests drop constraint if exists ssong_requests_kind_check;
alter table public.ssong_requests add constraint ssong_requests_kind_check
  check (kind in ('sales_contract', 'doc_send', 'invoice_request'));

create or replace function public.ssong_submit(
  p_kind text, p_title text, p_payload jsonb, p_reason text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_label text := public.ssong_require();
  v_id uuid; v_pending int; v_r jsonb; v_subject uuid; v_subject_name text;
begin
  if p_kind not in ('sales_contract', 'doc_send', 'invoice_request') then raise exception '알 수 없는 요청 종류: %', p_kind; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception '등록 내용이 비었습니다'; end if;
  if length(p_payload::text) > 20000 then raise exception '등록 내용이 너무 깁니다'; end if;
  if coalesce(btrim(p_title), '') = '' then raise exception '요약(title)이 필요합니다'; end if;

  select count(*) into v_pending from public.ssong_requests where status in ('대기', '처리중');
  if v_pending >= 30 then raise exception '결재 대기가 30건입니다. 대표님 결재 뒤에 다시 올려 주세요.'; end if;

  if p_kind in ('sales_contract', 'invoice_request') then
    v_subject := nullif(p_payload ->> 'entityId', '')::uuid;
    select e.name into v_subject_name from public.biz_entity e where e.id = v_subject and not coalesce(e.is_demo, false);
    if v_subject_name is null then raise exception '거래처(entityId)를 찾지 못했습니다'; end if;
    if nullif(p_payload ->> 'placeId', '') is not null and not exists (
      select 1 from public.biz_place p where p.id = (p_payload ->> 'placeId')::uuid and p.entity_id = v_subject
    ) then raise exception '사업장(placeId)이 그 거래처의 것이 아닙니다'; end if;
    if coalesce(p_payload ->> 'team', '') not in ('감사team', 'taxteam') then raise exception 'team 은 감사team 또는 taxteam'; end if;
  end if;

  if p_kind = 'sales_contract' then
    if coalesce(p_payload ->> 'categoryCode', '') = '' then raise exception 'categoryCode 가 필요합니다'; end if;
    if coalesce(p_payload ->> 'billingCycle', '') not in ('월', '분기', '반기', '연', '발생시', '건') then raise exception 'billingCycle 이 올바르지 않습니다'; end if;
    if coalesce(p_payload ->> 'occurrenceUnit', '') not in ('사업장', '법인', '개인') then raise exception 'occurrenceUnit 이 올바르지 않습니다'; end if;
    if jsonb_typeof(p_payload -> 'amount') <> 'number' or (p_payload ->> 'amount')::numeric < 0 then raise exception 'amount 는 0 이상 숫자'; end if;
  elsif p_kind = 'invoice_request' then
    if nullif(p_payload ->> 'contractId', '') is not null and not exists (
      select 1 from public.biz_sales_contract c where c.id = (p_payload ->> 'contractId')::uuid and c.entity_id = v_subject
    ) then raise exception '매출계약(contractId)이 그 거래처의 것이 아닙니다'; end if;
    if jsonb_typeof(p_payload -> 'supplyAmount') <> 'number' or (p_payload ->> 'supplyAmount')::numeric <= 0 then raise exception 'supplyAmount 는 0 보다 큰 숫자'; end if;
    if coalesce(p_payload ->> 'erpAccount', '') not in ('회계감사수입', '세무조정수입', '기업진단수입', '기장대리수입', '경영자문수입', '기타용역수입', '임의감사수입')
      then raise exception 'erpAccount 가 올바르지 않습니다'; end if;
    if coalesce(p_payload ->> 'phase', '') not in ('계약금', '중도금', '잔금', '총액') then raise exception 'phase 는 계약금·중도금·잔금·총액'; end if;
    if coalesce(btrim(p_payload ->> 'summary'), '') = '' then raise exception '적요(summary)가 필요합니다'; end if;
    if coalesce(p_payload ->> 'issueDate', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'issueDate 는 YYYY-MM-DD'; end if;
  else
    if coalesce(p_payload ->> 'requester', '') = '' then raise exception '의뢰인(requester)이 필요합니다'; end if;
    if coalesce(p_payload ->> 'workType', '') not in ('우체국', '퀵서비스', '회계사책상') then raise exception 'workType 이 올바르지 않습니다'; end if;
    if coalesce(p_payload ->> 'sendKind', '') = '' then raise exception 'sendKind 가 필요합니다'; end if;
    if coalesce(p_payload ->> 'deadline', '') not in ('긴급', '보통', '지연가능') then raise exception 'deadline 이 올바르지 않습니다'; end if;
    if jsonb_typeof(p_payload -> 'recipients') <> 'array' or jsonb_array_length(p_payload -> 'recipients') = 0 then
      raise exception '수신자(recipients)가 1명 이상 필요합니다';
    end if;
    for v_r in select * from jsonb_array_elements(p_payload -> 'recipients') loop
      if not exists (
        select 1 from public.doc_contacts c
         where c.id = nullif(v_r ->> 'contactId', '')::uuid and c.client_id = nullif(v_r ->> 'clientId', '')::uuid
      ) then raise exception '수신자 연락처를 찾지 못했습니다: %', v_r; end if;
    end loop;
    select dc.id, dc.company_name into v_subject, v_subject_name from public.doc_clients dc
     where dc.id = (p_payload -> 'recipients' -> 0 ->> 'clientId')::uuid;
  end if;

  insert into public.ssong_requests (kind, title, payload, reason, key_label)
  values (p_kind, left(btrim(p_title), 200), p_payload, left(p_reason, 2000), v_label)
  returning id into v_id;

  perform public.ssong_log('ssong_submit', 'ssong_requests', v_subject, v_subject_name, p_kind,
                           jsonb_build_object('request_id', v_id, 'key', v_label));
  return v_id;
end $$;

create or replace function public.ssong_finish(p_id uuid, p_created_table text, p_created_ids uuid[], p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare r public.ssong_requests; v_name text;
begin
  if not public.ssong_is_approver() then raise exception '결재 권한이 없습니다'; end if;
  if p_created_table not in ('biz_sales_contract', 'doc_send_requests', 'biz_invoice_request') then raise exception '알 수 없는 표: %', p_created_table; end if;
  select p.name into v_name from public.profiles p where p.id = auth.uid();
  update public.ssong_requests
     set status = '승인', decided_by = auth.uid(), decided_by_name = v_name, decided_at = now(),
         decision_note = nullif(btrim(coalesce(p_note, '')), ''),
         created_table = p_created_table, created_ids = p_created_ids, last_error = null
   where id = p_id and status = '처리중'
  returning * into r;
  if r.id is null then raise exception '처리중인 결재가 아닙니다'; end if;
  perform public.log_access('ssong_approve', p_created_table, null, r.title, null,
                            jsonb_build_object('request_id', p_id, 'created_ids', p_created_ids));
end $$;

revoke all on function public.ssong_submit(text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.ssong_submit(text,text,jsonb,text) to anon;
revoke all on function public.ssong_finish(uuid,text,uuid[],text) from public, anon, authenticated;
grant execute on function public.ssong_finish(uuid,text,uuid[],text) to authenticated;
