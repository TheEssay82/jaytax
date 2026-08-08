-- 0050: 거래처관리 대공사(2.0.0) Phase 0 — 거래처 통합 레지스트리 스키마
--
-- 설계요지(2026-08-08 사용자 요구 23개 반영):
--  · 2계층: biz_entity(귀속 주체=법인/개인 본체) → biz_place(사업장=거래처 실체, 매출·담당자가 매달림).
--  · 위성 4종: biz_representative(법인 대표이사)·biz_place_partner(개인 공동사업자)·
--             biz_place_staff(담당직원 배정)·biz_audit_log(등록·변경 로그).
--  · 2중키(#12): 법인=(entity,사업장명)/개인=(entity,사업장명). entity 는 법인등록번호(법인)·성명(개인)으로 귀속.
--  · 민감정보(대표자/개인 주민등록번호·홈텍스pw)는 pgcrypto+vault 로 암호화 저장, 복호는 권한자 RPC 전용.
--  · 기존 clients / doc_clients 는 건드리지 않는다(청구·발송 무중단 병행). 1회성 이관은 별도 도구로.
--
-- 참고: 무사업자 개인의 '사업자번호=주민번호'(#22)는 biz_reg_no 평문에 넣지 않는다 →
--       no_biz=true 로 표시하고 주민번호는 entity.resident_no_enc(암호화)에서 식별값으로 사용.

-- ── 0. 민감정보 암호화 키(vault) 부트스트랩 — 파일에 평문 키를 남기지 않고 난수 생성 ──
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'biz_pii_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'biz_pii_key',
      'JAYTAX 거래처 민감정보(PII) 대칭암호화 키 — 자동생성, 회전 시 재암호화 필요');
  end if;
end $$;

-- 키 조회(내부 전용). 다른 SECURITY DEFINER 함수만 호출한다.
create or replace function public.biz_pii_key()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'biz_pii_key' limit 1;
$$;
revoke all on function public.biz_pii_key() from public;

-- 암호화(쓰기용) — 암호화 자체는 유출이 아니므로 내부직원 호출 허용.
create or replace function public.biz_encrypt(p text)
returns bytea language sql volatile security definer set search_path = '' as $$
  select case
    when p is null or btrim(p) = '' then null
    else extensions.pgp_sym_encrypt(p, public.biz_pii_key())
  end;
$$;

-- 복호 권한 게이트 — 회계사·팀장·최고관리자만 민감정보 열람.
create or replace function public.biz_can_reveal()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role in ('superuser','accountant','team_lead') from public.profiles where id = auth.uid()),
    false);
$$;

-- ── 1. biz_entity — 귀속 주체(법인/개인 본체) ────────────────────────────
create sequence if not exists public.biz_corp_seq;    -- 법인 코드 채번 L0001..
create sequence if not exists public.biz_person_seq;  -- 개인 코드 채번 I0001..

