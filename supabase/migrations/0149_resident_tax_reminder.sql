-- 0149 주민세 종업원분 — 매월 5일 09:00(KST) taxteam(기장팀장·기장팀원)과 송현주 회계사에게 앱 알림
--
-- 왜 필요한가: 월평균 급여총액 1억 8천만원(지방세법 제84조의4·영 제85조의2, 360만원×50, 최근 12개월)을
-- 넘는 사업소는 주민세 종업원분을 다음 달 10일까지 신고해야 한다. 기장 계약 밖의 일이지만 놓치면 고객이
-- 「세금인데 왜 안 챙겼나」 한다(2026-09 실제 1곳 누락). 화면으로 만드는 대신 **매월 담당자에게 알림**을
-- 보내 확인하게 하기로 했다(사용자 결정 2026-09-15).
--
-- 받는 사람: profiles.role ∈ {team_lead, team_member}(taxteam) + 이름이 「송현주」인 사람. 읽기전용(테스트 계정)은 뺀다.
-- 같은 달에 두 번 보내지 않는다(entity_id 자리에 「달」의 uuid).

create extension if not exists pg_cron;

create or replace function public.resident_tax_reminder()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_ym text := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM');
  v_key uuid := md5('resident-tax-reminder:' || to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM'))::uuid;
  v_title text := '주민세 종업원분 — 이달 신고대상 확인';
  v_body text := '원천세 마감 뒤 위하고 신고현황표에서 거래처마다 최근 12개월 월평균 급여총액을 보고, '
    || '1억 8천만원(면세점: 360만원×50)을 넘거나 가까운 곳이 있으면 다음 달 10일까지 주민세 종업원분 신고를 안내하십시오. '
    || '급여총액은 비과세·육아휴직 급여 등을 뺀 값이고 사업소별로 봅니다. (지방세법 제84조의4 · 시행령 제85조의2)';
  u record; n integer := 0;
begin
  for u in
    select p.id from public.profiles p
    where coalesce(p.readonly, false) = false
      and (p.role in ('team_lead', 'team_member') or p.name = '송현주')
  loop
    if not exists (select 1 from public.notifications x where x.user_id = u.id and x.entity_id = v_key) then
      perform public.notify_user(u.id, 'resident_tax_reminder', v_title, v_body || ' [' || v_ym || ']', null, v_key);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.resident_tax_reminder() from public, anon, authenticated;
comment on function public.resident_tax_reminder() is
  '매월 5일 pg_cron 이 부른다. taxteam·송현주에게 주민세 종업원분 확인 알림. 같은 달은 한 번만.';

-- 매월 5일 00:00 UTC = 09:00 KST. 이미 있으면 다시 건다.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'resident-tax-reminder') then
    perform cron.unschedule('resident-tax-reminder');
  end if;
  perform cron.schedule('resident-tax-reminder', '0 0 5 * *', 'select public.resident_tax_reminder()');
end $$;
