-- 0201 쏭비서 결재가 올라오면 알림 (2026-11-21)
--
-- 대표님 「결재함이 너무 열기 어렵다, 결재가 올라오면 알림이 있으면 한다」.
-- 결재할 수 있는 사람(최고관리자) 모두에게 🔔 알림을 넣는다. 누르면 결재함이 열린다.
-- 앱의 알림 종(NotificationBell)이 브라우저 알림까지 띄운다(허용해 둔 경우).
create or replace function public.ssong_requests_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from public.profiles where role = 'superuser' loop
    perform public.notify_user(r.id, 'ssong_new',
      '쏭비서 결재 요청',
      case new.kind when 'sales_contract' then '매출계약 등록 — ' else '문서발송 의뢰 — ' end || new.title,
      'ssong-inbox', new.id);
  end loop;
  return new;
end $$;
revoke all on function public.ssong_requests_notify() from public, anon, authenticated;

drop trigger if exists trg_ssong_requests_notify on public.ssong_requests;
create trigger trg_ssong_requests_notify after insert on public.ssong_requests
  for each row execute function public.ssong_requests_notify();
