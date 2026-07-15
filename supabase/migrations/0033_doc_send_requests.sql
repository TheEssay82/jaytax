-- 0033: 문서발송 › 발송요청 — 요청 작성(+ 향후 처리 필드) 단일 테이블
-- 흐름: 발송요청(작성) → 발송요청처리(발송일·등기번호·상태) → 발송업무현황.
-- 요구 반영: 거래처/담당자 선택 시 회사명·수신자·직급·주소·연락처를 '스냅샷' 저장(과거 요청은 마스터 변경과 무관).
--   의뢰인=로그인 자동+대리 지정 / 한 요청에 수신자 다중(개별 건, batch_id 로 묶음) / 미접수 건만 수정·삭제.
--   CRUD 감사로그는 doc_audit_log 재사용(entity='send_request').

create table if not exists public.doc_send_requests (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid,                                 -- 같은 등록에서 만든 다중 수신자 묶음
  request_date  date not null default current_date,   -- 의뢰일자
  requester     text not null,                        -- 의뢰인(대리 지정 가능)
  requester_id  uuid references auth.users(id),       -- 실제 작성자
  work_type     text not null,                        -- 업무구분 (우체국/퀵서비스/회계사책상)
  send_kind     text not null,                        -- 송부종류
  doc_name      text,                                 -- 문서명
  copies        int not null default 1,               -- 발송부수
  seal_required boolean not null default false,       -- 날인필요 (날인요=true / X=false)
  deadline      text not null default '보통',          -- 발송기한 (긴급/보통/지연가능)
  etc_request   text,                                 -- 기타요청사항
  -- 수신자(거래처/담당자) — FK + 스냅샷
  client_id     uuid references public.doc_clients(id) on delete set null,
  contact_id    uuid references public.doc_contacts(id) on delete set null,
  company_name    text not null,                      -- 거래처명(스냅샷)
  recipient_name  text,                               -- 수신자명(스냅샷)
  recipient_title text,                               -- 직급/호칭(스냅샷)
  address         text,                               -- 주소(스냅샷)
  phone           text,                               -- 연락처(스냅샷)
  -- 처리 단계(다음 메뉴에서 채움)
  status        text not null default '미접수',         -- 미접수/진행중/발송완료
  sent_date     date,                                 -- 발송일
  tracking_no   text,                                 -- 등기번호
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id)
);
create index if not exists doc_send_status_idx on public.doc_send_requests(status);
create index if not exists doc_send_date_idx on public.doc_send_requests(request_date desc);
create index if not exists doc_send_client_idx on public.doc_send_requests(client_id);
create index if not exists doc_send_batch_idx on public.doc_send_requests(batch_id);

-- ── 트리거 함수 ───────────────────────────────────────────
-- INSERT: created_by/updated_by/requester_id 를 서버에서 신뢰성 있게 채움
create or replace function public.doc_send_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_by   := coalesce(new.created_by, auth.uid());
  new.updated_by   := coalesce(new.updated_by, auth.uid());
  new.requester_id := coalesce(new.requester_id, auth.uid());
  return new;
end; $$;

-- UPDATE: updated_* 갱신
create or replace function public.doc_touch_updated()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end; $$;

-- DELETE 가드: 처리가 시작된(미접수 아님) 요청은 삭제 불가
create or replace function public.doc_send_block_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status <> '미접수' then
    raise exception '처리가 시작된 발송요청(상태: %)은 삭제할 수 없습니다.', old.status;
  end if;
  return old;
end; $$;

-- 감사로그: client/contact 에 더해 send_request 분기 추가(to_jsonb 로 컬럼차 회피)
create or replace function public.doc_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_entity text := TG_ARGV[0];
  v_actor  uuid := auth.uid();
  v_name   text := public.doc_actor_name();
  rec      jsonb;
  v_client uuid;
  v_target text;
  v_label  text;
  v_act    text;
begin
  if TG_OP = 'DELETE' then rec := to_jsonb(old); else rec := to_jsonb(new); end if;
  if v_entity = 'client' then
    v_client := (rec->>'id')::uuid;
    v_target := rec->>'company_name';
    v_label  := '거래처';
  elsif v_entity = 'contact' then
    v_client := (rec->>'client_id')::uuid;
    v_target := rec->>'contact_name';
    v_label  := '담당자';
  else -- send_request
    v_client := nullif(rec->>'client_id', '')::uuid;
    v_target := trim(coalesce(rec->>'company_name', '') || ' ' || coalesce(rec->>'send_kind', ''));
    v_label  := '발송요청';
  end if;
  v_act := case TG_OP when 'INSERT' then '등록' when 'UPDATE' then '수정' else '삭제' end;
  insert into public.doc_audit_log(entity, action, entity_id, client_id, actor_id, actor_name, summary, before, after)
  values (
    v_entity, lower(TG_OP), (rec->>'id')::uuid, v_client, v_actor, v_name,
    v_label || ' ' || v_act || ': ' || coalesce(nullif(v_target, ''), '(무제)'),
    case when TG_OP <> 'INSERT' then to_jsonb(old) end,
    case when TG_OP <> 'DELETE' then to_jsonb(new) end
  );
  if TG_OP = 'DELETE' then return old; else return new; end if;
end; $$;

-- ── 트리거 ────────────────────────────────────────────────
drop trigger if exists trg_doc_send_before_insert on public.doc_send_requests;
create trigger trg_doc_send_before_insert before insert on public.doc_send_requests
  for each row execute function public.doc_send_before_insert();
drop trigger if exists trg_doc_send_before_update on public.doc_send_requests;
create trigger trg_doc_send_before_update before update on public.doc_send_requests
  for each row execute function public.doc_touch_updated();
drop trigger if exists trg_doc_send_block_delete on public.doc_send_requests;
create trigger trg_doc_send_block_delete before delete on public.doc_send_requests
  for each row execute function public.doc_send_block_delete();
drop trigger if exists trg_doc_send_audit on public.doc_send_requests;
create trigger trg_doc_send_audit after insert or update or delete on public.doc_send_requests
  for each row execute function public.doc_audit('send_request');

-- ── RLS ───────────────────────────────────────────────────
alter table public.doc_send_requests enable row level security;
create policy doc_send_sel on public.doc_send_requests for select to authenticated
  using (not public.is_external());
create policy doc_send_ins on public.doc_send_requests for insert to authenticated
  with check (not public.is_external() and not public.is_readonly());
create policy doc_send_upd on public.doc_send_requests for update to authenticated
  using (not public.is_external() and not public.is_readonly())
  with check (not public.is_external() and not public.is_readonly());
create policy doc_send_del on public.doc_send_requests for delete to authenticated
  using (not public.is_external() and not public.is_readonly());
