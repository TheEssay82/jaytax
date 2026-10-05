-- 0164 정산표 이월 — 회사별로 고른 계정 짝을 기억한다(사용자 2026-10-05 「회사별로 고른 짝을 저장해주세요」).
--
-- 회사 자료(ERP 재무제표·시산표)의 계정 줄이 정산표에 받을 줄이 없을 때 사람이 고른 것:
--   row  — 정산표의 그 줄에 더한다(줄 이름·과목·줄 번호. 줄 번호는 해마다 같으면 쓰고, 다르면 이름으로 찾는다)
--   skip — 넣지 않는다
-- 「새 줄로 넣기」는 저장하지 않는다 — 한 번 넣으면 다음 해 정산표에 그 이름의 줄이 있어 저절로 맞는다.
-- 다음 이월(기말 갱신·내년 중간)에서 같은 회사·같은 표·같은 계정(무리 이름 + 계정 이름)이면 그대로 쓴다.
-- 열쇠: entity_id + sheet(WBS·WPL·WMS-…) + source_key(norm(무리)|norm(계정)) — ERP 는 같은 이름이 다른 무리 아래 또 나온다(아비즈 「상각채권추심이익」).

create table if not exists public.wtb_account_map (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.biz_entity(id) on delete cascade,
  sheet text not null,
  source_key text not null,
  source_name text not null,
  source_group text,
  action text not null check (action in ('row', 'skip')),
  target_label text,
  target_fsli text,
  target_row int,
  updated_by uuid references auth.users(id),
  updated_email text,
  updated_at timestamptz not null default now(),
  unique (entity_id, sheet, source_key)
);
comment on table public.wtb_account_map is '정산표 이월 — 회사 자료 계정 ↔ 정산표 줄, 사람이 고른 짝(회사별). row = 그 줄에 더하기, skip = 넣지 않기.';

alter table public.wtb_account_map enable row level security;
drop policy if exists wtb_account_map_sel on public.wtb_account_map;
create policy wtb_account_map_sel on public.wtb_account_map for select using (public.is_audit_staff());
drop policy if exists wtb_account_map_ins on public.wtb_account_map;
create policy wtb_account_map_ins on public.wtb_account_map for insert
  with check (public.is_audit_staff() and not public.is_readonly());
drop policy if exists wtb_account_map_upd on public.wtb_account_map;
create policy wtb_account_map_upd on public.wtb_account_map for update
  using (public.is_audit_staff() and not public.is_readonly())
  with check (public.is_audit_staff() and not public.is_readonly());
drop policy if exists wtb_account_map_del on public.wtb_account_map;
create policy wtb_account_map_del on public.wtb_account_map for delete
  using (public.is_audit_staff() and not public.is_readonly());