create table if not exists public.biz_entity (
  id               uuid primary key default gen_random_uuid(),
  code             text unique,                        -- L0001(법인)/I0001(개인) — 트리거 채번
  kind             text not null check (kind in ('법인','개인')),
  name             text not null,                      -- 법인명 또는 개인 성명
  corp_reg_no      text,                               -- 법인등록번호(법인 귀속키 #7)
  resident_no_enc  bytea,                              -- 개인 주민등록번호(암호화 #6·#22)
  established_date date,                               -- 설립일(법인 #15)
  note             text,
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now()
);
-- 법인등록번호는 법인 내 유일(빈값 제외).
create unique index if not exists uniq_entity_corp_reg
  on public.biz_entity(corp_reg_no) where kind = '법인' and corp_reg_no is not null and corp_reg_no <> '';
create index if not exists biz_entity_kind_idx on public.biz_entity(kind);
create index if not exists biz_entity_name_idx on public.biz_entity(name);

-- ── 2. biz_place — 사업장(거래처 실체) ───────────────────────────────────
create table if not exists public.biz_place (
  id              uuid primary key default gen_random_uuid(),
  entity_id       uuid not null references public.biz_entity(id) on delete cascade,
  place_no        int  not null default 0,             -- entity 내 사업장 순번(트리거 채번) → 코드 -01,-02
  place_name      text not null,                       -- 사업장명
  biz_reg_no      text,                                -- 사업자번호(무사업자/폐업이면 null #21·#22)
  no_biz          boolean not null default false,      -- 사업자없음 필터(#23)
  address         text,                                -- 사업장주소
  is_headquarters boolean not null default false,      -- 본사 사업장 표시(#13)
  nature          text not null default '매출' check (nature in ('매출','일반')),      -- 거래처 성격(#2)
  sales_teams     text[] not null default '{}',        -- ['감사team','taxteam'] 복수·가변(#3)
  tax_type        text check (tax_type in ('과세','겸영','면세')),       -- 과세유형(taxteam만 #17·#18)
  withholding     text check (withholding in ('월별','반기별','N/A')),    -- 원천세(taxteam만 #17·#19)
  opened_date     date,                                -- 개업일(#15)
  status          text not null default '정상' check (status in ('정상','폐업')),      -- 사업자 상태(#21)
  cpa             text,                                -- 담당 CPA
  hometax_id      text,                                -- 홈텍스 ID(선택)
  hometax_pw_enc  bytea,                               -- 홈텍스 PW(암호화·선택 #6·#9)
  note            text,                                -- 비고(정보량 최대화 #12)
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now()
);
-- 2중키(#12): 같은 귀속주체 안에서 사업장명 유일.
create unique index if not exists uniq_place_entity_name on public.biz_place(entity_id, place_name);
-- 사업자번호 전역 유일(빈값 제외).
create unique index if not exists uniq_place_biz_reg
  on public.biz_place(biz_reg_no) where biz_reg_no is not null and biz_reg_no <> '';
-- 본사는 귀속주체당 1개.
create unique index if not exists uniq_place_hq on public.biz_place(entity_id) where is_headquarters;
create index if not exists biz_place_entity_idx on public.biz_place(entity_id);
create index if not exists biz_place_nature_idx on public.biz_place(nature);
create index if not exists biz_place_nobiz_idx  on public.biz_place(no_biz) where no_biz;

-- ── 3. biz_representative — 법인 대표이사(#7·#8) ─────────────────────────
create table if not exists public.biz_representative (
  id               uuid primary key default gen_random_uuid(),
  entity_id        uuid not null references public.biz_entity(id) on delete cascade,
  rep_name         text not null,
  resident_no_enc  bytea,                              -- 대표자 주민등록번호(암호화 #6)
  rep_type         text not null default '단독' check (rep_type in ('단독','공동대표','각자대표')),  -- 복수 가능(#7)
  linked_entity_id uuid references public.biz_entity(id) on delete set null,  -- 대표가 개인거래처면 링크(#8)
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now()
);
create index if not exists biz_rep_entity_idx on public.biz_representative(entity_id);
create index if not exists biz_rep_linked_idx on public.biz_representative(linked_entity_id);

-- ── 4. biz_place_partner — 개인 공동사업자(#10·#8) ──────────────────────
create table if not exists public.biz_place_partner (
  id                uuid primary key default gen_random_uuid(),
  place_id          uuid not null references public.biz_place(id) on delete cascade,
  partner_entity_id uuid not null references public.biz_entity(id) on delete restrict,  -- 개인 entity 로 귀속
  share_pct         numeric(5,2),                      -- 지분율(선택 #10)
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id),
  updated_at        timestamptz not null default now(),
  unique (place_id, partner_entity_id)
);
create index if not exists biz_partner_place_idx  on public.biz_place_partner(place_id);
create index if not exists biz_partner_entity_idx on public.biz_place_partner(partner_entity_id);

-- ── 5. biz_place_staff — 담당직원 배정(#1·#2·#20, 복수) ──────────────────
create table if not exists public.biz_place_staff (
  id            uuid primary key default gen_random_uuid(),
  place_id      uuid not null references public.biz_place(id) on delete cascade,
  staff_id      uuid not null references public.profiles(id) on delete restrict,  -- 내부 직원 계정 참조
  staff_name    text,                                  -- 표시용 스냅샷
  active        boolean not null default true,
  assigned_at   timestamptz not null default now(),
  assigned_by   uuid references auth.users(id),
  unassigned_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- 같은 사업장에 동일 직원의 '활성' 배정은 1건만(비활성 이력은 여러 건 허용).
create unique index if not exists uniq_staff_active
  on public.biz_place_staff(place_id, staff_id) where active;
create index if not exists biz_staff_place_idx on public.biz_place_staff(place_id);
create index if not exists biz_staff_staff_idx on public.biz_place_staff(staff_id);

-- ── 6. biz_audit_log — 등록·변경 로그(#2·#3) ────────────────────────────
create table if not exists public.biz_audit_log (
  id         bigint generated always as identity primary key,
  target     text not null,                            -- 'entity'|'place'|'representative'|'partner'|'staff'
  action     text not null,                            -- 'insert'|'update'|'delete'
  row_id     uuid,
  entity_id  uuid,                                     -- 소속 귀속주체(묶어보기용, best-effort)
  actor_id   uuid,
  actor_name text,
  summary    text,
  before     jsonb,
  after      jsonb,
  at         timestamptz not null default now()
);
create index if not exists biz_audit_at_idx     on public.biz_audit_log(at desc);
create index if not exists biz_audit_entity_idx on public.biz_audit_log(entity_id);

-- ── 공통 함수 ───────────────────────────────────────────────────────────
-- 행위자명(profiles.name → email → 'system')
create or replace function public.biz_actor_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(name, '') from public.profiles where id = auth.uid()),
    (select email from public.profiles where id = auth.uid()),
    'system');
$$;

-- entity INSERT: created_by/updated_by + 코드 채번
create or replace function public.biz_entity_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  new.updated_by := coalesce(new.updated_by, auth.uid());
  if new.code is null or new.code = '' then
    if new.kind = '법인' then new.code := 'L' || lpad(nextval('public.biz_corp_seq')::text, 4, '0');
    else                     new.code := 'I' || lpad(nextval('public.biz_person_seq')::text, 4, '0');
    end if;
  end if;
  return new;
end; $$;

-- place INSERT: created_by/updated_by + 사업장 순번 채번
create or replace function public.biz_place_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  new.updated_by := coalesce(new.updated_by, auth.uid());
  if new.place_no is null or new.place_no = 0 then
    select coalesce(max(place_no), 0) + 1 into new.place_no
      from public.biz_place where entity_id = new.entity_id;
  end if;
  return new;
end; $$;

-- 범용 INSERT(created_by) — 위성 테이블용
create or replace function public.biz_set_created_by()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  new.updated_by := coalesce(new.updated_by, auth.uid());
  return new;
end; $$;

-- 범용 UPDATE(updated_*)
create or replace function public.biz_touch_updated()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end; $$;

-- 감사로그 — 이질 테이블을 to_jsonb 키접근으로 안전 처리(doc_audit 패턴 계승, 42703 회피)
create or replace function public.biz_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_target text := TG_ARGV[0];
  rec      jsonb;
  v_entity uuid;
  v_label  text;
  v_name   text;
begin
  if TG_OP = 'DELETE' then rec := to_jsonb(old); else rec := to_jsonb(new); end if;
  -- 소속 귀속주체 id 산출
  if v_target = 'entity' then
    v_entity := (rec->>'id')::uuid;
    v_label  := coalesce(rec->>'name','');
  elsif v_target in ('place','representative') then
    v_entity := (rec->>'entity_id')::uuid;
    v_label  := coalesce(rec->>'place_name', rec->>'rep_name','');
  elsif v_target = 'partner' then
    select entity_id into v_entity from public.biz_place where id = (rec->>'place_id')::uuid;
    v_label  := '공동사업자';
  else -- staff
    select entity_id into v_entity from public.biz_place where id = (rec->>'place_id')::uuid;
    v_label  := coalesce(rec->>'staff_name','담당직원');
  end if;
  v_name := public.biz_actor_name();
  insert into public.biz_audit_log(target, action, row_id, entity_id, actor_id, actor_name, summary, before, after)
  values (
    v_target, lower(TG_OP), (rec->>'id')::uuid, v_entity, auth.uid(), v_name,
    v_target || ' ' || (case TG_OP when 'INSERT' then '등록' when 'UPDATE' then '수정' else '삭제' end)
             || ': ' || v_label,
    case when TG_OP <> 'INSERT' then to_jsonb(old) end,
    case when TG_OP <> 'DELETE' then to_jsonb(new) end
  );
  if TG_OP = 'DELETE' then return old; else return new; end if;
end; $$;

-- ── 트리거 부착 ─────────────────────────────────────────────────────────
drop trigger if exists trg_biz_entity_bi on public.biz_entity;
create trigger trg_biz_entity_bi before insert on public.biz_entity
  for each row execute function public.biz_entity_before_insert();
drop trigger if exists trg_biz_entity_bu on public.biz_entity;
create trigger trg_biz_entity_bu before update on public.biz_entity
  for each row execute function public.biz_touch_updated();
drop trigger if exists trg_biz_entity_audit on public.biz_entity;
create trigger trg_biz_entity_audit after insert or update or delete on public.biz_entity
  for each row execute function public.biz_audit('entity');

drop trigger if exists trg_biz_place_bi on public.biz_place;
create trigger trg_biz_place_bi before insert on public.biz_place
  for each row execute function public.biz_place_before_insert();
drop trigger if exists trg_biz_place_bu on public.biz_place;
create trigger trg_biz_place_bu before update on public.biz_place
  for each row execute function public.biz_touch_updated();
drop trigger if exists trg_biz_place_audit on public.biz_place;
create trigger trg_biz_place_audit after insert or update or delete on public.biz_place
  for each row execute function public.biz_audit('place');

drop trigger if exists trg_biz_rep_bi on public.biz_representative;
create trigger trg_biz_rep_bi before insert on public.biz_representative
  for each row execute function public.biz_set_created_by();
drop trigger if exists trg_biz_rep_bu on public.biz_representative;
create trigger trg_biz_rep_bu before update on public.biz_representative
  for each row execute function public.biz_touch_updated();
drop trigger if exists trg_biz_rep_audit on public.biz_representative;
create trigger trg_biz_rep_audit after insert or update or delete on public.biz_representative
  for each row execute function public.biz_audit('representative');

drop trigger if exists trg_biz_partner_bi on public.biz_place_partner;
create trigger trg_biz_partner_bi before insert on public.biz_place_partner
  for each row execute function public.biz_set_created_by();
drop trigger if exists trg_biz_partner_bu on public.biz_place_partner;
create trigger trg_biz_partner_bu before update on public.biz_place_partner
  for each row execute function public.biz_touch_updated();
drop trigger if exists trg_biz_partner_audit on public.biz_place_partner;
create trigger trg_biz_partner_audit after insert or update or delete on public.biz_place_partner
  for each row execute function public.biz_audit('partner');

drop trigger if exists trg_biz_staff_bu on public.biz_place_staff;
create trigger trg_biz_staff_bu before update on public.biz_place_staff
  for each row execute function public.biz_touch_updated();
drop trigger if exists trg_biz_staff_audit on public.biz_place_staff;
create trigger trg_biz_staff_audit after insert or update or delete on public.biz_place_staff
  for each row execute function public.biz_audit('staff');

-- ── 민감정보 setter/reveal RPC (암호화 쓰기 · 권한자 복호) ────────────────
-- 쓰기 게이트: 외부인·읽기전용·인당회계사 차단
create or replace function public.biz_assert_writer()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if public.is_external() or public.is_readonly() or public.is_perhead() then
    raise exception '거래처 정보를 수정할 권한이 없습니다';
  end if;
end; $$;

create or replace function public.biz_set_entity_resident(p_id uuid, p_val text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.biz_assert_writer();
  update public.biz_entity
     set resident_no_enc = public.biz_encrypt(p_val), updated_by = auth.uid(), updated_at = now()
   where id = p_id;
end; $$;

create or replace function public.biz_set_rep_resident(p_id uuid, p_val text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.biz_assert_writer();
  update public.biz_representative
     set resident_no_enc = public.biz_encrypt(p_val), updated_by = auth.uid(), updated_at = now()
   where id = p_id;
end; $$;

create or replace function public.biz_set_place_hometax_pw(p_id uuid, p_val text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.biz_assert_writer();
  update public.biz_place
     set hometax_pw_enc = public.biz_encrypt(p_val), updated_by = auth.uid(), updated_at = now()
   where id = p_id;
end; $$;

create or replace function public.biz_reveal_entity_resident(p_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v bytea;
begin
  if not public.biz_can_reveal() then raise exception '민감정보 열람 권한이 없습니다'; end if;
  select resident_no_enc into v from public.biz_entity where id = p_id;
  return case when v is null then null else extensions.pgp_sym_decrypt(v, public.biz_pii_key()) end;
end; $$;

create or replace function public.biz_reveal_rep_resident(p_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v bytea;
begin
  if not public.biz_can_reveal() then raise exception '민감정보 열람 권한이 없습니다'; end if;
  select resident_no_enc into v from public.biz_representative where id = p_id;
  return case when v is null then null else extensions.pgp_sym_decrypt(v, public.biz_pii_key()) end;
end; $$;

create or replace function public.biz_reveal_place_hometax_pw(p_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v bytea;
begin
  if not public.biz_can_reveal() then raise exception '민감정보 열람 권한이 없습니다'; end if;
  select hometax_pw_enc into v from public.biz_place where id = p_id;
  return case when v is null then null else extensions.pgp_sym_decrypt(v, public.biz_pii_key()) end;
end; $$;

-- ── RLS — 고객 민감 마스터: 외부인·인당회계사 읽기 차단, 쓰기는 writer 게이트 ────
alter table public.biz_entity        enable row level security;
alter table public.biz_place         enable row level security;
alter table public.biz_representative enable row level security;
alter table public.biz_place_partner enable row level security;
alter table public.biz_place_staff   enable row level security;
alter table public.biz_audit_log     enable row level security;

do $$
declare t text;
begin
  foreach t in array array['biz_entity','biz_place','biz_representative','biz_place_partner','biz_place_staff']
  loop
    execute format('drop policy if exists %I on public.%I', t||'_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (not public.is_external() and not public.is_perhead())', t||'_sel', t);
    execute format('drop policy if exists %I on public.%I', t||'_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (not public.is_external() and not public.is_readonly() and not public.is_perhead())', t||'_ins', t);
    execute format('drop policy if exists %I on public.%I', t||'_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (not public.is_external() and not public.is_readonly() and not public.is_perhead()) with check (not public.is_external() and not public.is_readonly() and not public.is_perhead())', t||'_upd', t);
    execute format('drop policy if exists %I on public.%I', t||'_del', t);
    execute format('create policy %I on public.%I for delete to authenticated using (not public.is_external() and not public.is_readonly() and not public.is_perhead())', t||'_del', t);
  end loop;
end $$;

-- 감사로그: 트리거(SECURITY DEFINER)만 기록. 읽기는 내부직원, 직접 쓰기 정책 없음(차단).
drop policy if exists biz_audit_sel on public.biz_audit_log;
create policy biz_audit_sel on public.biz_audit_log for select to authenticated
  using (not public.is_external() and not public.is_perhead());

-- RPC 실행 권한
grant execute on function
  public.biz_set_entity_resident(uuid, text),
  public.biz_set_rep_resident(uuid, text),
  public.biz_set_place_hometax_pw(uuid, text),
  public.biz_reveal_entity_resident(uuid),
  public.biz_reveal_rep_resident(uuid),
  public.biz_reveal_place_hometax_pw(uuid)
  to authenticated;
