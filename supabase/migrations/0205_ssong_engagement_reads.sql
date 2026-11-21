-- 0205: 쏭비서 읽기 도구 넓히기 — 감사 업무 진행(거래처·연도별)과 상담 이력(대표님 2026-11-21)
--
-- engagement_status: 감사 건(dsd_engagement)마다 일반조서 단계·조서 확인 수, 주석·DSD 주석 상태,
--                    JET(분개장·선정·증빙요청·회신·결과), 감사이슈(미결·판단 필요)를 한 줄로.
-- consult_history:  자문 상담 이력 — 제목·거래처·태그·날짜만(질문·답 본문은 주지 않는다).
-- 읽기만, 시연용(is_demo) 제외. 열쇠 확인·접속기록은 0200 과 같은 방식. 함수는 PUBLIC EXECUTE 부터 회수(0150).

create or replace function public.ssong_q_engagements(p_q text, p_fy int)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'fy' desc, x->>'company'), '[]'::jsonb) from (
    select jsonb_build_object(
      'company', b.name, 'fy', e.fy, 'scope', e.scope, 'status', e.status, 'periodTo', e.period_to,
      'workpapers', (select jsonb_build_object(
          'stage', y.stage, 'basis', y.audit_basis, 'partner', y.partner,
          'papers', (select count(*) from gwp_paper p where p.engagement_id = e.id),
          'checked', (select count(*) from gwp_paper p where p.engagement_id = e.id and p.status = '확인'),
          'drafting', (select count(*) from gwp_paper p where p.engagement_id = e.id and p.status is distinct from '확인'),
          'bookVersion', (select max(k.version) from gwp_book k where k.engagement_id = e.id),
          'lastEvent', (select jsonb_build_object('stage', s.stage, 'action', s.action, 'at', s.created_at)
                          from gwp_stage_event s where s.engagement_id = e.id order by s.created_at desc limit 1))
        from gwp_year y where y.engagement_id = e.id),
      'notes', (select jsonb_build_object('total', coalesce(sum(n), 0), 'byStatus', coalesce(jsonb_object_agg(st, n), '{}'::jsonb))
                  from (select coalesce(n.status, '미정') st, count(*) n from dsd_note n
                         where n.engagement_id = e.id and n.enabled group by 1) q),
      'jet', (select jsonb_build_object(
          'materiality', j.materiality, 'preparer', j.preparer, 'reviewer', j.reviewer,
          'journal', (select jsonb_build_object('lines', u.lines, 'from', u.date_from, 'to', u.date_to)
                        from je_upload u where u.engagement_id = e.id and u.kind = 'journal' and u.current limit 1),
          'selected', (select count(*) from je_pick k where k.engagement_id = e.id and k.selected),
          'requested', (select count(*) from je_pick k where k.engagement_id = e.id and k.selected and k.requested_at is not null),
          'replied', (select count(*) from je_pick k where k.engagement_id = e.id and k.selected and k.replied_at is not null),
          'concluded', (select count(*) from je_pick k where k.engagement_id = e.id and k.selected and coalesce(k.result, '') <> ''))
        from je_job j where j.engagement_id = e.id),
      'issues', (select jsonb_build_object('open', count(*) filter (where a.closed_at is null),
                        'decisionNeeded', count(*) filter (where a.closed_at is null and a.decision_needed),
                        'high', count(*) filter (where a.closed_at is null and a.importance = '높음'))
                   from audit_issue a where a.engagement_id = e.id),
      'updatedAt', greatest(e.updated_at,
          (select max(p.updated_at) from gwp_paper p where p.engagement_id = e.id),
          (select max(n.updated_at) from dsd_note n where n.engagement_id = e.id),
          (select max(k.updated_at) from je_pick k where k.engagement_id = e.id),
          (select max(a.updated_at) from audit_issue a where a.engagement_id = e.id))
    ) x
    from dsd_engagement e join biz_entity b on b.id = e.entity_id
    where not coalesce(e.is_demo, false)
      and (p_fy is null or e.fy = p_fy)
      and (coalesce(btrim(p_q), '') = '' or b.name ilike '%' || btrim(p_q) || '%')
    order by e.fy desc, b.name
    limit 60
  ) t
$$;

create or replace function public.ssong_q_consults(p_q text, p_limit int)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'createdAt' desc), '[]'::jsonb) from (
    select jsonb_build_object('title', c.title, 'client', c.client_name, 'tags', c.tags, 'status', c.status,
                              'createdAt', c.created_at, 'finalizedAt', c.finalized_at) x
      from consultations c
     where coalesce(btrim(p_q), '') = ''
        or c.title ilike '%' || btrim(p_q) || '%' or c.client_name ilike '%' || btrim(p_q) || '%'
        or exists (select 1 from unnest(c.tags) t where t ilike '%' || btrim(p_q) || '%')
     order by c.created_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) t
$$;

create or replace function public.ssong_engagement_status(p_q text default null, p_fy int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.ssong_require();
  perform public.ssong_log('ssong_read', 'engagement_status', null, null, 'engagement_status', jsonb_build_object('q', p_q, 'fy', p_fy));
  return public.ssong_q_engagements(p_q, p_fy);
end $$;

create or replace function public.ssong_consult_history(p_q text default null, p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.ssong_require();
  perform public.ssong_log('ssong_read', 'consultations', null, null, 'consult_history', jsonb_build_object('q', p_q));
  return public.ssong_q_consults(p_q, p_limit);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'ssong_q_engagements(text,int)', 'ssong_q_consults(text,int)',
    'ssong_engagement_status(text,int)', 'ssong_consult_history(text,int)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function public.ssong_engagement_status(text,int) to anon;
grant execute on function public.ssong_consult_history(text,int)   to anon;
