# AI 상담/Q&A 기능 현황 (STATUS-tax-qa)

기준일: 2026-09-03 · 코드 기준: `main` 93a7ee2 · 라이브: Supabase 프로젝트 `rboqmlwwwgrntasftwki`, consult 엣지함수 **v22**

메뉴 위치: `회계및세무상담관리` → 세법 검색(`std-tax`) · 상담진행(`consult`) · 상담기록(`consult-log`) · 자료실(`library`) · AI 사용량(`ai-usage`, 최고관리자). 회계기준 검색(`std-kifrs`)은 같은 지식베이스를 쓰는 조회 화면이다.

한 줄 요약: **질문 → (브라우저) 개인정보 마스킹 → consult 엣지함수가 회계기준 원문·요지·자료실 RAG + 법제처 세법 조문·심판례·판례를 모아 근거 블록을 만들고 → Claude가 5블록 회신 초안 작성 → 브라우저에서 마스킹 복원 → 직원이 편집·저장(consultations).**

---

## ① 관련 파일 목록과 역할

### 프런트 (React)

| 파일 | 역할 |
|---|---|
| `src/components/advisory/ConsultTab.tsx` | 상담진행 화면. 구분(일반/거래처)·분야(공통/회계/세무)·모델 선택·판례/세법 자동근거 토글·규격 질문 모드·보완 재회신·근거 목록·마스킹 안내·저장. |
| `src/components/advisory/ConsultLogTab.tsx` | 상담기록 목록/상세. 태그·거래처 필터, 초안↔확정 전환, 외부 공유 링크 켜고 끄기, 편집·삭제(작성자만). |
| `src/components/advisory/LawRefPicker.tsx` | 세법 조문 **수동 첨부** 선택기. law-search 엣지로 법령 검색→조문 열람→토글 선택 → `lawRefs`로 consult에 전달. |
| `src/components/advisory/TaxLawTab.tsx` | 세법 검색 화면(법령·3단비교·판례·심판례). 상담과 같은 law-search 엣지를 쓴다. |
| `src/components/advisory/StandardsTab.tsx` | 회계기준 검색(통합검색·기준서 목록·PDF·질의회신). 상담 근거의 원천 데이터를 열람하는 화면. |
| `src/components/advisory/LibraryTab.tsx` | 자료실. 참고자료 PDF 업로드, `🔎 RAG` 배지(rag_indexed). |
| `src/components/advisory/AiUsageTab.tsx` | AI 사용량(사용자별 호출 횟수). 최고관리자만. |
| `src/components/advisory/TagsField.tsx` | 해시태그 칩·편집기. |
| `src/components/SharedConsult.tsx` | 비로그인 공유 페이지 `/share/consult/:token`. `get_shared_consult` RPC. |
| `src/components/common/Markdown.tsx` | 회신 마크다운 렌더. |

### 데이터 레이어 (src/lib)

| 파일 | 역할 |
|---|---|
| `src/lib/consultApi.ts` | `runConsult()`(마스킹 관문 + consult 엣지 호출 + 복원), `CONSULT_MODELS` allowlist, consultations CRUD, 공유 토큰, `logConsultUsage`, `listAiUsage`, `modelLabel`. |
| `src/lib/pii.ts` | 개인정보 마스킹 레이어(⑤ 참조). |
| `src/lib/pii.test.ts` | 마스킹 경계 테스트 14건(`npm test`). |
| `src/lib/lawApi.ts` | law-search 엣지 클라이언트(법령·조문·3단비교·판례·심판례·별표). |
| `src/lib/standardsApi.ts` | standards-query 엣지 + 기준서 PDF Storage. |
| `src/lib/libraryApi.ts` | 자료실 문서 CRUD + RAG 상태 필드. |
| `src/lib/standardsCatalog.ts` | 기준서 정적 카탈로그(K-IFRS·일반기업·기타기준서). 적재 스크립트의 번호↔제목 매핑에도 쓰인다. |
| `src/lib/roles.ts` / `src/lib/menu.ts` | `viewAiUsage`(superuser)·`finalizeConsult`(superuser/accountant/team_lead) 권한, 외부인 허용 탭(세법검색·상담진행은 시연 가능, 상담기록은 차단). |

### 서버 (Supabase Edge Functions, Deno)

