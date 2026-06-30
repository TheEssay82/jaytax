# Edge Function: standards-query

회계기준 근거 검색 API (직원 전용). 질문 → OpenAI 임베딩 → `match_accounting_standards` RPC → 근거 문단 N개.
검색 로직은 `scripts/standards/search.ts` 와 동일하며, 단일 소스(`accounting-standards/*.md`)를 적재한 데이터를 검색한다.

## 사전 준비
1. `supabase/migrations/0013_accounting_standards.sql` 적용 (테이블 + RPC).
2. 단일 소스 적재: `npm run std:parse:md -- accounting-standards/k-ifrs-1115.md && npm run std:load -- scripts/standards/data/K-IFRS-1115.paragraphs.json`

## 배포
**대시보드**: Edge Functions → Create function → 이름 `standards-query` → `index.ts` 붙여넣기 → Deploy.

**또는 CLI**:
```bash
supabase functions deploy standards-query
```

## Secret 설정 (필수)
임베딩용 OpenAI 키를 함수 환경에 등록한다(브라우저에 노출되지 않음):
```bash
supabase secrets set OPENAI_API_KEY=sk-...
```
대시보드: Edge Functions → standards-query → Settings → Secrets.
> `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` 는 런타임이 자동 주입하므로 설정 불필요.

## 동작 테스트 (curl)
로그인 직원의 access token 이 필요하다(브라우저 콘솔: `(await supabase.auth.getSession()).data.session.access_token`).
```bash
curl -i -X POST "https://<PROJECT-REF>.supabase.co/functions/v1/standards-query" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"question":"변동대가 추정 방법은?","standard_no":"1115","match_count":3}'
```
기대 응답:
```json
{ "ok": true, "question": "...", "matches": [ { "paragraph_no": "52", "similarity": 0.52, "citation": "K-IFRS 제1115호 문단 52 (요지)", "content": "..." } ], "notice": "..." }
```

## 요청 / 응답 스키마
- 요청: `{ question: string, standard_no?: string|null, match_count?: number(1~20) }`
- 응답: `{ ok: true, question, matches: StandardMatch[], notice }` 또는 `{ ok: false, error }`
- 인증 실패 401 / 입력 오류 400 / 서버오류 500.

## 프런트엔드 연동
`src/lib/standardsApi.ts` 의 `queryStandards(question, { standardNo, matchCount })` 사용.

## 범위 / 다음 증분
이 함수는 **검색(retrieval)**까지다. 최종 회신문(이메일) 작성은 호출 측에서
`prompts/grounding-instructions.md`·`email-template.md` 규약으로 수행한다. 서버측 LLM 자동 작성은 다음 증분(별도 LLM 키·프로바이더 결정 필요).
