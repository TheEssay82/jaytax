-- 0167 거래처등록 — 기장팀원은 고치기만, 등록·삭제는 못 한다(roles.ts 「팀원은 일부 필드만 수정(등록·삭제 불가)」, 2026-10-05 권한 점검).
-- 전에는 화면·서버 모두 팀원에게 거래처·사업장 새로 만들기와 지우기를 열어 두고 있었다.
-- restrictive 라 기존 허용 정책(외부인·잠금·인당회계사 막기)과 함께 걸린다. 엑셀 가져오기는 최고관리자라 상관없다.
do $$
declare t text;
begin
  foreach t in array array['biz_entity','biz_place'] loop
    execute format('drop policy if exists tm_block_insert on public.%I', t);
    execute format('drop policy if exists tm_block_delete on public.%I', t);
    execute format($f$create policy tm_block_insert on public.%I as restrictive for insert with check (public.auth_role() is distinct from 'team_member')$f$, t);
    execute format($f$create policy tm_block_delete on public.%I as restrictive for delete using (public.auth_role() is distinct from 'team_member')$f$, t);
  end loop;
end $$;
