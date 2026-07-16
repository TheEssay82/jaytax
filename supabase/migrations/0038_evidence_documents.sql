-- 0038: 증빙 자료실 (evidence) — 일반업무관리 대분류의 계약서·증빙 보관소
-- 각종 계약서·사업자등록증·위임장·통장사본 등 증빙 자료를 업로드·검색·다운로드한다.
-- 파일은 Storage 'evidence' 비공개 버킷, 메타데이터는 evidence_documents 테이블.
-- 접근(사용자 확정 2026-07-16):
--   열람  = 인증 직원 전체 + 인당회계사(외부인만 차단).  ※ library 와 달리 per_head 를 막지 않는다.
--   업로드 = 열람 가능자 전원(외부인·읽기전용 제외).
--   수정·삭제 = 업로더 본인 또는 관리자(최고관리자·회계사·기장팀장).

-- ── Storage 버킷 + 정책 (library 패턴, 50MB — 스캔 계약서 대비) ─────
insert into storage.buckets (id, name, public, file_size_limit)
values ('evidence', 'evidence', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "evidence_read" on storage.objects;
create policy "evidence_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'evidence' and not public.is_external());

drop policy if exists "evidence_insert" on storage.objects;
create policy "evidence_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'evidence' and not public.is_external() and not public.is_readonly());

drop policy if exists "evidence_update" on storage.objects;
create policy "evidence_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'evidence' and not public.is_external() and not public.is_readonly())
  with check (bucket_id = 'evidence' and not public.is_external() and not public.is_readonly());

drop policy if exists "evidence_delete" on storage.objects;
create policy "evidence_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'evidence' and not public.is_external() and not public.is_readonly());

-- ⚠️ per_head 는 evidence 버킷을 읽을 수 있어야 한다(열람 허용). 0031 의 perhead_block_library_read
--    는 bucket_id <> 'library' 로 스코프되어 evidence 버킷을 막지 않는다 → 별도 조치 불필요.

-- ── 메타데이터 테이블 ───────────────────────────────────────────
create table if not exists public.evidence_documents (
  id            uuid primary key default gen_random_uuid(),
  title         text not null default '',
  description   text not null default '',
  category      text not null default '',          -- 자유 분류(예: 계약서 · 사업자등록증 · 위임장·확인서)
  counterparty  text not null default '',          -- 관련 거래처·상대방(자유 입력, 거래처관리 대분류 완성 전까지)
  tags          text[] not null default '{}',

  storage_path  text not null,                      -- 'evidence' 버킷 내 경로 (uuid.ext)
  file_name     text not null default '',           -- 원본 파일명(다운로드 시 표시)
  file_ext      text not null default '',
  file_size     bigint not null default 0,
  mime          text not null default '',

  uploaded_by   uuid default auth.uid() references auth.users (id) on delete set null,
  uploaded_email text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_evidence_created on public.evidence_documents (created_at desc);
create index if not exists idx_evidence_category on public.evidence_documents (category);
create index if not exists idx_evidence_tags on public.evidence_documents using gin (tags);

drop trigger if exists trg_evidence_updated on public.evidence_documents;
create trigger trg_evidence_updated
  before update on public.evidence_documents
  for each row execute function public.set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────
alter table public.evidence_documents enable row level security;

-- 열람: 인증 직원 전체 + 인당회계사(외부인 제외). per_head 를 막지 않는 것이 library 와의 차이.
drop policy if exists evidence_docs_sel on public.evidence_documents;
create policy evidence_docs_sel on public.evidence_documents
  for select to authenticated
  using (not public.is_external());

-- 업로드: 읽기전용·외부인 아닌 직원이 본인 명의로.
drop policy if exists evidence_docs_ins on public.evidence_documents;
create policy evidence_docs_ins on public.evidence_documents
  for insert to authenticated
  with check (not public.is_readonly() and not public.is_external() and uploaded_by = auth.uid());

-- 수정·삭제: 업로더 본인 또는 관리자(최고관리자·회계사·기장팀장). 읽기전용은 불가.
drop policy if exists evidence_docs_upd on public.evidence_documents;
create policy evidence_docs_upd on public.evidence_documents
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

drop policy if exists evidence_docs_del on public.evidence_documents;
create policy evidence_docs_del on public.evidence_documents
  for delete to authenticated
  using (
    not public.is_readonly() and (
      uploaded_by = auth.uid()
      or (select role from public.profiles where id = auth.uid()) in ('superuser', 'accountant', 'team_lead')
    )
  );
