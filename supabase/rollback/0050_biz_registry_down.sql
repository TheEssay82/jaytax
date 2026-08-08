-- ROLLBACK — 0050_biz_registry / 0051_biz_registry_harden 전체 되돌리기
--
-- ⚠️ 이 파일은 supabase/migrations/ '밖'에 있어 자동 적용되지 않는다. 수동 실행 전용.
-- ⚠️ 거래처 레지스트리를 통째로 제거한다. 실제 데이터가 있으면 전부 삭제된다.
-- 실행: Supabase 대시보드 SQL 편집기 또는 MCP execute_sql 로 아래를 실행.
-- CREATE-only 마이그레이션이라 이 drop 으로 0050/0051 이전 상태로 완전히 복귀한다(기존 clients/doc_clients 무관).

drop table if exists public.biz_contact           cascade;  -- 0055
drop table if exists public.biz_contract_discount cascade;  -- 0054
drop table if exists public.biz_contract_installment cascade;
drop table if exists public.biz_contract_staff    cascade;
drop table if exists public.biz_sales_contract    cascade;
drop table if exists public.biz_entity_relation cascade;  -- 0053
drop table if exists public.biz_audit_log      cascade;
drop table if exists public.biz_place_staff    cascade;
drop table if exists public.biz_place_partner  cascade;
drop table if exists public.biz_representative cascade;
drop table if exists public.biz_place          cascade;
drop table if exists public.biz_entity         cascade;

drop function if exists public.biz_reveal_place_hometax_pw(uuid);
drop function if exists public.biz_reveal_rep_resident(uuid);
drop function if exists public.biz_reveal_entity_resident(uuid);
drop function if exists public.biz_set_place_hometax_pw(uuid, text);
drop function if exists public.biz_set_rep_resident(uuid, text);
drop function if exists public.biz_set_entity_resident(uuid, text);
drop function if exists public.biz_assert_writer();
drop function if exists public.biz_audit();
drop function if exists public.biz_touch_updated();
drop function if exists public.biz_set_created_by();
drop function if exists public.biz_place_before_insert();
drop function if exists public.biz_entity_before_insert();
drop function if exists public.biz_actor_name();
drop function if exists public.biz_can_reveal();
drop function if exists public.biz_encrypt(text);
drop function if exists public.biz_pii_key();

drop sequence if exists public.biz_corp_seq;
drop sequence if exists public.biz_person_seq;

-- (선택) 암호화 키까지 제거 — 암호화된 데이터가 남아있다면 복호 불가가 되므로, 완전 폐기 시에만 실행.
-- delete from vault.secrets where name = 'biz_pii_key';
