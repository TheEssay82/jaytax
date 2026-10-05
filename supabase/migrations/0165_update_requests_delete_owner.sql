-- 0165 업데이트요청 — 지우기는 작성자 본인·최고관리자만(사용자 2026-10-05 「모두 고쳐주세요」, 권한 전수 조사에서 나온 빈틈).
-- 전에는 외부인만 막아 누구나 남의 요청을 지울 수 있었다(화면도 모든 카드에 지우기 단추).
-- 작성자 칸(created_by)이 빈 요청은 최고관리자만 지운다(2026-10-05 현재 그런 요청은 없다).
drop policy if exists update_requests_delete on public.update_requests;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'update_requests' and cmd = 'DELETE' and permissive = 'PERMISSIVE' loop
    execute format('drop policy %I on public.update_requests', p.policyname);
  end loop;
end $$;
create policy update_requests_delete on public.update_requests for delete
  using (not public.is_external() and (public.is_superuser() or created_by = auth.uid()));
