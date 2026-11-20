-- 0200 쏭비서 결재함 (2026-11-20)
--
-- 쏭비서(대표님 비서 AI)가 JAYTAX 에 **바로 쓰지 않고 결재를 올린다.**
-- 대표님(최고관리자)이 「⚙ 관리 › 쏭비서 결재함」에서 승인하면 그때 앱의 기존 등록 코드
-- (createSalesContract · createSendRequests)가 실제 행을 만든다 — 계약코드 채번·알림·감사로그가
-- 지금 화면과 똑같이 돈다. 규칙을 DB 에 한 벌 더 만들지 않는다.
--
-- ── 열쇠 ────────────────────────────────────────────────
-- 커넥터(Vercel)는 anon 키 + 요청 헤더 `x-ssong-key` 만 가진다. service-role 키를 두지 않는다.
-- DB 는 그 열쇠의 sha256 만 ssong_keys 에 둔다. 열쇠 교체 = 해시 한 줄 바꾸기.
-- 열쇠 자체는 서버 환경변수(SSONG_DB_KEY)에만 있다 — 이 파일·커밋·채팅에 남기지 않는다.
--
-- ── 쏭비서가 할 수 있는 것 ──────────────────────────────
--   쓰기: ssong_submit (결재 올리기) 하나뿐. 고치기·지우기·취소·승인 함수는 없다.
--   읽기: 거래처·연락처 검색, 매출계약, 문서발송 상태·등기번호, 직원 이름, 자기 결재요청.
--   돌려주는 거래처 정보는 이름·코드·사업장·담당회계사·연락처 이름/직함뿐.
--   전화·주소·이메일·주민번호·사업자번호는 돌려주지 않는다(AI 마스킹 요건).
--   모든 호출을 access_log(해시 체인)에 actor_name='쏭비서' 로 남긴다.

-- ── 열쇠 해시 ───────────────────────────────────────────
create table if not exists public.ssong_keys (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,                    -- 'vercel' | 'macmini' …
  key_hash   text not null unique,             -- sha256(hex) — 열쇠 원문은 두지 않는다
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.ssong_keys enable row level security;
-- 정책 없음 — 앱·anon 어느 쪽도 읽지 못한다. 등록·교체는 관리자가 SQL 로.
revoke all on public.ssong_keys from public, anon, authenticated;

-- ── 결재 표 ─────────────────────────────────────────────
create table if not exists public.ssong_requests (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('sales_contract', 'doc_send')),
  title           text not null,                -- 한 줄 요약(결재함 목록)
  payload         jsonb not null,               -- 등록할 내용
  reason          text,                         -- 쏭비서가 붙인 근거·메모
  status          text not null default '대기'
                  check (status in ('대기', '처리중', '승인', '반려')),
  submitted_at    timestamptz not null default now(),
  submitted_via   text not null default 'ssong',
  key_label       text,                         -- 어느 열쇠로 올렸나(vercel/macmini)
  claimed_at      timestamptz,                  -- 승인 처리 시작(두 번 승인 막기)
  decided_by      uuid references public.profiles(id),
  decided_by_name text,
  decided_at      timestamptz,
  decision_note   text,                         -- 반려 사유 · 승인 메모
  created_table   text,                         -- 'biz_sales_contract' | 'doc_send_requests'
  created_ids     uuid[],                       -- 만들어진 행
  last_error      text                          -- 승인 중 실패하면 남김(상태는 '대기'로 돌아감)
);
create index if not exists ssong_requests_status_idx on public.ssong_requests(status, submitted_at desc);

comment on table public.ssong_requests is
  '쏭비서 결재함 — 쏭비서는 ssong_submit 으로 올리기만, 승인·반려는 최고관리자 화면(ssong_claim/finish/reject).';

alter table public.ssong_requests enable row level security;
drop policy if exists ssong_requests_sel on public.ssong_requests;
create policy ssong_requests_sel on public.ssong_requests
  for select to authenticated
  using (coalesce((select role = 'superuser' from public.profiles where id = auth.uid()), false));
-- 쓰기 정책은 두지 않는다 — 모든 변화는 아래 함수로만.
revoke insert, update, delete on public.ssong_requests from public, anon, authenticated;

