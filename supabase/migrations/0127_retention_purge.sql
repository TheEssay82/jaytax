-- 0127 보존기한 · 파기 (개인정보 보호법 제21조)
--
-- 제21조제1항 — 보유기간 경과·목적 달성 등으로 **불필요하게 되었을 때 지체 없이 파기**한다.
--   다만 **다른 법령에 따라 보존하여야 하는 경우**에는 그러하지 아니하다.
-- 제21조제2항 — 파기할 때는 **복구 또는 재생되지 아니하도록** 한다.
--   → soft delete(deleted_at)는 파기가 아니다. 행을 지운다.
-- 제21조제3항 — 보존의무로 남기는 것은 **다른 개인정보와 분리하여 저장·관리**한다. (아직 미이행)
--
-- ── 기간을 코드가 아니라 표에 두는 이유 ──────────────────
-- 근거 조문과 기간이 화면에 그대로 보여야 점검이 되고(고시 제4조제4항 연1회 이상 점검),
-- 법이 바뀌면 배포 없이 고칠 수 있다.
--
-- ── 확인한 근거 (법제처 원문) ────────────────────────────
--  · 국세기본법 제85조의3제2항 — 장부·증거서류는 법정신고기한이 지난 날부터 5년(역외거래 7년)
--  · 상법 제33조제1항 — 상업장부·영업에 관한 중요서류 10년, 단서로 전표 등은 5년
--  · 주식회사 등의 외부감사에 관한 법률 제19조제2항 — 감사조서 8년
--      같은 조 제3항이 감사조서의 위조·변조·훼손 및 파기를 금지한다
--      → 조회서는 파기 버튼 자체를 막는다(destroy_ok = false).
--  · 「개인정보의 안전성 확보조치 기준」 제8조제1항 단서 제2호 — 접속기록 2년 이상(하한)

create table if not exists public.retention_policy (
  key text primary key, label text not null, table_name text not null, date_col text not null,
  months integer not null, basis text not null, destroy_ok boolean not null default true,
  note text, updated_at timestamptz not null default now()
);
alter table public.retention_policy enable row level security;
drop policy if exists retention_policy_sel on public.retention_policy;
create policy retention_policy_sel on public.retention_policy for select using (not public.is_external());
revoke insert, update, delete on public.retention_policy from anon, authenticated;

create table if not exists public.purge_log (
  id bigserial primary key, at timestamptz not null default now(),
  actor_id uuid, actor_name text, policy_key text not null, table_name text not null,
  cutoff timestamptz not null, deleted integer not null, reason text,
  method text not null default '데이터베이스 행 삭제(복구 불가)'
);
alter table public.purge_log enable row level security;
drop policy if exists purge_log_sel on public.purge_log;
create policy purge_log_sel on public.purge_log for select using (
  coalesce((select role = 'superuser' from public.profiles where id = auth.uid()), false));
revoke insert, update, delete on public.purge_log from anon, authenticated;
comment on table public.purge_log is '파기 이력 — 개인정보 보호법 제21조. 무엇을 언제 몇 건 지웠는지.';

insert into public.retention_policy (key, label, table_name, date_col, months, basis, destroy_ok, note) values
 ('login_attempt','로그인 시도 기록','login_attempt','at',3,
  '법정 보존의무 없음 — 실패 횟수 판정에만 쓰는 운영 데이터',true,
  '감사 증적은 접속기록(access_log)이 정본이라 이쪽은 짧게 둔다.'),
 ('access_log','접속기록','access_log','at',24,
  '「개인정보의 안전성 확보조치 기준」 제8조제1항 단서 제2호 — 고유식별정보 처리 시 2년 이상',true,
  '2년은 하한이다. 2년이 지나야 비로소 파기 대상이 된다.'),
 ('biz_invoice_request','세금계산서 발행요청','biz_invoice_request','issue_date',60,
  '국세기본법 제85조의3제2항 — 법정신고기한이 지난 날부터 5년',true,
  '작성일 기준으로 근사한다. 엄밀히는 그 과세기간의 법정신고기한 기산이라 실제로는 더 길게 남는다.'),
 ('billing_records','세무조정 청구기록','billing_records','saved_at',60,
  '국세기본법 제85조의3제2항 — 5년',true,null),
 ('biz_sales_contract','매출계약','biz_sales_contract','end_date',120,
  '상법 제33조제1항 — 영업에 관한 중요서류 10년',true,
  '종료일이 없는 계속계약은 대상이 아니다(아직 살아 있는 계약).'),
 ('biz_contact','거래처담당자','biz_contact','left_at',60,
  '퇴사·이직으로 무효가 된 뒤 5년(국세기본법 제85조의3제2항 준용)',true,
  '유효한 담당자는 대상이 아니다 — 퇴사 처리된 것만 센다.'),
 ('confirmations','조회서','confirmations','created_at',96,
  '주식회사 등의 외부감사에 관한 법률 제19조제2항 — 감사조서 8년',false,
  '같은 조 제3항이 감사조서의 위조·변조·훼손 및 파기를 금지한다. 8년이 지나기 전에는 시스템이 지우지 못하게 막아 둔다.'),
 ('consultations','상담기록','consultations','created_at',60,
  '직접적인 법정 보존의무 없음 — 세무 관련성을 들어 5년 준용(확인 필요)',true,
  '질문 본문에 의뢰인 개인정보가 섞일 수 있다. 기간을 줄일지 정해야 한다.')
