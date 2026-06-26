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
