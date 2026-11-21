# jaytax-ssong-mcp — 쏭비서 전용 JAYTAX 연결

쏭비서(대표님 비서 AI)가 **비밀번호 없이** JAYTAX 에 등록을 요청하는 원격 MCP 커넥터.
쏭비서는 바로 등록하지 못하고 **결재만 올린다.** 대표님이 JAYTAX 「⚙ 관리 › 🤖 쏭비서 결재함」에서
승인하면 그때 매출계약·발송요청이 만들어진다(DB 설계는 `supabase/migrations/0200_ssong_requests.sql`).

```
claude.ai(쏭비서) ──Authorization: Bearer MCP_SECRET──▶ 이 서버(/mcp)
   ──anon 키 + x-ssong-key: SSONG_DB_KEY──▶ Supabase RPC ssong_*  ──▶ ssong_requests(결재 대기)
대표님 JAYTAX 결재함 [승인] ──▶ 앱의 기존 등록 코드 ──▶ biz_sales_contract / doc_send_requests
```

## 도구

| 도구 | 하는 일 |
|---|---|
| `submit_sales_contract` | 매출계약 등록 **결재 올리기** (biz_sales_contract + 함께 하는 직원) |
| `submit_doc_send` | 문서발송 의뢰 **결재 올리기** (doc_send_requests). 첨부는 승인 뒤 문서발송관리에서 |
| `list_my_requests` | 올린 결재의 상태·승인자·반려 사유·만들어진 행 id |
| `search_clients` | 거래처 이름·코드·사업장·담당회계사 |
| `search_contacts` | 발송 수신자 이름·직함(주소·전화는 있음/없음만) |
| `list_sales_contracts` | 거래처의 매출계약 |
| `get_doc_send_status` | 발송 상태·발송일·등기번호 |
| `list_staff` | 직원 이름 |
| `list_contract_categories` | 매출유형 코드(앱 분류표에서 자동 생성) |

고치기·지우기·취소·승인 도구는 **없다.** DB 함수도 없다(테스트가 지킨다).

## 지키는 것

- **열쇠는 서버 환경변수에만.** 이 폴더·커밋·채팅에 남기지 않는다. DB 에는 `SSONG_DB_KEY` 의 sha256 만 `ssong_keys` 에 있다.
- **service-role 키를 두지 않는다.** anon 키로는 `ssong_*` 함수만 부를 수 있고, 함수가 열쇠를 확인한다. 표에 직접 쓰기는 거절된다.
- **꼭 필요한 만큼만 돌려준다.** 전화·주소·이메일·주민번호·사업자번호는 주지 않는다. 수신자 주소·전화는 승인 때 앱이 채운다.
- **기록.** 쏭비서의 조회·올리기는 `access_log`(해시 체인)에 actor 「쏭비서」로, 승인·반려는 대표님 이름으로 남는다. 결재 표에 누가 언제 승인·반려했는지와 만들어진 행 id 가 남는다.

## 핸드폰 알림(텔레그램)

결재를 올리면 텔레그램으로 결재 요약(거래처명·유형·금액 등)·쏭비서 메모·결재함 주소를 보낸다
(대표님 결정 2026-11-21 — 처음엔 주소만 보냈다). 아래 두 값이 없으면 알림 없이 결재만 올라간다.

| 환경변수 | 값 |
|---|---|
| `TELEGRAM_BOT_TOKEN` | @BotFather 가 준 봇 토큰 |
| `TELEGRAM_CHAT_ID` | 대표님 대화방 번호(봇에게 /start 보낸 뒤 getUpdates 의 `"chat":{"id":…}`) |

환경변수를 바꾼 뒤에는 Vercel 에서 **Redeploy** 해야 반영된다.

## 텔레그램에서 묻기 (단추 + 말로)

대표님 결정 2026-11-21 「버튼형·대화형 둘 다」. 주소는 `https://jaytax-ssong-mcp.vercel.app/telegram`.

- **단추 4개**(어제오늘 생긴 일 · 올해 매출 · 90일 넘은 미수금 · 이번 주 감사)는 AI 없이 바로 보고한다. 비용 없음. `lib/tgReports.ts`
- **그 밖의 글**은 Claude API(`claude-sonnet-5-5`, effort low — 대표님 결정: 비용)가 MCP 연결로 **이 서버의 /mcp** 를 붙여 답한다.
  도구·마스킹·접속기록이 claude.ai 쏭비서와 똑같다. `ANTHROPIC_API_KEY` 가 없으면 꺼지고 단추만 된다. `lib/tgChat.ts`
