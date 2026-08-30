-- 0070: 거래처 마스터 단일화 1단계 — doc_clients/doc_contacts 를 거래처관리(biz_*)의 '별칭'으로 강등
--
-- 배경: 문서발송(발송요청)·조회서(조회서등록)가 아직 독립 마스터 doc_clients/doc_contacts 를 쓴다.
--       거래처관리 2.0(biz_entity/biz_place/biz_contact)이 정식 마스터가 됐으므로 등록 창구를 하나로 모은다.
-- 방식: 기존 FK(confirmations.client_id NOT NULL·RESTRICT, doc_send_requests.client_id/contact_id)를
--       건드리지 않기 위해 doc_* 테이블은 남기고, biz_* 에서 트리거로 자동 동기화되는 별칭으로 만든다.
--       · doc_clients.entity_id  → biz_entity  (1:1)
--       · doc_contacts.biz_contact_id → biz_contact (1:1)
--       · 앞으로 화면(발송요청·조회서등록)은 '연결된 별칭'만 후보로 보여준다.
--       · 등록/수정/삭제는 거래처관리에서만. biz_* 가 지워지면 FK on delete set null 로 연결만 끊기고
--         과거 발송·조회서 이력은 그대로 남는다.

-- ── 1) 별칭 연결 컬럼 ────────────────────────────────────────
alter table public.doc_clients
  add column if not exists entity_id uuid references public.biz_entity(id) on delete set null;
create unique index if not exists doc_clients_entity_uk
  on public.doc_clients(entity_id) where entity_id is not null;

alter table public.doc_contacts
  add column if not exists biz_contact_id uuid references public.biz_contact(id) on delete set null;
create unique index if not exists doc_contacts_biz_uk
  on public.doc_contacts(biz_contact_id) where biz_contact_id is not null;

-- ── 2) 표기 헬퍼 — 법인격 통일표기(프런트 corpDisplayName 과 동일 규칙) ──
create or replace function public.biz_display_name(p_name text, p_form text, p_pos text)
returns text language sql immutable as $$
  select case
    when p_form is null or p_pos is null then p_name
    when p_pos = '앞' then (case p_form
        when '주식회사' then '㈜' when '유한회사' then '(유)' when '유한책임회사' then '(유책)'
        when '합자회사' then '(합자)' when '합명회사' then '(합명)' else '' end) || p_name
    else p_name || (case p_form
        when '주식회사' then '㈜' when '유한회사' then '(유)' when '유한책임회사' then '(유책)'
        when '합자회사' then '(합자)' when '합명회사' then '(합명)' else '' end)
  end;
$$;

