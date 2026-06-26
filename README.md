# jaytax — 인덕회계법인 세무조정수수료 관리시스템

기존 단일 HTML 앱(`세무조정수수료계산_정우철_ver.4.6`)을 **React + TypeScript + Supabase** 로 전환한 웹 서비스입니다.

## 기술 스택
- **Vite + React 19 + TypeScript** — UI
- **Supabase** — 인증(직원 로그인) + Postgres DB(공용 데이터)
- 스타일은 원본 CSS 유지 (`src/styles/legacy.css`)

## 프로젝트 구조
```
src/
  types.ts              도메인 타입 (Client, WizardState, BillingRecord, AppConfig …)
  lib/
    constants.ts        기본 설정(DEF)·누진구간·라벨·mkS()
    calc.ts             수수료 계산 로직 (calcBase / calcS) — 원본과 1원까지 동일 검증 완료
    supabase.ts         Supabase 클라이언트
  context/AuthContext.tsx   세션/로그인 상태
  components/
    Login.tsx           로그인 화면
    AppShell.tsx        헤더 + 7개 탭 셸 (탭 내용은 단계별 포팅 예정)
  styles/legacy.css     원본 디자인 CSS
supabase/
  migrations/0001_init.sql  DB 스키마 + RLS
  seed.sql                  기본 설정 1행 시드
```

## 데이터 모델 (localStorage → Postgres 매핑)
| 원본 localStorage | Supabase 테이블 |
|---|---|
| `ind_cli4` 거래처 | `clients` |
| `ind_hist4` 청구기록 | `billing_records` |
| `ind_tgt4` 청구대상 | `billing_targets` |
| `ind_reqs4` 업데이트요청 | `update_requests` |
| `ind_cfg4` 설정 | `app_config` |

인증: 직원 로그인 + 공용 DB. 로그인한 모든 직원이 데이터를 공유하며, RLS로 익명 접근은 차단됩니다.

## 셋업
1. [Supabase](https://supabase.com) 프로젝트 생성
2. `.env.local` 에 연결 정보 입력:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=...
   ```
3. Supabase SQL Editor 에서 `supabase/migrations/0001_init.sql` → `supabase/seed.sql` 순서로 실행
4. 직원 계정 추가: Supabase 대시보드 → Authentication → Users → Add user
5. 개발 서버 실행:
   ```
   npm install
   npm run dev
   ```

## 다음 단계 (포팅 로드맵)
- [x] 토대: 스캐폴딩 · 계산 로직 · DB 스키마 · 인증 셸
- [ ] 거래처 관리 탭 (CRUD)
- [ ] 청구서 작성 위저드 (6단계)
- [ ] 청구대상 / 청구기록 / 통계 / 업데이트요청 / 설정 탭
- [ ] XLSX 내보내기 · 청구서 인쇄(PDF)
- [ ] 배포 (jaytax.co.kr)