| 함수 | 라이브 버전 | 역할 |
|---|---|---|
| `supabase/functions/consult/index.ts` | v22 (verify_jwt) | **상담 본체.** 근거 수집(RAG·법제처) → Claude 회신 작성 → 태그 추출. 시크릿: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `LAW_API_OC`. |
| `supabase/functions/law-search/index.ts` | v8 | 법제처 DRF 프록시(search/detail/thdcmp/prec/tt/admrul). OC 키 보호 + CORS 우회. |
| `supabase/functions/standards-query/index.ts` | v6 | 회계기준 요지 검색(retrieval only). 회계기준 검색 화면용. |
| `supabase/functions/kasb-qna/index.ts` | v2 | KASB 질의회신 본문 프록시(회계기준 검색 화면용). |

### 마이그레이션 (상담·인용·RAG)

`0013_accounting_standards` · `0014_consultations` · `0015_consultation_tags` · `0016_standard_pdfs` · `0017_standard_fulltext` · `0023_consultation_client_link` · `0024_library` · `0029_consult_share_and_usage` · `0030_library_fulltext` · `0121_perhead_read_billing_advisory`(인당회계사 조회 허용) · `0123_lock_down_function_grants`(RPC grant 정리) · `0127`/`0128`(보존기한·파기: 상담기록 60개월).
※ `finalized_by`/`finalized_at` 컬럼과 `set_consultation_finalizer()` 트리거(메모리상 0022)는 **라이브 DB에는 있으나 로컬 마이그레이션 파일이 없다**(0018~0022는 대시보드 직접 적용분).

### 코퍼스·적재 스크립트

| 경로 | 역할 |
|---|---|
| `accounting-standards/*.md` | 요지 정리본 단일 소스(③ 참조). |
| `prompts/grounding-instructions.md`, `prompts/email-template.md` | 근거·인용·되묻기 규약, 이메일 형식. 스킬과 공유. |
| `skill/SKILL.md`, `skill/reference/` | 개인용 Claude 스킬 `회계기준-자문` 번들(`npm run skill:sync`로 단일 소스 복사). |
| `scripts/standards/` | md 파서·요지 적재(`std:parse:md`, `std:load`)·검색(`std:search`)·PDF 업로드(`std:upload:pdfs`)·원문 전문 RAG 적재(`std:load:fulltext`)·요지 자동생성(`std:gen:gist`, Claude)·질의회신 인덱스(`std:fetch:qnas`). |
| `scripts/library/load-library-rag.ts` | 자료실 참고자료 PDF → 청킹·임베딩 → `library_fulltext`(`npm run lib:load:rag`). |

### 개인용(앱 밖) 자산

`~/.claude/skills/세법자문-회신/SKILL.md`, `~/.claude/commands/세법자문.md`, `~/.claude/skills/회계기준-자문/`(repo `skill/`의 배포본). 설계 원본 `D:\Dropbox\학습\2_세법검토_설계서.md`. 이들은 Claude Code에서 `korean-law` MCP를 쓰는 **개인 워크플로**이고, 앱(consult 엣지)과 코드 공유는 없다. 공유되는 것은 `prompts/`의 규약과 5블록 회신 형식뿐이다.

---

## ② Anthropic API 호출 흐름

### 전체 시퀀스

```
ConsultTab.generate()
 └ consultApi.runConsult(question, opts)
    ├ piiNames()  ← biz_entity.name · biz_representative.rep_name · biz_contact.contact_name · profiles.name
    ├ createMasker(names).mask(question | priorAnswer | followup)   ← 한 마스커로 세 필드
    ├ findResidentNos(masked) 잔존 시 throw(전송 차단)
    └ supabase.functions.invoke('consult', body)
        consult/index.ts (Deno.serve)
        ├ auth.getUser()  (401)
        ├ hasResidentNo(question|priorAnswer|followup) → 400 백스톱
        ├ model allowlist 검사 → useModel
        ├ embed(groundingQuery)                     OpenAI text-embedding-3-small
        ├ [회계·공통] match_standard_fulltext(24) → pickByThreshold(0.40, min6, max20)  → [회계기준(원문)]
        ├ [회계·공통] match_accounting_standards(3)                                    → [회계기준(요지)]
        ├ [항상]     match_library_fulltext(12, reference) → pickByThreshold(0.40, 0, 6) → [자료실]
        ├ [세무·공통, includeTaxLaw] fetchTaxLaw()   Haiku×2 + 법제처 law                → [세법]
        ├ lawRefs(수동 첨부)                                                             → [세법]
        ├ [세무·공통] precKeyword() Haiku → fetchTaxTribunal() 법제처 ttSpecialDecc      → [심판례]
        ├ [includePrecedents] fetchPrecedents() 법제처 prec                              → [판례]
        ├ groundingBlock = "(n) [type] ref\ntext" 나열
        ├ compose()  ← Anthropic Messages API (Sonnet 4.6 기본 / Opus 4.8)
        ├ extractTags()  ← Haiku 4.5
        └ { ok, answer_md, citations, model, tags }
    └ masker.unmask(answer_md), tags → ConsultResult(+masked, maskedSummary)
 └ logConsultUsage({model, domain, action})  → consult_usage
```

