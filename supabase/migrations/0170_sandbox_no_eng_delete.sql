-- 0170 체험 계정은 데모 작업 건도 지우지 못한다(2026-10-06) — 심리실 여럿이 같은 (시연) 데모산업 연습 자료를 쓴다.
-- 화면은 「건 지우기」를 숨겼고(v3.59.1), 서버도 막는다. 주석 목록 고치기(지우고 다시 넣기)는 그대로 된다.
drop policy if exists sbx_delete on public.dsd_engagement;
create policy sbx_delete on public.dsd_engagement as restrictive for delete using (not public.is_sandbox());
