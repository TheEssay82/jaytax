-- 0124 발행요청 취소사유 · 세부내역 · 청구서 체크 · 세금계산서 발송 e-mail
--
-- 취소는 지금까지 흔적을 남기지 않았다. 김민섭 대리가 요청을 물리면 요청한
-- 회계사는 무엇을 고쳐야 할지 알 길이 없었다. 사유를 붙이고 그 사유로 알린다.
--
-- 세금계산서가 **어디로 갈지**도 요청 시점에 정해져야 한다. 실제로는 경리·대표·
-- 세무대리인 여러 곳으로 나가는 거래처가 많다. 과거 발행 이력(엑셀 903번까지)에
-- 실제로 쓰인 주소를 모아 두고 요청할 때 후보로 띄운다.

-- ── 요청: 취소 사유 ────────────────────────────────────
alter table public.biz_invoice_request
  add column if not exists cancel_reason text,
  add column if not exists canceled_by   uuid,
  add column if not exists canceled_at   timestamptz;

-- ── 요청: 세부내역(제경비 합산청구) · 청구서 발송 여부 ──
-- detail_lines: [{kind:'감사보수', desc:'…', amount:1000000}, …]
-- 합산청구할 때 무엇이 얼마인지를 요청 단계에서 굳혀 둔다.
alter table public.biz_invoice_request
  add column if not exists detail_lines      jsonb,
  add column if not exists needs_invoice_doc boolean not null default false;

-- ── 거래처(사업장): 전자세금계산서 수신 e-mail ──────────
-- 담당자 연락처와 별개다. 세금계산서는 사람이 아니라 자리로 간다.
alter table public.biz_place
  add column if not exists tax_emails text[] not null default '{}';

-- ── 과거에 실제로 쓴 주소 ───────────────────────────────
-- seen_count·last_seen 으로 "가장 많이 쓴 것"을 첫 후보로 올린다.
create table if not exists public.biz_tax_email_history (
  id          uuid primary key default gen_random_uuid(),
  client_name text not null,
  email       text not null,
  seen_count  integer not null default 1,
  last_seen   date,
  entity_id   uuid references public.biz_entity(id) on delete set null,
  place_id    uuid references public.biz_place(id)  on delete set null,
  source      text not null default '과거 발행',
  created_at  timestamptz not null default now(),
  unique (client_name, email)
);
create index if not exists biz_tax_email_history_entity_idx
  on public.biz_tax_email_history(entity_id);

alter table public.biz_tax_email_history enable row level security;
drop policy if exists biz_tax_email_history_sel on public.biz_tax_email_history;
create policy biz_tax_email_history_sel on public.biz_tax_email_history
  for select using (not public.is_external());
drop policy if exists biz_tax_email_history_write on public.biz_tax_email_history;
create policy biz_tax_email_history_write on public.biz_tax_email_history
  for all using (not public.is_external() and not public.is_readonly())
  with check (not public.is_external() and not public.is_readonly());

-- ── 취소 알림 ──────────────────────────────────────────
-- 0113 의 biz_audit_notify 에 'audit_cancel' 을 더한다.
create or replace function public.biz_audit_notify(
  p_name text, p_kind text, p_title text, p_body text
) returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0;
begin
  if public.is_external() then raise exception '권한이 없습니다'; end if;
  if p_kind not in ('audit_proposal', 'audit_request', 'audit_issued', 'audit_cancel') then
    raise exception '알 수 없는 알림 종류입니다: %', p_kind;
  end if;
  if coalesce(trim(p_name), '') = '' then return 0; end if;
  insert into public.notifications (user_id, kind, title, body, tab, entity_id)
  select id, p_kind, p_title, p_body, 'audit-invoice', null
    from public.profiles where trim(coalesce(name, '')) = trim(p_name);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.biz_audit_notify(text, text, text, text) from public, anon;
grant execute on function public.biz_audit_notify(text, text, text, text) to authenticated;