### Claude 호출 상세 (`compose`)

- **호출 방식:** SDK 없이 `fetch('https://api.anthropic.com/v1/messages')` 직접 호출. 헤더 `x-api-key`, `anthropic-version: 2023-06-01`.
- **모델:** 프런트 선택값을 서버 allowlist로 검증. 기본 `claude-sonnet-4-6`, 고품질 `claude-opus-4-8`. 보조 호출은 전부 `claude-haiku-4-5`.
- **파라미터:** `max_tokens: 8000`, `system: SYSTEM`, `messages: [user 1건]`. 비스트리밍, thinking 미지정, temperature 미지정, `cache_control` 없음.
- **tool use:** **사용하지 않는다.** `tools`·`tool_choice` 없음. 근거 수집은 전부 서버 코드가 사전에 수행하고 텍스트 블록으로 주입하는 고전 RAG 구조다.
- **mcp_servers:** **사용하지 않는다.** 서버에서는 `korean-law` MCP 대신 법제처 DRF를 직접 호출한다(개인 스킬만 MCP 사용).
- **응답 처리:** `content[].text`를 이어붙여 반환. `stop_reason` 검사 없음(잘림·refusal 미감지).
- **보완 재회신(refine):** `followup`이 있으면 user 메시지에 `[원 질문]/[기존 초안]/[보완 요청]/[근거]`를 넣어 전체 회신을 재작성. 근거는 질문+보완요청을 합쳐 재수집한다.

### 시스템 프롬프트 (`SYSTEM`, consult/index.ts 68~102행)

역할: "한국 회계·세무 실무 회신을 작성하는 보조자. 담당 회계사·세무사가 검토 후 그대로 보낼 수 있는 완성된 회신."

- **근거 규칙:** 제공된 근거 안의 내용만 사용, 없으면 `[확인 불가]`. 조문·문단·판례번호·링크 지어내기 금지. `[확인 불가]`는 결론에 직접 영향을 주는 조문·수치·요건이 없을 때만(심판례 부재는 실무 유의 한 줄로).
- **근거 유형별 인용법:** `[회계기준(원문)]` 문단번호+맥락 확인 권고 / `[회계기준(요지)]` "(요지)"+원문 대조 권고 / `[세법]` 법령명·조문·시행일+직접 인용+풀이 / `[판례]`·`[심판례]` 번호·일자·요지 / `[자료실]` "(내부자료)" 표기, 보조 근거.
- **형식(5블록 고정):** `# 제목([세무 회신]/[회계 회신]/[회계·세무 회신])` → `## 질의요지` → `## 결론`(경우별 번호) → `## 근거` → `## 실무 유의` → `적용 법령 시행일 | 원문` → AI 보조 자료 고지.
- **작성 지침:** 반드시 완결, 근거 풍부하면 상세히, 정중한 실무체, 이모지 금지.

### Haiku 보조 호출 (4종, 모두 실패 시 빈 값으로 흡수)

| 함수 | 목적 | max_tokens |
|---|---|---|
| `extractTags` | 질문+회신 → 한글 키워드 5~8개 JSON 배열 | 200 |
| `precKeyword` | 질문 → 판례·심판례 검색어 2~4어절 | 40 |
| `haikuJson` (fetchTaxLaw 1단계) | 질문 → 관련 세법 법령명 최대 3개(개인=소득세법/법인=법인세법 병행 규칙) | 300 |
| `haikuText` (fetchTaxLaw 4단계) | 조문제목 목록에서 관련 조문 최대 6개 선별. 산문 응답도 `제N조(의M)` 정규식으로 추출 | 300 |

### 근거 선택 파라미터

| 소스 | fetch | 유사도 하한 | 최소 유지 | 상한 |
|---|---|---|---|---|
| standard_fulltext | 24 | 0.40 | 6 | 20 |
| accounting_standards(요지) | 3 | 없음 | 3 | 3 |
| library_fulltext | 12 | 0.40 | 0 | 6 |
| 세법 조문(자동) | 법령당 최대 5, 법령 최대 3 | 해당 없음 | | |
| 심판례 / 판례 | 각 3 (+판례 사건명만 2) | 해당 없음 | | |

