-- 0197 거래처담당자등록 — 인당회계사도 담당자 등록·수정(사용자 2026-11-18). 지우기는 계속 막는다(0196 거래처등록과 같은 선).
drop policy if exists biz_contact_ins_perhead on public.biz_contact;
create policy biz_contact_ins_perhead on public.biz_contact for insert to authenticated
  with check (public.is_perhead() and not public.is_readonly());
drop policy if exists biz_contact_upd_perhead on public.biz_contact;
create policy biz_contact_upd_perhead on public.biz_contact for update to authenticated
  using (public.is_perhead() and not public.is_readonly())
  with check (public.is_perhead() and not public.is_readonly());
