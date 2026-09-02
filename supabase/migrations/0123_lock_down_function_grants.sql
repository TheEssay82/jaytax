-- 함수 실행권한 조이기 — 보안 점검(2026-09-03)에서 나온 것.
--
-- Supabase 는 public 스키마의 함수를 **REST API(/rest/v1/rpc/...)로 그대로 노출**한다.
-- 그래서 '아무도 부르지 않을 것'이라 여긴 함수도 로그인 없이 호출될 수 있었다.
--
-- 민감한 것들(주민번호·홈택스 비밀번호 복호화·저장)은 다행히 함수 안에서 권한을 확인하고 있었다
-- (biz_can_reveal · biz_assert_writer). 그래도 **부를 수 있다는 것 자체를 없애는 것**이 맞다.
-- 특히 notify_user 는 가드가 없어, 누구든 아무에게나 알림을 꽂아 넣을 수 있었다.

-- ① 트리거 전용 함수 — 사람이 부를 일이 없다.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure sig from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from anon, authenticated', f.sig);
  end loop;
end $$;

-- ② notify_user — 가드가 없다. 다른 SECURITY DEFINER 함수가 소유자 권한으로 부르므로
--    앱 기능은 그대로 돌아간다.
revoke execute on function public.notify_user(uuid, text, text, text, text, uuid) from anon, authenticated;

-- ③ 로그인해야만 뜻이 있는 RPC 는 anon 에서 뺀다(가드는 그대로 둔다 — 이중으로).
--    공개로 남기는 것: essay_*(습작 열람) · get_shared_consult(공유 링크) · is_*/auth_role(RLS 가 쓴다).
revoke execute on function public.biz_reveal_residents() from anon;
revoke execute on function public.biz_reveal_entity_resident(uuid) from anon;
revoke execute on function public.biz_reveal_rep_resident(uuid) from anon;
revoke execute on function public.biz_reveal_hometax_pws() from anon;
revoke execute on function public.biz_reveal_place_hometax_pw(uuid) from anon;
revoke execute on function public.biz_can_reveal_hometax_pw() from anon;
revoke execute on function public.biz_set_entity_resident(uuid, text) from anon;
revoke execute on function public.biz_set_rep_resident(uuid, text) from anon;
revoke execute on function public.biz_set_place_hometax_pw(uuid, text) from anon;
revoke execute on function public.biz_alias_sync_entity(uuid) from anon;
revoke execute on function public.biz_alias_sync_contact(uuid) from anon;
revoke execute on function public.biz_audit_notify(text, text, text, text) from anon;
revoke execute on function public.biz_receivable_notify(text, text, text) from anon;
revoke execute on function public.biz_invoice_notify_check(text) from anon;
revoke execute on function public.ai_usage_by_user() from anon;
revoke execute on function public.demo_clients() from anon;

-- ④ search_path 를 고정한다(우리가 만든 함수만). 고정하지 않으면 호출자의 search_path 에 따라
--    엉뚱한 스키마의 같은 이름 객체가 잡힐 수 있다.
alter function public.biz_display_name(text, text, text) set search_path = public;
alter function public.confirm_item_summary(jsonb, jsonb, text) set search_path = public;
alter function public.essay_lock_hours() set search_path = public;
alter function public.essay_name_key(text) set search_path = public;
alter function public.set_consultation_finalizer() set search_path = public;
alter function public.set_updated_at() set search_path = public;
alter function public.touch_updated_at() set search_path = public;
alter function public.match_accounting_standards(vector, integer, text) set search_path = public, extensions;
alter function public.match_library_fulltext(vector, integer, text) set search_path = public, extensions;
alter function public.match_standard_fulltext(vector, integer, text) set search_path = public, extensions;
