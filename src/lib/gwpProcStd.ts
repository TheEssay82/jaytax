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
  if (om == null || om <= 0 || (r.prev == null && r.cur == null)) return { material: false, unexpected: false };
  // 빈칸은 0 — 엑셀 I·J열(「=IF(ABS(F18)>$D$7…)」·「ABS(G18)>$E$7」, G = F−E)과 같게. 전기에만 있던 계정(아비즈 비유동 리스부채
  // 17.7억 → 0)도 Unexpected 다(사용자 2026-10-01 「I·J 열에 하나라도 떠 있으면 감사절차가 표시되어야」).
  return {
    material: Math.abs(r.cur ?? 0) > om,
    unexpected: Math.abs((r.cur ?? 0) - (r.prev ?? 0)) > om * factor,
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
  return stdMatchOf(row, std)?.account ?? null;
}

/** stdAccountOf + 분류 이름으로만 찾았는가(「복리후생비」 → 판매비와관리비) — 그런 줄엔 「항상」 절차를 붙이지 않는다. */
function stdMatchOf(row: { label: string; fsli?: string; group?: string }, std: ProcStd[]): { account: string; byGroup: boolean } | null {
  const names = new Map<string, string>();
  for (const s of std) {
    if (s.account === '*') continue;
    names.set(norm(s.account), s.account);
    for (const a of s.aliases) if (!names.has(norm(a))) names.set(norm(a), s.account);
  }
  const lab = norm(row.label);
  const contra = CONTRA_HEAD.exec(lab);
  // 「보증금(유동)」「리스부채(비유동)」 → 보증금·리스부채, 「재고자산평가충당금」 → 재고자산(아비즈 DSD 과목).
  const bare = lab.replace(/\((유동|비유동|유동성)\)$|-(유동|비유동)$/, '');   // 「임대보증금-유동」(휴식)
  const base = bare.replace(/(평가)?충당금$/, '');
  const keys = [contra ? contra[1] : null, lab, bare, base !== bare ? base : null];
  for (const k of keys) if (k && names.has(k)) return { account: names.get(k)!, byGroup: false };
  // 공시 계정·분류로 찾은 것은 느슨한 짝 — 「항상」을 붙이지 않는다(더그림 판관비 줄의 공시 계정이 「판매비와관리비」).
  for (const k of [norm(row.fsli ?? ''), norm(row.group ?? '')]) if (k && names.has(k)) return { account: names.get(k)!, byGroup: true };
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
  // 두 해 모두 빈 줄(양식에만 있는 계정)엔 절차가 없다 — 판관비 「사무용품비」 빈 줄에 「월별 분석」이 붙던 것(아비즈).
  if (row.prev == null && row.cur == null) return null;
  const live = std.filter((s) => s.active && (s.industry === '공통' || s.industry === industry));
  const m = stdMatchOf(row, live);
  const mine = m ? live.filter((s) => s.account === m.account) : [];
  // 「항상」은 그 계정 자체의 절차(미수수익·선급비용 재계산) — 분류로만 찾은 줄(판관비 각 계정)은 판정이 날 때만.
  // 판정이 하나라도 뜨면 그 계정의 핵심 절차(Material 줄)도 — Unexpected 만 뜬 현금에 금융기관조회가 빠지던 것(아비즈 2026-10-01).
  // 계정별 Material 줄이 없을 때 「*」 기본 Material 은 실제 Material 일 때만.
  const want: Trigger[] = [...(m && !m.byGroup ? (['항상'] as const) : []), ...(flags.material || flags.unexpected ? (['Material'] as const) : []), ...(flags.unexpected ? (['Unexpected'] as const) : [])];
  const picked: ProcStd[] = [];
  for (const t of want) {
    const own = mine.filter((s) => s.trigger === t);
    if (own.length) picked.push(...own);
    else if (t === 'Unexpected' || (t === 'Material' && flags.material)) picked.push(...live.filter((s) => s.account === '*' && s.trigger === t));
  }
  return compose(picked, row.prev, row.cur);
}

