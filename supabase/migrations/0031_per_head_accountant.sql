-- 0031: 인당회계사(per_head_accountant) 등급 — 고객 민감 데이터 읽기를 외부인과 동일하게 API(RLS) 차단
-- 배경: 메뉴는 프론트(AppShell)에서 숨기지만, 기존 RLS는 external 만 막았다(ext_block_select: NOT is_external()).
--       인당회계사도 거래처·청구·상담·자료실을 API로 못 읽도록 동일 차단(메뉴 숨김 + API 차단 이중).
-- 적용: Supabase SQL Editor 또는 Management API. (restrictive 정책은 기존 정책과 AND 결합)

-- 현재 사용자가 인당회계사인지 (RLS 재귀 방지 위해 SECURITY DEFINER)
create or replace function public.is_perhead()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select role = 'per_head_accountant' from public.profiles where id = auth.uid()), false);
$$;

-- 고객 민감 테이블 SELECT 차단 (외부인 ext_block_select 와 동일 패턴)
do $$
declare t text;
begin
  foreach t in array array[
    'clients', 'billing_records', 'billing_targets', 'consultations',
    'invoices', 'library_documents', 'library_fulltext'
  ]
  loop
    execute format('drop policy if exists %I on public.%I;', 'perhead_block_select', t);
    execute format(
      'create policy %I on public.%I as restrictive for select to authenticated using (not public.is_perhead());',
      'perhead_block_select', t
    );
  end loop;
end $$;

-- 자료실 스토리지(library 버킷) 읽기 차단 — 다른 버킷은 영향 없도록 스코프
drop policy if exists "perhead_block_library_read" on storage.objects;
create policy "perhead_block_library_read" on storage.objects
  as restrictive for select to authenticated
  using (bucket_id <> 'library' or not public.is_perhead());
