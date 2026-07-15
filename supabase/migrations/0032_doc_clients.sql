-- 0032: 문서발송 › 거래처 담당자 관리 — 계층형(거래처 회사 → 담당자) + 회사명 변경이력 + CRUD 감사로그
-- 요구사항 요약:
--  · 거래처(회사) 아래 담당자 N명. 회사명·담당회계사는 회사 속성, 호칭·연락처·이메일·수령지주소는 담당자 속성.
--  · CRUD 는 외부인 제외 전 역할 허용(읽기전용 계정은 서버 차단 유지).
--  · 모든 등록/수정/삭제를 doc_audit_log 에 기록하며 '행위 담당자(actor)'도 남긴다(트리거, auth.uid 기반).
--  · 회사명 변경 시 doc_client_name_history 에 이력 적재(과거 발송기록은 과거 회사명 유지 목적).

-- ── 테이블 ────────────────────────────────────────────────
create table if not exists public.doc_clients (
  id           uuid primary key default gen_random_uuid(),
  company_name text not null,                    -- 회사명(현재)
  accountant   text not null,                    -- 담당회계사 (정우철/송현주/조현규/김준성)
  note         text,                             -- 비고
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id),
  updated_by   uuid references auth.users(id)
);

create table if not exists public.doc_contacts (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.doc_clients(id) on delete cascade,
  contact_name text not null,                    -- 거래처담당자명
  honorific    text not null default '님',        -- 거래처담당자호칭 (미기재 시 '님')
  phone        text,                             -- 연락처(선택)
  email        text,                             -- 이메일(선택)
  address      text,                             -- 수령지주소 (앱에서 필수, DB는 정크 적재 허용 위해 nullable)
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id),
  updated_by   uuid references auth.users(id)
);
create index if not exists doc_contacts_client_idx on public.doc_contacts(client_id);

create table if not exists public.doc_client_name_history (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.doc_clients(id) on delete cascade,
  old_name        text not null,
  new_name        text not null,
  changed_by      uuid,
  changed_by_name text,
  changed_at      timestamptz not null default now()
);
create index if not exists doc_name_hist_client_idx on public.doc_client_name_history(client_id);

create table if not exists public.doc_audit_log (
  id         bigint generated always as identity primary key,
  entity     text not null,                      -- 'client' | 'contact'
  action     text not null,                      -- 'insert' | 'update' | 'delete'
  entity_id  uuid,
  client_id  uuid,                               -- 소속 회사(담당자 로그도 회사로 묶어보기)
  actor_id   uuid,                               -- 행위 담당자(직원) uid
  actor_name text,                               -- 행위 담당자명(스냅샷)
  summary    text,                               -- 사람이 읽는 요약
  before     jsonb,
  after      jsonb,
  at         timestamptz not null default now()
);
create index if not exists doc_audit_at_idx on public.doc_audit_log(at desc);
create index if not exists doc_audit_client_idx on public.doc_audit_log(client_id);

-- ── 공통 함수 ─────────────────────────────────────────────
-- 행위 담당자명 (profiles.name → email → 'system')
create or replace function public.doc_actor_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(name, '') from public.profiles where id = auth.uid()),
    (select email from public.profiles where id = auth.uid()),
    'system'
  );
$$;

-- INSERT 시 created_by/updated_by 를 서버에서 신뢰성 있게 채움
create or replace function public.doc_set_created_by()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  new.updated_by := coalesce(new.updated_by, auth.uid());
  return new;
end; $$;

-- 거래처 UPDATE: updated_* 갱신 + 회사명 변경 시 이력 적재
create or replace function public.doc_client_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if new.company_name is distinct from old.company_name then
    insert into public.doc_client_name_history(client_id, old_name, new_name, changed_by, changed_by_name)
      values (old.id, old.company_name, new.company_name, auth.uid(), public.doc_actor_name());
  end if;
  return new;
end; $$;

-- 담당자 UPDATE: updated_* 갱신
create or replace function public.doc_contact_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end; $$;

