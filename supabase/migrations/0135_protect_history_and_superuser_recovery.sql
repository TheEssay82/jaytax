-- 2026-07 전반점검에서 나왔던 오래된 위험 둘을 막는다.

-- ① 거래처를 지우면 그 기록이 '누구 것'이었는지 영구히 사라지던 자리.
--    금액·날짜는 남고 상대방만 없어져 **없어진 줄도 모른다**.
--    조회서(confirmations)는 이미 RESTRICT 라 맞게 돼 있었고, 나머지만 뚫려 있었다.
--    적용 시점에도 청구기록 175건 중 5건, 상담기록 8건 중 7건이 연결이 끊겨 있었다.
--    RESTRICT 로 바꾸면 기록이 달린 거래처는 지워지지 않는다
--    (사용자 확인 2026-09-04: 거래처를 지우는 일은 없다).
--
--    billing_targets(청구 대상선정)·doc_contacts(거래처 담당자)는 CASCADE 그대로 둔다 —
--    기록이 아니라 거래처에 종속된 자료라 함께 사라지는 것이 맞다.
alter table public.billing_records   drop constraint billing_records_client_id_fkey;
alter table public.billing_records   add  constraint billing_records_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete restrict;

alter table public.consultations     drop constraint consultations_client_id_fkey;
alter table public.consultations     add  constraint consultations_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete restrict;

alter table public.doc_send_requests drop constraint doc_send_requests_client_id_fkey;
alter table public.doc_send_requests add  constraint doc_send_requests_client_id_fkey
  foreign key (client_id) references public.doc_clients(id) on delete restrict;

-- ② 최고관리자 계정이 잠기면 앱 밖에서도 되돌릴 수 없던 자리.
--    is_superuser() 는 auth.uid() 를 보는데, SQL 편집기·서비스키로 들어오면 그 값이 비어
--    거짓이 된다. 그래서 트리거가 **복구 경로까지** 막았다. superuser 는 정우철 한 사람뿐이라
--    그가 잠기면 되돌릴 방법이 없었다.
--
--    auth.uid() 가 없다는 것은 '앱 사용자가 아니다'라는 뜻이다(로그인하면 반드시 값이 있다).
--    profiles 의 RLS 는 authenticated 역할에만 정책이 있어 anon 은 애초에 UPDATE 가 막히고,
--    service_role·postgres 는 원래 RLS 를 우회한다. 그러니 이 예외는 새 구멍을 만들지 않고
--    **비상구만 연다**.
create or replace function public.prevent_role_self_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- 앱 밖(SQL 편집기·서비스키)에서 들어온 복구 작업은 통과시킨다.
  if auth.uid() is null then
    return new;
  end if;
  if new.role is distinct from old.role and not public.is_superuser() then
    raise exception '역할 변경 권한이 없습니다 (최고관리자만 가능).';
  end if;
  if new.readonly is distinct from old.readonly and not public.is_superuser() then
    raise exception '쓰기잠금 변경 권한이 없습니다 (최고관리자만 가능).';
  end if;
  return new;
end; $function$;

-- 적용 후 확인(2026-09-04, 롤백 보장 DO 블록으로 시험):
--   ① 청구기록이 달린 거래처 삭제 → foreign_key_violation 으로 막힘 ✅
--   ② 앱 밖에서 등급 변경 → 통과(비상구 열림) ✅
