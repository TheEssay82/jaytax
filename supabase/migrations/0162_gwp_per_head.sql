-- 0162 일반조서 — 인당회계사도 감사팀으로(사용자 2026-10-02 「조현규·김준성이 일반조서 메뉴를 못 본다」 → 인당회계사 등급 전체, 보기 + 작성·확정).
--
-- is_audit_staff() 는 일반조서 표(gwp_book·gwp_paper·gwp_stage_event·gwp_year·gwp_template·gwp_proc_std·engagement_file)와
-- 'gwp' 파일 보관함의 읽기·쓰기 선이다(0148·0152·0153·0156). 다른 표는 쓰지 않는다 — 이 함수만 넓히면 일반조서 전체가 열린다.
-- 읽기 전용 계정(is_readonly)은 지금처럼 쓰기에서 막힌다. 화면은 roles.ts viewAuditPapers · GwpTab canWrite 를 같이 넓혔다.
create or replace function public.is_audit_staff()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select role in ('superuser', 'accountant', 'per_head_accountant') from public.profiles where id = auth.uid()),
    false);
$$;
