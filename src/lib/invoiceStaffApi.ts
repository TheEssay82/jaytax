// 청구 건별 실적 배분 — 누가 얼마나 가져가는가.
//
// 원칙(2026-09-01 확정)
//  · 기본은 **주담당 1명이 전액**. 여럿인 건 예외다.
//  · 실적은 청구 시점에 정해지므로 **청구할 때 비율을 바꿀 수 있어야** 한다.
//  · 그 달 청구는 그 달 담당자 몫 — 계약의 담당 이력을 청구 시점에 읽어 굳힌다.
//  · 건별매출은 사후에 발견되므로 기본값은 그 사업장 담당직원.
import { supabase } from './supabase';

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

/** 한 요청의 배분을 통째로 갈아끼운다. 합이 100이 아니면 막는다. */
export async function setInvoiceStaff(requestId: string, rows: InvoiceStaffShare[]): Promise<void> {
  const clean = rows.filter((r) => r.staffName.trim());
  const total = clean.reduce((s, r) => s + r.share, 0);
  if (clean.length && Math.round(total) !== 100) {
    throw new Error(`비율의 합이 100%가 되어야 합니다. 지금 ${Math.round(total)}%입니다.`);
  }
  await supabase.from('biz_invoice_staff').delete().eq('request_id', requestId);
  if (!clean.length) return;
  const { error } = await supabase.from('biz_invoice_staff').insert(
    clean.map((r, i) => ({ request_id: requestId, staff_name: r.staffName.trim(), share: r.share, seq: i + 1 })),
  );
  if (error) throw new Error(error.message);
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

/** 직원별 매출 집계 — 배분 비율을 반영한다. */
export async function staffRevenue(
  fromYm: string, toYm: string, team?: string,
): Promise<{ totals: StaffTotal[]; months: string[]; grand: number; unassigned: number }> {
  let q = supabase.from('biz_invoice_request')
    .select('id, ym, team, supply_amount, status, staff')
    .gte('ym', fromYm).lte('ym', toYm).neq('status', '취소');
  if (team) q = q.eq('team', team);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const reqs = (data as any[]) ?? [];
  const shares = await listInvoiceStaff(reqs.map((r) => r.id));
  const map = new Map<string, StaffTotal>();
  const monthSet = new Set<string>();
  let grand = 0, unassigned = 0;
  for (const r of reqs) {
    const amt = Number(r.supply_amount) || 0;
    grand += amt; monthSet.add(r.ym);
    const list = (shares.get(r.id) ?? []).filter((s) => s.share > 0);
    if (!list.length) { unassigned += amt; continue; }
    for (const s of list) {
      const cur = map.get(s.staffName) ?? { staffName: s.staffName, count: 0, supply: 0, byMonth: new Map() };
      const part = amt * (s.share / 100);
      cur.count += 1; cur.supply += part;
      cur.byMonth.set(r.ym, (cur.byMonth.get(r.ym) ?? 0) + part);
      map.set(s.staffName, cur);
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return {
    totals: [...map.values()].sort((a, b) => b.supply - a.supply),
    months: [...monthSet].sort(),
    grand, unassigned,
  };
}
