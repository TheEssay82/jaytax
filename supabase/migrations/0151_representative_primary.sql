-- 0151 대표자 '주 대표' — 공동대표·각자대표일 때 우리 업무 상대방(main role)을 한 사람 정한다.
--
-- 표의 '대표' 열과 문서·발송의 수신 대표는 주 대표를 먼저 쓴다. 대표가 한 명뿐이면 그 사람이 곧 주 대표라
-- 되채움으로 표시해 두고, 여럿인 곳은 사람이 고른다(거래처 수정 › 대표이사 › ★).
alter table public.biz_representative add column if not exists is_primary boolean not null default false;
comment on column public.biz_representative.is_primary is '주 대표(우리 업무 상대방). 거래처당 한 명만 true.';
-- 거래처당 한 명만 — 부분 유일 인덱스로 DB 가 지킨다.
create unique index if not exists biz_rep_primary_uniq on public.biz_representative(entity_id) where is_primary;
-- 대표가 한 명뿐인 거래처는 그 사람이 주 대표.
update public.biz_representative r set is_primary = true
 where not r.is_primary
   and (select count(*) from public.biz_representative x where x.entity_id = r.entity_id) = 1;
