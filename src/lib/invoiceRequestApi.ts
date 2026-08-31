// 기장등청구관리 › 세금계산서 발행요청 데이터 레이어 (마이그 0075)
//
// 흐름: 매출계약에서 그 달 청구예정을 전개(billingSchedule) → 발행요청 생성 → 발행완료(세계번호·발행일).
// 금액은 요청 시점 스냅샷으로 굳힌다 — 계약이 나중에 바뀌어도 이미 나간 요청·발행 이력은 그대로여야 한다.
import { supabase, assertWrote } from './supabase';
import { billingItemsForMonth } from './billingSchedule';
import { listSalesContracts, type SalesContract } from './salesContractApi';
import { corpDisplayName, type BizEntityFull } from './bizRegistryApi';

export const VAT_RATE = 0.1;
export type InvoiceStatus = '요청' | '발행완료' | '취소';

export interface InvoiceRequest {
  id: string;
  ym: string;
  entityId: string;
  placeId: string | null;
  contractId: string | null;
  installmentId: string | null;
  supplyAmount: number;
  vat: number;
  total: number;
  status: InvoiceStatus;
  invoiceNo: string;
  issuedDate: string | null;
  companyName: string;
  placeName: string;
  contractCode: string;
  note: string;
  requestedAt: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const toReq = (r: any): InvoiceRequest => ({
  id: r.id, ym: r.ym, entityId: r.entity_id, placeId: r.place_id, contractId: r.contract_id,
  installmentId: r.installment_id, supplyAmount: Number(r.supply_amount) || 0, vat: Number(r.vat) || 0,
  total: Number(r.total) || 0, status: r.status, invoiceNo: r.invoice_no || '', issuedDate: r.issued_date,
  companyName: r.company_name || '', placeName: r.place_name || '', contractCode: r.contract_code || '',
  note: r.note || '', requestedAt: r.requested_at,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 발행요청 조회 — ym 을 주면 그 달만. */
export async function listInvoiceRequests(ym?: string): Promise<InvoiceRequest[]> {
  let q = supabase.from('biz_invoice_request').select('*').order('ym', { ascending: false }).order('company_name');
  if (ym) q = q.eq('ym', ym);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as unknown[]).map(toReq);
}

/** 그 달 청구예정 후보 한 건(아직 요청 안 된 것). */
export interface InvoiceCandidate {
  key: string;                  // contractId + installmentId
  entityId: string;
  placeId: string | null;
  contractId: string;
  installmentId: string | null;
  companyName: string;
  placeName: string;
  contractCode: string;
  typeLabel: string;            // 매출유형(경로 라벨은 화면에서 붙인다)
  cpa: string;
  staff: string;
  label: string;                // 분할 회차명
  supplyAmount: number;
  confirmed: boolean;           // 계약확정 여부(미계약이면 표시해 준다)
  billingCycle: string;         // 청구주기 — 연 1회면 청구월을 실제 요청월로 맞춘다
  billingMonth: number | null;  // 계약에 적힌 청구월(잠정값일 수 있다)
}

/**
 * 그 달에 청구할 계약 항목을 펼쳐 발행요청 후보로 만든다.
 * 이미 요청된 건(취소 제외)은 빼고 돌려준다.
 */
export async function listInvoiceCandidates(ym: string, entities: BizEntityFull[]): Promise<InvoiceCandidate[]> {
  const [contracts, existing] = await Promise.all([listSalesContracts(), listInvoiceRequests(ym)]);
  const taken = new Set(
    existing.filter((r) => r.status !== '취소')
      .map((r) => `${r.contractId ?? ''}|${r.installmentId ?? ''}`),
  );
  const entMap = new Map(entities.map((e) => [e.id, e]));

  const out: InvoiceCandidate[] = [];
  for (const c of contracts) {
    const items = billingItemsForMonth(c, ym);
    if (!items.length) continue;
    const e = entMap.get(c.entityId);
    const place = e?.places.find((p) => p.id === c.placeId) ?? e?.places.find((p) => p.isHeadquarters) ?? e?.places[0];
    for (const it of items) {
      const key = `${c.id}|${it.installmentId ?? ''}`;
      if (taken.has(key)) continue;
      if (it.net <= 0) continue;
      out.push({
        key,
        entityId: c.entityId,
        placeId: place?.id ?? null,
        contractId: c.id,
        installmentId: it.installmentId,
        companyName: e ? corpDisplayName(e.name, e.corpForm, e.corpFormPosition) : '',
        placeName: place?.placeName ?? '',
        contractCode: c.contractCode,
        typeLabel: c.categoryCode,
        cpa: c.effectiveCpa,
        staff: c.effectiveStaff.map((s) => s.staffName).join(','),
        label: it.label,
        supplyAmount: it.net,
        confirmed: c.confirmed,
        billingCycle: c.billingCycle,
        billingMonth: c.billingMonth,
      });
    }
  }
  return out.sort((a, b) => a.companyName.localeCompare(b.companyName, 'ko'));
}

/** 후보를 발행요청으로 등록 — 생성 건수 반환 */
export async function createInvoiceRequests(ym: string, rows: InvoiceCandidate[]): Promise<number> {
  if (!rows.length) return 0;
  const { data: u } = await supabase.auth.getUser();
  const payload = rows.map((r) => {
    const vat = Math.round(r.supplyAmount * VAT_RATE);
    return {
      ym,
      entity_id: r.entityId,
      place_id: r.placeId,
      contract_id: r.contractId,
      installment_id: r.installmentId,
      supply_amount: r.supplyAmount,
      vat,
      total: r.supplyAmount + vat,
      status: '요청',
      company_name: r.companyName,
      place_name: r.placeName,
      contract_code: r.contractCode,
      note: r.label || null,
      requested_by: u.user?.id ?? null,
    };
  });
  const { data, error } = await supabase.from('biz_invoice_request').insert(payload).select('id');
  if (error) throw new Error(error.message);
  await syncContractBillingMonth(ym, rows);
  return data?.length ?? 0;
}

/**
 * 연 1회 계약의 청구월을 '실제로 요청한 달'로 맞춘다.
 * 세무조정 청구월(법인세 3월·소득세 5월/성실 6월)은 지난 해 실적에서 잡은 값이라 잠정치다 —
 * 실제로 발행요청을 낸 달이 곧 그 계약의 청구월이므로, 요청하는 순간 계약이 현실을 따라간다.
 * 분할회차가 있는 계약(감사 등)은 회차 납기가 기준이라 건드리지 않는다.
 */
async function syncContractBillingMonth(ym: string, rows: InvoiceCandidate[]): Promise<void> {
  const month = Number(ym.slice(5, 7));
  if (!month) return;
  const targets = [...new Set(
    rows.filter((r) => r.billingCycle === '연' && !r.installmentId && r.billingMonth !== month)
      .map((r) => r.contractId),
  )];
  if (!targets.length) return;
  // 실패해도 요청 자체는 이미 등록됐으므로 조용히 넘어간다(다음 요청 때 다시 맞춰진다).
  await supabase.from('biz_sales_contract').update({ billing_month: month }).in('id', targets);
}

/** 발행완료 처리 — 세금계산서 번호·발행일 기록 */
export async function markIssued(ids: string[], invoiceNo: string | null, issuedDate: string): Promise<void> {
  if (!ids.length) return;
  const { data: u } = await supabase.auth.getUser();
  const row: Record<string, unknown> = {
    status: '발행완료', issued_date: issuedDate, issued_by: u.user?.id ?? null,
  };
  // 여러 건을 한 번에 처리할 때는 번호를 비워 둔다(건별로 다르므로).
  if (invoiceNo !== null) row.invoice_no = invoiceNo;
  const { data, error } = await supabase.from('biz_invoice_request').update(row).in('id', ids).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '발행완료 처리');
}

/** 요청 취소(되돌리기) — 다시 후보로 돌아간다 */
export async function cancelRequests(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { data, error } = await supabase.from('biz_invoice_request')
    .update({ status: '취소' }).in('id', ids).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '요청 취소');
}

