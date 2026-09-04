// 거래처 한 장 — Ctrl+K 에서 거래처를 고르면 뜨는 **읽기 전용** 요약.
//
// 왜 필요한가: 한 거래처를 파악하려면 네 화면을 돌아야 했다 — 거래처등록(기본정보) ·
// 매출계약등록(계약) · 거래처담당자등록(연락처) · 현황및예산조회(금액).
// 「㈜오톰이 어떤 곳이더라」에 답하는 데 네 번 이동은 지나치다.
//
// **여기서는 고치지 않는다.** 고치는 일은 각 화면이 하고, 이 카드는 그리로 보내기만 한다.
// 그래야 규칙이 한 곳에만 남는다.
import { supabase } from './supabase';
import { annualize } from './annualize';
import { buildStaffIndex, resolveStaff, type ContractStaffRow, type PlaceStaffRow, type PlaceRef } from './contractStaff';
import { listArItems } from './arLedgerApi';

export interface CardPlace {
  id: string; name: string; bizRegNo: string;
  isHeadquarters: boolean; status: string; statusMonth: string;
}
export interface CardContract {
  id: string; code: string; category: string; cycle: string;
  amount: number; annual: number; cpa: string; staff: string;
  confirmed: boolean; endDate: string | null;
}
export interface CardInvoice { ym: string; summary: string; total: number; status: string }

export interface ClientCard {
  id: string; code: string; name: string; kind: string;
  places: CardPlace[];
  contracts: CardContract[];
  annualTotal: number;
  cpas: string[];
  staffs: string[];
  /** ERP 미수금대장 기준. 대장이 아직 없으면 null — **추정하지 않는다.** */
  receivable: { asOfYm: string; balance: number; over6mCount: number } | null;
  recent: CardInvoice[];
}

/** 6개월 넘게 남은 채권인가 — 발행일 기준. */
function isOver6m(issued: string | null, asOfYm: string): boolean {
  if (!issued) return false;
  const [y, m] = asOfYm.split('-').map(Number);
  const cut = new Date(y, m - 1 - 6, 1);
  return new Date(issued) < cut;
}

export async function loadClientCard(entityId: string): Promise<ClientCard> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const [ent, plc, con, cst, pst] = await Promise.all([
    supabase.from('biz_entity').select('id, code, name, kind').eq('id', entityId).single(),
    supabase.from('biz_place').select('*').eq('entity_id', entityId).order('place_no'),
    supabase.from('biz_sales_contract').select('*').eq('entity_id', entityId),
    // 담당은 **이력 테이블**이다. active 인 것만 가져온다(빠뜨리면 해제된 사람까지 센다).
    supabase.from('biz_contract_staff').select('*').eq('active', true),
    supabase.from('biz_place_staff').select('*').eq('active', true),
  ]);
  for (const r of [ent, plc, con, cst, pst]) if (r.error) throw new Error(r.error.message);

  const e = ent.data as any;
  const places: CardPlace[] = ((plc.data as any[]) ?? []).map((p) => ({
    id: p.id, name: p.place_name || '', bizRegNo: p.biz_reg_no || '',
    isHeadquarters: !!p.is_headquarters, status: p.status || '', statusMonth: p.status_month || '',
  }));
  const placeIds = new Set(places.map((p) => p.id));

  // 담당은 contractStaff 한 곳의 규칙으로 센다 — 계약 담당이 있으면 그것, 없으면 사업장 담당.
  const placeRefs: PlaceRef[] = ((plc.data as any[]) ?? []).map((p) => ({
    id: p.id, entityId: p.entity_id, isHeadquarters: !!p.is_headquarters,
  }));
  const placeStaff: PlaceStaffRow[] = ((pst.data as any[]) ?? []).map((r) => ({
    placeId: r.place_id, staffId: r.staff_id, staffName: r.staff_name || '', active: r.active !== false,
  }));
  const idx = buildStaffIndex(placeRefs, placeStaff);

  const staffOfContract = new Map<string, ContractStaffRow[]>();
  for (const r of ((cst.data as any[]) ?? [])) {
    const l = staffOfContract.get(r.contract_id) ?? [];
    l.push({
      staffId: r.staff_id, staffName: r.staff_name || '', active: r.active !== false,
      fromMonth: r.from_month ?? null, toMonth: r.to_month ?? null,
    });
    staffOfContract.set(r.contract_id, l);
  }
  const thisMonth = new Date().toISOString().slice(0, 7);

  const contracts: CardContract[] = ((con.data as any[]) ?? []).map((c) => ({
    id: c.id,
    code: c.contract_code || '',
    category: c.category_code || '',
    cycle: c.billing_cycle || '',
    amount: Number(c.amount) || 0,
    annual: annualize({ amount: Number(c.amount) || 0, billingCycle: c.billing_cycle }),
    cpa: c.cpa || '',
    staff: resolveStaff(
      { entityId, placeId: c.place_id ?? null, staff: staffOfContract.get(c.id) ?? [] },
      idx, thisMonth,
    ).staff.map((s2) => s2.staffName).join('·'),
    confirmed: !!c.confirmed,
    endDate: c.end_date ?? null,
  })).sort((a, b) => b.annual - a.annual);

  // ── 미수금 — ERP 미수금대장이 정본. 없으면 비운다(여기서 추정하지 않는다). ──
  let receivable: ClientCard['receivable'] = null;
  const ar = await listArItems();
  if (ar.length > 0) {
    const asOfYm = ar.reduce((m, r) => (r.ym > m ? r.ym : m), '');
    const mine = ar.filter((r) => r.ym === asOfYm && !r.excluded
      && (r.entityId === entityId || (r.placeId && placeIds.has(r.placeId))));
    if (mine.length > 0) {
      receivable = {
        asOfYm,
        balance: mine.reduce((s, r) => s + r.balance, 0),
        over6mCount: mine.filter((r) => r.balance > 0 && isOver6m(r.issuedDate, asOfYm)).length,
      };
    }
  }

  // ── 최근 청구 다섯 건 ──
  let recent: CardInvoice[] = [];
  if (placeIds.size > 0) {
    const { data } = await supabase.from('biz_invoice_request')
      .select('ym, summary, note, total, status, erp_account')
      .in('place_id', [...placeIds])
      .order('ym', { ascending: false })
      .limit(5);
    recent = ((data as any[]) ?? []).map((r) => ({
      ym: r.ym, total: Number(r.total) || 0, status: r.status || '',
      summary: r.erp_account || r.summary || r.note || '',
    }));
  }

  return {
    id: e.id, code: e.code || '', name: e.name || '', kind: e.kind || '',
    places, contracts,
    annualTotal: contracts.reduce((s, c) => s + c.annual, 0),
    cpas: [...new Set(contracts.map((c) => c.cpa).filter(Boolean))],
    staffs: [...new Set(contracts.map((c) => c.staff).filter(Boolean))],
    receivable, recent,
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