---

## ③ 코퍼스 구조와 세법 파일 목록

### `jaytax-knowledge`라는 별도 저장소·폴더는 없다

C:·D: 드라이브와 `~/.claude` 를 검색했으나 그 이름의 디렉토리는 없다. "지식베이스"는 아래 두 층으로 구성된다.

**(1) repo 안의 단일 소스(git 관리)**

```
accounting-standards/
  k-ifrs-1109.md   금융상품          (요지, gen-gist 생성, 539문단)
  k-ifrs-1115.md   고객과의 계약 수익 (요지, 손작성, 127문단, 2023-12-01 개정판)
  k-ifrs-1116.md   리스              (요지, gen-gist 생성, 160문단)
prompts/
  grounding-instructions.md   근거 검색·되묻기·인용 규약(API·스킬 공통)
  email-template.md           이메일 회신 템플릿(각주 방식)
skill/
  SKILL.md                    개인용 스킬 '회계기준-자문'
  reference/                  단일 소스 복사본(README·email-template·grounding-instructions·k-ifrs-1115) ※ 1109·1116은 미동기화
scripts/standards/data/       *.paragraphs.json 파싱 산출물(1109·1115·1116)
```

`.md` 프론트매터: `standard_set`·`standard_no`·`standard_title`·`revised_date`·`source`·`schema_version`(·`generator`). 본문은 `§문단번호` 규약으로 파싱된다. **요지 정리본이지 원문이 아니다**(Claude 생성).

**(2) Supabase에만 있는 원문 코퍼스(PDF → Storage + 벡터 청크, git에 없음)**

| 세트 | 문서 수 | 청크 | 비고 |
|---|---|---|---|
| K-IFRS | 61 | 7,021 | 기준서 41·해석서 19·개념체계. Storage `standard-pdfs`. |
| 일반기업회계기준 | 34 | 912 | 개념체계 + 1~33장. |
| 기타기준서(회계사 관련 법령 및 규칙) | 19 | 2,250 | 아래 목록. |
| 자료실 참고자료(`library_fulltext`) | 0 | 0 | 파이프라인은 있으나 업로드된 문서 0건. |

기타기준서 19종의 `no` 키(카탈로그 `section: '회계사 관련 법령 및 규칙'`): 공인회계사법 / 공인회계사법시행령 / 공인회계사법시행규칙 / 외부감사법 / 외부감사법시행령 / 외부감사법시행규칙 / 외부감사규정 / 외부감사규정시행세칙 / 회계부정행위신고포상규정 / 자본시장법 / 자본시장법시행령 / 자본시장법시행규칙 / 증권집단소송법 / 금융투자업규정 / 금융투자업규정시행세칙 / 증권발행공시규정 / 증권발행공시규정시행세칙 / 자본시장조사업무규정 / 자본시장조사업무규정시행세칙.

### 세법 파일 목록: **없음 (실시간 조회 구조)**

세법(부가가치세법·법인세법·소득세법 등)은 코퍼스에 **파일이나 벡터로 적재돼 있지 않다.** consult가 질문마다 법제처 국가법령정보 DRF(`law.go.kr/DRF/lawSearch.do`·`lawService.do`)를 호출해 조문 원문·시행일을 그때그때 가져온다(`target=law`·`prec`·`ttSpecialDecc`). 따라서 세법은 항상 현행 원문이지만, 의미검색은 불가하고 Haiku의 법령명·조문 선별에 의존한다. 개인 자산인 `C:\Users\geniw\AI학습\세법자문_*.md` 4건(의상비·미용실비용·회식비·캐디 원천징수)은 스킬 연습 산출물이며 앱은 읽지 않는다.

---

## ④ Supabase 스키마 (상담·인용 관련)

### `public.consultations` (0014 + 0015 + 0022(라이브) + 0023 + 0029)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| author_id / author_email | uuid → auth.users / text | 초안 저장자 |
| title | text | 쟁점 한 줄 |
| question | text | 직원 질문(마스킹 **복원된 원문** 저장) |
| answer_md | text | 회신 초안(마크다운, 편집 가능) |
| citations | jsonb `[]` | 근거 배열. 원소 `{ type, ref, text }` — type ∈ `회계기준(원문)`·`회계기준(요지)`·`자료실`·`세법`·`심판례`·`판례`·`판례(사건명)` |
| tags | text[] (GIN) | 해시태그 |
| llm_model | text | 작성 모델 id |
| status | text | `draft` \| `final` |
| finalized_by / finalized_at | uuid / timestamptz | 확정 전환 시 트리거 기록(로컬 파일 없음) |
| client_type | text | `general` \| `client` (check) |
| client_id / client_name | uuid → clients (set null) / text | 거래처 연결 + 명칭 스냅샷 |
| share_token | uuid unique | 있으면 외부 공유 활성 |
| created_at / updated_at | timestamptz | `set_updated_at` 트리거 |

