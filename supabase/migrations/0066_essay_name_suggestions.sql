-- 0066: 습작 열람 — 이름 중복 시 대안 이름 제안(동명이인 대비).
--   뒤에 2~9 / A~D 를 붙여 보고 아직 쓰이지 않은 것만 최대 4개 돌려준다.
--   0065 롤백 스크립트로 함께 제거된다(essay_* 전부 drop).

create or replace function public.essay_name_suggestions(p_name text)
returns text[] language plpgsql security definer set search_path = public stable as $$
declare
  v_base text := btrim(coalesce(p_name, ''));
  v_cand text;
  v_out  text[] := '{}';
  v_sfx  text;
begin
  if v_base = '' then return v_out; end if;
  foreach v_sfx in array array['2','3','4','A','B','C','5','D'] loop
    exit when array_length(v_out, 1) >= 4;
    v_cand := v_base || v_sfx;
    if char_length(v_cand) <= 20
       and not exists (select 1 from public.essay_reader where name_key = public.essay_name_key(v_cand))
       and not (v_cand = any(v_out)) then
      v_out := array_append(v_out, v_cand);
    end if;
  end loop;
  return v_out;
end $$;

revoke all on function public.essay_name_suggestions(text) from public;
grant execute on function public.essay_name_suggestions(text) to anon, authenticated;
