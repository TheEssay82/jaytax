-- 사용자별 알림. 범용으로 짓되(어느 영역이든 이 테이블에 쌓는다) 지금은 문서발송 이벤트만 연결한다.
--  · 발송요청 도착 → 처리 담당자 전원
--  · 반송 처리   → 원 요청자
--  · 재발송요청  → 처리 담당자 전원

create table if not exists public.notifications (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,  -- 수신자
  kind        text not null,                    -- 'dispatch_new' | 'dispatch_returned' | 'dispatch_resend' | ...
  title       text not null,
  body        text,
  tab         text,                             -- 클릭 시 이동할 앱 탭 id
  entity_id   uuid,                             -- 관련 레코드(중복 알림 억제·딥링크용)
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, read_at, created_at desc);

alter table public.notifications enable row level security;

-- 본인 알림만 읽고, 본인 알림만 읽음/삭제할 수 있다. 생성은 트리거(정의자 권한)만.
drop policy if exists notifications_sel on public.notifications;
create policy notifications_sel on public.notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists notifications_upd on public.notifications;
create policy notifications_upd on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notifications_del on public.notifications;
create policy notifications_del on public.notifications
  for delete to authenticated using (user_id = auth.uid());

/** 한 사람에게 알림 1건. 자기 자신에게는 보내지 않는다(내가 한 일은 나에게 안 알림). */
create or replace function public.notify_user(
  p_user uuid, p_kind text, p_title text, p_body text, p_tab text, p_entity uuid
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = auth.uid() then
    return;
  end if;
  insert into public.notifications (user_id, kind, title, body, tab, entity_id)
  values (p_user, p_kind, p_title, p_body, p_tab, p_entity);
end; $$;

/** 문서발송 상태 변화 → 알림 */
create or replace function public.doc_send_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_target text := trim(coalesce(new.company_name,'') || ' ' || coalesce(new.send_kind,''));
  r record;
begin
  -- 발송요청 도착(신규) → 처리 담당자 전원
  if TG_OP = 'INSERT' then
    for r in select id from public.profiles
             where role in ('superuser','team_lead','team_member') and not coalesce(readonly,false)
    loop
      perform public.notify_user(r.id, 'dispatch_new',
        '새 발송요청', v_target || ' — ' || coalesce(new.requester,'') || ' 요청', 'doc-process', new.id);
    end loop;
    return new;
  end if;

  -- 상태 전이 알림
  if TG_OP = 'UPDATE' and new.status is distinct from old.status then
    if new.status = '반송' then
      -- 원 요청자에게
      perform public.notify_user(coalesce(new.requester_id, new.created_by), 'dispatch_returned',
        '발송 반송됨', v_target || ' — 사유: ' || coalesce(new.status_note,'(미기재)'), 'doc-request', new.id);
    elsif new.status = '재발송요청' then
      -- 처리 담당자 전원에게
      for r in select id from public.profiles
               where role in ('superuser','team_lead','team_member') and not coalesce(readonly,false)
      loop
        perform public.notify_user(r.id, 'dispatch_resend',
          '재발송요청', v_target || ' — 재발송이 필요합니다', 'doc-process', new.id);
      end loop;
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_doc_send_notify on public.doc_send_requests;
create trigger trg_doc_send_notify
  after insert or update on public.doc_send_requests
  for each row execute function public.doc_send_notify();