인덱스: created_at desc, author_id, tags(GIN), client_id, share_token.

RLS(라이브 확인): select `true` + `ext_block_select`(외부인 차단) / insert `author_id = auth.uid()` / update 작성자 OR superuser·accountant·team_lead / delete 작성자만 / `ro_block_*`(읽기전용 계정 쓰기 차단). 인당회계사는 0121로 조회 허용.

RPC: `get_shared_consult(p_token uuid)` SECURITY DEFINER, anon 허용, 토큰 일치 1건(title·question·answer_md·citations·tags·status·created_at·author_name).

보존: `retention_policy` key `consultations` = 60개월, 근거 "법정 보존의무 없음, 5년 준용(확인 필요)", destroy_ok=true.

### `public.consult_usage` (0029)

`id, user_id(auth.uid), user_email, model, domain, action('generate'|'refine'), created_at`. RLS: insert 본인·외부인 제외, select superuser만. RPC `ai_usage_by_user()`(superuser 아니면 0행, 0123에서 anon grant 회수). 라이브 누계 27건(Opus generate 12·refine 5, Sonnet generate 5·refine 5). 상담기록 확정 8건.

### RAG 테이블 (근거 원천)

| 테이블 | 키 | 임베딩 | 검색 RPC | RLS |
|---|---|---|---|---|
| `accounting_standards` (0013) | (standard_set, standard_no, part, paragraph_no) | vector(1536) HNSW cosine | `match_accounting_standards(qe, match_count, filter_standard_no)` | 인증 select만 |
| `standard_fulltext` (0017) | (standard_set, standard_no, chunk_index) | 동일 | `match_standard_fulltext(qe, match_count, filter_standard_no)` | 인증 select만 |
| `library_fulltext` (0030) | (document_id, chunk_index) FK cascade | 동일 | `match_library_fulltext(qe, match_count, filter_kind)` | 인증·외부인 제외 |
| `library_documents` (0024/0030) | | | `rag_indexed`·`rag_chunks`·`indexed_at` | 외부인 제외 |

쓰기는 모두 service_role 스크립트만(적재). 임베딩 모델은 세 테이블 공통 OpenAI `text-embedding-3-small`.

---

## ⑤ 마스킹 레이어 — 구현됨 (v2.33.0/2.33.1)

법적 근거: 개인정보보호법 제28조의8(국외이전). Anthropic API가 국외라 의뢰인 식별정보를 프롬프트에 넣기 전 치환한다.

### 구조 (3중)

1. **브라우저 마스킹** `src/lib/pii.ts` → `consultApi.runConsult()`가 관문. 원문은 브라우저를 벗어나지 않는다.
2. **전송 차단** 마스킹 후에도 주민번호 모양이 남으면 `findResidentNos`가 잡아 **호출 자체를 막는다**(throw).
3. **서버 백스톱** consult 엣지의 `hasResidentNo()`가 question·priorAnswer·followup을 다시 검사해 400 반환(구버전 프런트·직접 호출 대비).

### 마스킹 규칙 (`PATTERNS`, 순서가 규칙)

주민번호(앞 6자리가 날짜면) → 법인등록번호(6-7 자리 중 날짜 아님) → 사업자번호 → 계좌번호(은행명 선행 시만, 금액 보호) → 연락처 → 이메일 → 주소(시·도~번지·건물까지만) → **인명(사전 기반)**.
인명 사전은 `biz_entity.name`·`biz_representative.rep_name`·`biz_contact.contact_name`·`profiles.name`을 세션당 1회 읽어 긴 이름부터 치환(NAME_STOP 단어 제외). 자리표는 `{인명1}` 형식, 같은 값은 같은 번호. 질문·기존초안·보완요청을 **한 마스커**로 처리해 번호 충돌을 막는다.

### 복원·표시

