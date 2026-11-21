-- 0202 쏭비서 읽기 도구 — 보고·집계 (2026-11-21)
--
-- 대표님 「jaytax 읽기도구 늘리기 — 다섯 개로 시작, 거래처별 금액까지」.
-- 네 함수(오늘 생긴 일 · 매출 · 청구/미수 · 감사)를 둔다. 다섯째 about_jaytax 는 DB 가 아니라
-- 커넥터가 앱 소스(메뉴·개발노트·백로그)에서 만든 지도를 돌려준다.
--
-- 구조: 실제 집계는 ssong_q_*(내부, 아무도 직접 못 부름) — 열쇠 확인·접속기록은 ssong_*(anon) 이
-- 감싼다. 내부 함수를 따로 둔 것은 열쇠 없이도 DB 에서 결과를 시험해 볼 수 있게 하려는 것.
--
-- 지키는 것: 읽기만. 전화·주소·이메일·주민/사업자번호는 돌려주지 않는다(거래처명·금액은 대표님이 허락).
-- 시연용(is_demo) 거래처는 뺀다. 정산연도는 fiscalYear.ts 와 같은 규칙 — 7월 이후면 그해, 아니면 전년.

create or replace function public.ssong_fy_of(d date) returns int
language sql immutable as $$ select case when extract(month from d) >= 7 then extract(year from d)::int else extract(year from d)::int - 1 end $$;

-- ── 1. 오늘(기간) 생긴 일 ───────────────────────────────
create or replace function public.ssong_q_daily_digest(p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = public as $$
  with r as (select (p_from::timestamp at time zone 'Asia/Seoul') a, ((p_to + 1)::timestamp at time zone 'Asia/Seoul') b)
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'newContracts', (select coalesce(jsonb_agg(jsonb_build_object(
        'company', e.name, 'code', c.contract_code, 'team', c.team, 'category', c.category_code,
        'amount', c.amount, 'confirmed', c.confirmed, 'cpa', c.cpa, 'at', c.created_at) order by c.created_at), '[]')
      from biz_sales_contract c join biz_entity e on e.id = c.entity_id, r
      where c.created_at >= r.a and c.created_at < r.b and not coalesce(e.is_demo, false)),
    'docSends', (select coalesce(jsonb_agg(jsonb_build_object(
        'company', d.company_name, 'kind', d.send_kind, 'docName', d.doc_name, 'status', d.status,
        'requester', d.requester, 'trackingNo', d.tracking_no, 'sentDate', d.sent_date, 'updatedAt', d.updated_at) order by d.updated_at), '[]')
      from doc_send_requests d, r
      where d.deleted_at is null and (d.created_at >= r.a or d.updated_at >= r.a) and least(d.created_at, d.updated_at) < r.b),
    'invoicesIssued', (select coalesce(jsonb_agg(jsonb_build_object(
        'company', i.company_name, 'team', i.team, 'supply', i.supply_amount, 'total', i.total,
        'status', i.status, 'invoiceNo', i.invoice_no, 'issuedDate', i.issued_date, 'cpa', i.cpa) order by i.issued_date), '[]')
      from biz_invoice_request i where i.issued_date between p_from and p_to and i.status in ('발행완료', '수정발행')),
    'invoiceRequestsNew', (select count(*) from biz_invoice_request i, r where i.created_at >= r.a and i.created_at < r.b),
    'receipts', (select coalesce(jsonb_agg(jsonb_build_object(
        'company', x.client_name, 'team', x.team, 'amount', x.amount, 'paidDate', x.paid_date) order by x.paid_date), '[]')
      from biz_receipt x where x.paid_date between p_from and p_to and not coalesce(x.excluded, false)),
    'confirmationsCollected', (select coalesce(jsonb_agg(jsonb_build_object(
        'company', c.company_name, 'institution', it.institution, 'kind', it.kind, 'collectDate', it.collect_date)), '[]')
      from confirmation_items it join confirmations c on c.id = it.confirmation_id
      where it.collect_date between p_from and p_to),
    'auditIssues', (select coalesce(jsonb_agg(jsonb_build_object(
        'company', e.name, 'no', a.no, 'title', a.title, 'importance', a.importance, 'status', a.status,
        'decisionNeeded', a.decision_needed, 'updatedAt', a.updated_at)), '[]')
      from audit_issue a join dsd_engagement g on g.id = a.engagement_id join biz_entity e on e.id = g.entity_id, r
      where (a.created_at >= r.a or a.updated_at >= r.a) and least(a.created_at, a.updated_at) < r.b
        and not coalesce(g.is_demo, false)),
    'ssongDecisions', (select coalesce(jsonb_agg(jsonb_build_object(
        'title', s.title, 'status', s.status, 'by', s.decided_by_name, 'note', s.decision_note, 'at', s.decided_at)), '[]')
      from ssong_requests s, r where s.decided_at >= r.a and s.decided_at < r.b)
  )
