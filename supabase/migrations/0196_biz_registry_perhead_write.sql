-- 0196 거래처등록 — 인당회계사(김준성·조현규)도 거래처 등록·수정을 한다(사용자 2026-11-18 「등록 + 수정」).
-- 거래처·사업장 **지우기**는 계속 막는다. 보기 권한은 손대지 않는다(주민번호=내부직원 전부 0079, 홈택스 PASS=인당회계사 제외 그대로).
-- 기존 정책(not is_perhead)은 그대로 두고, 인당회계사용 허용 정책을 따로 더한다(0122 감사팀 발행요청과 같은 방식).
-- 대표이사·공동사업자·관계·담당직원은 「고치기」의 일부라 지우기도 연다(대표 교체·담당 해제).
do $$
declare t text;
begin
  foreach t in array array['biz_entity','biz_place','biz_representative','biz_place_partner','biz_place_staff','biz_entity_relation'] loop
    execute format('drop policy if exists %I on public.%I', t||'_ins_perhead', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_perhead() and not public.is_readonly())', t||'_ins_perhead', t);
    execute format('drop policy if exists %I on public.%I', t||'_upd_perhead', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_perhead() and not public.is_readonly()) with check (public.is_perhead() and not public.is_readonly())', t||'_upd_perhead', t);
  end loop;
  foreach t in array array['biz_representative','biz_place_partner','biz_place_staff','biz_entity_relation'] loop
    execute format('drop policy if exists %I on public.%I', t||'_del_perhead', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_perhead() and not public.is_readonly())', t||'_del_perhead', t);
  end loop;
end $$;

-- 주민번호·홈택스 PASS 쓰기(암호화 setter) — 등록할 때 넣어야 하므로 인당회계사도 연다. 보기는 biz_can_reveal* 가 따로 정한다.
create or replace function public.biz_assert_writer()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if public.is_external() or public.is_readonly() then
    raise exception '거래처 정보를 수정할 권한이 없습니다';
  end if;
end; $$;
revoke execute on function public.biz_assert_writer() from public, anon;
