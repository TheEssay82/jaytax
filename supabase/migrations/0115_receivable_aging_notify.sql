-- 오래 묵은 미수금 알림.
--
-- 미수금은 쌓이는 줄 모르는 사이에 쌓인다. 6개월을 넘긴 채권은 담당이 알아야 움직인다.
-- 대상은 그 거래처의 담당 회계사와 담당 직원이다(청구를 만든 사람들).
create or replace function public.biz_receivable_notify(
  p_name text, p_title text, p_body text
) returns integer language plpgsql security definer set search_path = public as $fn$
declare n integer := 0; r record;
begin
  if public.is_external() then raise exception '권한이 없습니다'; end if;
  if coalesce(trim(p_name), '') = '' then return 0; end if;
  for r in select id from public.profiles where trim(coalesce(name, '')) = trim(p_name) loop
    perform public.notify_user(r.id, 'receivable_aging', p_title, p_body, 'receivable', null);
    n := n + 1;
  end loop;
  return n;
end $fn$;

revoke execute on function public.biz_receivable_notify(text, text, text) from public;
grant execute on function public.biz_receivable_notify(text, text, text) to authenticated;

-- 같은 달에 같은 거래처로 두 번 알리지 않는다. 달이 바뀌면 다시 알린다 —
-- 미수는 시간이 갈수록 나빠지므로 매달 한 번은 상기시키는 것이 맞다.
create table if not exists public.biz_receivable_notice (
  place_id    uuid not null references public.biz_place(id) on delete cascade,
  ym          text not null,                    -- 알린 달
  company     text not null default '',
  amount      numeric not null default 0,       -- 그때의 6개월 초과 잔액
  recipients  text not null default '',         -- 받은 사람들(이름, 쉼표)
  notified_at timestamptz not null default now(),
  notified_by uuid references auth.users(id),
  primary key (place_id, ym)
);
comment on table public.biz_receivable_notice is
  '6개월 초과 미수금 알림 기록. 같은 달 중복 발송을 막고, 언제 누구에게 알렸는지 남긴다.';

alter table public.biz_receivable_notice enable row level security;

drop policy if exists biz_receivable_notice_sel on public.biz_receivable_notice;
create policy biz_receivable_notice_sel on public.biz_receivable_notice
  for select to authenticated using (not public.is_external());

drop policy if exists biz_receivable_notice_write on public.biz_receivable_notice;
create policy biz_receivable_notice_write on public.biz_receivable_notice
  for all to authenticated
  using (not public.is_external() and not public.is_readonly() and not public.is_perhead())
  with check (not public.is_external() and not public.is_readonly() and not public.is_perhead());

grant select, insert, update, delete on public.biz_receivable_notice to authenticated;
