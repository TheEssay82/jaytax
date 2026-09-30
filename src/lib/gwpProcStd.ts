// 2120A 주요 감사절차(K열) 표준 — 판정(Material·Unexpected)과 표준 문구 고르기(사용자 2026-09-30).
//
//   판정 기준 = 2700A-2(계획단계) 중요성. Material = |당기 잔액| > 중요성, Unexpected = |증감| > 중요성 × 90%(시트 E7 「보수적 적용」).
//   표준 = gwp_proc_std(화면에서 고치는 표) — 계정(동의어) × 판정(항상·Material·Unexpected) × 업종.
//   고를 때는 공통 + 그 회사 업종 줄만. 계정별 줄이 없는 판정은 계정 「*」 기본 줄로.
//   문구의 {증감액}·{증감률}·{잔액} 은 그 줄 금액으로 채운다.
// 순수 모듈 — DB·화면은 부르는 쪽.
import { cleanFs } from './gwpPaper2120A';

export const INDUSTRIES = ['제조업', '도소매업', '서비스업', '운송·물류업', '콘텐츠·엔터', '투자회사'] as const;
export type Industry = (typeof INDUSTRIES)[number];
export type Trigger = '항상' | 'Material' | 'Unexpected';
export const TRIGGERS: Trigger[] = ['항상', 'Material', 'Unexpected'];

export interface ProcStd {
  id: string; account: string; aliases: string[]; trigger: Trigger; industry: string;
  body: string; sort: number; active: boolean; note: string | null;
}

/** Unexpected 기준 = 중요성 × 이 비율(평안정공·알티스트 2120A E7 「=D7*0.9」). */
export const UNEXPECTED_FACTOR = 0.9;

export interface Flags { material: boolean; unexpected: boolean }
export function flagsOf(r: { prev: number | null; cur: number | null }, om: number | null, factor = UNEXPECTED_FACTOR): Flags {
  if (om == null || om <= 0) return { material: false, unexpected: false };
  return {
    material: r.cur != null && Math.abs(r.cur) > om,
    unexpected: r.cur != null && r.prev != null && Math.abs(r.cur - r.prev) > om * factor,
  };
}

/**
 * 재무제표 계정으로 업종 추정 — 처음 한 번, 담당자가 확인한다.
 * 회사 이름(사모투자·투자목적회사) → 투자회사, 원재료·재공품·제조원가 → 제조업, 판권·저작권·콘텐츠 → 콘텐츠·엔터,
 * 상품(상품매출원가)만 → 도소매업, 운송·물류 매출 → 운송·물류업, 나머지 서비스업.
 */
export function guessIndustry(labels: string[], entityName = ''): Industry {
  const has = (re: RegExp) => labels.some((l) => re.test(cleanFs(l)));
  if (/사모투자|투자목적회사|투자조합|기업인수목적|투자합자/.test(entityName)) return '투자회사';
  // 2120A 에는 「재고자산」 한 줄뿐인 회사가 많다(평안정공) — 부르는 쪽이 DSD 재무제표 과목도 함께 준다.
  if (has(/^(원재료|재공품|반제품|제조원가|제품매출원가|금형)$/)) return '제조업';
  if (has(/판권|저작권|콘텐츠|컨텐츠|제작원가|음원|저작인접권/)) return '콘텐츠·엔터';
  if (has(/^(운송수입|운송매출|물류매출|운송원가|물류원가)$/)) return '운송·물류업';
  if (has(/^(상품|상품매출원가|상품매출)$/)) return '도소매업';
  return '서비스업';
}

const CONTRA_HEAD = /^(대손충당금|감가상각누계액|손상차손누계액|정부보조금|현재가치할인차금)/;
const norm = (s: string) => cleanFs(s ?? '');