/** 고른 표준 줄 → 「① … ② …」. {증감액}·{증감률}·{잔액} 은 주어진 금액으로(빈칸은 0). */
function compose(picked: ProcStd[], prev: number | null, cur: number | null, rank: (s: ProcStd) => number = () => 0): string | null {
  if (!picked.length) return null;
  const g = (cur ?? 0) - (prev ?? 0);
  const pct = prev ? `${g > 0 ? '+' : ''}${Math.round((g / Math.abs(prev)) * 1000) / 10}%` : '신규';
  const fill = (b: string) => b
    .replace(/\{증감액\}/g, fmtWon(g))
    .replace(/\{증감률\}/g, cur == null || cur === 0 ? (prev ? '-100%' : '-') : pct)
    .replace(/\{잔액\}/g, fmtWon(cur ?? 0, false));
  const seen = new Set<string>();
  const lines = [...picked].sort((a, b) => TRIGGERS.indexOf(a.trigger) - TRIGGERS.indexOf(b.trigger) || rank(a) - rank(b) || a.sort - b.sort)
    .map((s) => fill(s.body)).filter((t) => !seen.has(t) && seen.add(t));
  return lines.map((t, i) => `${CIRCLED[i] ?? `${i + 1})`} ${t}`).join(' ');
}

// ── 묶음 — 재고자산·유형자산·무형자산은 계정마다가 아니라 묶어서 한 번(사용자 2026-10-01) ─────────
export type Bundle = '재고자산' | '유형자산' | '무형자산' | '투자부동산';
// 투자부동산 — 사용자가 든 셋은 아니지만 세 회사(더그림·휴식·제이스튜디오) 틀 모두 유형·무형과 같이 분류 줄에 적는다.
export const BUNDLES: Bundle[] = ['재고자산', '유형자산', '무형자산', '투자부동산'];
/** 묶음 절차에 쓰는 표준 계정 — 유형자산은 건설중인자산 줄까지(감가상각누계액 줄은 「감가상각비 재계산」과 겹쳐 뺀다). */
const BUNDLE_ACCTS: Record<Bundle, string[]> = { 재고자산: ['재고자산'], 유형자산: ['유형자산', '건설중인자산'], 무형자산: ['무형자산'], 투자부동산: ['투자부동산'] };
/** 묶음에 드는 표준 계정 — 감가상각누계액 줄도 유형자산 묶음이다. */
const BUNDLE_MEMBERS: Record<Bundle, string[]> = { ...BUNDLE_ACCTS, 유형자산: [...BUNDLE_ACCTS.유형자산, '감가상각누계액'] };

type PRow = { key?: string; label: string; fsli?: string; group?: string; prev: number | null; cur: number | null; proc?: string };
/** 이 줄이 드는 묶음 — 분류 이름(「(1) 유 형 자 산」)이 먼저, 아니면 표준 계정(원재료 → 재고자산, 감가상각누계액-기계장치 → 유형자산). */
export function bundleOf(row: PRow, std: ProcStd[]): Bundle | null {
  const g = norm(row.group ?? '');
  const byGroup = BUNDLES.find((b) => g === b);
  if (byGroup) return byGroup;
  const a = stdAccountOf({ label: row.label, fsli: row.fsli }, std);
  return BUNDLES.find((b) => a && BUNDLE_MEMBERS[b].includes(a)) ?? null;
}

