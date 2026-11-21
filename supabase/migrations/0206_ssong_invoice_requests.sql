-- 0206: 쏭비서 읽기 — 세금계산서 발행의뢰와 처리 여부(대표님 2026-11-21)
--
-- biz_invoice_request 한 건씩: 귀속월·거래처·사업장·팀·담당회계사·직원·공급가액·부가세·합계·상태(요청/발행완료/수정발행/취소)
-- ·의뢰자·의뢰일·발행일·승인번호·적요·메모·취소/수정 사유. 받는 메일주소(doc_email)는 주지 않는다.
-- 읽기만. 열쇠 확인·접속기록은 0200 과 같은 방식. 함수는 PUBLIC EXECUTE 부터 회수(0150).

create or replace function public.ssong_q_invoice_requests(p_q text, p_status text, p_from text, p_to text, p_team text, p_limit int)
returns jsonb language sql stable security definer set search_path = public as $$
  with r as (
    select i.*, (select btrim(p.name) from profiles p where p.id = i.requested_by) as requester
      from biz_invoice_request i
     where (coalesce(btrim(p_q), '') = '' or i.company_name ilike '%' || btrim(p_q) || '%' or i.place_name ilike '%' || btrim(p_q) || '%')
       and (p_status is null or i.status = p_status)
       and (p_from is null or i.ym >= p_from)
       and (p_to is null or i.ym <= p_to)
       and (p_team is null or i.team = p_team)
  )
  select jsonb_build_object(
    'summary', (select coalesce(jsonb_object_agg(status, jsonb_build_object('count', n, 'supply', s)), '{}'::jsonb)
                  from (select status, count(*) n, sum(supply_amount) s from r group by status) q),
    'requests', (select coalesce(jsonb_agg(x order by x->>'requestedAt' desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'ym', r.ym, 'company', r.company_name, 'place', r.place_name, 'team', r.team, 'cpa', r.cpa, 'staff', r.staff,
          'supply', r.supply_amount, 'vat', r.vat, 'total', r.total, 'status', r.status, 'phase', r.phase,
          'requester', r.requester, 'requestedAt', r.requested_at, 'issueDate', r.issue_date,
          'issuedDate', r.issued_date, 'invoiceNo', r.invoice_no, 'summary', r.summary, 'note', r.note,
          'cancelReason', r.cancel_reason, 'correctReason', r.correct_reason, 'contractCode', r.contract_code) x
          from r order by r.requested_at desc nulls last
          limit least(greatest(coalesce(p_limit, 30), 1), 100)) t)
  )
$$;

create or replace function public.ssong_invoice_requests(p_q text default null, p_status text default null, p_from text default null,
                                                         p_to text default null, p_team text default null, p_limit int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.ssong_require();
  if p_status is not null and p_status not in ('요청', '발행완료', '수정발행', '취소') then raise exception '상태는 요청·발행완료·수정발행·취소 중 하나'; end if;
  if (p_from is not null and p_from !~ '^\d{4}-\d{2}$') or (p_to is not null and p_to !~ '^\d{4}-\d{2}$') then raise exception '월은 YYYY-MM'; end if;
  perform public.ssong_log('ssong_read', 'biz_invoice_request', null, null, 'invoice_requests',
    jsonb_build_object('q', p_q, 'status', p_status, 'from', p_from, 'to', p_to, 'team', p_team));
  return public.ssong_q_invoice_requests(p_q, p_status, p_from, p_to, p_team, p_limit);
end $$;

revoke all on function public.ssong_q_invoice_requests(text,text,text,text,text,int) from public, anon, authenticated;
revoke all on function public.ssong_invoice_requests(text,text,text,text,text,int) from public, anon, authenticated;
grant execute on function public.ssong_invoice_requests(text,text,text,text,text,int) to anon;
