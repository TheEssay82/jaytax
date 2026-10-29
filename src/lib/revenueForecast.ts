// 매출통계 › 예측·성장 — **셈법만**. supabase 를 물지 않는다(테스트가 돌아야 하므로).
//
// 한 해의 예측 = 지난 달까지 실적 + 이번 달부터 계약 예상(listBudgetFacts)
//              + **조정수수료 전년 동액**(이 파일).
//
// 조정수수료(법인세조정 · 종합소득세)는 해마다 새 계약이 필요한데, 계약이 아직 안 들어온
// 거래처가 많다(FY2026 기장팀 82건 중 77건이 미확정, 감사팀은 FY2025 22곳 중 11곳만 등록).
// 그대로 두면 예측이 통째로 낮아진다 — 사용자 요구(2026-10-29) 「적어도 전년 동액으로」.
//
// 규칙(사용자 확정 2026-10-29): **계약 우선, 없으면 전년 실적.**
//   · 그 해에 같은 거래처의 조정수수료가 실적이든 계약이든 한 줄이라도 있으면 → 그것을 쓴다.
//   · 없으면 → 앞 해 실제 금액을 **같은 달(1년 뒤)** 에 넣는다. 이미 지난 달이면 이번 달로 민다.
//   · 폐업 · 이관 · 종료한 거래처는 넣지 않는다.
import type { RevenueFact } from './revenueStatsApi';

/** 거래처 이름 비교용 — ㈜ · (주) · (합) · (유) · 유한회사 · 공백을 뗀다. */
export function normName(s: string): string {
  return (s || '')
    .replace(/㈜|\(주\)|주식회사|\(합\)|\(유\)|유한회사|합자회사|\s+/g, '')
    .toLowerCase();
}

/** 해를 넘겨 같은 거래처를 맞추는 열쇠 — 거래처 id 가 있으면 그것, 없으면 이름. */
export function partyKey(f: Pick<RevenueFact, 'entityId' | 'company'>): string {
  return f.entityId ? `id:${f.entityId}` : `nm:${normName(f.company)}`;
}

/**
 * 팀마다 매출을 가르는 칸. 감사팀은 감사 · 용역 · 세무조정.
 * 기장팀의 자문(컨설팅)은 따로 뺀다 — FY2025 실적은 「컨설팅」이 기장료로, FY2026 계약은
 * 「기타용역수입」이 기타로 떨어져 두 해를 견주면 기장료가 줄고 기타가 생긴 것처럼 보였다.
 */
export const GROUPS: Record<string, readonly string[]> = {
  taxteam: ['기장료', '조정수수료', '자문·기타'],
  감사team: ['감사', '용역', '세무조정'],
};

export function groupOf(f: Pick<RevenueFact, 'team' | 'kind' | 'erpAccount' | 'typeTop'>): string {
  if (f.team === '감사team') {
    if (f.kind === '세무조정') return '세무조정';
    const a = `${f.erpAccount} ${f.typeTop}`;
    return a.includes('감사') ? '감사' : '용역';
  }
  if (f.kind === '세무조정') return '조정수수료';
  const a = (f.erpAccount || '').trim();
  if (a === '컨설팅' || a === '경영자문수입' || a.includes('용역')) return '자문·기타';
  return f.kind === '기장료' ? '기장료' : '자문·기타';
}

const addYear = (ym: string) => `${Number(ym.slice(0, 4)) + 1}${ym.slice(4)}`;

/**
 * 조정수수료 전년 동액 줄을 만든다.
 *
 * @param prev   앞 해 실적(조정수수료 아닌 줄이 섞여 있어도 된다)
 * @param cur    이번 해 실적 + 예상
 * @param curYm  이번 달 — 이보다 앞 달로는 넣지 않는다(지난 달은 실적만 센다)
 * @param closed 폐업 · 이관 · 종료한 거래처의 partyKey
 */
export function adjCarryForward(
  prev: RevenueFact[], cur: RevenueFact[], curYm: string, closed: Set<string> = new Set(),
): RevenueFact[] {
  const has = new Set<string>();
  for (const f of cur) if (f.kind === '세무조정') { has.add(partyKey(f)); has.add(`nm:${normName(f.company)}`); }
  const out: RevenueFact[] = [];
  for (const f of prev) {
    if (f.kind !== '세무조정' || !f.supply) continue;
    const k = partyKey(f);
    if (has.has(k) || has.has(`nm:${normName(f.company)}`) || closed.has(k)) continue;
    const ym0 = addYear(f.ym);
    const ym = ym0 < curYm ? curYm : ym0;
    out.push({
      ...f,
      id: `carry:${f.id}`,
      ym,
      fy: f.fy + 1,
      status: '전년동액',
      origin: '예상',
    });
  }
  return out;
}

