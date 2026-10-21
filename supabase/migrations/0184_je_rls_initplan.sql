-- 0184 JET — RLS 를 줄마다 함수로 부르지 않게 (select …) 로 감싼다(한 번만 평가). 6만 줄 je_lines_json 이 문 시간초과(8초)에 걸렸다(RLS 없이 0.5초).
do $$
declare t text;
begin
  foreach t in array array['je_job', 'je_upload', 'je_line', 'je_tb', 'je_pick'] loop
    execute format('drop policy if exists %1$s_sel on public.%1$s', t);
    execute format('create policy %1$s_sel on public.%1$s for select using ((select public.is_audit_staff()))', t);
    execute format('drop policy if exists %1$s_ins on public.%1$s', t);
    execute format('create policy %1$s_ins on public.%1$s for insert with check ((select public.is_audit_staff()) and not (select public.is_readonly()))', t);
    execute format('drop policy if exists %1$s_upd on public.%1$s', t);
    execute format('create policy %1$s_upd on public.%1$s for update using ((select public.is_audit_staff()) and not (select public.is_readonly())) with check ((select public.is_audit_staff()) and not (select public.is_readonly()))', t);
  end loop;
  drop policy if exists je_pick_del on public.je_pick;
  create policy je_pick_del on public.je_pick for delete using ((select public.is_audit_staff()) and not (select public.is_readonly()));
  drop policy if exists je_tb_del on public.je_tb;
  create policy je_tb_del on public.je_tb for delete using ((select public.is_audit_staff()) and not (select public.is_readonly()));
end $$;