- 짧은 기억: DB `ssong_tg_memory`(0203)에 최근 8마디·30분(지나면 지움). 같은 메시지·단추는 `ssong_tg_seen` 으로 서버가 몇 대든 한 번만 처리.
- 결재: 모델에게는 MCP 쪽 submit_* 를 끄고 같은 모양의 **클라이언트 도구**만 준다. 모델이 그것을 부르면 서버가 실제 올릴 값으로 요약을 만들어 **「✅ 이대로 결재 올리기」** 단추와 함께 보내고, 내용은 메시지 번호와 함께 DB 기억에 둔다. ✅ 를 누르면 **모델 없이** 서버가 같은 MCP 도구(lib/tools.ts)를 그대로 불러 한 건 올린다(`lib/tgSubmit.ts`). 단추는 바로 지워진다.
- 웹훅 비밀이 맞는 요청, `TELEGRAM_CHAT_ID` 대화방의 메시지만 받는다. 다른 사람이 말을 걸면 답하지 않는다.

| 환경변수 | 값 |
|---|---|
| `TELEGRAM_WEBHOOK_SECRET` | 32자 이상 무작위(`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`) |
| `ANTHROPIC_API_KEY` | console.anthropic.com 에서 만든 키(말로 묻기용, 없으면 단추만). 콘솔에서 월 사용 한도를 걸어 둔다 |

웹훅 등록은 한 번만 — 브라우저 주소창에(토큰·비밀은 대표님 값으로, 채팅에 붙여 넣지 않는다):

```
https://api.telegram.org/bot<봇토큰>/setWebhook?url=https://jaytax-ssong-mcp.vercel.app/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

`{"ok":true,...}` 가 나오면 끝. 봇에게 `/start` 를 보내면 단추가 뜬다. (웹훅을 걸면 getUpdates 는 더 이상 안 된다.)

## 아침 브리핑

평일 아침 텔레그램으로 한 통(대표님 2026-11-21). JAYTAX 부분은 AI 없이 읽기 함수만 → 비용 없음. `lib/tgBriefing.ts`

- **네이버웍스 요약과 합치기:** Claude 앱 예약 작업 「웍스 아침 브리핑 (메일·일정·연차·회의)」(평일 08:50)이 마지막에
  쏭비서 커넥터 `send_morning_briefing(works_summary)` 를 부른다 → 서버가 웍스 요약 아래 JAYTAX 브리핑을 붙여 보낸다.
- **대비:** 그 작업이 안 돌면(PC·앱 꺼짐) Vercel Cron(`0 0 * * 1-5` UTC = 평일 09시대)이 JAYTAX 부분만 보낸다.

- 결재 대기 · 오늘 감사 일정 · 지난 근무일 이후 생긴 일(월요일은 금~일) · 판단 필요한 감사이슈 · 조회서 미회수 · 90일 넘은 미수금
- Vercel Cron 은 Hobby 요금제라 그 시각부터 한 시간 안에 온다.
- 환경변수 `CRON_SECRET`(16자 이상 무작위) — Vercel 이 `Authorization: Bearer` 로 붙여 부른다. 없으면 브리핑은 안 온다.
- 같은 날 두 번 불려도 `ssong_tg_seen`(`brief:날짜`)으로 한 번만. 텔레그램에서 「브리핑」 또는 `/brief` 로 아무 때나 받을 수 있다.

## 문서발송 진행 알림

대표님이 의뢰인이거나 쏭비서 결재로 만든 발송요청의 **상태·등기번호가 바뀌면** 텔레그램으로 한 줄(대표님 2026-11-21). `lib/notify.ts`

- DB 트리거(`0204`, pg_net)가 `POST /notify` 를 부른다. 비동기라 앱 저장을 막거나 늦추지 않고, 실패해도 저장은 그대로.
- 인증: 헤더 `x-ssong-notify` = 쏭비서 열쇠(`ssong_keys` label `vercel`)의 sha256 — 서버는 `SSONG_DB_KEY` 의 sha256 과 맞춘다. 새 환경변수 없음.
  열쇠를 바꾸면(label 이 `vercel` 이 아니게 되면) 트리거의 label 도 같이 바꾼다.
- 보내는 것: 거래처명·송부종류·문서명·상태·발송일·등기번호(우체국 조회 링크)·상태메모. 주소·전화·수신자 이름은 안 보낸다.
- 같은 상태·등기번호는 `ssong_tg_seen` 으로 한 번만.

## 환경변수

| 이름 | 값 |
|---|---|
| `SUPABASE_URL` | `https://rboqmlwwwgrntasftwki.supabase.co` |
| `SUPABASE_ANON_KEY` | JAYTAX 앱과 같은 anon(공개) 키 |
| `SSONG_DB_KEY` | 64자 hex 무작위(아래 「열쇠 만들기」) |
| `MCP_SECRET` | 32자 이상 무작위 — claude.ai 요청 헤더에 넣는 값 |