on conflict (key) do update set
  label = excluded.label, table_name = excluded.table_name, date_col = excluded.date_col,
  months = excluded.months, basis = excluded.basis, destroy_ok = excluded.destroy_ok,
  note = excluded.note, updated_at = now();

-- 보존기한이 지난 건이 몇 건인지 센다. 지우지는 않는다.
create or replace function public.retention_survey()
returns table(key text, label text, table_name text, months integer, basis text,
              destroy_ok boolean, note text, cutoff date, due bigint, total bigint)
language plpgsql stable security definer set search_path = public as $fn$
declare p record; v_cut date; v_due bigint; v_tot bigint;
begin
  if not coalesce((select role = 'superuser' from public.profiles where id = auth.uid()), false) then
    raise exception '보존·파기 현황을 볼 권한이 없습니다'; end if;
  for p in select * from public.retention_policy order by months, key loop
    v_cut := (current_date - make_interval(months => p.months))::date;
    execute format('select count(*) from public.%I', p.table_name) into v_tot;
    execute format('select count(*) from public.%I where %I is not null and %I < $1',
                   p.table_name, p.date_col, p.date_col) using v_cut into v_due;
    key := p.key; label := p.label; table_name := p.table_name; months := p.months;
    basis := p.basis; destroy_ok := p.destroy_ok; note := p.note;
    cutoff := v_cut; due := v_due; total := v_tot;
    return next;
  end loop;
end $fn$;

-- 실제 파기. 복구되지 않는 삭제(법 제21조제2항)이고 이력을 남긴다.
create or replace function public.retention_purge(p_key text, p_reason text)
returns integer language plpgsql volatile security definer set search_path = public as $fn$
declare p record; v_cut date; v_n integer; v_uid uuid := auth.uid(); v_name text;
begin
  if not coalesce((select role = 'superuser' from public.profiles where id = v_uid), false) then
    raise exception '파기 권한이 없습니다 — 개인정보 보호책임자만 할 수 있습니다'; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception '파기 사유를 적어야 합니다 (파기 이력에 남습니다)'; end if;
  select * into p from public.retention_policy where key = p_key;
  if p is null then raise exception '알 수 없는 보존정책입니다: %', p_key; end if;
  if not p.destroy_ok then
    raise exception '이 자료는 시스템에서 파기할 수 없습니다 — %', p.basis; end if;

  v_cut := (current_date - make_interval(months => p.months))::date;
  execute format('delete from public.%I where %I is not null and %I < $1',
                 p.table_name, p.date_col, p.date_col) using v_cut;
  get diagnostics v_n = row_count;

  select name into v_name from public.profiles where id = v_uid;
  insert into public.purge_log (actor_id, actor_name, policy_key, table_name, cutoff, deleted, reason)
  values (v_uid, v_name, p.key, p.table_name, v_cut, v_n, p_reason);
  perform public.log_access('purge', p.table_name, null, null, p_reason,
                            jsonb_build_object('count', v_n, 'cutoff', v_cut, 'policy', p.key));
  return v_n;
end $fn$;

revoke all on function public.retention_survey() from public, anon;
revoke all on function public.retention_purge(text, text) from public, anon;
grant execute on function public.retention_survey() to authenticated;
grant execute on function public.retention_purge(text, text) to authenticated;
