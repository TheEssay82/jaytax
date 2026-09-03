-- 0131 종료월을 모를 때 — 자료를 고치지 않고 판정에서만 시스템 시작일로 간주
--
-- 0128 은 "종료월을 모르면 파기하지 않는다"로 두었다. 안전하지만, 종료월을 영영
-- 채우지 않으면 그 개인정보가 **영원히 남는다**. 그것도 법 제21조의 취지에 어긋난다.
--
-- 그렇다고 거짓 폐업월을 써 넣을 수는 없다. status_month 는 거래처등록 화면의 상태 열과
-- 엑셀 '귀속월'로 그대로 나가는 **업무 기록**이다. 2022년에 닫은 곳에 2026-07 을 적으면
-- 기록이 틀린다(집계 숫자에는 안 쓰이지만 사람이 읽는 기록이 틀어진다).
--
-- 그래서 **자료는 '모름'으로 두고 판정에서만** 시스템 시작일(2026-07)로 친다.
--   · 화면·엑셀 — 종료월 없음 그대로
--   · 파기 판정 — 2026-07 에 끝난 것으로 보아 5년 뒤(2031-07)부터 대상
-- 사용자 결정(2026-09-03). 나중에 진짜 종료월을 알게 되면 그것을 넣으면 되고,
-- 그때는 그 날짜가 기준이 된다(더 이른 날짜면 더 일찍 파기 대상이 된다).
--
-- 확인: 지금 0건 → 2031-06 에 2건 → 2031-08 에 5건(종료월 미상분이 그때 도래).

comment on column public.biz_place.status_month is
  '상태(폐업·이관·종료) 귀속월. 비어 있으면 "모름"이며, 파기 판정에서만 시스템 시작일(2026-07)로 간주한다(마이그 0131).';

update public.retention_policy set where_sql = $w$resident_no_enc is not null
     and not exists (select 1 from public.biz_place p where p.entity_id = biz_entity.id and p.status = '정상')
     and coalesce(
           (select max(p.status_month) from public.biz_place p where p.entity_id = biz_entity.id),
           '2026-07')
         < to_char({cutoff}::date, 'YYYY-MM')$w$,
  note = '거래 중인 사업장이 하나도 없고, 마지막 종료·폐업·이관으로부터 5년이 지난 거래처만. 거래처 자체는 남고 주민번호 칸만 비운다. 종료월을 모르면 시스템 시작일(2026-07)에 끝난 것으로 보아 2031-07 부터 대상이 된다 — 거짓 날짜를 자료에 써 넣지 않으면서도 언젠가는 파기되게 하려는 것이다.'
 where key = 'resident_entity';

update public.retention_policy set where_sql = $w$resident_no_enc is not null
     and not exists (select 1 from public.biz_place p where p.entity_id = biz_representative.entity_id and p.status = '정상')
     and coalesce(
           (select max(p.status_month) from public.biz_place p where p.entity_id = biz_representative.entity_id),
           '2026-07')
         < to_char({cutoff}::date, 'YYYY-MM')$w$,
  note = '대표자 기록은 남고 주민번호 칸만 비운다. 종료월을 모르면 시스템 시작일(2026-07)로 간주한다.'
 where key = 'resident_rep';

update public.retention_policy set where_sql = $w$hometax_pw_enc is not null
     and public.biz_entity_closed(entity_id)
     and coalesce(status_month, '2026-07') < to_char({cutoff}::date, 'YYYY-MM')$w$,
  note = '거래처가 통째로 끝난 뒤 1년. 사업장 정보는 남고 비밀번호만 비운다. 사업장 하나가 폐업해도 그 거래처가 살아 있으면 대상이 아니다 — 정정신고 등으로 들어갈 일이 있다. 종료월을 모르면 시스템 시작일(2026-07)로 간주한다.'
 where key = 'hometax_pw';
