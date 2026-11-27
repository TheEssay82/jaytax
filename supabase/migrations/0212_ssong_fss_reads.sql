-- 0212 쏭비서 — 금감원 회계업무자료(fss_docs) 읽기 2개 (인계 5단계, 2026-11-28).
--   ssong_fss_updates : 기간 안에 금감원에 **새로 등록된**(reg_date) 자료 목록 — 아침 브리핑 · fss_updates 도구.
--                       백필로 오늘 들어온 옛 자료는 등록일이 오래돼 걸리지 않는다.
--   ssong_fss_search  : 낱말(공백 = 모두 포함) · 종류 · 관련기준서 · 등록일로 찾기, 본문 앞 300자 — fss_search 도구.
-- 공개자료라 마스킹 없음. 다른 쏭비서 함수와 같이 열쇠 확인(ssong_require) + 접속기록(ssong_log).
-- 속 함수(ssong_q_fss_*)는 아무도 직접 못 부른다 — 시험은 postgres 로.

create or replace function public.ssong_q_fss_updates(p_from date, p_to date, p_api text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'count', (select count(*) from fss_docs c
               where (c.reg_date at time zone 'Asia/Seoul')::date between p_from and p_to
                 and (p_api is null or c.api = p_api)),
    'byKind', coalesce((select jsonb_object_agg(api, n) from (
        select d2.api, count(*) n from fss_docs d2
         where (d2.reg_date at time zone 'Asia/Seoul')::date between p_from and p_to
           and (p_api is null or d2.api = p_api) group by d2.api) k), '{}'::jsonb),
    'items', coalesce(jsonb_agg(jsonb_build_object(
        'kind', d.api, 'subject', d.subject,
        'regDate', to_char(d.reg_date at time zone 'Asia/Seoul', 'YYYY-MM-DD'),
        'relStand', d.rel_stand, 'issRealm', d.iss_realm, 'url', d.origin_url,
        'attachments', jsonb_array_length(d.attachments))
      order by d.reg_date desc) filter (where d.api is not null), '[]'::jsonb))
  from (select * from fss_docs
         where (reg_date at time zone 'Asia/Seoul')::date between p_from and p_to
           and (p_api is null or api = p_api)
         order by reg_date desc limit 50) d
$$;

create or replace function public.ssong_q_fss_search(p_q text, p_api text, p_rel_stand text, p_from date, p_to date, p_limit int)
returns jsonb language sql stable security definer set search_path = public as $$
  with terms as (
    select t from unnest(regexp_split_to_array(btrim(regexp_replace(coalesce(p_q, ''), '[%_\\]', ' ', 'g')), '\s+')) t
     where length(t) >= 1 limit 5
  )
  select jsonb_build_object(
    'total', (select count(*) from fss_docs),
    'items', coalesce(jsonb_agg(x order by x->>'regDate' desc nulls last), '[]'::jsonb))
  from (
    select jsonb_build_object(
        'kind', d.api, 'subject', d.subject,
        'regDate', to_char(d.reg_date at time zone 'Asia/Seoul', 'YYYY-MM-DD'),
        'relStand', d.rel_stand, 'issRealm', d.iss_realm, 'decisionYear', d.dcsn_yr,
        'url', d.origin_url, 'attachments', d.attachments,
        'bodyHead', left(coalesce(d.body_text, ''), 300)) x
      from fss_docs d
     where (p_api is null or d.api = p_api)
       and (coalesce(btrim(p_rel_stand), '') = '' or d.rel_stand ilike '%' || btrim(p_rel_stand) || '%')
       and (p_from is null or (d.reg_date at time zone 'Asia/Seoul')::date >= p_from)
       and (p_to is null or (d.reg_date at time zone 'Asia/Seoul')::date <= p_to)
       and not exists (select 1 from terms
                        where (d.subject || ' ' || coalesce(d.rel_stand, '') || ' ' || coalesce(d.iss_realm, '') || ' ' || coalesce(d.body_text, ''))
                              not ilike '%' || terms.t || '%')
     order by d.reg_date desc nulls last
     limit least(greatest(coalesce(p_limit, 10), 1), 30)
  ) t
$$;

create or replace function public.ssong_fss_updates(p_from date default null, p_to date default null, p_api text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_to date := coalesce(p_to, (now() at time zone 'Asia/Seoul')::date);
        v_from date := coalesce(p_from, v_to - 7);
begin
  perform public.ssong_require();
  if v_to - v_from > 92 then raise exception '기간은 석 달 이내로 주세요'; end if;
  perform public.ssong_log('ssong_read', 'fss_docs', null, null, 'fss_updates', jsonb_build_object('from', v_from, 'to', v_to, 'api', p_api));
  return public.ssong_q_fss_updates(v_from, v_to, p_api);
end $$;

create or replace function public.ssong_fss_search(p_q text default null, p_api text default null, p_rel_stand text default null,
                                                   p_from date default null, p_to date default null, p_limit int default 10)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.ssong_require();
  perform public.ssong_log('ssong_read', 'fss_docs', null, null, 'fss_search', jsonb_build_object('q', p_q, 'api', p_api, 'rel_stand', p_rel_stand));
  return public.ssong_q_fss_search(p_q, p_api, p_rel_stand, p_from, p_to, p_limit);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'ssong_q_fss_updates(date,date,text)', 'ssong_q_fss_search(text,text,text,date,date,int)',
    'ssong_fss_updates(date,date,text)', 'ssong_fss_search(text,text,text,date,date,int)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function public.ssong_fss_updates(date,date,text) to anon;
grant execute on function public.ssong_fss_search(text,text,text,date,date,int) to anon;