export interface ProcBundle {
  id: string; bundle: Bundle; group: string;
  /** 절차를 분류 줄(K38 「(1) 유형자산」)에 — 아니면 묶음의 첫 줄(holder)에(평안정공 「재고자산」 한 줄) */ onGroup: boolean;
  holder: string; rows: PRow[]; flags: Flags; prev: number; cur: number;
}
/** 금액이 있는 줄의 묶음들 — 같은 분류 안의 같은 묶음끼리. */
export function bundlesOf(rows: PRow[], std: ProcStd[], om: number | null): ProcBundle[] {
  const out = new Map<string, ProcBundle>();
  for (const r of rows) {
    if (r.prev == null && r.cur == null) continue;
    const b = bundleOf(r, std);
    if (!b) continue;
    const group = r.group ?? '';
    const id = `${group}|${b}`;
    const u = out.get(id) ?? { id, bundle: b, group, onGroup: norm(group) === b, holder: r.key ?? r.label, rows: [], flags: { material: false, unexpected: false }, prev: 0, cur: 0 };
    const f = flagsOf(r, om);
    u.rows.push(r);
    // 문구의 {증감액}·{잔액} 은 취득가(차감 계정 뺀) 합계 — 순액이면 취득·상각이 서로 지워 「0원 변동」이 된다.
    if (!CONTRA_HEAD.test(norm(r.label)) && !/충당금$/.test(norm(r.label))) { u.prev += r.prev ?? 0; u.cur += r.cur ?? 0; }
    u.flags = { material: u.flags.material || f.material, unexpected: u.flags.unexpected || f.unexpected };
    out.set(id, u);
  }
  return [...out.values()];
}
/** 묶음에 적힌 절차 — 분류 줄 칸 또는 첫 줄 칸. */
export const bundleProc = (u: ProcBundle, groupProc?: Record<string, string>) =>
  (u.onGroup ? groupProc?.[u.group] : u.rows.find((r) => (r.key ?? r.label) === u.holder)?.proc)?.trim() ?? '';

/** 묶음 표준 절차 — 묶음 계정들의 「항상」 + 한 줄이라도 뜬 판정. 금액은 묶음 합계. */
export function suggestBundle(u: ProcBundle, std: ProcStd[], industry: string | null): string | null {
  const live = std.filter((s) => s.active && (s.industry === '공통' || s.industry === industry));
  const accts = BUNDLE_ACCTS[u.bundle];
  const mine = live.filter((s) => accts.includes(s.account));
  const want: Trigger[] = ['항상', ...(u.flags.material || u.flags.unexpected ? (['Material'] as const) : []), ...(u.flags.unexpected ? (['Unexpected'] as const) : [])];
  const picked: ProcStd[] = [];
  for (const t of want) {
    // 건설중인자산 줄은 그 계정이 묶음에 있을 때만.
    const own = mine.filter((s) => s.trigger === t && (s.account !== '건설중인자산' || u.rows.some((r) => norm(r.label).includes('건설중인자산'))));
    if (own.length) picked.push(...own);
    else if (t === 'Unexpected' || (t === 'Material' && u.flags.material)) picked.push(...live.filter((s) => s.account === '*' && s.trigger === t));
  }
  if (!u.flags.material && !u.flags.unexpected && !picked.some((s) => s.trigger === '항상')) return null;
  return compose(picked, u.prev, u.cur, (s) => accts.indexOf(s.account));
}

/**
 * 분류 줄(「(1) 유형자산」)에 적힌 절차가 이 줄을 덮는가 — 묶음 분류(재고·유형·무형자산·투자부동산)만.
 * 판관비 분류 줄의 「월별 변동 분석」은 판정 난 계정(급여 등)을 덮지 않는다(사용자 2026-10-01 「I·J 에 하나라도 뜨면 절차」).
 */
export const coveredByGroup = (r: { group?: string }, groupProc?: Record<string, string>) =>
  !!(r.group && groupProc?.[r.group]?.trim() && (BUNDLES as string[]).includes(norm(r.group)));

/**
 * Material·Unexpected 가 떴는데 절차가 없는 줄 — [확인]을 막는다(2520·2530 빈칸과 같은 규칙).
 * 재고·유형·무형자산은 묶음으로 — 한 줄이라도 떴으면 묶음 절차(분류 줄 또는 첫 줄)가 있어야 한다.
 */
export function missingProcs(
  d: { rows: PRow[]; hasProc?: boolean; groupProc?: Record<string, string> },
  om: number | null, std: ProcStd[] = [],
): string[] {
  if (!d.hasProc || om == null) return [];
  const rows = d.rows.filter((r) => { if (bundleOf(r, std)) return false; const f = flagsOf(r, om); return (f.material || f.unexpected) && !r.proc?.trim() && !coveredByGroup(r, d.groupProc); }).map((r) => r.label);
  const bundles = bundlesOf(d.rows, std, om).filter((u) => (u.flags.material || u.flags.unexpected) && !bundleProc(u, d.groupProc)).map((u) => `${u.bundle}(묶음)`);
  return [...rows, ...bundles];
}