-- 감사로그 기록 (TG_ARGV[0] = 'client' | 'contact')
-- 주의: 두 테이블이 컬럼 구성이 달라, CASE 안에서 new.client_id / new.company_name 을 직접
--       참조하면 PL/pgSQL 이 미사용 분기까지 컬럼을 해석하려다 42703 오류가 난다.
--       → to_jsonb 로 레코드를 뽑아 키로 접근한다(존재하지 않는 키는 NULL).
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
  else
    v_client := (rec->>'client_id')::uuid;
    v_target := rec->>'contact_name';
    v_label  := '담당자';
  end if;
  v_act := case TG_OP when 'INSERT' then '등록' when 'UPDATE' then '수정' else '삭제' end;
  insert into public.doc_audit_log(entity, action, entity_id, client_id, actor_id, actor_name, summary, before, after)
  values (
    v_entity, lower(TG_OP), (rec->>'id')::uuid, v_client, v_actor, v_name,
    v_label || ' ' || v_act || ': ' || coalesce(v_target, ''),
    case when TG_OP <> 'INSERT' then to_jsonb(old) end,
    case when TG_OP <> 'DELETE' then to_jsonb(new) end
  );
  if TG_OP = 'DELETE' then return old; else return new; end if;
end; $$;

-- ── 트리거 ────────────────────────────────────────────────
drop trigger if exists trg_doc_clients_created on public.doc_clients;
create trigger trg_doc_clients_created before insert on public.doc_clients
  for each row execute function public.doc_set_created_by();
drop trigger if exists trg_doc_clients_before_update on public.doc_clients;
create trigger trg_doc_clients_before_update before update on public.doc_clients
  for each row execute function public.doc_client_before_update();
drop trigger if exists trg_doc_clients_audit on public.doc_clients;
create trigger trg_doc_clients_audit after insert or update or delete on public.doc_clients
  for each row execute function public.doc_audit('client');

drop trigger if exists trg_doc_contacts_created on public.doc_contacts;
create trigger trg_doc_contacts_created before insert on public.doc_contacts
  for each row execute function public.doc_set_created_by();
drop trigger if exists trg_doc_contacts_before_update on public.doc_contacts;
create trigger trg_doc_contacts_before_update before update on public.doc_contacts
  for each row execute function public.doc_contact_before_update();
drop trigger if exists trg_doc_contacts_audit on public.doc_contacts;
create trigger trg_doc_contacts_audit after insert or update or delete on public.doc_contacts
  for each row execute function public.doc_audit('contact');

-- ── RLS ───────────────────────────────────────────────────
alter table public.doc_clients            enable row level security;
alter table public.doc_contacts           enable row level security;
alter table public.doc_client_name_history enable row level security;
alter table public.doc_audit_log          enable row level security;

-- 읽기: 인증 직원 전부(외부인만 차단)
create policy doc_clients_sel  on public.doc_clients  for select to authenticated using (not public.is_external());
create policy doc_contacts_sel on public.doc_contacts for select to authenticated using (not public.is_external());
create policy doc_namehist_sel on public.doc_client_name_history for select to authenticated using (not public.is_external());
create policy doc_audit_sel    on public.doc_audit_log for select to authenticated using (not public.is_external());

-- 쓰기(거래처): 외부인 제외 + 읽기전용 계정 제외
create policy doc_clients_ins on public.doc_clients for insert to authenticated
  with check (not public.is_external() and not public.is_readonly());
create policy doc_clients_upd on public.doc_clients for update to authenticated
  using (not public.is_external() and not public.is_readonly())
  with check (not public.is_external() and not public.is_readonly());
create policy doc_clients_del on public.doc_clients for delete to authenticated
  using (not public.is_external() and not public.is_readonly());

-- 쓰기(담당자): 동일
create policy doc_contacts_ins on public.doc_contacts for insert to authenticated
  with check (not public.is_external() and not public.is_readonly());
create policy doc_contacts_upd on public.doc_contacts for update to authenticated
  using (not public.is_external() and not public.is_readonly())
  with check (not public.is_external() and not public.is_readonly());
create policy doc_contacts_del on public.doc_contacts for delete to authenticated
  using (not public.is_external() and not public.is_readonly());

-- name_history / audit_log 은 트리거(SECURITY DEFINER)만 기록 → 직접 INSERT/UPDATE/DELETE 정책 없음(차단).