`unmaskPii`가 답변과 태그의 자리표를 원문으로 되돌린다(자리표 중첩 대비 최대 5회 반복, 긴 키 우선). 화면에 "🔒 인명 2 · 사업자번호 1 을(를) 가린 뒤 보냈습니다" 안내. 저장되는 question/answer_md는 **복원된 원문**(사내 DB 보관은 허용 범위, 파기는 retention으로).

### 테스트

`src/lib/pii.test.ts` 14건: 주민/법인번호 구분, 하이픈 없음, 금액 비마스킹, 주소 경계, 긴 이름 우선, `{인명10}` 복원, 중첩 자리표, 요약 문자열.

### 알려진 한계

- DB에 없는 이름(질문에만 등장하는 제3자)은 못 잡는다. 상담 입력칸에 "실명·주민번호·연락처를 적지 말라" 안내로 보완(v2.39.0).
- `lawRefs`(수동 첨부 조문)·citations는 마스킹 대상이 아니다(법령 원문이라 개인정보 없음).
- 임베딩 호출(OpenAI, 국외)에도 마스킹된 문자열이 간다. 별도 정책 없음.

---

## ⑥ 미구현 · TODO

### 기능

- **세법 의미검색 코퍼스 없음.** 세법은 법제처 실시간 조회뿐이라 Haiku의 법령명·조문 선별이 빗나가면 근거가 비고 `[확인 불가]`가 뜬다. 주요 세법(법·령·규칙) 조문 단위 적재+벡터검색이 근본 대안.
- **비세법 법령의 조문 단위 정확검색(B, 미착수).** 외부감사법 §10·§11처럼 800자 청킹에서 유사도가 희석되는 조문은 fulltext RAG로 안 뜬다. `fetchTaxLaw` 방식을 외부감사법 등으로 확장.
- **국세청 세법해석례·법제처 법령해석례(`expc`) 미연동.** DRF target 미확인. 최신 대법원·하급심 판례도 공백(`prec`는 공간판례 전문만).
- **자료실 RAG 0건.** 파이프라인은 있으나 참고자료 업로드 후 `npm run lib:load:rag`를 수동 실행해야 한다. 자동 트리거 없음. 서식(template)·비PDF·스캔본 제외.
- **요지 정리본 확장 미완.** 1109·1115·1116 3종만. 나머지 약 58종은 `std:gen:gist`로 생성 가능하나 미실행(Claude 비용). 기타기준서 5001~5004 PDF, 일반기업 부속 2건 미적재.
- `skill/reference/`에 1109·1116 미동기화(`npm run skill:sync` 미실행).
- Notion 상담사례 동기화(장기).
- 상담기록 보존기한 5년의 법적 근거 미확정(retention_policy note에 "확인 필요").

### API·품질

- `compose`가 `stop_reason`을 보지 않는다. `max_tokens`(8000) 도달·`refusal` 시 잘린 회신이 그대로 저장될 수 있다.
- SDK 미사용·재시도 없음·타임아웃 미설정. 429/5xx는 곧바로 사용자 오류.
- 프롬프트 캐싱 미적용. SYSTEM은 고정이지만 근거 블록이 매번 달라 캐시 효과는 SYSTEM 분량(약 1.5k자)에 한정되므로 우선순위 낮음.
- 비스트리밍이라 Opus 장문 회신 시 대기 시간이 길고 진행 표시가 없다.
- `consult_usage`는 호출 횟수만 기록한다. 토큰·비용(`usage` 필드) 미기록.
- `modelLabel` 맵의 Haiku id(`claude-haiku-4-5-20251001`)가 실제 `TAG_MODEL`(`claude-haiku-4-5`)과 다르다. 정규식 폴백으로 표시는 되지만 정리 필요.
- 근거 유사도 임계값 0.40은 실측 튜닝 여지(관련 클러스터 0.55~0.59).

### 코드·문서 정합성

- `standards-query/README.md`의 "서버측 LLM 자동 작성은 다음 증분"과 `law-search/README.md`의 "심판례 연동은 다음 증분"은 **이미 consult에서 구현됨**(stale).
- 0018~0022 마이그레이션 파일이 로컬에 없다(`finalized_by` 트리거 포함). 라이브 DDL을 파일로 역기록해 두는 것이 안전.
- consult 엣지·RAG 검색에 대한 자동화 테스트 없음(테스트는 `pii.test.ts`뿐).

### 개인정보(⑤ 연장)

- 이름 사전 밖 인명 미탐지(위 한계). NER 기반 보완은 미검토.
- 상담 입력 접속기록(`access_log`)에 상담 저장은 남지만 AI 호출 자체(외부 전송 이벤트)는 별도 기록하지 않는다.
