// 계약갱신 대상 — 표를 읽고 쓰는 일. 가리는 규칙과 셈법은 budgetRenewal.ts 에 있다.
//
// ⚠️ **여기서 계약을 만들지 않는다.** 체크는 budget_renewal 표에만 남고
//    biz_sales_contract 는 건드리지 않는다(사장님 지시 2026-09-06).
import { supabase } from './supabase';
import { listSalesContracts } from './salesContractApi';
import { listBizEntities } from './bizRegistryApi';
import { fyOf } from './revenueStatsApi';
import { erpAccountOf } from './invoiceRequestApi';
import { findNode, pathLabel } from './salesContractTaxonomy';
import { revenueKind } from './revenueClassify';
import {
  renewalCandidates, renewalAmount,
  type RenewalCandidate, type RenewalContract, type RenewalPick,
} from './budgetRenewal';
import type { RevenueFact } from './revenueStatsApi';

export {
  renewalCandidates, renewalAmount, pickedTotal,
} from './budgetRenewal';
export type { RenewalCandidate, RenewalPick } from './budgetRenewal';

/**
 * 앞 해(fy-1) 계약 중 이번 해(fy)에 같은 거래처·유형이 없는 것.
 *
 * 계약의 **정산연도(fiscalYear)** 로 가른다 — 기간으로 가르면 감사처럼 대상연도와 정산연도가
 * 어긋나는 계약에서 엉뚱한 해에 걸린다.
 */
export async function listRenewalCandidates(fy: number, team?: string): Promise<RenewalCandidate[]> {
  const [contracts, ents] = await Promise.all([listSalesContracts(), listBizEntities()]);
  const nameOf = new Map<string, string>(ents.map((e) => [e.id, e.name]));
  const toRc = (c: (typeof contracts)[number]): RenewalContract => ({
    id: c.id,
    entityId: c.entityId,
    categoryCode: c.categoryCode ?? '',
    team: c.team ?? '',
    fiscalYear: c.fiscalYear,
    billingCycle: c.billingCycle ?? '',
    amount: c.amount,
    endDate: c.endDate,
    cpa: (c.effectiveCpa ?? '').trim(),
    company: nameOf.get(c.entityId) ?? '',
    staff: c.effectiveStaff.map((s) => ({ name: s.staffName })),
  });
  const prev = contracts.filter((c) => c.fiscalYear === fy - 1).map(toRc);
  const cur = contracts.filter((c) => c.fiscalYear === fy).map(toRc);
  return renewalCandidates(prev, cur, team);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const toPick = (r: any): RenewalPick => ({
  prevId: r.prev_contract_id,
  include: !!r.include,
  amount: r.amount == null ? null : Number(r.amount),
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listRenewalPicks(fy: number): Promise<Map<string, RenewalPick>> {
  const { data, error } = await supabase.from('budget_renewal').select('*').eq('fy', fy);
  if (error) throw new Error(error.message);
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const rows = ((data as any[]) ?? []).map(toPick);
  return new Map(rows.map((p) => [p.prevId, p]));
}

/** 체크하거나 금액을 고친다. 같은 (연도, 앞 해 계약)은 한 줄만 둔다. */
export async function saveRenewalPick(
  fy: number, prevContractId: string, include: boolean, amount: number | null,
): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from('budget_renewal').upsert({
    fy, prev_contract_id: prevContractId, include, amount,
    updated_by: u.user?.id ?? null, updated_at: new Date().toISOString(),
  }, { onConflict: 'fy,prev_contract_id' });
  if (error) throw new Error(error.message);
}

/**
 * 체크된 갱신 대상을 **예상 매출 줄**로 바꾼다 — 예산 표가 다른 매출과 똑같이 다루도록.
 *
 * 담당회계사·담당직원은 **앞 해 계약의 것**을 그대로 쓴다. 갱신하면 같은 사람이 이어서
 * 맡는 것이 보통이고, 다르면 계약을 실제로 등록할 때 바로잡히기 때문이다.
 * 귀속월은 그 정산연도의 첫 달(7월)에 몰아 둔다 — 예상은 원래 한 달에 몰아 넣는다.
 */
export function renewalFacts(
  fy: number, cands: RenewalCandidate[], picks: Map<string, RenewalPick>,
): RevenueFact[] {
  const ym = `${fy}-07`;
  const out: RevenueFact[] = [];
  for (const c of cands) {
    const supply = renewalAmount(c, picks.get(c.prevId));
    if (!supply) continue;
    const share = c.staff.length ? 100 / c.staff.length : 0;
    const code = c.categoryCode;
    out.push({
      id: `renewal:${c.prevId}`,
      ym,
      fy: fyOf(ym),
      team: c.team,
      cpa: c.cpa,
      shares: c.staff.map((name) => ({ name, share })),
      erpAccount: erpAccountOf(code),
      company: c.company,
      place: '',
      typeTop: code ? (findNode(code)?.path[0]?.label ?? '기타') : '',
      typeFull: code ? pathLabel(code) : '',
      billingCycle: c.billingCycle,
      phase: '',
      status: '갱신예정',
      supply,
      origin: '예상',
      kind: revenueKind(erpAccountOf(code)),
      bizType: '',
    });
  }
  return out;
}
