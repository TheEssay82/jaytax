-- 0185 JET — je_lines_json 을 security definer 로(감사팀 확인은 함수 머리에서 한 번). invoker + RLS 로는 6만 줄이 문 시간초과(8초)에 걸렸다.
create or replace function public.je_lines_json(p_upload uuid)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_audit_staff() then raise exception '감사팀만 볼 수 있습니다' using errcode = '42501'; end if;
  return (select coalesce(json_agg(json_build_array(seq, vdate, vno, acct_code, acct_name, dr, cr, cp_code, cp_name, memo, side, vtype, appr_date, appr_no) order by seq), '[]'::json)
          from public.je_line where upload_id = p_upload);
end $$;
revoke all on function public.je_lines_json(uuid) from public, anon;
grant execute on function public.je_lines_json(uuid) to authenticated;
