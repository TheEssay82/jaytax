-- 0088_invoice_request_created_by.sql
-- biz_invoice_request 에 created_by 가 없는데 BEFORE INSERT 트리거(biz_set_created_by)가
-- new.created_by 를 채우려 해서 **등록이 전부 실패**했다.
--   ERROR: record "new" has no field "created_by"
-- 0075 에서 requested_by 만 두고 created_by 를 빠뜨린 탓. 이 표에 실제로 등록을 시도한 것이
-- 이번이 처음이라 그동안 드러나지 않았다. 다른 biz_* 표와 같게 맞춘다.
-- (같은 트리거를 쓰는 나머지 11개 표에는 created_by 가 모두 있는 것을 확인했다.)

alter table public.biz_invoice_request
  add column if not exists created_by uuid references auth.users(id);

comment on column public.biz_invoice_request.created_by is
  '행을 만든 사람(트리거가 채움). 업무상 의미는 requested_by 가 갖는다.';
