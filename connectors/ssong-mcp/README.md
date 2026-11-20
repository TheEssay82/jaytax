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