/**
 * 다른 업종 문구 — 틀을 이어받으며 딸려 온 것(평안정공 계열 「미정산 운송건」「기중 운송비가 많은 거래처」가
 * 콘텐츠 회사 더그림엔터테인먼트·서비스 회사 휴식 2120A 에도 그대로, 사용자 2026-10-01 제공 파일).
 * [표준 절차 넣기]가 이런 줄은 회사 문구로 보지 않고 표준으로 바꾼다.
 */
export const OFF_INDUSTRY: { industry: Industry; re: RegExp }[] = [
  { industry: '운송·물류업', re: /운송건|미확정\s*운송비|기중\s*운송비|운반비\s*미지급|운반비와\s*월말|월운송비|물류비에\s*대한|운반비에\s*대한/ },
];
export const offIndustry = (text: string, industry: string | null) => OFF_INDUSTRY.some((o) => o.industry !== industry && o.re.test(text));

/**
 * [표준 절차 넣기] — 판정이 났는데 빈 곳만 채운다. 이미 적힌 회사 문구는 건드리지 않는다.
 *   재고·유형·무형자산 → 묶음 절차 하나(분류 줄 또는 첫 줄). 묶음 안 계정 줄에 전에 넣은 표준 문구(계정별)는 걷어낸다.
 *   나머지 줄 → 계정별 표준(없으면 「*」 기본). 분류 줄 절차가 덮는 줄(평안정공 관행)은 둔다. 다른 업종 문구(offIndustry)는 바꾼다.
 */
export function fillStdProcs<R extends PRow & { key: string; procStd?: boolean }, D extends { rows: R[]; groupProc?: Record<string, string>; groupStd?: string[] }>(
  d: D, std: ProcStd[], industry: string | null, om: number | null,
): { data: D; n: number } {
  let n = 0;
  const units = bundlesOf(d.rows, std, om);
  const unitOf = new Map(units.flatMap((u) => u.rows.map((r) => [(r as R).key, u] as const)));
  const groupProc = { ...(d.groupProc ?? {}) };
  const groupStd = new Set(d.groupStd ?? []);
  const holderText = new Map<string, string>();
  // 「표준」 표시가 남은 칸(사람이 안 고친 것)은 다시 누르면 최신 표준으로 — 표준을 고친 뒤 이미 채운 회사에도 반영되게.
  const autoGroup = new Set(d.groupStd ?? []);
  const autoRow = new Set(d.rows.filter((r) => r.procStd).map((r) => r.key));
  for (const u of units) {
    const auto = u.onGroup ? autoGroup.has(u.group) : autoRow.has(u.holder);
    if (bundleProc(u, d.groupProc) && !auto) continue;
    const t = suggestBundle(u, std, industry);
    if (!t || t === bundleProc(u, d.groupProc)) continue;
    n += 1;
    if (u.onGroup) { groupProc[u.group] = t; groupStd.add(u.group); } else holderText.set(u.holder, t);
  }
  const rows = d.rows.map((r) => {
    const u = unitOf.get(r.key);
    if (u) {
      if (holderText.has(r.key)) return { ...r, proc: holderText.get(r.key)!, procStd: true };
      return r.procStd && (u.onGroup || r.key !== u.holder) ? { ...r, proc: '', procStd: false } : r;
    }
    const off = !!r.proc?.trim() && offIndustry(r.proc, industry);
    if ((r.proc?.trim() && !off && !r.procStd) || coveredByGroup(r, d.groupProc)) return r;
    const t = suggestProc(r, flagsOf(r, om), std, industry);
    // 업종에 안 맞는 이월 문구·판정이 사라진 표준 문구는 비운다.
    if (!t) return off || r.procStd ? { ...r, proc: '', procStd: false } : r;
    if (t === r.proc) return r;
    n += 1;
    return { ...r, proc: t, procStd: true };
  });
  return { data: { ...d, rows, groupProc, groupStd: [...groupStd] }, n };
}

