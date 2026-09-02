// 표시·포맷 헬퍼 — 원본 HTML(ver.4.6)의 fm/dt/getRevForYear 등을 옮긴 것
import type { Client } from '../types';

/**
 * 이름 뒤에 붙는 조사를 받침에 맞춘다 — '김민섭가'가 아니라 '김민섭이'.
 * 담당자 이름을 문장에 끼워 넣는 곳이 여럿이라 한 곳에 둔다.
 */
export function withJosa(name: string, withBatchim: string, without: string): string {
  const last = name.trim().slice(-1);
  const code = last.charCodeAt(0);
  if (!last || code < 0xac00 || code > 0xd7a3) return `${name}${without}`;
  return `${name}${(code - 0xac00) % 28 ? withBatchim : without}`;
}

/** 숫자 → 천단위 콤마 (원본 fm) */
export const fm = (n: number): string => Math.round(n || 0).toLocaleString('ko-KR');

/**
 * 오늘 날짜를 'YYYY-MM-DD' 로. **로컬 시간 기준**이다.
 * toISOString() 은 UTC 라 한국시간 오전 9시 이전에는 전날이 나온다
 * (오전 8시에 회수 처리를 하면 처리일이 어제로 찍혔다).
 */
export function todayYmd(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** ISO 날짜 → 'YYYY.MM.DD' (원본 dtFmt) */
export const dtFmt = (s?: string): string => (s ? s.split('T')[0].replace(/-/g, '.') : '');

/** 귀속연도별 매출액 (revenues 구조: {year: amount}) */
export function getRevForYear(c: Client, year: number | string): number {
  if (!c) return 0;
  const v = c.revenues?.[String(year)];
  return typeof v === 'number' ? v : 0;
}

/**
 * 거래처관리 테이블 표시 연도:
 * 기준연도 포함 최근 4개년 + 실제 데이터 있는 연도 모두 (>=2015, 내림차순)
 */
export function getClientDispYears(clients: Client[], baseYear: number): number[] {
  const base = [baseYear, baseYear - 1, baseYear - 2, baseYear - 3];
  const dataYears = clients.flatMap((c) => Object.keys(c.revenues || {}).map(Number));
  return [...new Set([...base, ...dataYears])].filter((y) => y >= 2015).sort((a, b) => b - a);
}

/** 정렬 표시기 (원본 sortIndicator) */
export function sortIndicator(key: string, sortKey: string, sortDir: number): string {
  return key === sortKey ? (sortDir > 0 ? ' ▲' : ' ▼') : ' ⇅';
}

// ── 시각 표시는 반드시 한국 표준시로 ──────────────────────
// DB 는 timestamptz(내부 UTC)로 저장하고 supabase-js 는 '2026-09-02T16:44:17+00:00' 처럼 준다.
// 이 문자열을 slice 로 자르면 **UTC 가 그대로 화면에 나온다** — 한국시간 오전 9시 이전에
// 벌어진 일이 전날로 보인다(01:44 에 남긴 기록이 '9/2 16:44' 로 표시됐다).
// 날짜만 다루는 값(YYYY-MM-DD)은 시간대가 없으므로 그대로 두고, **시각이 붙은 값**만 이걸 쓴다.

/** 'YYYY-MM-DD HH:mm' (KST). 시각이 붙은 timestamptz 표시는 전부 이것으로. */
export function kstDateTime(s?: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s).replace('T', ' ').slice(0, 16);
  const f = new Intl.DateTimeFormat('sv-SE', {   // sv-SE 는 'YYYY-MM-DD HH:mm' 꼴을 준다
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return f.format(d).replace(',', '');
}

/** 'MM-DD HH:mm' (KST) — 표 안에서 연도가 군더더기일 때. */
export const kstShort = (s?: string | null): string => kstDateTime(s).slice(5);

/** 'YYYY-MM-DD' (KST) — timestamptz 에서 날짜만 뽑을 때. */
export const kstDate = (s?: string | null): string => kstDateTime(s).slice(0, 10);
