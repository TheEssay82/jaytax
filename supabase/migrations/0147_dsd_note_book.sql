-- 0147 주석·DSD 관리 — 회사별 **표준주석엑셀**(dsd_note_book)
--
-- 왜 필요한가: ② 가 뜬 주석 서식 엑셀에 사람이 건 수식(재무제표·TB 링크)은 DSD 로 넘어가지
-- 않아 해마다 다시 걸어야 했다. 다 채우고 검증까지 마친 엑셀을 작업 건에 등록해 두면 다음 해
-- ② 가 그 수식을 이어받는다. 다른 회사의 틀로 내려받아 볼 수도 있다.
--
-- ⚠️ 이 시스템에서 **파일을 서버에 두는 유일한 자리**다. 「재무제표·DSD 파일은 올리지 않는다」는
--    원칙은 그대로이고, 주석은 공시되는 정보라 두어도 된다는 사용자 결정(2026-09-14)이다.
--
-- 접근: 외부인은 못 본다(시연용 작업 건에도 파일은 없다). 조회전용은 읽기만. 작업 건마다 한 벌.

-- ── Storage 버킷 + 정책 (evidence 패턴, 50MB) ───────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('dsd-notes', 'dsd-notes', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "dsd_notes_read" on storage.objects;
create policy "dsd_notes_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'dsd-notes' and not public.is_external());

drop policy if exists "dsd_notes_insert" on storage.objects;
create policy "dsd_notes_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'dsd-notes' and not public.is_external() and not public.is_readonly());

drop policy if exists "dsd_notes_update" on storage.objects;
create policy "dsd_notes_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'dsd-notes' and not public.is_external() and not public.is_readonly())
  with check (bucket_id = 'dsd-notes' and not public.is_external() and not public.is_readonly());

drop policy if exists "dsd_notes_delete" on storage.objects;
create policy "dsd_notes_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'dsd-notes' and not public.is_external() and not public.is_readonly());

-- ── 메타 ───────────────────────────────────────────────────────
create table if not exists public.dsd_note_book (
  id             uuid primary key default gen_random_uuid(),
  engagement_id  uuid not null unique references public.dsd_engagement(id) on delete cascade,
  storage_path   text not null,                       -- 'dsd-notes' 버킷 안 경로 (건ID/uuid.xlsx)
  file_name      text not null default '',            -- 원본 파일명(내려받을 때 표시)
  file_size      bigint not null default 0,
  sheet_layout   text not null default 'sheets' check (sheet_layout in ('sheets', 'long')),
  sheet_count    integer not null default 0,          -- 파일의 시트 수
  note_sheets    integer not null default 0,          -- 그 가운데 주석 시트 수
  memo           text,
  uploaded_by    uuid references auth.users(id) on delete set null,
  uploaded_email text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.dsd_note_book is
  '작업 건마다 한 벌 두는 표준주석엑셀. 다음 해 ② 가 노란 칸의 수식을 이어받는다.';
comment on column public.dsd_note_book.sheet_layout is
  '등록할 때의 시트 구성. 읽을 때 어느 시트가 주석인지 이걸로 안다.';

drop trigger if exists dsd_note_book_touch on public.dsd_note_book;
create trigger dsd_note_book_touch before update on public.dsd_note_book
  for each row execute function public.dsd_touch();

-- ── 권한 ───────────────────────────────────────────────────────
alter table public.dsd_note_book enable row level security;
drop policy if exists dsd_note_book_sel on public.dsd_note_book;
create policy dsd_note_book_sel on public.dsd_note_book for select
  using (not public.is_external());
drop policy if exists dsd_note_book_write on public.dsd_note_book;
create policy dsd_note_book_write on public.dsd_note_book for all
  using (not public.is_external() and not public.is_readonly())
  with check (not public.is_external() and not public.is_readonly());
