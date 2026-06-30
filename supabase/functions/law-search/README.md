# Edge Function: law-search

세법(법령) 검색·조문 열람 API (직원 전용). 법제처 국가법령정보 공동활용 Open API(DRF)를 서버에서 프록시한다.
법제처는 **원문**을 제공하므로 회계기준(요지 정리본)과 달리 조문 원문 + 시행일을 그대로 반환한다.

## 왜 Edge Function 프록시인가
- **OC 키 보호**: 법제처 OC는 브라우저에 노출하면 안 되는 키 → 서버에서만 사용.
- **CORS**: 법제처 DRF는 CORS 헤더를 주지 않아 브라우저 직접호출이 막힌다 → 서버가 중계.

## 배포
**대시보드**: Edge Functions → Create function → 이름 `law-search` → `index.ts` 붙여넣기 → Deploy.
**또는 CLI**: `supabase functions deploy law-search`

## Secret (필수)
```bash
supabase secrets set LAW_API_OC=<법제처 OC값>
```
대시보드: Edge Functions → Secrets. (open.law.go.kr 에서 발급받은 OC. 보통 가입 이메일의 @ 앞부분.)
> `SUPABASE_URL`/`SUPABASE_ANON_KEY` 는 자동 주입.

## 요청 / 응답
- 검색: `{ action:'search', query:'부가가치세법', display?:20 }`
  → `{ ok, totalCnt, laws:[{ mst, lawId, name, lawType, effDate, dept, link }] }`
- 조문 열람: `{ action:'detail', mst:'276117' }`
  → `{ ok, name, effDate, dept, articleCount, articles:[{ no, title, isChapter, content, effDate }] }`
- 인증 필요(로그인 직원). 미인증 401 / 입력오류 400 / OC 미설정·서버오류 500.

## 테스트 (curl)
```bash
curl -s -X POST "https://<PROJECT-REF>.supabase.co/functions/v1/law-search" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" -H "Content-Type: application/json" \
  -d '{"action":"search","query":"부가가치세법"}'
```

## 프런트엔드
`src/lib/lawApi.ts` 의 `searchLaws()` / `fetchLawDetail()`. 화면: `src/components/advisory/TaxLawTab.tsx` (메뉴 `세법 검색`, id `std-tax`).

## 참고
- DRF 베이스: `https://www.law.go.kr/DRF/{lawSearch.do|lawService.do}`, `target=law`, `type=JSON`.
- 국세청 해석례·조세심판례 연동은 다음 증분(별도 endpoint/소스).
