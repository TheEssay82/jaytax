-- 0036: 발송요청 — 업무구분이 '퀵서비스'면 수신자 연락처(phone) 필수(서버 강제)
-- 퀵서비스는 기사에게 수신자 연락처가 반드시 필요하므로 insert/update 모두에서 검증.

create or replace function public.doc_send_quick_phone_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.work_type = '퀵서비스' and coalesce(btrim(new.phone), '') = '' then
    raise exception '퀵서비스는 수신자 연락처가 필수입니다.';
  end if;
  return new;
end; $$;

drop trigger if exists trg_doc_send_quick_phone on public.doc_send_requests;
create trigger trg_doc_send_quick_phone before insert or update on public.doc_send_requests
  for each row execute function public.doc_send_quick_phone_guard();
