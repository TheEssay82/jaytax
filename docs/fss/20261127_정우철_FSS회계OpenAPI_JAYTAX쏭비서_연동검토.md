# 금감원 회계업무자료 Open API — Claude·JAYTAX·쏭비서 연동 검토

작성일 2026-11-27 · 작성 공인회계사 정우철 · 대상 JAYTAX v3.90.7 기준

## 1. 결론

| 대상 | 활용 가능 | 권장 방식 | 효과 |
|---|---|---|---|
| Claude (Desktop·Code) | ○ | 로컬 스크립트 `fss_openapi.py` + 키 파일 | 질의회신·감리지적사례를 키워드로 바로 조회, 엑셀 저장 |
| JAYTAX | ◎ (가장 효과 큼) | Supabase `fss-sync` 엣지함수 → `fss_docs` 테이블 → 상담 RAG·화면 | 회계 상담 근거층 보강(현재 보류 중인 "상담시스템 — 회계 쪽" 해소) |
| 쏭비서 | ○ | JAYTAX MCP 읽기도구 `fss_updates` 추가 + 아침 브리핑 한 줄 | "이번 주 금감원 새 회계자료" 알림, "리스 감리지적사례 찾아줘" 질의 |

핵심은 **키를 JAYTAX(Supabase secret)에만 두고, 수집은 JAYTAX가, 조회는 JAYTAX MCP로** 하는 것입니다. 그러면 claude.ai 채팅·쏭비서·Claude Code가 모두 같은 데이터를 키 노출 없이 씁니다.
금감원 안내문도 결과를 "내부 DB 등에 저장하여 활용(예: 사내 게시판 연동)"하라고 예시하고 있어 DB 적재 방식이 안내 취지와 맞습니다.

## 2. API 명세 (확인 완료)

공통: `GET https://www.fss.or.kr/fss/kr/openApi/api/{endpoint}.jsp?apiType=json&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&authKey={32자리}`
네 개 요청변수 모두 필수, 키워드 검색 파라미터 없음 → **기간으로 받아서 우리 쪽에서 검색**해야 합니다.

