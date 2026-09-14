-- 0148 일반조서 관리 — 기반: 회계기준 셋째 값 · 감사팀 판정 · 표준양식/회사 조서 파일 표 · gwp 버킷
--
-- 왜 필요한가: 일반조서(한공회 표준 감사조서 1000~9000)는 회사마다 엑셀 워크북 하나로 보관하고,
-- 해마다 전기 파일 + 당기 표준양식으로 다시 짓는다. 이 파일들을 서버에 두고(사용자 결정 2026-09-15)
-- 표준양식 등록 → 이월 → 상태 추적 → 최종본 등록을 시스템이 맡는다.
--
-- 열람은 **감사팀**으로 좁힌다. 지금은 profiles.role 이 superuser·accountant 인 사람이다 —
-- 함수(is_audit_staff)로 두어 나중에 넓힐 수 있게 한다.
--
-- ⚠️ 회사 조서 파일(gwp_book)은 **지우거나 고칠 수 없다.** 외부감사법 제19조가 감사조서의 위조·변조·훼손·
--    파기를 금지하고 8년 보존을 요구한다. 새 판을 올리면 버전이 하나 늘 뿐이다. 최종본 표시·메모만 고친다.

-- ── 회계기준 셋째 값 ──────────────────────────────────────────────
-- 전기 일반기업이 당기 소규모가 될 수도, 반대도 된다(사용자 2026-09-15). 값은 작업 건마다 따로 고른다.
alter table public.dsd_engagement drop constraint if exists dsd_engagement_basis_check;
alter table public.dsd_engagement
  add constraint dsd_engagement_basis_check
  check (basis in ('K-IFRS', '일반기업회계기준', '소규모감사기준'));

-- ── 감사팀 판정 ─────────────────────────────────────────────────
create or replace function public.is_audit_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role in ('superuser', 'accountant') from public.profiles where id = auth.uid()),
    false);
$$;
revoke all on function public.is_audit_staff() from public, anon;
grant execute on function public.is_audit_staff() to authenticated;
comment on function public.is_audit_staff() is
  '일반조서를 볼 수 있는 사람 — 지금은 최고관리자·회계사. 넓힐 때 여기만 고친다.';

-- ── Storage 버킷 + 정책 (감사팀만, 50MB) ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('gwp', 'gwp', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "gwp_read" on storage.objects;
create policy "gwp_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'gwp' and public.is_audit_staff());

drop policy if exists "gwp_insert" on storage.objects;
create policy "gwp_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'gwp' and public.is_audit_staff() and not public.is_readonly());

-- 지우기·덮어쓰기 정책은 두지 않는다 — 조서 파일은 판이 쌓일 뿐이다. 표준양식도 같은 버킷이라
-- 잘못 올린 양식은 새 판으로 덮는다(행의 storage_path 만 바뀐다).

-- ── 표준양식(한공회 묶음) — 연도 × 기준마다 한 벌 ───────────────────
create table if not exists public.gwp_template (
  id             uuid primary key default gen_random_uuid(),
  fy             integer not null,                    -- 양식 연도(2026 = 2026년 배포본)
  basis          text not null check (basis in ('K-IFRS', '일반기업회계기준', '소규모감사기준')),
  storage_path   text not null,                       -- gwp 버킷 안 경로 (templates/uuid.zip)
  file_name      text not null default '',
  file_size      bigint not null default 0,
  catalog        jsonb not null default '{}'::jsonb,  -- 묶음 안 파일·시트·조서코드 목록(브라우저에서 읽어 둔 것)
  note           text,
  uploaded_by    uuid references auth.users(id) on delete set null,
  uploaded_email text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (fy, basis)
);
comment on table public.gwp_template is
  '한공회 표준 일반조서 묶음(zip). 연도·기준마다 한 벌. catalog 에 시트·조서코드 목록을 둔다.';

drop trigger if exists gwp_template_touch on public.gwp_template;
create trigger gwp_template_touch before update on public.gwp_template
  for each row execute function public.dsd_touch();

alter table public.gwp_template enable row level security;
drop policy if exists gwp_template_sel on public.gwp_template;
create policy gwp_template_sel on public.gwp_template for select
  using (public.is_audit_staff());
drop policy if exists gwp_template_write on public.gwp_template;
create policy gwp_template_write on public.gwp_template for all
  using (public.is_audit_staff() and not public.is_readonly())
  with check (public.is_audit_staff() and not public.is_readonly());

-- ── 회사 조서 파일 — 작업 건마다 판이 쌓인다 ───────────────────────
create table if not exists public.gwp_book (
  id             uuid primary key default gen_random_uuid(),
  engagement_id  uuid not null references public.dsd_engagement(id) on delete restrict,
  version        integer not null,                    -- 1부터. 같은 건에 새 판을 올리면 +1
  kind           text not null default '작업중' check (kind in ('이월본', '작업중', '최종본')),
  storage_path   text not null,
  file_name      text not null default '',
  file_size      bigint not null default 0,
  catalog        jsonb not null default '{}'::jsonb,  -- 시트별 조서코드·작성자·검토자·일자·상태(브라우저에서 읽어 둔 것)
  memo           text,
  uploaded_by    uuid references auth.users(id) on delete set null,
  uploaded_email text,
  created_at     timestamptz not null default now(),
  unique (engagement_id, version)
);
comment on table public.gwp_book is
  '회사별 일반조서 워크북. 판이 쌓일 뿐 지우지 않는다(외감법 제19조). 최종본은 kind 로 표시한다.';
comment on column public.gwp_book.kind is
  '이월본(시스템이 만든 당기 시작 파일) · 작업중(사람이 올린 중간 판) · 최종본(감사 종료 뒤 확정한 판).';

create index if not exists gwp_book_eng_idx on public.gwp_book(engagement_id, version desc);

alter table public.gwp_book enable row level security;
drop policy if exists gwp_book_sel on public.gwp_book;
create policy gwp_book_sel on public.gwp_book for select
  using (public.is_audit_staff());
drop policy if exists gwp_book_ins on public.gwp_book;
create policy gwp_book_ins on public.gwp_book for insert
  with check (public.is_audit_staff() and not public.is_readonly());
-- 고칠 수 있는 것은 kind(최종본 표시)와 memo 뿐 — 트리거가 나머지를 막는다. 지우기 정책은 없다.
drop policy if exists gwp_book_upd on public.gwp_book;
create policy gwp_book_upd on public.gwp_book for update
  using (public.is_audit_staff() and not public.is_readonly())
  with check (public.is_audit_staff() and not public.is_readonly());

create or replace function public.gwp_book_guard() returns trigger
language plpgsql as $$
begin
  if new.engagement_id <> old.engagement_id or new.version <> old.version
     or new.storage_path <> old.storage_path or new.file_name <> old.file_name
     or new.file_size <> old.file_size or new.catalog <> old.catalog
     or new.uploaded_by is distinct from old.uploaded_by
     or new.uploaded_email is distinct from old.uploaded_email
     or new.created_at <> old.created_at then
    raise exception '조서 파일은 고칠 수 없습니다 — 새 판을 올리십시오(외부감사법 제19조).';
  end if;
  return new;
end $$;
drop trigger if exists gwp_book_guard on public.gwp_book;
create trigger gwp_book_guard before update on public.gwp_book
  for each row execute function public.gwp_book_guard();
