-- 0128 부분 파기 — 업무자료는 영구보관하고 개인정보만 지운다
--
-- ── 사용자 결정과 법의 간극을 메우는 설계 ────────────────
-- 사용자 결정(2026-09-03): "법정 보존기한은 최소한이므로, 파기해야 하는 정보만 파기하고
-- 그 외에는 영구보관한다. 매출계약·조회서는 하드카피로도 보관 중이라 큰 의미가 없다."
--
-- 법 제21조제1항 단서(다른 법령에 따른 보존)는 파기 의무의 **예외**다. 기간이 지나면
-- 예외가 사라지므로, 개인정보를 담은 자료를 기한 뒤에도 영구보관하는 것은 위반 소지가 있다.
-- 그러나 **개인정보가 아닌 것**(상호·사업자번호·금액·계약조건·거래내역)은 애초에 제21조의
-- 대상이 아니므로 영구보관해도 된다.
--
-- 그래서 둘을 갈라 놓는다 — **행은 남기고 개인정보 열만 비운다.**
--   「개인정보의 안전성 확보조치 기준」 제13조제2항제1호 —
--   "전자적 파일 형태인 경우: 개인정보를 삭제한 후 복구 및 재생되지 않도록 관리 및 감독"
--   개인정보 보호법 시행령 제16조제1항제1호 — "복원이 불가능한 방법으로 영구 삭제"
--
-- 결과적으로 jaytax 의 업무자료(발행요청·청구기록·매출계약·조회서)는 영구보관하고,
-- 개인정보 그 자체(주민번호·홈택스PW·퇴사한 담당자 연락처)만 때가 되면 지운다.

alter table public.retention_policy
  add column if not exists mode      text not null default 'row',   -- row | columns | keep
  add column if not exists pii_cols  text[],                        -- mode='columns' 일 때 비울 열
  add column if not exists where_sql text;                          -- 대상 조건. {cutoff} 자리에 기준일이 들어간다

update public.retention_policy set mode = 'keep',
  note = coalesce(note || ' / ', '') || '사용자 결정(2026-09-03): 영구보관. 개인정보가 아닌 업무·회계 자료이고 하드카피도 보관 중이다.'
 where key in ('biz_invoice_request','billing_records','biz_sales_contract');
update public.retention_policy set mode = 'keep' where key = 'confirmations';
update public.retention_policy set mode = 'keep',
  note = '보관기간 미정 — 질문 본문에 의뢰인 개인정보가 섞일 수 있어 별도 판단이 필요하다.'
 where key = 'consultations';

update public.retention_policy set mode = 'row', where_sql = 'at < {cutoff}'
 where key in ('login_attempt','access_log');
update public.retention_policy set mode = 'row',
  where_sql = 'left_at is not null and left_at < {cutoff}',
  note = '퇴사·이직으로 무효가 된 연락처는 남길 이유가 없다. 유효한 담당자는 대상이 아니다.'
 where key = 'biz_contact';

-- ── 개인정보 그 자체 — 목적을 다했으면 지운다 ────────────
-- **종료 시점을 모르면 파기하지 않는다.** coalesce(status_month,'1900-01') 로 두면
-- 종료월이 비어 있는 것이 곧바로 파기 대상이 된다 — 언제 끝났는지 모르는 것을
-- 기한 경과로 단정하면 안 된다. 모를 때는 남기고, 사람이 종료월을 채우면 그때 대상이 된다.
insert into public.retention_policy
  (key, label, table_name, date_col, months, basis, destroy_ok, mode, pii_cols, where_sql, note) values
 ('resident_entity','주민등록번호 (개인 거래처)','biz_entity','created_at',60,
  '개인정보 보호법 제21조제1항 — 목적 달성. 국세기본법 제85조의3제2항의 5년이 지난 뒤',
  true,'columns', array['resident_no_enc'],
  $w$resident_no_enc is not null
     and not exists (select 1 from public.biz_place p where p.entity_id = biz_entity.id and p.status = '정상')
     and (select max(p.status_month) from public.biz_place p where p.entity_id = biz_entity.id) is not null
     and (select max(p.status_month) from public.biz_place p where p.entity_id = biz_entity.id)
         < to_char({cutoff}::date, 'YYYY-MM')$w$,
  '거래 중인 사업장이 하나도 없고, 마지막 종료·폐업·이관으로부터 5년이 지난 거래처만. 거래처 자체는 남고 주민번호 칸만 비운다. 종료월이 비어 있으면 대상이 아니다 — 언제 끝났는지 모르는 것을 기한 경과로 단정하지 않는다.'),
 ('resident_rep','주민등록번호 (법인 대표자)','biz_representative','created_at',60,
  '개인정보 보호법 제21조제1항 — 목적 달성. 국세기본법 제85조의3제2항의 5년이 지난 뒤',
  true,'columns', array['resident_no_enc'],
  $w$resident_no_enc is not null
     and not exists (select 1 from public.biz_place p where p.entity_id = biz_representative.entity_id and p.status = '정상')
     and (select max(p.status_month) from public.biz_place p where p.entity_id = biz_representative.entity_id) is not null
     and (select max(p.status_month) from public.biz_place p where p.entity_id = biz_representative.entity_id)
         < to_char({cutoff}::date, 'YYYY-MM')$w$,
  '대표자 기록은 남고 주민번호 칸만 비운다. 종료월이 비어 있으면 대상이 아니다.'),
 ('hometax_pw','홈택스 비밀번호','biz_place','created_at',12,
  '개인정보 보호법 제21조제1항 — 목적 달성(거래가 끝나면 쓸 일이 없다)',
  true,'columns', array['hometax_pw_enc'],
  $w$hometax_pw_enc is not null and status <> '정상'
     and status_month is not null and status_month < to_char({cutoff}::date, 'YYYY-MM')$w$,
  '거래 종료 후 1년. 사업장 정보는 남고 비밀번호만 비운다. 정정신고 등 뒷정리 기간을 감안한 1년이다. 종료월이 비어 있으면 대상이 아니다.')