$$;

-- ── 2. 매출 — 계약 · 발행 실적 · 과거 실적, 거래처별 ─────
create or replace function public.ssong_q_revenue_summary(p_year int, p_team text)
returns jsonb language sql stable security definer set search_path = public as $$
  with con as (
    select c.team, e.name company, c.category_code, c.amount, c.confirmed, c.billing_cycle, c.cpa, c.start_date, c.end_date
      from biz_sales_contract c join biz_entity e on e.id = c.entity_id
     where not coalesce(e.is_demo, false) and (p_team is null or c.team = p_team)
       -- 그 정산연도에 걸쳐 있는 계약: 귀속연도가 그 해이거나, 기간이 그 해(7/1~익년 6/30)와 겹친다
       and (c.fiscal_year = p_year
            or (c.fiscal_year is null
                and coalesce(c.start_date, date '1900-01-01') <= make_date(p_year + 1, 6, 30)
                and coalesce(c.end_date, date '9999-12-31') >= make_date(p_year, 7, 1)))
  ), inv as (
    select i.team, coalesce(i.company_name, e.name) company, i.supply_amount
      from biz_invoice_request i left join biz_entity e on e.id = i.entity_id
     where i.status in ('발행완료', '수정발행') and i.issued_date is not null
       and public.ssong_fy_of(i.issued_date) = p_year and (p_team is null or i.team = p_team)
  ), act as (
    select a.team, a.entity_name company, a.amount from biz_revenue_actual a
     where a.settlement_year = p_year and (p_team is null or a.team = p_team)
  )
  select jsonb_build_object(
    'fiscalYear', p_year, 'period', jsonb_build_object('from', make_date(p_year, 7, 1), 'to', make_date(p_year + 1, 6, 30)),
    'team', coalesce(p_team, '전체'),
    'notes', jsonb_build_array(
      'contracts: 그 정산연도에 걸친 매출계약의 계약금액(월 청구 계약은 1회분 금액 — 연간 환산 아님, billingCycle 참고).',
      'issued: 그 정산연도에 발행된 세금계산서 공급가액(수정발행 음수 포함).',
      'actual: 결산 확정 실적(biz_revenue_actual). 확정 전 연도는 비어 있다.',
      '예측·월할 같은 계산은 JAYTAX 「현황및예산조회·매출통계」 화면 기준이 정본이다.'),
    'contracts', jsonb_build_object(
      'byTeam', (select coalesce(jsonb_object_agg(team, jsonb_build_object('count', n, 'amount', amt, 'unconfirmed', un)), '{}')
                 from (select team, count(*) n, sum(amount) amt, count(*) filter (where not confirmed) un from con group by team) t),
      'byCompany', (select coalesce(jsonb_agg(jsonb_build_object('company', company, 'team', team, 'category', category_code,
                     'amount', amount, 'cycle', billing_cycle, 'confirmed', confirmed, 'cpa', cpa) order by amount desc), '[]') from con)),
    'issued', jsonb_build_object(
      'byTeam', (select coalesce(jsonb_object_agg(team, amt), '{}') from (select team, sum(supply_amount) amt from inv group by team) t),
      'byCompany', (select coalesce(jsonb_agg(jsonb_build_object('company', company, 'team', team, 'supply', amt) order by amt desc), '[]')
                    from (select company, team, sum(supply_amount) amt from inv group by company, team) t)),
    'actual', jsonb_build_object(
      'byTeam', (select coalesce(jsonb_object_agg(team, amt), '{}') from (select team, sum(amount) amt from act group by team) t),
      'byCompany', (select coalesce(jsonb_agg(jsonb_build_object('company', company, 'team', team, 'amount', amt) order by amt desc), '[]')
                    from (select company, team, sum(amount) amt from act group by company, team) t))
  )