/** 한 해 합계를 칸별로. */
export function sumByGroup(facts: RevenueFact[], team: string): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries((GROUPS[team] ?? []).map((g) => [g, 0]));
  for (const f of facts) {
    if (f.team !== team) continue;
    const g = groupOf(f);
    out[g] = (out[g] ?? 0) + f.supply;
  }
  return out;
}

/** 거래처 한 곳의 앞 해 · 이번 해 칸별 금액. */
export interface PartyRow {
  key: string;
  company: string;
  prev: Record<string, number>;
  cur: Record<string, number>;
  /** 이번 해 조정수수료가 어디서 왔나 — 실적 · 계약 · 전년동액(여럿이면 이어 붙임). */
  adjSource: string;
  prevTotal: number;
  curTotal: number;
}

export function partyRows(prev: RevenueFact[], cur: RevenueFact[], team: string): PartyRow[] {
  const groups = GROUPS[team] ?? [];
  const blank = () => Object.fromEntries(groups.map((g) => [g, 0])) as Record<string, number>;
  const m = new Map<string, PartyRow & { src: Set<string> }>();
  // 이름이 같은 곳은 id 유무와 상관없이 한 줄로 — 옛 실적엔 id 가 빠진 줄이 있다.
  const alias = new Map<string, string>();
  const keyOf = (f: RevenueFact) => {
    const nm = `nm:${normName(f.company)}`;
    const id = f.entityId ? `id:${f.entityId}` : '';
    const key = alias.get(nm) ?? (id ? alias.get(id) ?? id : nm);
    alias.set(nm, key);
    if (id) alias.set(id, key);
    return key;
  };
  const row = (f: RevenueFact) => {
    const k = keyOf(f);
    let r = m.get(k);
    if (!r) {
      r = { key: k, company: f.company, prev: blank(), cur: blank(), adjSource: '', prevTotal: 0, curTotal: 0, src: new Set() };
      m.set(k, r);
    }
    return r;
  };
  for (const f of prev) {
    if (f.team !== team) continue;
    const r = row(f); const g = groupOf(f);
    r.prev[g] = (r.prev[g] ?? 0) + f.supply; r.prevTotal += f.supply;
  }
  for (const f of cur) {
    if (f.team !== team) continue;
    const r = row(f); const g = groupOf(f);
    r.company = f.company || r.company;
    r.cur[g] = (r.cur[g] ?? 0) + f.supply; r.curTotal += f.supply;
    if (f.kind === '세무조정') r.src.add(f.status === '전년동액' ? '전년동액' : f.origin === '예상' ? '계약' : '실적');
  }
  return [...m.values()].map(({ src, ...r }) => ({ ...r, adjSource: [...src].join('·') }));
}

/**
 * 지난 달에 청구하기로 돼 있었는데 아직 청구되지 않은 **연 · 건 계약**을 이번 달로 민다.
 *
 * 예측은 「지난 달까지 실적 + 이번 달부터 예정」이라, 예정 달이 지나 버린 한 번짜리 청구는
 * 실적에도 예정에도 없어 조용히 빠진다. 청구월이 빈 연 계약은 시작 달(7월)로 잡히므로
 * 특히 그렇다(FY2026 세무조정 3건 12,000,000, 2026-10-29 확인).
 * 월 · 분기 계약은 밀지 않는다 — 지난 달 기장료가 안 나갔다면 해지일 수 있어 지어내지 않는다.
 *
 * @param sched  지난 달까지의 **예정**(청구 기준)
 * @param actual 같은 해 실적(청구)
 */
export function overdueOneOff(sched: RevenueFact[], actual: RevenueFact[], curYm: string): RevenueFact[] {
  const billed = new Set<string>();
  for (const f of actual) {
    const g = groupOf(f);
    billed.add(`${partyKey(f)}|${g}`); billed.add(`nm:${normName(f.company)}|${g}`);
  }
  return sched
    .filter((f) => (f.billingCycle === '연' || f.billingCycle === '건') && f.ym < curYm && f.supply)
    .filter((f) => !billed.has(`${partyKey(f)}|${groupOf(f)}`) && !billed.has(`nm:${normName(f.company)}|${groupOf(f)}`))
    .map((f) => ({ ...f, id: `overdue:${f.id}`, ym: curYm, status: '미청구 이월' }));
}