-- ── 쏭비서 열쇠 확인 ────────────────────────────────────
-- 맞으면 열쇠 이름표(label), 틀리면 null.
create or replace function public.ssong_key_label() returns text
language plpgsql stable security definer set search_path = public as $$
declare h json; k text; v_label text;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then return null; end;
  k := btrim(coalesce(h ->> 'x-ssong-key', ''));
  if length(k) < 32 then return null; end if;
  select s.label into v_label from public.ssong_keys s
   where s.active and s.key_hash = encode(extensions.digest(k, 'sha256'), 'hex');
  return v_label;
end $$;

create or replace function public.ssong_require() returns text
language plpgsql stable security definer set search_path = public as $$
declare v text := public.ssong_key_label();
begin
  if v is null then raise exception '쏭비서 열쇠가 맞지 않습니다' using errcode = '42501'; end if;
  return v;
end $$;

-- ── 접속기록(쏭비서) ────────────────────────────────────
-- log_access() 는 auth.uid() 로 사람을 적는다. 쏭비서는 로그인한 사람이 아니라
-- 같은 해시 체인 공식으로 actor_name='쏭비서' 를 적는다(access_log_verify 와 같은 공식).
create or replace function public.ssong_log(
  p_action text, p_target text default null, p_subject_id uuid default null,
  p_subject_name text default null, p_reason text default null, p_detail jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint; v_prev text; v_ip text := public.client_ip(); v_ua text;
  v_at timestamptz := clock_timestamp(); v_hash text;
begin
  begin v_ua := left((current_setting('request.headers', true)::json) ->> 'user-agent', 400);
  exception when others then v_ua := null; end;
  perform pg_advisory_xact_lock(hashtext('public.access_log'));
  v_id := nextval('public.access_log_id_seq');
  select a.hash into v_prev from public.access_log a order by a.id desc limit 1;
  v_hash := encode(extensions.digest(
    coalesce(v_prev, '') || '|' || v_id::text || '|' || v_at::text || '|' ||
    '' || '|' || coalesce(v_ip, '') || '|' || p_action || '|' ||
    coalesce(p_target, '') || '|' || coalesce(p_subject_id::text, '') || '|' ||
    coalesce(p_reason, '') || '|' || coalesce(p_detail::text, ''), 'sha256'), 'hex');
  insert into public.access_log
    (id, at, actor_id, actor_name, actor_email, ip, user_agent,
     action, target, subject_id, subject_name, reason, detail, prev_hash, hash)
  values
    (v_id, v_at, null, '쏭비서', null, v_ip, v_ua,
     p_action, p_target, p_subject_id, p_subject_name, p_reason, p_detail, v_prev, v_hash);
end $$;

-- ════════════════════════════════════════════════════════
-- 쏭비서가 부르는 함수 (anon + x-ssong-key)
-- ════════════════════════════════════════════════════════

-- 결재 올리기 — 유일한 쓰기.
create or replace function public.ssong_submit(
  p_kind text, p_title text, p_payload jsonb, p_reason text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_label text := public.ssong_require();
  v_id uuid; v_pending int; v_r jsonb; v_subject uuid; v_subject_name text;
begin
  if p_kind not in ('sales_contract', 'doc_send') then raise exception '알 수 없는 요청 종류: %', p_kind; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception '등록 내용이 비었습니다'; end if;
  if length(p_payload::text) > 20000 then raise exception '등록 내용이 너무 깁니다'; end if;
  if coalesce(btrim(p_title), '') = '' then raise exception '요약(title)이 필요합니다'; end if;

  -- 결재함이 넘치지 않게 — 대기가 30건을 넘으면 더 받지 않는다.
  select count(*) into v_pending from public.ssong_requests where status in ('대기', '처리중');
  if v_pending >= 30 then raise exception '결재 대기가 30건입니다. 대표님 결재 뒤에 다시 올려 주세요.'; end if;

  if p_kind = 'sales_contract' then
    v_subject := nullif(p_payload ->> 'entityId', '')::uuid;
    select e.name into v_subject_name from public.biz_entity e where e.id = v_subject and not coalesce(e.is_demo, false);
    if v_subject_name is null then raise exception '거래처(entityId)를 찾지 못했습니다'; end if;
    if nullif(p_payload ->> 'placeId', '') is not null and not exists (
      select 1 from public.biz_place p where p.id = (p_payload ->> 'placeId')::uuid and p.entity_id = v_subject
    ) then raise exception '사업장(placeId)이 그 거래처의 것이 아닙니다'; end if;
    if coalesce(p_payload ->> 'team', '') not in ('감사team', 'taxteam') then raise exception 'team 은 감사team 또는 taxteam'; end if;
    if coalesce(p_payload ->> 'categoryCode', '') = '' then raise exception 'categoryCode 가 필요합니다'; end if;
    if coalesce(p_payload ->> 'billingCycle', '') not in ('월', '분기', '반기', '연', '발생시', '건') then raise exception 'billingCycle 이 올바르지 않습니다'; end if;
    if coalesce(p_payload ->> 'occurrenceUnit', '') not in ('사업장', '법인', '개인') then raise exception 'occurrenceUnit 이 올바르지 않습니다'; end if;
    if jsonb_typeof(p_payload -> 'amount') <> 'number' or (p_payload ->> 'amount')::numeric < 0 then raise exception 'amount 는 0 이상 숫자'; end if;
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

-- 내가 올린 결재요청 — 상태·결과·반려사유.
create or replace function public.ssong_my_requests(p_status text default null, p_limit int default 30)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.ssong_require();
  select coalesce(jsonb_agg(x order by x.submitted_at desc), '[]'::jsonb) into v from (
    select r.id, r.kind, r.title, r.status, r.submitted_at, r.decided_by_name, r.decided_at,
           r.decision_note, r.created_table, r.created_ids, r.last_error
      from public.ssong_requests r
     where p_status is null or r.status = p_status
     order by r.submitted_at desc
     limit least(greatest(coalesce(p_limit, 30), 1), 100)
  ) x;
  perform public.ssong_log('ssong_read', 'ssong_requests', null, null, null, jsonb_build_object('status', p_status));
  return v;
end $$;

-- 거래처 검색 — 이름·코드·사업장·담당회계사만.
create or replace function public.ssong_search_clients(p_q text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; q text := btrim(coalesce(p_q, ''));
begin
  perform public.ssong_require();
  if length(q) < 1 then raise exception '검색어가 필요합니다'; end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v from (
    select e.id as "entityId", e.code, e.name, e.kind,
           (select coalesce(jsonb_agg(jsonb_build_object(
                    'placeId', p.id, 'placeNo', p.place_no, 'placeName', p.place_name,
                    'isHeadquarters', p.is_headquarters, 'status', p.status, 'cpa', p.cpa)
                    order by p.place_no), '[]'::jsonb)
              from public.biz_place p where p.entity_id = e.id) as places
      from public.biz_entity e
     where not coalesce(e.is_demo, false)
       and (e.name ilike '%' || q || '%' or e.code ilike q || '%')
     order by e.name
     limit 20
  ) x;
  perform public.ssong_log('ssong_read', 'biz_entity', null, null, 'search_clients', jsonb_build_object('q', q, 'n', jsonb_array_length(v)));
  return v;
end $$;

-- 문서발송 수신자(연락처) 검색 — 이름·직함만. 전화·주소·이메일은 주지 않고 있음/없음만.
create or replace function public.ssong_search_contacts(p_q text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; q text := btrim(coalesce(p_q, ''));
begin
  perform public.ssong_require();
  if length(q) < 1 then raise exception '검색어가 필요합니다'; end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v from (
    select dc.id as "clientId", dc.company_name as "companyName", dc.accountant, dc.entity_id as "entityId",
           (select coalesce(jsonb_agg(jsonb_build_object(
                    'contactId', c.id, 'name', c.contact_name, 'position', c.position, 'honorific', c.honorific,
                    'hasAddress', coalesce(btrim(c.address), '') <> '', 'hasPhone', coalesce(btrim(c.phone), '') <> '')
                    order by c.contact_name), '[]'::jsonb)
              from public.doc_contacts c where c.client_id = dc.id) as contacts
      from public.doc_clients dc
     where dc.company_name ilike '%' || q || '%'
        or exists (select 1 from public.doc_contacts c where c.client_id = dc.id and c.contact_name ilike '%' || q || '%')
     order by dc.company_name
     limit 20
  ) x;
  perform public.ssong_log('ssong_read', 'doc_contacts', null, null, 'search_contacts', jsonb_build_object('q', q, 'n', jsonb_array_length(v)));
  return v;
end $$;

-- 매출계약 조회 — 거래처 하나의 계약.
create or replace function public.ssong_list_contracts(p_entity_id uuid, p_fiscal_year int default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; v_name text;
begin
  perform public.ssong_require();
  select e.name into v_name from public.biz_entity e where e.id = p_entity_id and not coalesce(e.is_demo, false);
  if v_name is null then raise exception '거래처를 찾지 못했습니다'; end if;
  select coalesce(jsonb_agg(x order by x."startDate" desc nulls last), '[]'::jsonb) into v from (
    select c.id, c.contract_code as "contractCode", c.team, c.category_code as "categoryCode",
           c.category_etc_name as "categoryEtcName", c.place_id as "placeId", c.occurrence_unit as "occurrenceUnit",
           c.billing_cycle as "billingCycle", c.amount, c.includes_vat as "includesVat", c.cpa,
           c.fiscal_year as "fiscalYear", c.contract_date as "contractDate", c.start_date as "startDate",
           c.end_date as "endDate", c.confirmed, c.billing_month as "billingMonth", c.note,
           (select coalesce(jsonb_agg(s.staff_name), '[]'::jsonb) from public.biz_contract_staff s
             where s.contract_id = c.id and s.active and s.to_month is null) as staff
      from public.biz_sales_contract c
     where c.entity_id = p_entity_id and (p_fiscal_year is null or c.fiscal_year = p_fiscal_year)
  ) x;
  perform public.ssong_log('ssong_read', 'biz_sales_contract', p_entity_id, v_name, 'list_contracts', null);
  return v;
end $$;

-- 문서발송 상태·등기번호 — 거래처명 일부 또는 발송요청 id. 주소·전화는 빼고.
create or replace function public.ssong_doc_send_status(p_q text default null, p_ids uuid[] default null, p_limit int default 20)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; q text := btrim(coalesce(p_q, ''));
begin
  perform public.ssong_require();
  if q = '' and p_ids is null then raise exception '거래처명 또는 발송요청 id 가 필요합니다'; end if;
  select coalesce(jsonb_agg(x order by x."requestDate" desc), '[]'::jsonb) into v from (
    select d.id, d.request_date as "requestDate", d.requester, d.work_type as "workType", d.send_kind as "sendKind",
           d.doc_name as "docName", d.copies, d.company_name as "companyName", d.recipient_name as "recipientName",
           d.status, d.sent_date as "sentDate", d.tracking_no as "trackingNo", d.status_note as "statusNote"
      from public.doc_send_requests d
     where d.deleted_at is null
       and ((p_ids is not null and d.id = any(p_ids)) or (q <> '' and d.company_name ilike '%' || q || '%'))
     order by d.request_date desc, d.created_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) x;
  perform public.ssong_log('ssong_read', 'doc_send_requests', null, null, 'doc_send_status', jsonb_build_object('q', q));
  return v;
end $$;

-- 직원 이름 — 담당직원·의뢰인 고르기용(이름만).
create or replace function public.ssong_list_staff()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.ssong_require();
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', btrim(p.name)) order by p.name), '[]'::jsonb) into v
    from public.profiles p
   where p.role not in ('external', 'client_user') and not coalesce(p.sandbox, false) and coalesce(btrim(p.name), '') <> '';
  perform public.ssong_log('ssong_read', 'profiles', null, null, 'list_staff', null);
  return v;
end $$;

-- ════════════════════════════════════════════════════════
-- 대표님(최고관리자) 화면이 부르는 함수
-- ════════════════════════════════════════════════════════
create or replace function public.ssong_is_approver() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'superuser' from public.profiles where id = auth.uid()), false)
$$;

-- 승인 시작 — 두 사람(두 탭)이 같은 건을 두 번 승인하지 못하게 '처리중'으로 잡는다.
-- 브라우저가 중간에 닫혀 10분 넘게 '처리중'이면 다시 잡을 수 있다.
create or replace function public.ssong_claim(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.ssong_requests;
begin
  if not public.ssong_is_approver() then raise exception '결재 권한이 없습니다'; end if;
  update public.ssong_requests
     set status = '처리중', claimed_at = now(), last_error = null
   where id = p_id
     and (status = '대기' or (status = '처리중' and claimed_at < now() - interval '10 minutes'))
  returning * into r;
  if r.id is null then raise exception '이미 처리된 결재입니다'; end if;
  return to_jsonb(r);
end $$;

-- 승인 완료 — 만들어진 행을 적는다.
create or replace function public.ssong_finish(p_id uuid, p_created_table text, p_created_ids uuid[], p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare r public.ssong_requests; v_name text;
begin
  if not public.ssong_is_approver() then raise exception '결재 권한이 없습니다'; end if;
  if p_created_table not in ('biz_sales_contract', 'doc_send_requests') then raise exception '알 수 없는 표: %', p_created_table; end if;
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

-- 승인 실패 — '대기'로 되돌리고 오류를 남긴다(다시 승인하거나 반려).
create or replace function public.ssong_fail(p_id uuid, p_error text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ssong_is_approver() then raise exception '결재 권한이 없습니다'; end if;
  update public.ssong_requests set status = '대기', claimed_at = null, last_error = left(p_error, 2000)
   where id = p_id and status = '처리중';
end $$;

-- 반려 — 사유 필수.
create or replace function public.ssong_reject(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.ssong_requests; v_name text;
begin
  if not public.ssong_is_approver() then raise exception '결재 권한이 없습니다'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception '반려 사유를 적어 주세요'; end if;
  select p.name into v_name from public.profiles p where p.id = auth.uid();
  update public.ssong_requests
     set status = '반려', decided_by = auth.uid(), decided_by_name = v_name, decided_at = now(),
         decision_note = btrim(p_note), claimed_at = null
   where id = p_id and status = '대기'
  returning * into r;
  if r.id is null then raise exception '대기 중인 결재가 아닙니다'; end if;
  perform public.log_access('ssong_reject', 'ssong_requests', null, r.title, btrim(p_note),
                            jsonb_build_object('request_id', p_id));
end $$;

-- ── 실행 권한 (0150: PUBLIC EXECUTE 부터 회수) ──────────
do $$
declare f text;
begin
  foreach f in array array[
    'ssong_key_label()', 'ssong_require()',
    'ssong_log(text,text,uuid,text,text,jsonb)',
    'ssong_submit(text,text,jsonb,text)', 'ssong_my_requests(text,int)',
    'ssong_search_clients(text)', 'ssong_search_contacts(text)',
    'ssong_list_contracts(uuid,int)', 'ssong_doc_send_status(text,uuid[],int)', 'ssong_list_staff()',
    'ssong_is_approver()', 'ssong_claim(uuid)', 'ssong_finish(uuid,text,uuid[],text)',
    'ssong_fail(uuid,text)', 'ssong_reject(uuid,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- 쏭비서(anon + 열쇠)가 부르는 것. 함수 안에서 열쇠를 확인한다.
grant execute on function public.ssong_submit(text,text,jsonb,text)        to anon;
grant execute on function public.ssong_my_requests(text,int)               to anon;
grant execute on function public.ssong_search_clients(text)                to anon;
grant execute on function public.ssong_search_contacts(text)               to anon;
grant execute on function public.ssong_list_contracts(uuid,int)            to anon;
grant execute on function public.ssong_doc_send_status(text,uuid[],int)    to anon;
grant execute on function public.ssong_list_staff()                        to anon;
-- 대표님 화면이 부르는 것. 함수 안에서 최고관리자인지 확인한다.
grant execute on function public.ssong_claim(uuid)                         to authenticated;
grant execute on function public.ssong_finish(uuid,text,uuid[],text)       to authenticated;
grant execute on function public.ssong_fail(uuid,text)                     to authenticated;
grant execute on function public.ssong_reject(uuid,text)                   to authenticated;
-- ssong_key_label · ssong_require · ssong_log · ssong_is_approver 는 다른 함수 안에서만 쓴다(직접 호출 불가).
