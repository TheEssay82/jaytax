# 회계기준 근거 DB (RAG) — 적재 파이프라인

회계기준(K-IFRS, 일반기업회계기준) 원문을 **문단 단위로 청크 → 임베딩 → Supabase 적재**하여,
질의에 대해 관련 문단을 유사도로 반환하는 근거 데이터베이스를 구축한다.

> 회계기준은 공식 API가 없어 원문 PDF를 직접 파싱한다. (세법·상법은 법제처 Open API로 별도 연동)

## 구성

| 파일 | 역할 |
|---|---|
| `../../supabase/migrations/0013_accounting_standards.sql` | 테이블 `accounting_standards` + pgvector + 검색 RPC `match_accounting_standards` |
| `parser.ts` | 추출 텍스트 → 문단 배열 (휴리스틱 상태기계) |
| `parse.ts`  | **1단계** PDF → 문단 JSON |
| `load.ts`   | **2단계** 문단 JSON → 임베딩 → Supabase upsert(멱등) |
| `search.ts` | **3단계** 질의 → 유사 문단 N개 (동작 확인) |
| `lib.ts`    | 공통: env 로드 · service_role 클라이언트 · OpenAI 임베딩 |

## 사전 준비

1. **스키마 적용**: Supabase SQL Editor 에서 `supabase/migrations/0013_accounting_standards.sql` 실행
2. **원문 배치**: `scripts/standards/data/` 에 PDF 저장 (예: `K-IFRS-1115.pdf`) — git 제외됨
3. **`.env.local`** 에 키 추가 (`.env.example` 참고):
   ```
   SUPABASE_SECRET_KEY=<service_role 키>
   OPENAI_API_KEY=<OpenAI 키>
   ```

## 실행 (파일럿: K-IFRS 1115)

```bash
# 1) 파서 점검 — 적재 없이 추출/분해 결과 확인 (파서 정규식 튜닝)
npm run std:parse -- scripts/standards/data/K-IFRS-1115.pdf --inspect

# 2) 문단 JSON 생성
npm run std:parse -- scripts/standards/data/K-IFRS-1115.pdf \
  --no 1115 --title "고객과의 계약에서 생기는 수익" --revised 2023-12-01

#    → data/K-IFRS-1115.paragraphs.json 생성. 내용 검수 후 다음 단계로.

# 3) 임베딩 + 적재 (--dry 로 건수만 먼저 확인 가능)
npm run std:load -- scripts/standards/data/K-IFRS-1115.paragraphs.json

# 4) 검색 동작 확인
npm run std:search -- "변동대가는 어떻게 추정하나요?" --no 1115
```

## 멱등성·확장

- upsert 키: `(standard_set, standard_no, part, paragraph_no)` — 재실행해도 중복 없이 갱신.
- 다른 기준서 확장: 같은 스크립트에 `--no`, `--title`, PDF만 바꿔 반복.
- 임베딩 모델 변경 시: `lib.ts`의 `EMBED_MODEL`/`EMBED_DIM`과 마이그레이션의 `vector(N)` 차원·인덱스를 함께 변경 후 재적재.

## 파서 주의

`parser.ts`는 K-IFRS PDF의 일반적 번호체계(`31`, `105A`, `B2`, `IE3`, `BC4`)와 부록 전환을 가정한 **휴리스틱**이다.
실제 PDF의 텍스트 추출 형태에 따라 문단 분해가 어긋날 수 있으므로, 반드시 `--inspect` 로 먼저 확인하고
`PARA_RE` / `PART_RULES` / `looksLikeHeading` 를 조정한다.
