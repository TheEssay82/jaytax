-- 0016: 기준서 원문 PDF 게시 (Supabase Storage)
-- Closed 사내 사이트에서 기준서 전문 PDF를 직접 게시·열람·다운로드한다.
-- 버킷은 비공개(인증 직원만). 경로 규약: '{기준서set}/{기준서no}.pdf' (예: 'K-IFRS/1115.pdf').
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('standard-pdfs', 'standard-pdfs', false, 104857600, array['application/pdf'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- RLS: 인증 직원은 열람·업로드·교체·삭제 가능(공유 자료).
drop policy if exists std_pdf_read on storage.objects;
create policy std_pdf_read on storage.objects
  for select to authenticated using (bucket_id = 'standard-pdfs');

drop policy if exists std_pdf_insert on storage.objects;
create policy std_pdf_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'standard-pdfs');

drop policy if exists std_pdf_update on storage.objects;
create policy std_pdf_update on storage.objects
  for update to authenticated using (bucket_id = 'standard-pdfs') with check (bucket_id = 'standard-pdfs');

drop policy if exists std_pdf_delete on storage.objects;
create policy std_pdf_delete on storage.objects
  for delete to authenticated using (bucket_id = 'standard-pdfs');