-- ── 3) 동기화 함수 ───────────────────────────────────────────
-- 거래처(biz_entity) → doc_clients 별칭 upsert. 담당회계사는 본사 사업장 cpa 우선.
create or replace function public.biz_alias_sync_entity(p_entity uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_name text;
  v_cpa  text;
begin
  if p_entity is null then return null; end if;
  select public.biz_display_name(e.name, e.corp_form, e.corp_form_position)
    into v_name from public.biz_entity e where e.id = p_entity;
  if v_name is null then return null; end if;

  select coalesce(
           max(p.cpa) filter (where p.is_headquarters and coalesce(p.cpa, '') <> ''),
           max(p.cpa) filter (where coalesce(p.cpa, '') <> '')
         )
    into v_cpa from public.biz_place p where p.entity_id = p_entity;

  select id into v_id from public.doc_clients where entity_id = p_entity;
  if v_id is null then
    insert into public.doc_clients(company_name, accountant, entity_id)
      values (v_name, coalesce(v_cpa, ''), p_entity)
      returning id into v_id;
  elsif exists (
    select 1 from public.doc_clients
     where id = v_id
       and (company_name is distinct from v_name
            or (coalesce(v_cpa, '') <> '' and accountant is distinct from v_cpa))
  ) then
    update public.doc_clients
       set company_name = v_name,
           accountant   = case when coalesce(v_cpa, '') <> '' then v_cpa else accountant end
     where id = v_id;
  end if;
  return v_id;
end $$;

-- 거래처담당자(biz_contact) → doc_contacts 별칭 upsert (부모 별칭도 함께 보장)
create or replace function public.biz_alias_sync_contact(p_contact uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c        record;
  v_client uuid;
  v_id     uuid;
begin
  select * into c from public.biz_contact where id = p_contact;
  if not found then return null; end if;
  v_client := public.biz_alias_sync_entity(c.entity_id);
  if v_client is null then return null; end if;

  select id into v_id from public.doc_contacts where biz_contact_id = p_contact;
  if v_id is null then
    insert into public.doc_contacts(client_id, contact_name, honorific, phone, email, address, note, biz_contact_id)
      values (v_client, c.contact_name, coalesce(nullif(c.honorific, ''), '님'),
              c.phone, c.email, c.address, c.note, p_contact)
      returning id into v_id;
  else
    update public.doc_contacts
       set client_id    = v_client,
           contact_name = c.contact_name,
           honorific    = coalesce(nullif(c.honorific, ''), '님'),
           phone        = c.phone,
           email        = c.email,
           address      = c.address,
           note         = c.note
     where id = v_id;
  end if;
  return v_id;
end $$;

-- ── 4) 트리거 ────────────────────────────────────────────────
create or replace function public.trg_biz_alias_entity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.biz_alias_sync_entity(new.id);
  return null;
end $$;

create or replace function public.trg_biz_alias_place()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.biz_alias_sync_entity(new.entity_id);   -- 담당회계사(cpa) 갱신 반영
  return null;
end $$;

create or replace function public.trg_biz_alias_contact()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.biz_alias_sync_contact(new.id);
  return null;
end $$;

drop trigger if exists trg_biz_entity_alias on public.biz_entity;
create trigger trg_biz_entity_alias after insert or update of name, corp_form, corp_form_position
  on public.biz_entity for each row execute function public.trg_biz_alias_entity();

drop trigger if exists trg_biz_place_alias on public.biz_place;
create trigger trg_biz_place_alias after insert or update of cpa, entity_id
  on public.biz_place for each row execute function public.trg_biz_alias_place();

drop trigger if exists trg_biz_contact_alias on public.biz_contact;
create trigger trg_biz_contact_alias after insert or update
  on public.biz_contact for each row execute function public.trg_biz_alias_contact();

-- ── 5) 기존 데이터 백필 ──────────────────────────────────────
-- (a) 이름 대사로 doc_clients ↔ biz_entity 연결. 법인격 표기·공백 차이를 정규화해서 맞춘다.
--     감사로그·회사명 변경이력이 백필로 오염되지 않도록 트리거를 잠시 끈다.
alter table public.doc_clients disable trigger user;
alter table public.doc_contacts disable trigger user;

with dc as (
  select c.id,
         regexp_replace(c.company_name,
           '(주식회사|㈜|\(주\)|유한회사|\(유책\)|\(유\)|합자회사|\(합자\)|\(합\)|합명회사|\s)', '', 'g') as norm
    from public.doc_clients c where c.entity_id is null
), be as (
  select e.id,
         regexp_replace(e.name,
           '(주식회사|㈜|\(주\)|유한회사|\(유책\)|\(유\)|합자회사|\(합자\)|\(합\)|합명회사|\s)', '', 'g') as norm
    from public.biz_entity e
), m as (                                        -- 1:1 로 확정되는 쌍만 연결(모호하면 건너뛴다)
  select dc.id as dcid, (array_agg(be.id order by be.id))[1] as beid
    from dc join be on be.norm = dc.norm
   group by dc.id having count(*) = 1
)
update public.doc_clients d
   set entity_id = m.beid
  from m
 where d.id = m.dcid
   and not exists (select 1 from public.doc_clients x where x.entity_id = m.beid);

-- (b) 담당자 연결 — 같은 거래처 안에서 담당자명이 일치하는 1:1 쌍
with pair as (
  select dct.id as dcid, (array_agg(bc.id order by bc.id))[1] as bcid
    from public.doc_contacts dct
    join public.doc_clients dcl on dcl.id = dct.client_id and dcl.entity_id is not null
    join public.biz_contact  bc on bc.entity_id = dcl.entity_id and bc.contact_name = dct.contact_name
   where dct.biz_contact_id is null
   group by dct.id having count(*) = 1
)
update public.doc_contacts d
   set biz_contact_id = pair.bcid
  from pair
 where d.id = pair.dcid
   and not exists (select 1 from public.doc_contacts x where x.biz_contact_id = pair.bcid);

-- (c) biz_* 에만 있는 거래처·담당자를 별칭으로 생성(문서발송/조회서 후보에 나타나도록)
select public.biz_alias_sync_entity(e.id) from public.biz_entity e;
select public.biz_alias_sync_contact(c.id) from public.biz_contact c;

alter table public.doc_clients enable trigger user;
alter table public.doc_contacts enable trigger user;
