-- 리스부채 이름 보강 — 제이스튜디오 2120A 「장기리스부채」(2026-10-01 다른 회사 2120A 가져오기 시험).
update public.gwp_proc_std set aliases = aliases || '{장기리스부채,유동리스부채,리스부채(유동),리스부채(비유동)}'::text[] where account = '리스부채' and not ('장기리스부채' = any(aliases));
