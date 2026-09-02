# 배포 가이드 — jaytax.co.kr

정적 SPA(Vite 빌드 → `dist/`) + Supabase(별도 호스팅). 아래는 **Vercel** 기준이며, Netlify도 거의 동일합니다.

## 0. 사전 확인
- 빌드 정상: `npm run build` → `dist/` 생성 (이미 검증됨)
- 환경변수 2개 필요: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (현재 `.env.local` 값과 동일)
- `.env.local` 은 git 에 안 올라감(.gitignore) → **호스팅 대시보드에 직접 입력**

## 1. 코드 원격 저장소(GitHub) 올리기
```
git remote add origin https://github.com/<계정>/jaytax.git
git branch -M main
git push -u origin main
```
> GitHub 비공개(private) 저장소 권장. (사내 도구이므로)

## 2. Vercel 배포
1. https://vercel.com 가입/로그인 (GitHub 계정 연동)
2. **Add New… → Project** → 위 저장소 import
3. Framework Preset: **Vite** 자동 감지 (`vercel.json` 이 빌드 설정 포함)
4. **Environment Variables** 에 추가:
   - `VITE_SUPABASE_URL` = `https://rboqmlwwwgrntasftwki.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = (현재 `.env.local` 의 anon 키)
5. **Deploy** → 1~2분 후 `*.vercel.app` 주소 생성

## 3. 커스텀 도메인 (jaytax.co.kr)
1. Vercel 프로젝트 → **Settings → Domains** → `jaytax.co.kr` 추가
2. 도메인 등록업체(가비아 등) DNS 에 Vercel 안내대로 레코드 추가:
   - 루트(`jaytax.co.kr`): A 레코드 `76.76.21.21` (Vercel 안내값 확인)
   - 또는 `www`: CNAME `cname.vercel-dns.com`
3. DNS 전파(수 분~수 시간) 후 HTTPS 자동 발급

## 4. Supabase 운영 설정 (중요)
- **Authentication → URL Configuration → Site URL** 에 배포 주소(`https://jaytax.co.kr`) 추가
- **Redirect URLs** 에도 추가 (로그인 리다이렉트 허용)
- 직원 계정: **Authentication → Users → Add user** (Auto Confirm 체크)로 추가

## 5. 이후 배포
`main` 브랜치에 push 하면 Vercel 이 자동 재배포합니다.

---
## 대안: Netlify
- 빌드 명령 `npm run build`, 게시 디렉터리 `dist`
- SPA 리다이렉트: `public/_redirects` 에 `/* /index.html 200` (또는 `netlify.toml`)
- 환경변수·도메인 설정은 위와 동일

---

## 보안 헤더 (`vercel.json`)

개인정보보호법 제29조 · 「개인정보의 안전성 확보조치 기준」 제7조(인터넷 구간 전송 암호화) 대응.
Vercel 이 HTTPS 자체는 강제하지만 **헤더는 명시해야 붙는다**.

| 헤더 | 값 | 왜 |
|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | 브라우저가 이 도메인을 **2년간 HTTPS로만** 연결한다. 처음 한 번의 http 접속을 가로채는 길(SSL stripping)을 막는다. |
| `X-Content-Type-Options` | `nosniff` | 브라우저가 파일 내용을 보고 타입을 추측하지 않게 한다. 올린 파일이 스크립트로 실행되는 것을 막는다. |
| `X-Frame-Options` | `DENY` | 다른 사이트가 jaytax 를 iframe 에 넣고 클릭을 가로채는 것(클릭재킹)을 막는다. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 외부 링크를 눌렀을 때 **어느 화면에 있었는지가 상대 사이트로 새지 않게** 한다. |
| `Permissions-Policy` | 카메라·마이크·위치 차단 | 쓰지 않는 기능은 닫아 둔다. |

### `preload` 를 넣지 않은 이유

`preload` 는 브라우저 제조사가 관리하는 목록에 도메인을 올리는 것이라 **되돌리기가 매우 어렵다**
(제거 신청 후 수개월). 하위 도메인 중 http 로만 열리는 것이 하나라도 생기면 접속이 막힌다.
지금은 `includeSubDomains` 까지만 두고, 하위 도메인 구성이 확정된 뒤에 판단한다.

### CSP(Content-Security-Policy) 는 아직 없다

넣으면 가장 강한 방어가 되지만 지금 화면이 부르는 곳이 여럿이다 — Supabase(REST·Edge Function),
esm.sh, 법제처(`law.go.kr` 조문 이미지). 목록을 빠뜨리면 **조용히 화면 일부가 깨진다**.
먼저 `Content-Security-Policy-Report-Only` 로 한동안 관찰해 실제 호출처를 모은 뒤 적용한다. (미착수)

### 배포 후 확인

```
curl -sI https://jaytax.co.kr | grep -i "strict-transport\|x-content-type\|x-frame\|referrer\|permissions"
```

다섯 줄이 모두 보이면 정상이다.
