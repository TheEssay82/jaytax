-- 0188 보존기한 · 파기 — 파기 대상이 **어느 거래처 · 누구인지** 펼쳐 보기.
--
-- 사용자 2026-11-09 「첨부내용이 어느거래처인지 알 수 없나요?」 — 화면에 건수만 있어
-- 홈택스 비밀번호 3건이 누구 것인지 따로 조회해야 했다. 파기는 되돌릴 수 없으니 누르기 전에 볼 수 있어야 한다.
--
-- 대상 조건은 retention_survey · retention_purge 와 **같은 where_sql** 을 쓴다(셈이 갈라지지 않게).
-- 보여 주는 것은 알아보는 데 필요한 것뿐이다 — 거래처 코드 · 이름 · 사업장 · 상태 · 날짜.
-- 비밀번호 · 주민번호 같은 파기 대상 값 자체는 내놓지 않는다.
create or replace function public.retention_due_list(p_key text)
returns table(label text, detail text, at text)
language plpgsql stable security definer set search_path = public as $fn$
declare p record; v_cut date; v_where text; v_sel text;
begin
  if not coalesce((select role = 'superuser' from public.profiles where id = auth.uid()), false) then
    raise exception '보존·파기 대상을 볼 권한이 없습니다'; end if;
  select * into p from public.retention_policy rp where rp.key = p_key;
  if p is null then raise exception '알 수 없는 보존정책입니다: %', p_key; end if;
  if p.mode = 'keep' or p.where_sql is null then return; end if;
  v_cut := (current_date - make_interval(months => p.months))::date;
  v_where := replace(p.where_sql, '{cutoff}', quote_literal(v_cut));

  -- 표마다 「알아볼 이름」이 다르다. 모르는 표는 id 만.
  v_sel := case p.table_name
    when 'biz_place' then
      $s$(select e.code || ' ' || e.name from public.biz_entity e where e.id = t.entity_id),
         coalesce(t.place_name, '') || ' · ' || coalesce(t.status, '') || coalesce(' ' || t.status_month, ''),
         coalesce(t.status_month, '')$s$
    when 'biz_entity' then
      $s$t.code || ' ' || t.name, coalesce(t.kind, ''), to_char(t.created_at, 'YYYY-MM-DD')$s$
    when 'biz_representative' then
      $s$(select e.code || ' ' || e.name from public.biz_entity e where e.id = t.entity_id),
         '대표자 ' || coalesce(t.rep_name, ''), to_char(t.created_at, 'YYYY-MM-DD')$s$
    when 'biz_contact' then
      $s$(select e.code || ' ' || e.name from public.biz_entity e where e.id = t.entity_id),
         coalesce(t.contact_name, '') || coalesce(' · ' || t.position, ''), coalesce(t.left_at::text, '')$s$
    when 'login_attempt' then
      $s$coalesce(t.email, ''), (case when t.ok then '성공' else '실패' end)::text, to_char(t.at, 'YYYY-MM-DD HH24:MI')$s$
    when 'access_log' then
      $s$coalesce(t.actor_name, ''), coalesce(t.action, '') || coalesce(' · ' || t.target, ''), to_char(t.at, 'YYYY-MM-DD HH24:MI')$s$
    else
      $s$t.id::text, ''::text, ''::text$s$
  end;
  -- where_sql 은 표 이름으로 열을 가리킨다(biz_entity.id) — 별칭을 표 이름과 같게 둔다.
  v_sel := regexp_replace(v_sel, '\mt\.', p.table_name || '.', 'g');
  return query execute format(
    'select %s from public.%I as %I where %s order by 1, 3 limit 300', v_sel, p.table_name, p.table_name, v_where);
end $fn$;

revoke all on function public.retention_due_list(text) from public, anon;
grant execute on function public.retention_due_list(text) to authenticated;