| 키 | endpoint | 자료 | 추가 결과필드 | 상세페이지 |
|---|---|---|---|---|
| illust | illustDisc | 주석공시 모범사례 | — | [링크](https://www.fss.or.kr/fss/api/apiInquiryIllustDisc/view.do?menuNo=201298) |
| kifrs | kifrsQa | K-IFRS 질의회신요약 | relStand(관련기준서) | [링크](https://www.fss.or.kr/fss/api/apiInquiryKifrsQa/view.do?menuNo=201299) |
| kgaap | kgaapQa | 일반기업회계기준 질의회신요약 | — | [링크](https://www.fss.or.kr/fss/api/apiInquiryKgaapQa/view.do?menuNo=201300) |
| icfr | icfrData | 내부회계관리제도 자료 | — | [링크](https://www.fss.or.kr/fss/api/apiInquiryIcfrData/view.do?menuNo=201301) |
| insp | inspExmpl | 심사·감리 지적사례 | rlsNo, issRealm(쟁점분야), relStand, dcsnYr, sprvisnTrgtYr, deptNm | [링크](https://www.fss.or.kr/fss/api/apiInquiryInspExmpl/view.do?menuNo=201302) |
| auddata | audData | 외부감사 업무자료 | — | [링크](https://www.fss.or.kr/fss/api/apiInquiryAudData/view.do?menuNo=201303) |
| audfaq | audFaq | 외부감사 FAQ | — | [링크](https://www.fss.or.kr/fss/api/apiInquiryAudFaq/view.do?menuNo=201304) |

공통 결과필드: contentId, subject, originUrl, regDate, contentsKor, atchfileUrl, atchfileNm(첨부 여러 개는 `|` 구분)

**구현 시 주의(실측·명세 차이)**
- 최상위 키가 `reponse`(원문 오타). `response`도 함께 받도록.
- 본문 키가 명세는 `contentsKor`, 안내문 예시 응답은 `contentKor` → 둘 다 수용.
- 본문 HTML이 이중 escape(`&lt;p&gt;`) → unescape 2회 후 태그 제거.
- 성공 `resultCode "1"`/"조회 성공", 잘못된 키 `"013"`/"미등록 인증키", **자료 없음 `"900"`/"자료가 없습니다."**.
- **(2026-11-27 실측) 개인용 키 한도** — 한 번에 **최대 1개월**(`"030"` 「최대 조회기간 초과(개인 : 1개월)」), **하루 30회**(`"033"` 「하루 조회 건수는 30회」). 7종 × 개월 수가 곧 호출 수다.
  → 운영 증분(최근 14일 × 7종 = 7회/일) + 백필은 남는 호출로 최근 달부터 거꾸로(하루 약 20회 → 2011년까지 약 두 달). 로컬 스크립트와 한도를 같이 쓴다.
- **(실측) 응답 인코딩은 EUC-KR**(`Content-Type: text/html;charset=euc-kr`) — UTF-8 로 읽으면 깨진다. 헤더의 charset 으로 디코딩.
- (실측) IP 제한 오류는 없었다(개인용 키).
- 실내용은 첨부(hwp/pdf)에 있는 건이 많음(예: 1118 모범사례는 본문이 "첨부파일 참고"). 1단계는 제목·요약·링크, 2단계에서 첨부 텍스트 추출.
- 인증키 신청 메뉴에 "요청 IP 변경 신청(법인용)"이 있음 → **법인용 키면 IP 제한이 걸릴 수 있어** Supabase 엣지함수(유동 IP)에서 막힐 수 있음. 개인용 키인지 먼저 확인.

## 3. Claude 반영 (즉시 가능)

1. 키를 `C:\Users\geniw\Claude\fss_key.txt`에 저장 (OpenDART 키와 같은 방식, 채팅에 붙여넣지 않음).
2. `fss_openapi.py`를 같은 폴더에 둠.
3. 사용:
   ```
   python fss_openapi.py kifrs --from 2015-01-01 --q 리스 --out xlsx
   python fss_openapi.py insp  --from 2019-01-01 --q 수익 진행기준
   python fss_openapi.py all   --from 2026-11-01          # 최근 신규자료 전체
   ```
   저장 파일명은 `YYYYMMDD_FSS_<api>.xlsx`.
4. Claude Desktop·Code에서는 "금감원 감리지적사례에서 재고자산 찾아줘"라고 하면 위 스크립트를 실행하면 됩니다. (claude.ai 클라우드 작업공간은 fss.or.kr 접속이 차단되어 있어, 클라우드 채팅에서는 아래 4번 JAYTAX MCP 경유가 정답입니다.)

## 4. JAYTAX 반영 (Claude Code 작업 지시용)

### 4-1. 키 보관
```
supabase secrets set FSS_API_KEY=<32자리>
```
`.env.local`에도 `FSS_API_KEY`. 프론트엔드에는 절대 노출하지 않음.

### 4-2. 테이블
```sql
create table public.fss_docs (
  api          text not null,          -- illust|kifrs|kgaap|icfr|insp|auddata|audfaq
  content_id   text not null,
  subject      text not null,
  reg_date     timestamptz,
  rel_stand    text,                   -- 관련기준서(kifrs, insp)
  iss_realm    text,                   -- 쟁점분야(insp)
  rls_no       text, dcsn_yr text, sprvisn_trgt_yr text, dept_nm text,
  origin_url   text,
  attachments  jsonb default '[]',     -- [{name,url}]
  body_text    text,                   -- HTML 제거본
  body_raw     text,
  embedding    vector(1536),           -- 기존 회계기준 RAG와 같은 임베딩
  fetched_at   timestamptz default now(),
  primary key (api, content_id)
);
create index on public.fss_docs (reg_date desc);
create index on public.fss_docs using gin (to_tsvector('simple', subject || ' ' || coalesce(rel_stand,'') || ' ' || coalesce(body_text,'')));
alter table public.fss_docs enable row level security;
create policy fss_docs_read on public.fss_docs for select to authenticated using (true);
```
공개자료이므로 개인정보 마스킹·보존기한 파기 대상 아님. 다만 DB 한도(500MB)에 근접해 있으므로 **body_raw는 1단계에서 생략하거나, 첨부 원문은 저장하지 않고 링크만** 두는 것을 권장.

### 4-3. 수집 엣지함수 `fss-sync` (Deno)
```ts
const BASE = "https://www.fss.or.kr/fss/kr/openApi/api/";
const APIS = { illust:"illustDisc", kifrs:"kifrsQa", kgaap:"kgaapQa", icfr:"icfrData",
               insp:"inspExmpl", auddata:"audData", audfaq:"audFaq" } as const;

const unesc = (s: string) => s.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"')
  .replace(/&#39;/g,"'").replace(/&nbsp;/g," ").replace(/&amp;/g,"&");
const toText = (s = "") => unesc(unesc(unesc(s)))
  .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, "\n").replace(/<[^>]+>/g, "")
  .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

async function pull(api: keyof typeof APIS, start: string, end: string) {
  const u = `${BASE}${APIS[api]}.jsp?apiType=json&startDate=${start}&endDate=${end}&authKey=${Deno.env.get("FSS_API_KEY")}`;
  const j = await (await fetch(u)).json();
  const b = j.reponse ?? j.response ?? {};
  if (String(b.resultCode) !== "1") {
    if (String(b.resultMsg ?? "").includes("없")) return [];          // 자료없음
    throw new Error(`${api} ${b.resultCode} ${b.resultMsg}`);           // 013 미등록 인증키 등
  }
  return (b.result ?? []).map((r: any) => {
    const names = (r.atchfileNm ?? "").split("|"), urls = (r.atchfileUrl ?? "").split("|");
    return { api, content_id: r.contentId, subject: r.subject, reg_date: r.regDate,
      rel_stand: r.relStand ?? null, iss_realm: r.issRealm ?? null, rls_no: r.rlsNo ?? null,
      dcsn_yr: r.dcsnYr ?? null, sprvisn_trgt_yr: r.sprvisnTrgtYr ?? null, dept_nm: r.deptNm ?? null,
      origin_url: r.originUrl, body_text: toText(r.contentsKor ?? r.contentKor),
      attachments: urls.filter(Boolean).map((url: string, i: number) => ({ name: names[i] ?? "", url })) };
  });
}
// 호출: 평일 07:30 cron → 최근 14일 증분, 최초 1회는 연도별 백필(2011~현재)
// upsert(onConflict: "api,content_id") 후 신규건(fetched_at = now)만 embedding 생성
```
cron은 기존 아침 브리핑(평일) 직전에 걸어 브리핑이 새 자료를 바로 담게 함.
실패 시(013·네트워크) 접속기록/서비스한도 화면에 한 줄 남김.

### 4-4. 상담(consult) 연동 — 효과가 가장 큰 부분
- 현재 consult = 회계기준 RAG + 법제처 DRF. 여기에 **`fss_docs` 벡터검색을 근거 소스 하나로 추가**.
- 5블록 회신의 근거 블록에 "금감원 질의회신(K-IFRS/일반기준)", "심사·감리 지적사례" 소제목으로 원게시글 링크(origin_url)를 함께 인용 → 링크 인용 원칙 충족.
- 감독당국 질의회신은 기준서 원문 다음 순위 근거로 표시(기준서와 충돌 시 기준서 우선 + 질의회신 일자 표기).
- 「📚 회계기준 검색」 화면에 탭 "금감원 자료" 추가(필터: 자료종류·관련기준서·쟁점분야·기간).

### 4-5. 감사업무 연동(선택)
- 감사이슈 LOG의 계정·기준서 태그와 `rel_stand`/`iss_realm`를 매칭해 "관련 감리지적사례 n건" 배지 표시.
- 강평자료(Discussion Memo) 초안에 관련 지적사례 링크 첨부.

## 5. 쏭비서 반영

### 5-1. 새 읽기도구 (JAYTAX MCP)
```
fss_updates   — 기간 내 신규 금감원 회계자료 목록(종류·제목·등록일·링크). 기본 최근 7일
fss_search    — 키워드·자료종류·관련기준서로 검색, 상위 10건 요약(제목·쟁점·링크, 본문 앞 300자)
```
- 읽기 전용, 결재 불필요. 공개자료라 마스킹 대상 아님.
- `about_jaytax` 지도(ssongTools)에 두 도구 추가 — 지도 자동생성 테스트가 막으므로 같은 커밋에서 갱신.
- 이 도구가 생기면 **claude.ai 채팅에서도 JAYTAX 커넥터로 바로 조회**됩니다(별도 설정 불필요).

### 5-2. 아침 브리핑·단추
- 브리핑에 "📰 금감원 새 회계자료 n건" 한 줄(0건이면 생략). AI 미사용, 비용 0.
- 텔레그램 단추 5번째 후보: 「금감원 새 자료」.

## 6. 진행 순서

1. 인증키가 개인용/법인용인지, IP 제한 여부 확인 (법인용이면 엣지함수 대신 고정 IP 경로 필요)
2. `fss_key.txt` 저장 → `python fss_openapi.py all --from 2026-11-01`로 실키 동작 확인 (응답 필드 실물 확인)
3. JAYTAX: secret → 테이블 → `fss-sync` 백필 → consult 근거 추가
4. 쏭비서: `fss_updates`/`fss_search` + 브리핑 한 줄 + 지도 갱신
5. DB 용량 점검 후 2단계(첨부 hwp/pdf 텍스트화) 여부 결정
