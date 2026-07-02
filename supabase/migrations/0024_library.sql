-- 0024: 자료실 (library) — 사무소 내부 문서 보관소
-- 두 갈래를 한 테이블로 관리한다(문서 유형 kind로 구분):
--   reference = 내부 참고자료 아카이브(예규·해석사례·개정세법·체크리스트 등, 검색·열람)
--   template  = 서식·템플릿 라이브러리(회신 서식·검토보고서·위임장 등, 재사용·다운로드)
-- 파일은 Storage 'library' 비공개 버킷, 메타데이터는 library_documents 테이블.
-- 접근: 인증 직원 열람·업로드(외부인·읽기전용 차단), 수정·삭제는 업로더 또는 관리자(회계사·팀장+).

-- ── Storage 버킷 + 정책 ─────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('library', 'library', false)
on conflict (id) do nothing;

create policy library_read on storage.objects
  for select to authenticated
  using (bucket_id = 'library' and not public.is_external());

create policy library_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'library' and not public.is_external() and not public.is_readonly());

create policy library_update on storage.objects
  for update to authenticated
  using (bucket_id = 'library' and not public.is_external() and not public.is_readonly())
  with check (bucket_id = 'library' and not public.is_external() and not public.is_readonly());

create policy library_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'library' and not public.is_external() and not public.is_readonly());

-- ── 메타데이터 테이블 ───────────────────────────────────────────
create table if not exists public.library_documents (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'reference' check (kind in ('reference', 'template')),
  title         text not null default '',
  description   text not null default '',
  category      text not null default '',          -- 자유 분류(예: 예규/해석사례/개정세법 · 회신/검토보고서/위임장)
  tags          text[] not null default '{}',

  storage_path  text not null,                      -- 'library' 버킷 내 경로 (kind/uuid.ext)
  file_name     text not null default '',           -- 원본 파일명(다운로드 시 표시)
  file_ext      text not null default '',
  file_size     bigint not null default 0,
  mime          text not null default '',

  uploaded_by   uuid default auth.uid() references auth.users (id) on delete set null,
  uploaded_email text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_library_created on public.library_documents (created_at desc);
create index if not exists idx_library_kind on public.library_documents (kind);
create index if not exists idx_library_tags on public.library_documents using gin (tags);

create trigger trg_library_updated
  before update on public.library_documents
  for each row execute function public.set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────
alter table public.library_documents enable row level security;

-- 열람: 인증 직원 전체(외부인 제외 — 사무소 내부자료).
create policy library_docs_sel on public.library_documents
  for select to authenticated
  using (not public.is_external());

-- 업로드: 읽기전용·외부인 아닌 직원이 본인 명의로.
create policy library_docs_ins on public.library_documents
  for insert to authenticated
  with check (not public.is_readonly() and not public.is_external() and uploaded_by = auth.uid());

-- 수정·삭제: 업로더 본인 또는 관리자(회계사·팀장+). 읽기전용은 불가.
create policy library_docs_upd on public.library_documents
  for update to authenticated
  using (
    not public.is_readonly() and (
      uploaded_by = auth.uid()
      or (select role from public.profiles where id = auth.uid()) in ('superuser', 'accountant', 'team_lead')
    )
  )
  with check (
    not public.is_readonly() and (
      uploaded_by = auth.uid()
      or (select role from public.profiles where id = auth.uid()) in ('superuser', 'accountant', 'team_lead')
    )
  );

create policy library_docs_del on public.library_documents
  for delete to authenticated
  using (
    not public.is_readonly() and (
      uploaded_by = auth.uid()
      or (select role from public.profiles where id = auth.uid()) in ('superuser', 'accountant', 'team_lead')
    )
  );