// ── 표준 쌓기 — 화면에서 적은 절차·다른 회사 2120A 를 표준 줄로(사용자 2026-10-01 「WEB 창에서 표준절차를 직접」·「샘플 회사 것을 합쳐서」) ──

/** 「① A / ② B」·줄바꿈 → [A, B]. 번호·불릿·빈 줄은 뗀다. */
export function splitProc(text: string): string[] {
  return text
    .split(/(?=[①-⑳])|\n|\s\/\s/)
    .map((t) => t.replace(/^[\s①-⑳\-·•]+/, '').replace(/^\d+[).]\s*/, '').trim())
    .filter((t) => t.length >= 4);
}

/** 그 회사 금액을 자리표시로 — 「전기 대비 +6.9억원(+1499.7%)」 → 「전기 대비 {증감액}({증감률})」. */
export function generalizeProc(t: string): string {
  return t
    .replace(/[+-]?\d[\d,.]*\s*(억원|백만원|천원|원)\s*\(\s*([+-]?\d[\d,.]*%|신규|-)\s*\)/g, '{증감액}({증감률})')
    .replace(/[+-]\d[\d,.]*\s*(억원|백만원|천원)/g, '{증감액}');
}

/** 같은 문구인가 — 띄어쓰기·문장부호·괄호 속 주장(E/O, A) 무시. */
export const procKey = (t: string) => generalizeProc(t).replace(/\([^)]*\)\s*$/, '').replace(/[\s.,·:;'"()（）\-—–/]/g, '').toLowerCase();

/** 이 문구가 표준에 이미 있나 — 같은 계정(또는 기본 「*」)의 줄과 견준다. */
export function stdHas(std: ProcStd[], account: string, body: string): boolean {
  const k = procKey(body);
  return std.some((s) => (s.account === account || s.account === '*') && procKey(s.body) === k);
}

/** 이 문구의 판정 — 변동·증감 이야기면 Unexpected, 아니면 그 줄의 판정(Material 우선). */
export function triggerOf(body: string, flags?: Flags): Trigger {
  if (/\{증감액\}|변동|증감/.test(body)) return 'Unexpected';
  if (flags && !flags.material && flags.unexpected) return 'Unexpected';
  return 'Material';
}

export interface Harvest {
  /** 표준 계정(이미 있는 계정이면 그 이름, 없으면 줄 이름) */ account: string;
  /** 원래 줄 이름(동의어 후보) */ label: string;
  trigger: Trigger; body: string;
  /** 표준에 이미 있다 */ exists: boolean;
  /** 다른 업종 문구(운송) — 기본으로 고르지 않는다 */ off: boolean;
}

/**
 * 2120A 한 장의 절차 → 표준 후보 줄. 계정 줄은 표준 계정으로(없으면 줄 이름), 재고·유형·무형·투자부동산 분류 줄 절차는 묶음 계정으로.
 * 같은 (계정·문구)는 한 번만.
 */
export function harvestProcs(
  d: { rows: PRow[]; groupProc?: Record<string, string> }, std: ProcStd[], om: number | null,
): Harvest[] {
  const out: Harvest[] = [];
  const seen = new Set<string>();
  const add = (account: string, label: string, text: string, flags?: Flags) => {
    for (const raw of splitProc(text)) {
      const body = generalizeProc(raw);
      const k = `${account}|${procKey(body)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ account, label, trigger: triggerOf(body, flags), body, exists: stdHas(std, account, body), off: OFF_INDUSTRY.some((o) => o.re.test(body)) });
    }
  };
  for (const [g, text] of Object.entries(d.groupProc ?? {})) {
    const b = BUNDLES.find((x) => x === norm(g));
    if (b && text.trim()) add(b, b, text);
  }
  for (const r of d.rows) {
    if (!r.proc?.trim() || /테스트|test/i.test(r.label)) continue;
    const label = norm(r.label).replace(/^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX]+\./, '');
    const account = bundleOf(r, std) ?? stdAccountOf({ label: r.label }, std) ?? label;
    add(account, label, r.proc, om ? flagsOf(r, om) : undefined);
  }
  return out;
}
