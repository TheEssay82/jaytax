// 예측·성장 화면이 읽는 자료를 모은다. 셈법은 revenueForecast.ts 에 있다.
import { supabase } from './supabase';
import { listBizEntities } from './bizRegistryApi';
import {
  listBudgetFacts, listForecastFacts, listRevenueAll, fyRange, kstYm, type RevenueFact,
} from './revenueStatsApi';
import {
  listRenewalCandidates, listRenewalPicks, renewalFacts,
} from './budgetRenewalApi';
import { adjCarryForward, normName, overdueOneOff, sumByGroup } from './revenueForecast';

/** 앱에 매출 자료가 있는 첫 해 — 이보다 앞 해는 biz_revenue_history 에서 읽는다. */
export const FIRST_APP_FY = 2025;

export interface YearBar {
  fy: number;
  team: string;
  groups: Record<string, number>;
  total: number;
  /** 'history' 옛 엑셀 · 'actual' 실적 · 'forecast' 실적+예상 */
  kind: 'history' | 'actual' | 'forecast';
  /** 옛 엑셀 값의 기준(기간 · 계약/입금/청구). 그래프에 마우스를 올리면 보인다. */
  note?: string;
}

export async function listRevenueHistory(): Promise<YearBar[]> {
  const { data, error } = await supabase.from('biz_revenue_history').select('fy, team, grp, amount, note');
  if (error) throw new Error(error.message);
  const m = new Map<string, YearBar>();
  for (const r of (data as { fy: number; team: string; grp: string; amount: number; note: string | null }[]) ?? []) {
    if (r.fy >= FIRST_APP_FY) continue;
    const k = `${r.fy}|${r.team}`;
    const b = m.get(k) ?? { fy: r.fy, team: r.team, groups: {}, total: 0, kind: 'history' as const };
    b.groups[r.grp] = (b.groups[r.grp] ?? 0) + Number(r.amount);
    b.total += Number(r.amount);
    if (r.note && !b.note) b.note = r.note;
    m.set(k, b);
  }
  return [...m.values()];
}

export interface ForecastData {
  fy: number;
  prev: RevenueFact[];     // 앞 해 실적
  cur: RevenueFact[];      // 이번 해 실적 + 예상 + 전년동액
  carry: RevenueFact[];    // 그중 전년동액 줄
  bars: YearBar[];         // 두 팀 · 해마다
}

/** 한 해의 예측과 그 앞 해들 — 두 팀 모두. */
export async function loadForecast(fy: number): Promise<ForecastData> {
  // 팀마다 「올해」를 세는 법이 다르다 — 앞 해 실적이 어떻게 적혀 있는지에 맞춘다.
  //   · 기장팀: 실적이 **발행 기준**(3월에 법인세조정 한 번). 지난 달까지 발행 + 이번 달부터 청구 예정.
  //     월할(accrual)로 세면 7~9월 몫(3/12)이 실적에도 예상에도 없어 조정수수료가 75%만 잡혔다.
  //   · 감사팀: 실적이 **회계연도 월할**. 계약을 한 해 전체 월할로 센다(발행은 착수금이 앞 해에 나가 어긋난다).
  const { from, to } = fyRange(fy);
  const [prev, taxCur, audCur, cands, picks, ents, hist] = await Promise.all([
    listRevenueAll(fyRange(fy - 1).from, fyRange(fy - 1).to),
    listBudgetFacts(fy, 'taxteam', { includeDraft: true, monthly: true, basis: 'billing' }),
    listForecastFacts(from, to, '감사team', { includeDraft: true, monthly: true }),
    listRenewalCandidates(fy),
    listRenewalPicks(fy),
    listBizEntities(),
    listRevenueHistory().catch(() => [] as YearBar[]),
  ]);
  // 사업장이 모두 폐업 · 이관 · 종료면 「끝난 거래처」다 — 전년 동액을 넣지 않는다.
  const closed = new Set<string>();
  for (const e of ents) {
    if (e.places.length && e.places.every((p) => p.status !== '정상')) {
      closed.add(`id:${e.id}`);
      closed.add(`nm:${normName(e.name)}`);
    }
  }
  // 기장팀: 예정 달이 지났는데 아직 청구 안 된 연 · 건 계약은 이번 달로 민다(overdueOneOff).
  const cut = kstYm();
  const lastYm = (() => { const [y, m] = cut.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; })();
  const pastEnd = lastYm < to ? lastYm : to;
  const sched = pastEnd >= from
    ? await listForecastFacts(from, pastEnd, 'taxteam', { includeDraft: true, monthly: true, basis: 'billing' })
    : [];
  const overdue = overdueOneOff(sched, taxCur.filter((f) => f.origin !== '예상'), cut < from ? from : cut)
    .filter((f) => !closed.has(`id:${f.entityId}`));
  const base = [...taxCur, ...overdue, ...audCur, ...renewalFacts(fy, cands, picks)];
  const carry = adjCarryForward(prev, base, cut < from ? from : cut, closed)
    .filter((f) => !closed.has(`nm:${normName(f.company)}`));
  const cur = [...base, ...carry];

  // 앱 자료가 있는 해 중 앞 해보다 더 앞(FY2025 ~ fy-2)은 실적을 따로 읽는다.
  const mid: { fy: number; facts: RevenueFact[] }[] = [];
  for (let y = FIRST_APP_FY; y < fy - 1; y++) {
    const r = fyRange(y);
    mid.push({ fy: y, facts: await listRevenueAll(r.from, r.to) });
  }
  const bars: YearBar[] = [...hist];
  const add = (y: number, facts: RevenueFact[], kind: YearBar['kind']) => {
    for (const team of ['감사team', 'taxteam']) {
      const groups = sumByGroup(facts, team);
      bars.push({ fy: y, team, groups, total: Object.values(groups).reduce((s, v) => s + v, 0), kind });
    }
  };
  for (const m of mid) add(m.fy, m.facts, 'actual');
  if (fy - 1 >= FIRST_APP_FY) add(fy - 1, prev, 'actual');
  add(fy, cur, 'forecast');
  bars.sort((a, b) => a.fy - b.fy);
  return { fy, prev, cur, carry, bars };
}