/** 이 줄의 표준 계정 — 계정 이름 → 공시 계정 → 분류 순. 차감 계정은 앞머리(감가상각누계액). */
export function stdAccountOf(row: { label: string; fsli?: string; group?: string }, std: ProcStd[]): string | null {
  const names = new Map<string, string>();
  for (const s of std) {
    if (s.account === '*') continue;
    names.set(norm(s.account), s.account);
    for (const a of s.aliases) if (!names.has(norm(a))) names.set(norm(a), s.account);
  }
  const lab = norm(row.label);
  const contra = CONTRA_HEAD.exec(lab);
  for (const k of [contra ? contra[1] : null, lab, norm(row.fsli ?? ''), norm(row.group ?? '')]) {
    if (k && names.has(k)) return names.get(k)!;
  }
  return null;
}

/** 금액 → 「+12.3억원」·「-450백만원」·「+8,000천원」 — 문장에 넣을 만큼만. */
export function fmtWon(n: number, sign = true): string {
  const s = sign ? (n > 0 ? '+' : n < 0 ? '-' : '') : n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e8) return `${s}${(Math.round(a / 1e7) / 10).toLocaleString('ko-KR')}억원`;
  if (a >= 1e6) return `${s}${Math.round(a / 1e6).toLocaleString('ko-KR')}백만원`;
  return `${s}${Math.round(a / 1e3).toLocaleString('ko-KR')}천원`;
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

/**
 * 한 줄의 표준 절차 문구 — 판정이 난 줄(과 「항상」 줄이 있는 계정)만. 없으면 null.
 * 계정별 줄이 없는 판정(Material·Unexpected)은 「*」 기본 줄로 채운다.
 */
export function suggestProc(
  row: { label: string; fsli?: string; group?: string; prev: number | null; cur: number | null },
  flags: Flags, std: ProcStd[], industry: string | null,
): string | null {
  const live = std.filter((s) => s.active && (s.industry === '공통' || s.industry === industry));
  const acct = stdAccountOf(row, live);
  const mine = acct ? live.filter((s) => s.account === acct) : [];
  const want: Trigger[] = ['항상', ...(flags.material ? (['Material'] as const) : []), ...(flags.unexpected ? (['Unexpected'] as const) : [])];
  const picked: ProcStd[] = [];
  for (const t of want) {
    const own = mine.filter((s) => s.trigger === t);
    if (own.length) picked.push(...own);
    else if (t !== '항상') picked.push(...live.filter((s) => s.account === '*' && s.trigger === t));
  }
  if (!picked.length) return null;
  const g = row.prev != null && row.cur != null ? row.cur - row.prev : null;
  const pct = g != null && row.prev ? `${g > 0 ? '+' : ''}${Math.round((g / Math.abs(row.prev)) * 1000) / 10}%` : '신규';
  const fill = (b: string) => b
    .replace(/\{증감액\}/g, g == null ? '-' : fmtWon(g))
    .replace(/\{증감률\}/g, pct)
    .replace(/\{잔액\}/g, row.cur == null ? '-' : fmtWon(row.cur, false));
  const seen = new Set<string>();
  const lines = [...picked].sort((a, b) => TRIGGERS.indexOf(a.trigger) - TRIGGERS.indexOf(b.trigger) || a.sort - b.sort)
    .map((s) => fill(s.body)).filter((t) => !seen.has(t) && seen.add(t));
  return lines.map((t, i) => `${CIRCLED[i] ?? `${i + 1})`} ${t}`).join(' ');
}

/** 분류 줄(「(1) 유형자산」)에 적힌 절차가 이 줄을 덮는가 — 평안정공·알티스트 관행. */
export const coveredByGroup = (r: { group?: string }, groupProc?: Record<string, string>) => !!(r.group && groupProc?.[r.group]?.trim());

/** Material·Unexpected 가 떴는데 절차가 없는 줄 — [확인]을 막는다(2520·2530 빈칸과 같은 규칙). */
export function missingProcs(
  d: { rows: { label: string; group?: string; prev: number | null; cur: number | null; proc?: string }[]; hasProc?: boolean; groupProc?: Record<string, string> },
  om: number | null,
): string[] {
  if (!d.hasProc || om == null) return [];
  return d.rows.filter((r) => { const f = flagsOf(r, om); return (f.material || f.unexpected) && !r.proc?.trim() && !coveredByGroup(r, d.groupProc); }).map((r) => r.label);
}