/** 발행완료 → 요청으로 되돌리기(오기입 정정용) */
export async function revertToRequested(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { data, error } = await supabase.from('biz_invoice_request')
    .update({ status: '요청', invoice_no: null, issued_date: null }).in('id', ids).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '되돌리기');
}

/** 한 건 수정(번호·발행일·비고·금액) */
export async function updateInvoiceRequest(
  id: string,
  patch: { invoiceNo?: string; issuedDate?: string | null; note?: string; supplyAmount?: number },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.invoiceNo !== undefined) row.invoice_no = patch.invoiceNo || null;
  if (patch.issuedDate !== undefined) row.issued_date = patch.issuedDate || null;
  if (patch.note !== undefined) row.note = patch.note || null;
  if (patch.supplyAmount !== undefined) {
    const vat = Math.round(patch.supplyAmount * VAT_RATE);
    row.supply_amount = patch.supplyAmount;
    row.vat = vat;
    row.total = patch.supplyAmount + vat;
  }
  if (!Object.keys(row).length) return;
  const { data, error } = await supabase.from('biz_invoice_request').update(row).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '저장');
}

// ── 기초 미수금(사업장 단위) ────────────────────────────────
export const OPENING_AS_OF = '2026-07-01';

export interface ReceivableOpening {
  id: string;
  placeId: string;
  asOf: string;
  /** 공급가액(부가세 제외) 기준 잔액 — 기초 미수금의 기본값 */
  amount: number;
  /** 부가세 포함 잔액 — 거래처가 VAT 뺀 금액만 입금했는지 가려내는 데 쓴다 */
  amountGross: number;
  note: string;
}

export async function listReceivableOpenings(asOf = OPENING_AS_OF): Promise<ReceivableOpening[]> {
  const { data, error } = await supabase.from('biz_receivable_opening').select('*').eq('as_of', asOf);
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data as any[]).map((r) => ({
    id: r.id, placeId: r.place_id, asOf: r.as_of, amount: Number(r.amount) || 0,
    amountGross: Number(r.amount_gross) || 0, note: r.note || '',
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** 기초 미수금 저장(사업장당 1행 upsert). 0원도 '확인함'의 의미로 저장한다. */
export async function saveReceivableOpenings(
  rows: { placeId: string; amount: number; amountGross?: number; note?: string }[],
  asOf = OPENING_AS_OF,
): Promise<number> {
  if (!rows.length) return 0;
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('biz_receivable_opening')
    .upsert(
      rows.map((r) => ({
        place_id: r.placeId, as_of: asOf, amount: r.amount,
        amount_gross: r.amountGross ?? Math.round(r.amount * (1 + VAT_RATE)),
        note: r.note || null, created_by: u.user?.id ?? null,
      })),
      { onConflict: 'place_id,as_of' },
    )
    .select('id');
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/** 계약이 있는 달인지 화면에서 안내하기 위한 보조 — 그 달 청구예정 총액 */
export function monthSupplyTotal(contracts: SalesContract[], ym: string): number {
  return contracts.reduce((s, c) => s + billingItemsForMonth(c, ym).reduce((a, i) => a + i.net, 0), 0);
}
