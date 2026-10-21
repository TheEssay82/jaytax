// JET 2차 — ④ 선정 전표 · 증빙요청 · 회신 읽기(사용자 2026-10-21). supabase 를 물지 않는다.
//
// 후보 = 수행한 시나리오가 추출한 **전표**(B01 은 줄 → 전표로 묶음). 여러 시나리오에 걸린 전표는 한 줄로 합쳐
// 회사가 같은 증빙을 두 번 찾지 않게 한다(중소기업 감사대응 편하게 — 사용자 요구 10).
// 요청 증빙은 시나리오별 기본값을 합친 것(고칠 수 있음). 회신은 우리가 내보낸 요청 엑셀 그대로 돌아온다고 보고 머리 낱말로 읽는다.
import type { JeLine } from './jeParse';
import { vkey, type CheckResult } from './jeChecks';

/** 전표 단위로 추출하는 시나리오(줄 0 = 전표일자, 1 = 전표번호). B03(계정) · B10(날짜) · A 계열은 후보가 아니다. */
export const VOUCHER_SCENARIOS = ['B01', 'B02', 'B07', 'B08', 'B09', 'B11', 'B12', 'B13', 'B14'] as const;

export const DEFAULT_DOCS: Record<string, string> = {
  B01: '전표 · 거래 증빙(세금계산서 · 계약서 · 계산근거)',
  B02: '전표 · 계정 신설 근거',
  B07: '계약서 · 거래명세서 · 대금 수령 증빙',
  B08: '지출결의서 · 거래 증빙',
  B09: '결산조정 계산근거(명세서)',
  B11: '계약서 · 이체확인증',
  B12: '품의서 · 거래 증빙',
  B13: '원전표 · 취소(역분개) 사유',
  B14: '계정 신설 사유 · 거래 증빙',
};

/** 회사 담당자에게 보이는 「왜 이 전표를 묻나」(쉬운 말). */
export const PLAIN_REASON: Record<string, string> = {
  B01: '금액이 큰 거래',
  B02: '계정과목표에 없는 계정을 쓴 전표',
  B07: '매출의 상대 계정이 현금 · 채권이 아닌 거래',
  B08: '주말 · 공휴일에 기표된 전표',
  B09: '결산(월말 · 기말) 조정 분개',
  B11: '딱 떨어지는 큰 금액의 거래',
  B12: '적요가 모호하거나 없는 전표',
  B13: '취소 · 역분개된 전표',
  B14: '올해 처음 쓴 계정의 전표',
};
export const plainReason = (scenarios: string[]) => [...new Set(scenarios.map((s) => PLAIN_REASON[s]).filter(Boolean))].join(' / ');

/** 금액과 상관없이 증빙을 받는 시나리오 — 성격 자체가 위험 신호(매출 상대계정 · 신규 계정). */
export const ALWAYS_ASK = ['B07', 'B14'];

/**
 * 권장 선정(사용자 2026-10-21 「샘플링 기준이 있었으면」). 지침 원칙은 시나리오에 걸린 전표를 **모두 확인**하는 것이고,
 * 확인 방법은 둘이다 — 계정 조서에서 이미 본 전표는 REF(조서 번호)로, 나머지는 회사 증빙으로.
 * 회사 증빙을 받을 전표 = 금액 ≥ 기준(기본 B01 중요성 기준) 이거나 ALWAYS_ASK 시나리오에 걸린 전표, 단 REF 가 이미 적힌 전표는 뺀다.
 */
export function recommendPicks<T extends { key: string; amount: number; scenarios: string[] }>(cands: T[], threshold: number, hasRef: (key: string) => boolean): T[] {
  return cands.filter((c) => !hasRef(c.key) && ((threshold > 0 && c.amount >= threshold) || c.scenarios.some((s) => ALWAYS_ASK.includes(s))));
}

export interface Candidate {
  key: string;
  date: string;
  no: string;
  scenarios: string[];
  /** 전표금액(차변합) */ amount: number;
  mainAcct: string;
  memo: string;
  cpName: string;
}

export function buildCandidates(results: CheckResult[], lines: JeLine[], performed: (r: CheckResult) => boolean): Candidate[] {
  const byKey = new Map<string, JeLine[]>();
  for (const l of lines) { const k = vkey(l); const a = byKey.get(k) ?? []; a.push(l); byKey.set(k, a); }
  const m = new Map<string, Candidate>();
  for (const r of results) {
    if (!(VOUCHER_SCENARIOS as readonly string[]).includes(r.code) || !performed(r) || r.status !== '예외') continue;
    for (const row of r.rows) {
      const key = `${row[0]}|${row[1]}`;
      const c = m.get(key);
      if (c) { if (!c.scenarios.includes(r.code)) c.scenarios.push(r.code); continue; }
      const ls = byKey.get(key) ?? [];
      const top = [...ls].sort((a, b) => Math.max(Math.abs(b.dr), Math.abs(b.cr)) - Math.max(Math.abs(a.dr), Math.abs(a.cr)))[0];
      m.set(key, {
        key, date: String(row[0]), no: String(row[1]), scenarios: [r.code],
        amount: Math.round(ls.reduce((s, l) => s + l.dr, 0)), mainAcct: top?.acctName ?? '', memo: top?.memo ?? '',
        cpName: ls.find((l) => l.cpName)?.cpName ?? '',
      });
    }
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date) || a.no.localeCompare(b.no, 'en', { numeric: true }));
}

export const docsFor = (scenarios: string[]) => [...new Set(scenarios.map((s) => DEFAULT_DOCS[s]).filter(Boolean))].join(' / ');

/** 회신 엑셀 한 줄 — 우리가 내보낸 「증빙요청」 시트의 전표일자 · 전표번호로 짝짓는다. */
export interface ReplyRow { date: string; no: string; answer: string | null; docs: string | null }

const t = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => t(v).replace(/\s+/g, '');
const toDate = (v: unknown): string | null => {
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t(v));
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
};

export function parseReply(rows: unknown[][]): ReplyRow[] {
  const hi = rows.findIndex((r) => { const n = r.map(norm); return n.includes('전표일자') && n.includes('전표번호') && n.some((x) => /회사설명|회신/.test(x)); });
  if (hi < 0) throw new Error('회신 엑셀에서 「전표일자 · 전표번호 · 회사 설명」 머리를 찾지 못했습니다 — 앱에서 내려받은 증빙요청 엑셀에 적어 보내 달라고 해 주세요.');
  const h = rows[hi].map(norm);
  const cD = h.indexOf('전표일자'), cN = h.indexOf('전표번호'), cA = h.findIndex((x) => /회사설명/.test(x)), cF = h.findIndex((x) => /증빙파일|첨부/.test(x));
  const out: ReplyRow[] = [];
  for (const r of rows.slice(hi + 1)) {
    const date = toDate(r[cD]);
    if (!date) continue;
    const answer = cA >= 0 ? t(r[cA]) : '', docs = cF >= 0 ? t(r[cF]) : '';
    if (!answer && !docs) continue;
    out.push({ date, no: t(r[cN]), answer: answer || null, docs: docs || null });
  }
  return out;
}

/** 결과 집계(조서 · 화면). */
export function pickSummary(picks: { selected: boolean; result: string | null }[]) {
  const sel = picks.filter((p) => p.selected);
  return { total: sel.length, ok: sel.filter((p) => p.result === '이상없음').length, exc: sel.filter((p) => p.result === '예외').length, pending: sel.filter((p) => !p.result || p.result === '확인중').length };
}