## 열쇠 만들기·바꾸기

PowerShell 에서(값은 화면에만 나오고 어디에도 저장되지 않는다):

```powershell
node -e "const c=require('crypto');const k=c.randomBytes(32).toString('hex');console.log('SSONG_DB_KEY='+k);console.log('hash='+c.createHash('sha256').update(k).digest('hex'))"
```

1. `SSONG_DB_KEY` 는 Vercel 환경변수에 넣는다.
2. `hash` 는 Supabase SQL 편집기에서 등록한다:
   `insert into public.ssong_keys(label, key_hash) values ('vercel', '<hash>');`
3. 바꿀 때는 새 열쇠를 같은 방법으로 넣고 옛 줄을 끈다:
   `update public.ssong_keys set active = false where label = '<옛 이름표>';`

`MCP_SECRET` 은 `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` 로 만든다.

## Vercel 에 올리기 (팀 jaytax-firm)

### 대시보드로 (권장 — CLI 가 이 PC 에서 안 될 때)

이 PC 는 컴퓨터 이름이 한글이라 Vercel CLI 가 `Cannot convert argument to a ByteString` 로 멈춘다(2026-11-21).
대시보드로 하면 CLI 가 필요 없고, main 에 올릴 때마다 저절로 다시 배포된다.

1. vercel.com → 팀 **jaytax-firm** → **Add New › Project** → GitHub `TheEssay82/jaytax` 가져오기.
2. **Project Name** `jaytax-ssong-mcp`, **Root Directory** `connectors/ssong-mcp`, Framework **Other**(빌드 명령 비움).
3. **Environment Variables** 네 개(아래 표)를 넣고 **Deploy**.

### CLI 로

```powershell
cd connectors/ssong-mcp
npx vercel link --scope jaytax-firm --project jaytax-ssong-mcp
npx vercel env add SUPABASE_URL production
npx vercel env add SUPABASE_ANON_KEY production
npx vercel env add SSONG_DB_KEY production
npx vercel env add MCP_SECRET production
npx vercel deploy --prod
```

## claude.ai 에 커넥터 등록

1. claude.ai → **설정 › 커넥터 › 사용자 지정 커넥터 추가**.
2. 이름 `JAYTAX 쏭비서`, 주소 `https://jaytax-ssong-mcp.vercel.app/mcp`.
3. 인증은 **「로그인 없음」**, **요청 헤더**에 `Authorization` = `Bearer <MCP_SECRET>`.
   (주소에 비밀을 넣지 않는다. 헤더가 틀리면 서버는 404 만 돌려준다.)
4. 쏭비서 프로젝트·대화에서 커넥터를 켠다. 쓰기 도구 두 개(`submit_*`)는 「항상 확인」으로 두는 것을 권한다.
5. 시험: 쏭비서에게 「명진 거래처 찾아줘」 → `search_clients` 가 돌면 연결된 것이다.

## 맥미니(상시 서버)

같은 코드를 Node 로 띄운다. 열쇠는 맥미니용으로 따로 만들어 `label='macmini'` 로 등록한다(끊을 때 그 줄만 끈다).

```bash
npm ci
SUPABASE_URL=… SUPABASE_ANON_KEY=… SSONG_DB_KEY=… MCP_SECRET=… PORT=8787 npm start
```

앞단에 HTTPS(Cloudflare Tunnel·Tailscale Funnel 등)를 두고 그 주소의 `/mcp` 를 claude.ai 에 등록한다.

## 개발

```powershell
npm install
npm run typecheck
npm test
npm run gen:categories   # 앱의 매출유형 분류가 바뀌면 다시 생성
```
