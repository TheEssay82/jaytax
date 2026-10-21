-- 0186 JET 2차 — ④ 증빙요청 · ⑤ 결과 입력(사용자 2026-10-21).
-- 선정 전표(je_pick)에 요청 번호 · 요청 증빙 · 요청일 · 회신 증빙 파일명 · 회신일 · 확인자를 더한다.
--   answer = 회사 설명(회신 엑셀), evidence = 감사인이 확인한 증빙 · REF 조서, result = 이상없음 / 예외 / 확인중.
-- je_accounts — 한 판 분개장의 계정 목록(전년 대비 신규 계정 B14). 6만 줄을 화면으로 받지 않고 서버에서 묶는다.
alter table public.je_pick
  add column if not exists req_no integer,
  add column if not exists req_docs text,
  add column if not exists requested_at date,
  add column if not exists reply_docs text,
  add column if not exists replied_at date,
  add column if not exists checked_by text;
comment on column public.je_pick.req_docs is '회사에 요청한 증빙(시나리오별 기본값, 고칠 수 있음)';
comment on column public.je_pick.reply_docs is '회사가 회신한 증빙 파일명';
comment on column public.je_pick.answer is '회사 설명(회신 엑셀에서 들어옴)';
comment on column public.je_pick.evidence is '감사인이 확인한 증빙 · REF 조서';

create or replace function public.je_accounts(p_upload uuid)
returns table(acct_code text, acct_name text, n bigint) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_audit_staff() then raise exception '감사팀만 볼 수 있습니다' using errcode = '42501'; end if;
  return query select l.acct_code, min(l.acct_name), count(*) from public.je_line l where l.upload_id = p_upload group by l.acct_code;
end $$;
revoke all on function public.je_accounts(uuid) from public, anon;
grant execute on function public.je_accounts(uuid) to authenticated;
