-- 0087_invoice_system.sql — 세금계산서 발행 시스템 1단계(뼈대)
--
-- jaytax 는 발행하지 않는다. 발행은 계속 인덕 ERP 에서 담당자가 한다.
-- 여기서 하는 일 = **요청을 모으고, ERP 가 실제 발행한 결과를 받아 대사**하는 회계기능.
--
-- 화면은 감사팀/taxteam 둘로 나누지만 **데이터는 한 테이블**에 담는다.
-- 미수금과 대사가 결국 거래처 단위로 한 곳에서 모여야 하기 때문이다.

-- ── 1) 발행요청 확장 ──────────────────────────────────────
alter table public.biz_invoice_request
  add column if not exists team        text not null default 'taxteam',  -- 감사team | taxteam
  add column if not exists erp_account text,          -- ERP 매출계정 7종
  add column if not exists phase       text,          -- 계약금·중도금·잔금·총액 (감사팀 건별)
  add column if not exists summary     text,          -- 발행 시 적요
  add column if not exists doc_email   text,          -- 공급받는자(세금계산서 수신) 이메일
  add column if not exists issue_date  date;          -- 작성일(발행기준일). taxteam 은 매월 24일

comment on column public.biz_invoice_request.team is
  '감사team | taxteam. 화면을 가르는 기준이자 통계 축.';
comment on column public.biz_invoice_request.issue_date is
  '작성일(발행기준일). taxteam 은 매월 24일 고정, 감사팀은 건별 지정.';
comment on column public.biz_invoice_request.doc_email is
  '세금계산서 수신 이메일. 원래는 거래처에 전용 필드를 두는 것이 맞고, 그전까지는 거래처담당자 이메일을 끌어 쓴다.';

do $$ begin
  alter table public.biz_invoice_request add constraint biz_invoice_request_team_chk
    check (team in ('감사team', 'taxteam'));
exception when duplicate_object then null; end $$;

-- ERP 매출계정 7종. 표기가 흔들리지 않게 코드에서만 고르게 한다.
do $$ begin
  alter table public.biz_invoice_request add constraint biz_invoice_request_account_chk
    check (erp_account is null or erp_account in (
      '회계감사수입', '세무조정수입', '기업진단수입', '기장대리수입',
      '경영자문수입', '기타용역수입', '임의감사수입'));
exception when duplicate_object then null; end $$;

-- 기존 행(2026-09 이전 시험분)은 전부 taxteam 으로 둔다.
update public.biz_invoice_request set team = 'taxteam' where team is null;

create index if not exists biz_invoice_request_team_ym_idx
  on public.biz_invoice_request (team, ym);

-- ── 2) taxteam 월별 확인 워크플로 ────────────────────────
-- 매월 24일 전월분이 당월로 전개되면 담당자 3인(김민섭·김동주·정남지)에게 알림이 가고,
-- **변경이 없어도 각자 '확인'을 눌러야** 한다. 3인이 다 누르면 김민섭이 최종확인한다.
-- '아무도 안 봤다'와 '보고 변경 없음'을 구별하려고 만든 테이블이다.
create table if not exists public.biz_invoice_month (
  ym               text primary key,                  -- 'YYYY-MM'
  opened_at        timestamptz not null default now(),-- 당월 전개 시점
  opened_by        uuid references auth.users(id),
  final_confirmed_at timestamptz,
  final_confirmed_by uuid references auth.users(id),
  note             text
);
comment on table public.biz_invoice_month is
  'taxteam 발행요청의 달별 상태. 전개 시점과 최종확인만 담는다(개인 확인은 biz_invoice_check).';

create table if not exists public.biz_invoice_check (
  ym         text not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  checked_at timestamptz not null default now(),
  note       text,                                    -- '변경 없음' 등 한 줄 메모
  primary key (ym, user_id)
);
comment on table public.biz_invoice_check is
  '담당자별 당월 확인. 변경이 없어도 눌러야 하며, 누른 사실 자체가 기록이다.';

alter table public.biz_invoice_month enable row level security;
alter table public.biz_invoice_check enable row level security;

-- 내부자는 모두 보고, 쓰기는 내부자(외부인 제외). 확인은 본인 것만 남기고 지운다.
drop policy if exists biz_invoice_month_sel on public.biz_invoice_month;
create policy biz_invoice_month_sel on public.biz_invoice_month
  for select to authenticated using (not public.is_external());
drop policy if exists biz_invoice_month_ins on public.biz_invoice_month;
create policy biz_invoice_month_ins on public.biz_invoice_month
  for insert to authenticated with check (not public.is_external());
drop policy if exists biz_invoice_month_upd on public.biz_invoice_month;
create policy biz_invoice_month_upd on public.biz_invoice_month
  for update to authenticated using (not public.is_external()) with check (not public.is_external());

drop policy if exists biz_invoice_check_sel on public.biz_invoice_check;
create policy biz_invoice_check_sel on public.biz_invoice_check
  for select to authenticated using (not public.is_external());
drop policy if exists biz_invoice_check_ins on public.biz_invoice_check;
create policy biz_invoice_check_ins on public.biz_invoice_check
  for insert to authenticated with check (user_id = auth.uid() and not public.is_external());
drop policy if exists biz_invoice_check_del on public.biz_invoice_check;
create policy biz_invoice_check_del on public.biz_invoice_check
  for delete to authenticated using (user_id = auth.uid());

grant select, insert, update on table public.biz_invoice_month to authenticated;
grant select, insert, delete on table public.biz_invoice_check to authenticated;

-- ── 3) 당월 확인 요청 알림 ───────────────────────────────
-- 기존 notifications/notify_user() 를 그대로 쓴다. 대상은 taxteam 담당 3인.
create or replace function public.biz_invoice_notify_check(p_ym text)
returns integer language plpgsql security definer set search_path = public as $fn$
declare n integer := 0; r record;
begin
  if public.is_external() then raise exception '권한이 없습니다'; end if;
  for r in
    select id from public.profiles
     where trim(coalesce(name, '')) in ('김민섭', '김동주', '정남지')
  loop
    perform public.notify_user(
      r.id, 'invoice_check',
      p_ym || ' 세금계산서 발행요청 확인 요청',
      '전월분이 ' || p_ym || ' 로 전개되었습니다. 변경사항을 반영한 뒤 확인을 눌러 주세요(변경이 없어도 눌러야 합니다).',
      'invoice-request', null);
    n := n + 1;
  end loop;
  return n;
end $fn$;

revoke execute on function public.biz_invoice_notify_check(text) from public;
grant execute on function public.biz_invoice_notify_check(text) to authenticated;
