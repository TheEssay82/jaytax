# [인계] 금감원 회계업무자료 Open API → JAYTAX·쏭비서 연동

작성 2026-11-27 · 요청자 정우철(Bryan) · 기준 JAYTAX v3.90.7
같이 넘기는 파일
- `docs/fss/20261127_정우철_FSS회계OpenAPI_JAYTAX쏭비서_연동검토.md` — 설계서(명세·DDL·엣지함수 초안)
- `scripts/fss/fss_openapi.py` — 로컬 조회 스크립트(응답 파싱 기준 구현)

---

## 0. 이 작업에서 이미 정한 것 (다시 묻지 말 것)

1. **수집·저장은 JAYTAX 한 곳**: Supabase 엣지함수 `fss-sync` → `public.fss_docs` 테이블. 키는 Supabase secret `FSS_API_KEY`에만 둔다. 프론트엔드·로그·커밋에 키 금지.
2. **claude.ai·쏭비서 노출은 JAYTAX MCP 읽기도구로**: `fss_search`, `fss_updates`. 결재 불필요(읽기 전용).
3. **금감원 API를 직접 부르는 별도 커넥터는 만들지 않는다.** API에 키워드 검색이 없어 매 질문마다 7종×연도 전수 호출이 되기 때문. 직원 공유·분리가 필요해지면 그때 `fss_docs`를 읽는 전용 커넥터를 추가(이번 범위 밖, 6단계로 백로그 등록만).
4. 1단계는 **제목·요약 본문·링크·첨부 목록**만. 첨부(hwp/pdf) 원문 저장·텍스트화는 DB 용량(500MB 한도 근접) 확인 뒤 별도 결정.
5. 공개자료이므로 개인정보 마스킹·보존기한 파기 대상 아님. 다만 쏭비서 조회는 기존처럼 접속기록에 남긴다.

## 1. API 핵심 (설계서 2장 요약)

`GET https://www.fss.or.kr/fss/kr/openApi/api/{endpoint}.jsp?apiType=json&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&authKey=KEY`

| api | endpoint | 자료 | 추가필드 |
|---|---|---|---|
| illust | illustDisc | 주석공시 모범사례 | — |
| kifrs | kifrsQa | K-IFRS 질의회신요약 | relStand |
| kgaap | kgaapQa | 일반기업회계기준 질의회신요약 | — |
| icfr | icfrData | 내부회계관리제도 자료 | — |
| insp | inspExmpl | 심사·감리 지적사례 | rlsNo, issRealm, relStand, dcsnYr, sprvisnTrgtYr, deptNm |
| auddata | audData | 외부감사 업무자료 | — |
| audfaq | audFaq | 외부감사 FAQ | — |

공통필드: contentId, subject, originUrl, regDate, contentsKor, atchfileUrl, atchfileNm(`|` 구분)

**반드시 처리할 함정** (2026-11-27 시험 호출·명세로 확인)
- 최상위 키 `reponse`(오타). `response`도 수용.
- 본문 키 `contentsKor`(명세) / `contentKor`(안내문 예시) 둘 다 수용.
- 본문 HTML 이중 escape → unescape 2~3회 후 태그 제거.
- 성공 `resultCode "1"`, 잘못된 키 `"013" 미등록 인증키`. 자료없음 메시지는 빈 배열로 처리.
- ~~호출·기간 한도 미공개 → 백필은 연 단위 분할~~ → **(2026-11-27 실측) 개인용 키: 1회 최대 1개월(030) · 하루 30회(033) · 응답 EUC-KR · 자료없음 900.** 운영은 최근 14일 증분(7회/일), 백필은 남는 호출로 최근 달부터 거꾸로(Bryan 결정: 천천히 채우기).
- 키 종류 미확인: **법인용이면 IP 제한 가능성** → 엣지함수에서 013/IP 오류 나면 즉시 멈추고 Bryan에게 보고(우회 시도 금지).

## 2. 작업 단계와 완료 기준

### 1단계 — 실키 확인 (Bryan 로컬)
- Bryan이 `C:\Users\geniw\Claude\fss_key.txt`에 키 저장(채팅에 붙여넣지 않음).
- `python scripts/fss/fss_openapi.py all --from 2026-11-01` 실행 → 7종 응답 실물 확인.
- 완료: 7종 모두 `resultCode 1`, 실제 필드명을 설계서와 대조해 차이가 있으면 설계서 2장 수정.

### 2단계 — 저장소
- 마이그레이션: 설계서 4-2의 `fss_docs` DDL(+ RLS: authenticated select). `body_raw`는 만들지 않음.
- 임베딩은 기존 회계기준 RAG와 같은 모델·차원을 따른다(코드에서 확인 후 맞출 것).
- `supabase secrets set FSS_API_KEY=...`는 Bryan이 직접 실행.
- 완료: 마이그레이션 적용, advisors 경고 없음.

### 3단계 — 수집 `fss-sync`
- 설계서 4-3 초안 기반. `upsert(onConflict: api,content_id)`, 신규·변경 건만 임베딩.
- 모드: `?backfill=YYYY` (연 단위 수동), 기본은 최근 14일.
- 스케줄: 평일 07:30 KST(아침 브리핑 전).
- 실패는 서비스 한도/접속기록 화면에서 보이게 한 줄 기록.
- 완료: 2011~현재 백필 후 7종 건수 표로 보고, 재실행해도 중복 0.

### 4단계 — 상담·검색 화면
- consult 근거 수집에 `fss_docs` 벡터검색 추가(상위 k건, 종류별 가중치는 기준서 원문 > 질의회신 > 지적사례).
- 5블록 회신의 근거 블록에 "금감원 질의회신"·"심사·감리 지적사례" 소제목 + `origin_url` 링크 인용(링크 인용은 필수 원칙).
- 기준서와 충돌 시 기준서 우선, 질의회신은 등록일 표기.
- 📚 회계기준 검색에 「금감원 자료」 탭(필터: 종류·관련기준서·쟁점분야·기간).
- 완료: 「리스 변경」「진행기준」 두 질문으로 근거에 금감원 자료가 링크와 함께 붙는 것 확인.

### 5단계 — 쏭비서 / JAYTAX MCP
- 도구 `fss_updates(days=7, api?)`: 기간 내 신규 목록(종류·제목·등록일·링크).
- 도구 `fss_search(q, api?, rel_stand?, from?, to?, limit=10)`: 제목·쟁점·링크·본문 앞 300자.
- `about_jaytax` 지도 ssongTools에 두 도구 추가(지도 자동생성 테스트가 막으므로 같은 커밋).
- 아침 브리핑: "📰 금감원 새 회계자료 n건"(0건이면 생략, AI 미사용).
- 완료: claude.ai에서 JAYTAX 커넥터로 `fss_search` 호출 성공, 텔레그램 브리핑에 줄 표시.

### 6단계 — 백로그 등록만
- "금감원 회계자료 전용 커넥터(fss_docs 읽기 전용, 인증 필수) — 직원 공유 필요 시".
- "첨부 hwp/pdf 텍스트화 — DB 용량 결정 후".
- "감사이슈 LOG ↔ 감리지적사례 매칭 배지 / 강평자료 첨부".

## 3. 작업 규칙
- 버전 올리고 recentChanges에 기존 문체(짧은 한국어, 사용자 관점)로 기록.
- 단계마다 끝나면 Bryan에게 결과 요약 후 다음 단계 진행.
- 산출 보고 파일명은 `YYYYMMDD_` 접두.
- 키·토큰을 출력·커밋·로그에 남기지 않는다.
