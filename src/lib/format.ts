// 표시·포맷 헬퍼 — 원본 HTML(ver.4.6)의 fm/dt/getRevForYear 등을 옮긴 것
import type { Client } from '../types';

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
