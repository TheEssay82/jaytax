-- 0106_invoice_request_cpa_staff.sql
-- 발행요청에 **그 시점의 담당CPA·담당직원을 박아 둔다.**
--
-- 왜 스냅샷인가: 계속계약은 연중에도 담당직원이 바뀐다. 계약을 지금 읽으면 '오늘의 담당'이
-- 나오지, '그 달 청구를 실제로 담당한 사람'이 나오지 않는다. 직원별 매출(업무량) 집계의
-- 근거는 **청구 시점의 담당자**여야 하므로 발행요청에 굳혀 둔다.
-- 계약의 담당 이력(biz_contract_staff.from_month/to_month)은 그대로 원천으로 남는다.
alter table public.biz_invoice_request
  add column if not exists cpa   text,
  add column if not exists staff text;

comment on column public.biz_invoice_request.cpa is
  '청구 시점의 담당 회계사(스냅샷). 계약이 나중에 바뀌어도 이 값은 그대로 남는다.';
comment on column public.biz_invoice_request.staff is
  '청구 시점의 담당 직원(스냅샷, 쉼표로 여럿). 직원별 매출 집계의 근거.';

-- 이미 쌓인 요청에 그 달 기준 담당을 채운다.
update public.biz_invoice_request r
   set cpa = coalesce(nullif(r.cpa, ''), nullif(c.cpa, ''), nullif(p.cpa, '')),
       staff = coalesce(nullif(r.staff, ''),
         nullif((select string_agg(s.staff_name, ',' order by s.staff_name)
                   from public.biz_contract_staff s
                  where s.contract_id = c.id and coalesce(s.active, true)
                    and (s.from_month is null or to_char(s.from_month, 'YYYY-MM') <= r.ym)
                    and (s.to_month  is null or to_char(s.to_month,  'YYYY-MM') >= r.ym)), ''),
         nullif((select string_agg(ps.staff_name, ',' order by ps.staff_name)
                   from public.biz_place_staff ps
                  where ps.place_id = r.place_id and coalesce(ps.active, true)), ''))
  from public.biz_sales_contract c
  left join public.biz_place p on p.id = c.place_id
 where c.id = r.contract_id;

-- 계약이 없는 건(감사팀 건별·대사에서 들여온 건)은 사업장 기준으로 채운다.
update public.biz_invoice_request r
   set cpa = coalesce(nullif(r.cpa, ''), nullif(p.cpa, '')),
       staff = coalesce(nullif(r.staff, ''),
         nullif((select string_agg(ps.staff_name, ',' order by ps.staff_name)
                   from public.biz_place_staff ps
                  where ps.place_id = p.id and coalesce(ps.active, true)), ''))
  from public.biz_place p
 where p.id = r.place_id and r.contract_id is null;
