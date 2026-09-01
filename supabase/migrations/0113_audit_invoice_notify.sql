-- 감사팀 발행요청의 알림 — 사람 이름으로 보낸다.
--
-- 감사팀은 taxteam 처럼 월 단위로 몰아 처리하지 않는다. 계약금·중도금·잔금이 건별로 생기고,
-- 그때그때 담당 회계사가 요청하고 김민섭이 발행한다. 그래서 알림도 건별이다.
--   ① 청구기한이 지난 분할회차가 생기면 → 담당 회계사에게
--   ② 회계사가 발행요청하면 → 김민섭에게
--   ③ 김민섭이 발행완료하면 → 요청한 회계사에게
create or replace function public.biz_audit_notify(
  p_name text, p_kind text, p_title text, p_body text
) returns integer language plpgsql security definer set search_path = public as $fn$
declare n integer := 0; r record;
begin
  if public.is_external() then raise exception '권한이 없습니다'; end if;
  -- 아무 알림이나 보낼 수 있으면 안 된다 — 이 세 가지만.
  if p_kind not in ('audit_proposal', 'audit_request', 'audit_issued') then
    raise exception '알 수 없는 알림 종류입니다: %', p_kind;
  end if;
  if coalesce(trim(p_name), '') = '' then return 0; end if;
  for r in
    select id from public.profiles where trim(coalesce(name, '')) = trim(p_name)
  loop
    perform public.notify_user(r.id, p_kind, p_title, p_body, 'audit-invoice', null);
    n := n + 1;
  end loop;
  return n;
end $fn$;

revoke execute on function public.biz_audit_notify(text, text, text, text) from public;
grant execute on function public.biz_audit_notify(text, text, text, text) to authenticated;

-- 같은 제안으로 매번 알림이 가면 곧 아무도 안 본다. 한 번 보낸 회차는 여기 적어 둔다.
create table if not exists public.biz_audit_proposal_notice (
  proposal_key text primary key,          -- contractId|installmentId
  company      text not null default '',
  cpa          text not null default '',
  amount       numeric not null default 0,
  due_date     date,
  notified_at  timestamptz not null default now(),
  notified_by  uuid references auth.users(id)
);
comment on table public.biz_audit_proposal_notice is
  '감사팀 청구기한 도래 제안을 담당 회계사에게 알린 기록. 같은 회차로 두 번 알리지 않기 위한 것.';

alter table public.biz_audit_proposal_notice enable row level security;

drop policy if exists biz_audit_proposal_notice_sel on public.biz_audit_proposal_notice;
create policy biz_audit_proposal_notice_sel on public.biz_audit_proposal_notice
  for select to authenticated using (not public.is_external());

drop policy if exists biz_audit_proposal_notice_write on public.biz_audit_proposal_notice;
create policy biz_audit_proposal_notice_write on public.biz_audit_proposal_notice
  for all to authenticated
  using (not public.is_external() and not public.is_readonly() and not public.is_perhead())
  with check (not public.is_external() and not public.is_readonly() and not public.is_perhead());

grant select, insert, update, delete on public.biz_audit_proposal_notice to authenticated;
