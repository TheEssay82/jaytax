-- 아직 보내지 않은 발송요청의 **직함을 되채운다**
--
-- 발송요청은 수신자 정보를 **그때 값으로 박아 둔다**(스냅샷). 담당자가 나중에 바뀌거나
-- 퇴사해도 「무엇을 누구에게 보냈는가」가 흔들리지 않게 하려는 것이다. 그래서 0141 로
-- 직책이 건너올 길을 놓아도, **이미 만들어진 요청은 옛 값을 그대로 들고 있다.**
--
-- 실제로 「㈜메가박스중앙 · 고혜련」 건이 그랬다 — 거래처담당자에는 직책 「팀장」이 있는데
-- 요청 스냅샷에는 「님」만 박혀 있어 화면에 「고혜련 님」으로 나왔다.
--
-- **보낸 것은 건드리지 않는다.** 발송완료·취소는 지나간 일이라 그때 적힌 대로 두는 것이
-- 맞다. 아직 나가지 않은 것(미접수·진행중)만 지금 담당자 정보로 맞춘다.

with 직함 as (
  select
    c.id,
    -- lib/honorific.ts 의 pickTitle 과 같은 규칙: 직책 칸이 먼저, 비면 호칭 칸에서.
    -- 「과장님」처럼 님이 붙어 있으면 뗀다(「사모님·어머님」은 통째로 하나라 그대로).
    nullif(
      case
        when t ~ '(어머|아버|사모)님$' then t
        else regexp_replace(t, '\s*님$', '')
      end, '') as title
  from public.doc_contacts c
  cross join lateral (
    select coalesce(nullif(btrim(c.position), ''), nullif(nullif(btrim(c.honorific), ''), '님'), '') as t
  ) x
)
update public.doc_send_requests r
set recipient_title = 직함.title
from 직함
where 직함.id = r.contact_id
  and 직함.title is not null
  and r.status in ('미접수', '진행중')
  and coalesce(btrim(r.recipient_title), '') in ('', '님');
