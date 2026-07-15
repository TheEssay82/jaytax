-- 0034: 발송요청 첨부파일(인쇄·발송용 docx/hwp 등) — 비공개 스토리지 버킷 + 배치 단위 첨부 메타
-- 첨부는 '요청(문서)' 단위: 다중 수신자 요청이면 같은 batch_id 로 묶여 첨부 1벌을 공유한다.
-- 대부분은 첨부 없이 요청만 작성(사무실에서 담당자에게 인쇄본 전달), 인쇄·발송 건만 첨부.

-- 비공개 버킷 (20MB 제한). hwp MIME 다양성 때문에 형식 제한은 클라이언트(accept)에서 처리.
insert into storage.buckets (id, name, public, file_size_limit)
values ('doc-send', 'doc-send', false, 20971520)
on conflict (id) do nothing;

-- 스토리지 접근(library 패턴과 동일): 조회=외부인 제외 / 업로드·수정·삭제=외부인·읽기전용 제외
drop policy if exists "docsend_read" on storage.objects;
create policy "docsend_read" on storage.objects for select to authenticated
  using (bucket_id = 'doc-send' and not public.is_external());
drop policy if exists "docsend_insert" on storage.objects;
create policy "docsend_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'doc-send' and not public.is_external() and not public.is_readonly());
drop policy if exists "docsend_update" on storage.objects;
create policy "docsend_update" on storage.objects for update to authenticated
  using (bucket_id = 'doc-send' and not public.is_external() and not public.is_readonly())
  with check (bucket_id = 'doc-send' and not public.is_external() and not public.is_readonly());
drop policy if exists "docsend_delete" on storage.objects;
create policy "docsend_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'doc-send' and not public.is_external() and not public.is_readonly());

-- 첨부 메타 (batch_id 로 요청과 연결)
create table if not exists public.doc_send_attachments (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null,
  file_name    text not null,
  storage_path text not null unique,
  mime         text,
  size_bytes   bigint,
  uploaded_by  uuid references auth.users(id),
  uploaded_at  timestamptz not null default now()
);
create index if not exists doc_send_attach_batch_idx on public.doc_send_attachments(batch_id);

create or replace function public.doc_send_attach_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.uploaded_by := coalesce(new.uploaded_by, auth.uid());
  return new;
end; $$;
drop trigger if exists trg_doc_send_attach_ins on public.doc_send_attachments;
create trigger trg_doc_send_attach_ins before insert on public.doc_send_attachments
  for each row execute function public.doc_send_attach_before_insert();

alter table public.doc_send_attachments enable row level security;
create policy doc_send_attach_sel on public.doc_send_attachments for select to authenticated
  using (not public.is_external());
create policy doc_send_attach_ins on public.doc_send_attachments for insert to authenticated
  with check (not public.is_external() and not public.is_readonly());
create policy doc_send_attach_del on public.doc_send_attachments for delete to authenticated
  using (not public.is_external() and not public.is_readonly());