on conflict (key) do update set
  label = excluded.label, table_name = excluded.table_name, date_col = excluded.date_col,
  months = excluded.months, basis = excluded.basis, destroy_ok = excluded.destroy_ok,
  mode = excluded.mode, pii_cols = excluded.pii_cols, where_sql = excluded.where_sql,
  note = excluded.note, updated_at = now();

-- ── 현황·파기 함수 (mode 반영) ──────────────────────────
drop function if exists public.retention_survey();
create or replace function public.retention_survey()
returns table(key text, label text, table_name text, months integer, basis text,
              destroy_ok boolean, mode text, pii_cols text[], note text,
              cutoff date, due bigint, total bigint)
language plpgsql stable security definer set search_path = public as $fn$
declare p record; v_cut date; v_due bigint; v_tot bigint; v_where text;
begin
  if not coalesce((select role = 'superuser' from public.profiles where id = auth.uid()), false) then
    raise exception '보존·파기 현황을 볼 권한이 없습니다'; end if;
  -- 반환 컬럼 이름(mode 등)과 표의 컬럼이 겹치므로 **반드시 별칭으로 가리킨다**.
  for p in select rp.* from public.retention_policy rp
            order by (rp.mode = 'keep'), rp.months, rp.key loop
    v_cut := (current_date - make_interval(months => p.months))::date;
    execute format('select count(*) from public.%I', p.table_name) into v_tot;
    if p.mode = 'keep' or p.where_sql is null then
      v_due := 0;
    else
      v_where := replace(p.where_sql, '{cutoff}', quote_literal(v_cut));
      execute format('select count(*) from public.%I where %s', p.table_name, v_where) into v_due;
    end if;
    key := p.key; label := p.label; table_name := p.table_name; months := p.months;
    basis := p.basis; destroy_ok := p.destroy_ok; mode := p.mode; pii_cols := p.pii_cols;
    note := p.note; cutoff := v_cut; due := v_due; total := v_tot;
    return next;
  end loop;
end $fn$;

create or replace function public.retention_purge(p_key text, p_reason text)
returns integer language plpgsql volatile security definer set search_path = public as $fn$
declare p record; v_cut date; v_n integer; v_uid uuid := auth.uid(); v_name text;
        v_where text; v_set text; v_method text;
begin
  if not coalesce((select role = 'superuser' from public.profiles where id = v_uid), false) then
    raise exception '파기 권한이 없습니다 — 개인정보 보호책임자만 할 수 있습니다'; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception '파기 사유를 적어야 합니다 (파기 이력에 남습니다)'; end if;
  select * into p from public.retention_policy where key = p_key;
  if p is null then raise exception '알 수 없는 보존정책입니다: %', p_key; end if;
  if not p.destroy_ok then
    raise exception '이 자료는 시스템에서 파기할 수 없습니다 — %', p.basis; end if;
  if p.mode = 'keep' then
    raise exception '이 자료는 영구보관으로 정해져 있습니다 — 파기 대상이 아닙니다'; end if;
  if p.where_sql is null then raise exception '대상 조건이 없습니다: %', p_key; end if;

  v_cut := (current_date - make_interval(months => p.months))::date;
  v_where := replace(p.where_sql, '{cutoff}', quote_literal(v_cut));

  if p.mode = 'columns' then
    -- 일부 파기 — 개인정보 열만 비운다(안전성 확보조치 기준 제13조제2항제1호).
    select string_agg(format('%I = null', c), ', ') into v_set from unnest(p.pii_cols) c;
    if v_set is null then raise exception '비울 열이 지정되지 않았습니다: %', p_key; end if;
    execute format('update public.%I set %s where %s', p.table_name, v_set, v_where);
    v_method := format('열 비우기(%s) — 복원 불가', array_to_string(p.pii_cols, ', '));
  else
    execute format('delete from public.%I where %s', p.table_name, v_where);
    v_method := '행 삭제 — 복원 불가';
  end if;
  get diagnostics v_n = row_count;

  select name into v_name from public.profiles where id = v_uid;
  insert into public.purge_log (actor_id, actor_name, policy_key, table_name, cutoff, deleted, reason, method)
  values (v_uid, v_name, p.key, p.table_name, v_cut, v_n, p_reason, v_method);
  perform public.log_access('purge', p.table_name, null, null, p_reason,
                            jsonb_build_object('count', v_n, 'cutoff', v_cut, 'policy', p.key, 'method', v_method));
  return v_n;
end $fn$;

revoke all on function public.retention_survey() from public, anon;
revoke all on function public.retention_purge(text, text) from public, anon;
grant execute on function public.retention_survey() to authenticated;
grant execute on function public.retention_purge(text, text) to authenticated;
