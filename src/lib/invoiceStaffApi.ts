// 청구 건별 실적 배분 — 누가 얼마나 가져가는가.
//
// 원칙(2026-09-01 확정)
//  · 기본은 **주담당 1명이 전액**. 여럿인 건 예외다.
//  · 실적은 청구 시점에 정해지므로 **청구할 때 비율을 바꿀 수 있어야** 한다.
//  · 그 달 청구는 그 달 담당자 몫 — 계약의 담당 이력을 청구 시점에 읽어 굳힌다.
//  · 건별매출은 사후에 발견되므로 기본값은 그 사업장 담당직원.
import { supabase } from './supabase';
import { changeContractStaffFrom } from './salesContractApi';
import { listInternalStaff } from './bizRegistryApi';

export interface InvoiceStaffShare { staffName: string; share: number; seq: number }

/** 요청 여러 건의 배분을 한 번에 읽는다. requestId → [{이름, 비율}] */
export async function listInvoiceStaff(requestIds: string[]): Promise<Map<string, InvoiceStaffShare[]>> {
  const out = new Map<string, InvoiceStaffShare[]>();
  if (!requestIds.length) return out;
  const { data, error } = await supabase.from('biz_invoice_staff')
    .select('request_id, staff_name, share, seq').in('request_id', requestIds).order('seq');
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  for (const r of (data as any[]) ?? []) {
    const l = out.get(r.request_id) ?? [];
    l.push({ staffName: r.staff_name, share: Number(r.share) || 0, seq: r.seq ?? 1 });
    out.set(r.request_id, l);
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return out;
}

/**
 * 한 요청의 담당직원·배분을 바꾼다.
 *
 * 담당은 청구 시점에 정해지므로 **여기가 변경의 출발점**이다. 세 가지를 함께 한다.
 *  ① 배분(biz_invoice_staff)을 갈아끼우고
 *  ② 발행요청의 담당직원 표기(staff)를 맞추고
 *  ③ propagate 면 **매출계약의 담당 이력을 이 달부터** 바꾼다 — 그래야 다음 달 청구가 새 담당으로 잡힌다.
 * 그리고 무엇이 어떻게 바뀌었는지 로그를 남긴다.
 */
export async function setInvoiceStaff(
  requestId: string, rows: InvoiceStaffShare[],
  opt: { propagate?: boolean; ym?: string; contractId?: string | null; placeId?: string | null; company?: string } = {},
): Promise<{ propagated: boolean }> {
  const clean = rows.filter((r) => r.staffName.trim());
  const total = clean.reduce((s, r) => s + r.share, 0);
  if (clean.length && Math.round(total) !== 100) {
    throw new Error(`비율의 합이 100%가 되어야 합니다. 지금 ${Math.round(total)}%입니다.`);
  }
  const before = (await listInvoiceStaff([requestId])).get(requestId) ?? [];
  const beforeNames = before.filter((s) => s.share > 0).map((s) => s.staffName).join(',');
  const afterNames = clean.filter((s) => s.share > 0).map((s) => s.staffName).join(',');

  await supabase.from('biz_invoice_staff').delete().eq('request_id', requestId);
  if (clean.length) {
    const { error } = await supabase.from('biz_invoice_staff').insert(
      clean.map((r, i) => ({ request_id: requestId, staff_name: r.staffName.trim(), share: r.share, seq: i + 1 })),
    );
    if (error) throw new Error(error.message);
  }
  // 발행요청의 담당직원 표기도 맞춘다 — 화면과 집계가 어긋나지 않게.
  await supabase.from('biz_invoice_request').update({ staff: afterNames || null }).eq('id', requestId);

  let propagated = false;
  if (opt.propagate && opt.contractId && opt.ym && afterNames !== beforeNames) {
    const all = await listInternalStaff();
    const picked = clean.filter((r) => r.share > 0)
      .map((r) => all.find((x) => x.name === r.staffName.trim()))
      .filter((x): x is NonNullable<typeof x> => !!x)
      .map((x) => ({ staffId: x.id, staffName: x.name }));
    if (picked.length) { await changeContractStaffFrom(opt.contractId, picked, opt.ym); propagated = true; }
  }

  if (afterNames !== beforeNames) {
    const { data: u } = await supabase.auth.getUser();
    await supabase.from('biz_staff_change_log').insert({
      ym: opt.ym ?? '', contract_id: opt.contractId ?? null, place_id: opt.placeId ?? null,
      request_id: requestId, company: opt.company ?? '',
      before_staff: beforeNames, after_staff: afterNames,
      source: '발행요청', propagated, changed_by: u.user?.id ?? null,
    });
  }
  return { propagated };
}

export interface StaffChangeLog {
  id: string; ym: string; company: string; before: string; after: string;
  propagated: boolean; changedAt: string; changedBy: string; source: string;
}
/** 담당직원 변경 이력 — 최근 것부터. */
export async function listStaffChangeLog(limit = 200): Promise<StaffChangeLog[]> {
  const { data, error } = await supabase.from('biz_staff_change_log')
    .select('id, ym, company, before_staff, after_staff, propagated, changed_at, changed_by, source')
    .order('changed_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rows = (data as any[]) ?? [];
  const ids = [...new Set(rows.map((r) => r.changed_by).filter(Boolean))];
  let names = new Map<string, string>();
  if (ids.length) {
    const { data: p } = await supabase.from('profiles').select('id, name').in('id', ids);
    names = new Map((p as any[] ?? []).map((x) => [x.id as string, ((x.name as string) || '').trim()]));
  }
  return rows.map((r) => ({
    id: r.id, ym: r.ym || '', company: r.company || '',
    before: r.before_staff || '', after: r.after_staff || '',
    propagated: !!r.propagated, changedAt: r.changed_at,
    changedBy: names.get(r.changed_by) ?? '', source: r.source || '',
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** 새 요청에 주담당 100% 로 배분을 깔아 준다. staff 는 쉼표로 여럿일 수 있다. */
export async function seedInvoiceStaff(requestIds: string[], staffByRequest: Map<string, string>): Promise<void> {
  const rows: { request_id: string; staff_name: string; share: number; seq: number }[] = [];
  for (const id of requestIds) {
    const names = (staffByRequest.get(id) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    names.forEach((n, i) => rows.push({ request_id: id, staff_name: n, share: i === 0 ? 100 : 0, seq: i + 1 }));
  }
  if (!rows.length) return;
  const { error } = await supabase.from('biz_invoice_staff').insert(rows);
  if (error) throw new Error(error.message);
}

// ── 집계 ──────────────────────────────────────────────────
export interface StaffTotal {
  staffName: string;
  count: number;
  supply: number;              // 배분 반영 공급가액
  byMonth: Map<string, number>;
}

/**
 * 매출 집계 — 직원(배분 비율 반영)과 **담당회계사** 두 축으로 함께 낸다.
 * 감사팀은 회계사 단위로만 보므로 직원 집계가 비어 있어도 정상이다.
 */
export async function staffRevenue(
  fromYm: string, toYm: string, team?: string,
): Promise<{
  totals: StaffTotal[]; cpaTotals: StaffTotal[]; months: string[];
  grand: number; unassigned: number; cpaUnassigned: number;
}> {
  let q = supabase.from('biz_invoice_request')
    .select('id, ym, team, supply_amount, status, staff, cpa')
    .gte('ym', fromYm).lte('ym', toYm).neq('status', '취소');
  if (team) q = q.eq('team', team);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const reqs = (data as any[]) ?? [];
  const shares = await listInvoiceStaff(reqs.map((r) => r.id));
  const map = new Map<string, StaffTotal>();
  const cpaMap = new Map<string, StaffTotal>();
  const monthSet = new Set<string>();
  let grand = 0, unassigned = 0, cpaUnassigned = 0;
  const add = (m: Map<string, StaffTotal>, name: string, ym: string, part: number) => {
    const cur = m.get(name) ?? { staffName: name, count: 0, supply: 0, byMonth: new Map() };
    cur.count += 1; cur.supply += part;
    cur.byMonth.set(ym, (cur.byMonth.get(ym) ?? 0) + part);
    m.set(name, cur);
  };
  for (const r of reqs) {
    const amt = Number(r.supply_amount) || 0;
    grand += amt; monthSet.add(r.ym);
    // 회계사는 나누지 않는다 — 한 건은 한 회계사 몫.
    const cpa = (r.cpa || '').trim();
    if (cpa) add(cpaMap, cpa, r.ym, amt); else cpaUnassigned += amt;

    const list = (shares.get(r.id) ?? []).filter((s) => s.share > 0);
    if (!list.length) { unassigned += amt; continue; }
    for (const s of list) add(map, s.staffName, r.ym, amt * (s.share / 100));
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const bySupply = (a: StaffTotal, b: StaffTotal) => b.supply - a.supply;
  return {
    totals: [...map.values()].sort(bySupply),
    cpaTotals: [...cpaMap.values()].sort(bySupply),
    months: [...monthSet].sort(),
    grand, unassigned, cpaUnassigned,
  };
}
