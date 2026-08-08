-- 0055: 거래처관리 2.0.0 step3 — 거래처담당자(외부 연락처) biz_contact
-- 거래처(법인/개인) 단위 + 선택 사업장. 기존 문서발송 doc_contacts 를 1회성 이관.
-- 트리거(created_by/updated) 0050 함수 재사용. 기존 doc_contacts 는 무중단(발송 흐름 이관 전까지 병행).

create table if not exists public.biz_contact (
  id           uuid primary key default gen_random_uuid(),
  entity_id    uuid not null references public.biz_entity(id) on delete cascade,   -- 거래처(귀속주체)
  place_id     uuid references public.biz_place(id) on delete set null,            -- (선택) 특정 사업장
  contact_name text not null,
  honorific    text not null default '님',
  position     text,                                                               -- 직책
  phone        text,
  email        text,
  address      text,                                                              -- 수령지주소
  is_primary   boolean not null default false,                                    -- 대표 연락처
  note         text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id),
  updated_at   timestamptz not null default now()
);
create index if not exists biz_contact_entity_idx on public.biz_contact(entity_id);
create index if not exists biz_contact_place_idx  on public.biz_contact(place_id);

drop trigger if exists trg_biz_contact_bi on public.biz_contact;
create trigger trg_biz_contact_bi before insert on public.biz_contact
  for each row execute function public.biz_set_created_by();
drop trigger if exists trg_biz_contact_bu on public.biz_contact;
create trigger trg_biz_contact_bu before update on public.biz_contact
  for each row execute function public.biz_touch_updated();

alter table public.biz_contact enable row level security;
drop policy if exists biz_contact_sel on public.biz_contact;
create policy biz_contact_sel on public.biz_contact for select to authenticated
  using (not public.is_external() and not public.is_perhead());
drop policy if exists biz_contact_ins on public.biz_contact;
create policy biz_contact_ins on public.biz_contact for insert to authenticated
  with check (not public.is_external() and not public.is_readonly() and not public.is_perhead());
drop policy if exists biz_contact_upd on public.biz_contact;
create policy biz_contact_upd on public.biz_contact for update to authenticated
  using (not public.is_external() and not public.is_readonly() and not public.is_perhead())
  with check (not public.is_external() and not public.is_readonly() and not public.is_perhead());
drop policy if exists biz_contact_del on public.biz_contact;
create policy biz_contact_del on public.biz_contact for delete to authenticated
  using (not public.is_external() and not public.is_readonly() and not public.is_perhead());
