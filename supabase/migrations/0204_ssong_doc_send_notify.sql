-- 0204: 문서발송 진행 알림 — 대표님 발송요청의 상태·등기번호가 바뀌면 텔레그램으로(대표님 2026-11-21)
--
-- 대상: 의뢰인이 대표님(최고관리자)이거나 쏭비서 결재로 만들어진 발송요청.
-- 길:   AFTER UPDATE 트리거 → pg_net 으로 쏭비서 서버 /notify 에 POST(비동기 — 앱 저장을 막거나 늦추지 않는다)
--       → 서버가 같은 상태는 한 번만(ssong_tg_seen) 텔레그램으로 보낸다.
-- 인증: 헤더 x-ssong-notify 에 쏭비서 열쇠(label 'vercel')의 sha256 — 서버는 SSONG_DB_KEY 의 sha256 과 맞춰 본다.
--       새 비밀을 만들지 않는다. 이 해시로 할 수 있는 일은 「대표님께 진행 알림 보내기」뿐이고 같은 상태는 한 번만 간다.
-- 보내는 것: 거래처명·송부종류·문서명·상태·발송일·등기번호·상태메모. 주소·전화·수신자 이름은 보내지 않는다.

create extension if not exists pg_net;

create or replace function public.ssong_notify_doc_send()
returns trigger
language plpgsql security definer set search_path = public as $$
declare h text; via_ssong boolean;
begin
  if new.deleted_at is not null then return new; end if;
  if new.status is not distinct from old.status and new.tracking_no is not distinct from old.tracking_no then return new; end if;
  via_ssong := exists (select 1 from public.ssong_requests r where new.id = any(r.created_ids));
  if not via_ssong and not exists (select 1 from public.profiles p where p.id = new.requester_id and p.role = 'superuser') then
    return new;
  end if;
  select k.key_hash into h from public.ssong_keys k where k.label = 'vercel' and k.active limit 1;
  if h is null then return new; end if;
  begin
    perform net.http_post(
      url := 'https://jaytax-ssong-mcp.vercel.app/notify',
      body := jsonb_build_object(
        'kind', 'doc_send', 'id', new.id, 'company', new.company_name, 'sendKind', new.send_kind,
        'docName', new.doc_name, 'status', new.status, 'sentDate', new.sent_date,
        'trackingNo', new.tracking_no, 'statusNote', new.status_note, 'viaSsong', via_ssong),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-ssong-notify', h),
      timeout_milliseconds := 5000);
  exception when others then
    null; -- 알림이 실패해도 발송요청 저장은 그대로 간다
  end;
  return new;
end $$;

revoke all on function public.ssong_notify_doc_send() from public, anon, authenticated;

drop trigger if exists ssong_notify_doc_send on public.doc_send_requests;
create trigger ssong_notify_doc_send
  after update on public.doc_send_requests
  for each row execute function public.ssong_notify_doc_send();