$$;

-- ── 3. 청구·미수 ────────────────────────────────────────
create or replace function public.ssong_q_billing_watch(p_ym text, p_min_days int)
returns jsonb language sql stable security definer set search_path = public as $$
  with ar_ym as (select max(ym) ym from biz_ar_item),
  ar as (
    select a.team, a.client_name, a.balance, a.issued_date, a.cpa, a.invoice_no, a.kind,
           (current_date - a.issued_date) age
      from biz_ar_item a, ar_ym where a.ym = ar_ym.ym and not coalesce(a.excluded, false) and a.balance <> 0
  )
  select jsonb_build_object(
    'month', p_ym,
    'invoiceRequests', jsonb_build_object(
      'byStatus', (select coalesce(jsonb_object_agg(status, jsonb_build_object('count', n, 'supply', amt)), '{}')
                   from (select status, count(*) n, sum(supply_amount) amt from biz_invoice_request where ym = p_ym group by status) t),
      'byTeam', (select coalesce(jsonb_object_agg(team, jsonb_build_object('count', n, 'supply', amt)), '{}')
                 from (select team, count(*) n, sum(supply_amount) amt from biz_invoice_request
                        where ym = p_ym and status in ('발행완료', '수정발행') group by team) t),
      'waiting', (select coalesce(jsonb_agg(jsonb_build_object('company', company_name, 'team', team, 'supply', supply_amount,
                    'requestedAt', requested_at, 'cpa', cpa)), '[]')
                  from biz_invoice_request where ym = p_ym and status = '요청'),
      'monthClosed', (select final_confirmed_at from biz_invoice_month where ym = p_ym)),
    'receivables', jsonb_build_object(
      'asOfLedger', (select ym from ar_ym),
      'note', '미수금은 매월 올리는 ERP 미수금대장 기준이다(asOfLedger 월말). 그 뒤 수금은 반영 전일 수 있다.',
      'totalByTeam', (select coalesce(jsonb_object_agg(team, amt), '{}') from (select team, sum(balance) amt from ar group by team) t),
      'overdue', (select coalesce(jsonb_agg(jsonb_build_object('company', client_name, 'team', team, 'balance', balance,
                    'issuedDate', issued_date, 'days', age, 'cpa', cpa, 'kind', kind) order by age desc nulls last), '[]')
                  from ar where age >= p_min_days),
      'byCompany', (select coalesce(jsonb_agg(jsonb_build_object('company', client_name, 'team', team, 'balance', amt,
                      'oldest', oldest) order by amt desc), '[]')
                    from (select client_name, team, sum(balance) amt, min(issued_date) oldest from ar group by client_name, team) t))
  )
$$;

