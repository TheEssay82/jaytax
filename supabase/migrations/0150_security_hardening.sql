-- 보안 어드바이저 대응 — Supabase 경고 메일(2026-09-16, 9/13 스캔) 에서 나온 것.
--
-- 0123 에서 anon·authenticated 를 뺐는데도 어드바이저가 "anon 이 부를 수 있는 SECURITY DEFINER 함수 44개"를
-- 계속 잡았다. 이유: 함수를 만들면 기본으로 **PUBLIC 에 EXECUTE 가 부여**되고,
-- `revoke ... from anon` 은 PUBLIC 부여를 건드리지 않는다. 그래서 이번엔 PUBLIC 부터 뺀다.

-- ① 9/5 존칭 정리 때 만든 백업 표 — RLS 없이 남아 프로젝트 URL 만 알면 읽고 쓸 수 있었다(이름·존칭·직위 49줄).
--    원본 biz_contact 는 그대로다. 지운다.
drop table if exists public.biz_contact_honorific_backup_20260905;

-- ② 트리거 함수 — PUBLIC 까지 뺀다. 트리거는 발화할 때 EXECUTE 를 검사하지 않는다
--    (biz_audit·biz_set_created_by 는 이미 postgres·service_role 만 갖고도 매일 돌아간다).
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure sig from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on function public.handle_new_user() to supabase_auth_admin;   -- auth.users 트리거를 발화시키는 역할

-- ③ SECURITY DEFINER 일반 함수 — PUBLIC·anon 을 뺀다.
--    anon 에 남기는 것(의도적 공개): login_gate·login_failed(로그인 전) · essay_*(습작 공개 열람) · get_shared_consult(공유 링크).
--    is_*/auth_role 도 뺀다 — 로그인 안 한 요청에는 어차피 null 이고, 정책이 실패해도 결과는 같은 '거부'다.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure sig, p.proname from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prorettype <> 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public', f.sig);
    if f.proname not in ('login_gate', 'login_failed', 'get_shared_consult') and f.proname not like 'essay\_%' then
      execute format('revoke execute on function %s from anon', f.sig);
    end if;
  end loop;
end $$;
-- RLS·트리거·다른 함수가 쓰는 도우미는 로그인 사용자가 부를 수 있어야 한다(PUBLIC 으로 받고 있던 것을 명시로).
grant execute on function public.auth_role() to authenticated;
grant execute on function public.is_external() to authenticated;
grant execute on function public.is_perhead() to authenticated;
grant execute on function public.is_readonly() to authenticated;
grant execute on function public.confirm_actor_name() to authenticated;
grant execute on function public.doc_actor_name() to authenticated;
-- notify_user 는 다른 SECURITY DEFINER 함수 안에서만 부른다(0123) — authenticated 에도 주지 않는다.

-- ④ search_path 고정 — 0123 뒤에 만든 것.
alter function public.staff_cost_total(public.staff_cost) set search_path = public;
alter function public.dsd_touch() set search_path = public;
alter function public.gwp_book_guard() set search_path = public;

-- ⑤ vector 확장을 extensions 스키마로. match_* 는 이미 search_path 에 extensions 를 갖고 있고(0123),
--    컬럼 타입·hnsw 인덱스는 OID 로 묶여 있어 영향이 없다. 스크립트에도 ::vector 를 직접 쓰는 곳은 없다.
alter extension vector set schema extensions;
