-- 0070 되돌리기 — doc_clients/doc_contacts 별칭화 해제(수동 실행용)
--
-- 주의: 백필 (c) 단계에서 biz_* 에만 있던 거래처·담당자를 doc_* 에 새로 만들었다.
--       아래 3)은 그 '별칭으로 새로 생긴 행'만 지운다. 발송·조회서 이력이 걸린 행은 FK(restrict/set null)
--       때문에 남거나 삭제가 거부되므로, 그런 행은 수동 확인 후 처리한다.

-- 1) 트리거 제거
drop trigger if exists trg_biz_entity_alias  on public.biz_entity;
drop trigger if exists trg_biz_place_alias   on public.biz_place;
drop trigger if exists trg_biz_contact_alias on public.biz_contact;
drop function if exists public.trg_biz_alias_entity();
drop function if exists public.trg_biz_alias_place();
drop function if exists public.trg_biz_alias_contact();

-- 2) 별칭으로 새로 생긴 행 정리 (0070 적용 이후 생성분 = 별칭연결 있고 발송/조회서 이력 없음)
delete from public.doc_contacts c
 where c.biz_contact_id is not null
   and not exists (select 1 from public.doc_send_requests r where r.contact_id = c.id);

delete from public.doc_clients d
 where d.entity_id is not null
   and not exists (select 1 from public.confirmations f where f.client_id = d.id)
   and not exists (select 1 from public.doc_send_requests r where r.client_id = d.id)
   and not exists (select 1 from public.doc_contacts c where c.client_id = d.id);

-- 3) 동기화 함수·연결 컬럼 제거
drop function if exists public.biz_alias_sync_contact(uuid);
drop function if exists public.biz_alias_sync_entity(uuid);
drop function if exists public.biz_display_name(text, text, text);

drop index if exists public.doc_contacts_biz_uk;
drop index if exists public.doc_clients_entity_uk;
alter table public.doc_contacts drop column if exists biz_contact_id;
alter table public.doc_clients  drop column if exists entity_id;
