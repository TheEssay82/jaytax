-- 0052: 거래처 레지스트리 보강 — 담당직원 UPDATE 버그 수정 + 사업장 본점/지점·사업자단위과세
--
-- 1) [버그] biz_place_staff 에 updated_by 컬럼이 없어 공용 UPDATE 트리거(biz_touch_updated)가
--    'record "new" has no field "updated_by"' 로 실패 → 이미 등록된 거래처의 담당직원 배정취소(UPDATE) 불가.
--    (등록 시 INSERT 는 다른 트리거라 정상) → 컬럼 추가로 해결.
-- 2) 사업장 본점/지점 구분(branch_type).
-- 3) 사업자단위과세(unit_taxation) + 신고기준사업장(filing_place_id, 지점이 참조하는 본점).

alter table public.biz_place_staff add column if not exists updated_by uuid references auth.users(id);

alter table public.biz_place add column if not exists branch_type   text check (branch_type in ('본점','지점'));
alter table public.biz_place add column if not exists unit_taxation boolean not null default false;
alter table public.biz_place add column if not exists filing_place_id uuid references public.biz_place(id) on delete set null;
create index if not exists biz_place_filing_idx on public.biz_place(filing_place_id);
