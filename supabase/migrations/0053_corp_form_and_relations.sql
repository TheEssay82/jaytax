-- 0053: 법인격(corp_form) 구조화 + 개인 간 관계(biz_entity_relation)
--
-- 1) 법인격을 회사명에서 분리해 별도 필드로 둔다(주식회사/유한회사/유한책임회사/합자회사/합명회사).
--    표기는 화면에서 통일 심볼(㈜·(유)·(유책)·(합자)·(합명))로 재조립하고, 앞/뒤 위치는 실제 등록명대로 보존.
--    name 컬럼에는 법인격을 뗀 '순수 상호'만 저장. (PEF·사모투자합자회사는 합자회사로 통일)
-- 2) 개인↔개인 관계(가족·동업 등) — 예: 이도현 —(부)→ 이소미.

alter table public.biz_entity add column if not exists corp_form text
  check (corp_form in ('주식회사','유한회사','유한책임회사','합자회사','합명회사'));
alter table public.biz_entity add column if not exists corp_form_position text
  check (corp_form_position in ('앞','뒤'));

create table if not exists public.biz_entity_relation (
  id             uuid primary key default gen_random_uuid(),
  from_entity_id uuid not null references public.biz_entity(id) on delete cascade,
  to_entity_id   uuid not null references public.biz_entity(id) on delete cascade,
  relation_type  text not null,   -- 부/모/자녀/배우자/형제자매/동업/기타
  note           text,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id),
  updated_at     timestamptz not null default now(),
  unique (from_entity_id, to_entity_id, relation_type),
  check (from_entity_id <> to_entity_id)
);
create index if not exists biz_rel_from_idx on public.biz_entity_relation(from_entity_id);
create index if not exists biz_rel_to_idx   on public.biz_entity_relation(to_entity_id);

drop trigger if exists trg_biz_rel_bi on public.biz_entity_relation;
create trigger trg_biz_rel_bi before insert on public.biz_entity_relation
  for each row execute function public.biz_set_created_by();
drop trigger if exists trg_biz_rel_bu on public.biz_entity_relation;
create trigger trg_biz_rel_bu before update on public.biz_entity_relation
  for each row execute function public.biz_touch_updated();

alter table public.biz_entity_relation enable row level security;
drop policy if exists biz_entity_relation_sel on public.biz_entity_relation;
create policy biz_entity_relation_sel on public.biz_entity_relation for select to authenticated
  using (not public.is_external() and not public.is_perhead());
drop policy if exists biz_entity_relation_ins on public.biz_entity_relation;
create policy biz_entity_relation_ins on public.biz_entity_relation for insert to authenticated
  with check (not public.is_external() and not public.is_readonly() and not public.is_perhead());
drop policy if exists biz_entity_relation_upd on public.biz_entity_relation;
create policy biz_entity_relation_upd on public.biz_entity_relation for update to authenticated
  using (not public.is_external() and not public.is_readonly() and not public.is_perhead())
  with check (not public.is_external() and not public.is_readonly() and not public.is_perhead());
drop policy if exists biz_entity_relation_del on public.biz_entity_relation;
create policy biz_entity_relation_del on public.biz_entity_relation for delete to authenticated
  using (not public.is_external() and not public.is_readonly() and not public.is_perhead());
