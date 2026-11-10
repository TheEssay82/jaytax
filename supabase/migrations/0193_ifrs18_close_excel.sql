-- 0193 K-IFRS 1118 월결산 — 마감 엑셀 보관(사용자 2026-11-11 「엑셀 내려받기가 마감 때에만 됩니다」 → 「서버에 마감 엑셀 보관」).
--
-- 마감할 때 그 달 엑셀(검증 엑셀 — 분개장 전 줄 포함)을 비공개 저장소 'ifrs18-close' 에 함께 둔다.
-- 결산 현황에서 달마다 언제든 내려받는다(서명 URL, 짧은 유효시간).
-- 경로: <회사키>/<연도>/<MM>/<파일명>.xlsx — 권한은 0189 와 같다: ifrs18_can(회사키). 인덕 직원 · 연결된 회사 담당자만.
-- 마감 해제하면 화면이 파일을 지우고 경로를 비운다.

insert into storage.buckets (id, name, public, file_size_limit)
values ('ifrs18-close', 'ifrs18-close', false, 104857600)
on conflict (id) do nothing;

drop policy if exists "ifrs18_close_file_read" on storage.objects;
create policy "ifrs18_close_file_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'ifrs18-close' and (select public.ifrs18_can(split_part(name, '/', 1))));

drop policy if exists "ifrs18_close_file_insert" on storage.objects;
create policy "ifrs18_close_file_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'ifrs18-close' and (select public.ifrs18_can(split_part(name, '/', 1))) and not coalesce((select public.is_readonly()), false));

drop policy if exists "ifrs18_close_file_update" on storage.objects;
create policy "ifrs18_close_file_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'ifrs18-close' and (select public.ifrs18_can(split_part(name, '/', 1))) and not coalesce((select public.is_readonly()), false))
  with check (bucket_id = 'ifrs18-close' and (select public.ifrs18_can(split_part(name, '/', 1))));

drop policy if exists "ifrs18_close_file_delete" on storage.objects;
create policy "ifrs18_close_file_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'ifrs18-close' and (select public.ifrs18_can(split_part(name, '/', 1))) and not coalesce((select public.is_readonly()), false));

alter table public.ifrs18_close add column if not exists excel_path text;
alter table public.ifrs18_close add column if not exists excel_at timestamptz;

alter table public.ifrs18_log drop constraint if exists ifrs18_log_action_check;
alter table public.ifrs18_log add constraint ifrs18_log_action_check
  check (action in ('분개장 읽음', '판단 저장', '판단 삭제', '마감', '마감 해제', '2차 마감', '2차 마감 해제', '엑셀 내려받기', '엑셀 보관'));

comment on column public.ifrs18_close.excel_path is '마감 엑셀 — storage ifrs18-close 버킷 경로(<회사키>/<연도>/<MM>/<파일>.xlsx). 분개장 전 줄이 들어 있다.';
