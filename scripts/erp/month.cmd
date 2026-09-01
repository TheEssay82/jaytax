@echo off
chcp 65001 >nul
rem ── 인덕 ERP 월별 4종 세트 — 기장24팀 + 감사팀 한 번에 ──────────────
rem   사용법:  month.cmd 2026-08      (달을 안 주면 전월)
rem   크롬이 뜨면 계정으로 로그인해 주세요. 팀마다 프로필이 달라 각각 한 번씩 필요합니다.
rem            기장24팀 = 정남지 · 감사팀(2본부5팀) = 정우철
rem   세션은 프로필에 남아 다음 달에는 로그인이 생략됩니다.

setlocal
cd /d "%~dp0..\.."

set MONTH=%~1
if "%MONTH%"=="" (
  set MONTHARG=
) else (
  set MONTHARG=--month %MONTH%
)

echo.
echo ===== 기장24팀 =====
node scripts\erp\fetch.mjs %MONTHARG%

echo.
echo ===== 감사팀 (2본부5팀) =====
node scripts\erp\fetch.mjs --profile audit --bu 0205 --dept 감사팀 %MONTHARG%

echo.
echo 끝났습니다. jaytax 기장등청구관리 ^> ERP 발행내역 대사에서 올리세요.
pause
