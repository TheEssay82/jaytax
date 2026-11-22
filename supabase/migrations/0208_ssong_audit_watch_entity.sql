-- 0208 쏭비서 audit_watch — 일정·감사이슈에 거래처 id(entityId) 붙이기
--
-- 아침 브리핑 「판단 필요 감사이슈」를 1주 안에 감사 일정이 있는 회사 것만 보이게(대표님 2026-11-22).
-- 일정(audit_schedule_item.entity_id)과 이슈(dsd_engagement.entity_id)를 둘 다 biz_entity id 로 맞춘다.
-- 이름이 같아도 다르게 적힌 경우가 있어 회사 이름으로는 맞추지 않는다. 키만 더하는 것이라 기존 호출은 그대로.
create or replace function public.ssong_q_audit_watch(p_from date, p_days int)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'schedule', jsonb_build_object(
      'from', p_from, 'to', p_from + p_days - 1,
      'days', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'company', i.company, 'entityId', i.entity_id, 'kind', i.kind, 'task', i.task,
                 'staff', i.staff, 'mark', nullif(d.mark, ''), 'confirmed', i.confirmed) order by d.day, i.sort), '[]')
               from audit_schedule_day d join audit_schedule_item i on i.id = d.item_id
               where d.day between p_from and p_from + p_days - 1)),
    'confirmationsOutstanding', (select coalesce(jsonb_agg(x order by x->>'oldestSent'), '[]') from (
        select jsonb_build_object('company', c.company_name, 'fiscalYear', c.fiscal_year, 'accountant', c.accountant_name,
               'sent', count(*) filter (where it.sent), 'notCollected', count(*) filter (where it.sent and coalesce(it.collect_status, '') <> '회수완료'),
               'notSent', count(*) filter (where not coalesce(it.sent, false)),
               'oldestSent', min(it.sent_date) filter (where it.sent and coalesce(it.collect_status, '') <> '회수완료'),
               'institutions', jsonb_agg(it.institution) filter (where it.sent and coalesce(it.collect_status, '') <> '회수완료')) x
          from confirmations c join confirmation_items it on it.confirmation_id = c.id
         group by c.id, c.company_name, c.fiscal_year, c.accountant_name
        having count(*) filter (where (it.sent and coalesce(it.collect_status, '') <> '회수완료') or not coalesce(it.sent, false)) > 0) q),
    'openIssues', (select coalesce(jsonb_agg(jsonb_build_object('company', e.name, 'entityId', e.id, 'fy', g.fy, 'no', a.no, 'title', a.title,
                     'importance', a.importance, 'category', a.category, 'status', a.status, 'decisionNeeded', a.decision_needed,
                     'dueStage', a.due_stage, 'staff', a.our_staff) order by e.name, a.no), '[]')
                   from audit_issue a join dsd_engagement g on g.id = a.engagement_id join biz_entity e on e.id = g.entity_id
                   where a.closed_at is null and not coalesce(g.is_demo, false))
  )
$$;

-- 0150: PUBLIC EXECUTE 회수 (create or replace 는 권한을 유지하지만 확실히)
revoke all on function public.ssong_q_audit_watch(date,int) from public, anon, authenticated;