-- ── 4. 감사 — 일정 · 조회서 미회수 · 미결 이슈 ──────────
create or replace function public.ssong_q_audit_watch(p_from date, p_days int)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'schedule', jsonb_build_object(
      'from', p_from, 'to', p_from + p_days - 1,
      'days', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'company', i.company, 'kind', i.kind, 'task', i.task,
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
    'openIssues', (select coalesce(jsonb_agg(jsonb_build_object('company', e.name, 'fy', g.fy, 'no', a.no, 'title', a.title,
                     'importance', a.importance, 'category', a.category, 'status', a.status, 'decisionNeeded', a.decision_needed,
                     'dueStage', a.due_stage, 'staff', a.our_staff) order by e.name, a.no), '[]')
                   from audit_issue a join dsd_engagement g on g.id = a.engagement_id join biz_entity e on e.id = g.entity_id
                   where a.closed_at is null and not coalesce(g.is_demo, false))
  )
$$;

-- ── 쏭비서가 부르는 겉 함수(열쇠 확인 + 접속기록) ────────
create or replace function public.ssong_daily_digest(p_from date default null, p_to date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_to date := coalesce(p_to, (now() at time zone 'Asia/Seoul')::date);
        v_from date := coalesce(p_from, v_to - 1);
begin
  perform public.ssong_require();
  if v_to - v_from > 62 then raise exception '기간은 두 달 안으로 잡아 주세요'; end if;
  perform public.ssong_log('ssong_read', 'daily_digest', null, null, 'daily_digest', jsonb_build_object('from', v_from, 'to', v_to));
  return public.ssong_q_daily_digest(v_from, v_to);
end $$;

create or replace function public.ssong_revenue_summary(p_year int default null, p_team text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_year int := coalesce(p_year, public.ssong_fy_of((now() at time zone 'Asia/Seoul')::date));
begin
  perform public.ssong_require();
  if p_team is not null and p_team not in ('감사team', 'taxteam') then raise exception 'team 은 감사team 또는 taxteam'; end if;
  perform public.ssong_log('ssong_read', 'revenue_summary', null, null, 'revenue_summary', jsonb_build_object('year', v_year, 'team', p_team));
  return public.ssong_q_revenue_summary(v_year, p_team);
end $$;

create or replace function public.ssong_billing_watch(p_ym text default null, p_min_days int default 90)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ym text := coalesce(p_ym, to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM'));
begin
  perform public.ssong_require();
  if v_ym !~ '^\d{4}-\d{2}$' then raise exception 'ym 은 YYYY-MM'; end if;
  perform public.ssong_log('ssong_read', 'billing_watch', null, null, 'billing_watch', jsonb_build_object('ym', v_ym, 'minDays', p_min_days));
  return public.ssong_q_billing_watch(v_ym, greatest(coalesce(p_min_days, 90), 0));
end $$;

create or replace function public.ssong_audit_watch(p_from date default null, p_days int default 7)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_from date := coalesce(p_from, (now() at time zone 'Asia/Seoul')::date);
begin
  perform public.ssong_require();
  perform public.ssong_log('ssong_read', 'audit_watch', null, null, 'audit_watch', jsonb_build_object('from', v_from, 'days', p_days));
  return public.ssong_q_audit_watch(v_from, least(greatest(coalesce(p_days, 7), 1), 60));
end $$;

-- ── 실행 권한 (0150: PUBLIC EXECUTE 부터 회수) ──────────
do $$
declare f text;
begin
  foreach f in array array[
    'ssong_fy_of(date)',
    'ssong_q_daily_digest(date,date)', 'ssong_q_revenue_summary(int,text)',
    'ssong_q_billing_watch(text,int)', 'ssong_q_audit_watch(date,int)',
    'ssong_daily_digest(date,date)', 'ssong_revenue_summary(int,text)',
    'ssong_billing_watch(text,int)', 'ssong_audit_watch(date,int)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function public.ssong_daily_digest(date,date)     to anon;
grant execute on function public.ssong_revenue_summary(int,text)   to anon;
grant execute on function public.ssong_billing_watch(text,int)     to anon;
grant execute on function public.ssong_audit_watch(date,int)       to anon;
