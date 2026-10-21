-- 0183 JET — 분개장 줄을 한 번에 불러오기. 1,000줄씩 61쪽을 읽으면 45초가 걸려(나래 61,014줄) 배열 하나로 돌려준다.
-- security invoker — je_line 의 RLS(감사팀만)가 그대로 걸린다. PUBLIC · anon 실행권은 회수(0150 원칙).
create or replace function public.je_lines_json(p_upload uuid)
returns json language sql stable security invoker set search_path = public as $$
  select coalesce(json_agg(json_build_array(seq, vdate, vno, acct_code, acct_name, dr, cr, cp_code, cp_name, memo, side, vtype, appr_date, appr_no) order by seq), '[]'::json)
  from public.je_line where upload_id = p_upload
$$;
revoke all on function public.je_lines_json(uuid) from public, anon;
grant execute on function public.je_lines_json(uuid) to authenticated;
comment on function public.je_lines_json(uuid) is 'JET — 한 판의 분개장 줄을 배열 하나로(화면 불러오기 한 번에). security invoker 라 RLS(감사팀만) 그대로.';
