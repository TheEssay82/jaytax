// 그 달 청구예정 초안 — taxteam 월 마감의 출발점.
//
// 실제 업무 순서는 이렇다.
//   ① 김민섭이 그 달을 연다 → **전월 세금계산서가 그대로 복사**된다(엑셀에서 전월 열을 복사하던 그 일).
//   ② 담당자 3인이 각자 맡은 곳을 보고 고치고 지우고 더한다. **매출계약은 대사용 참고자료**다.
//   ③ 김민섭이 확인하고 발행요청으로 등록한다 — 그때 초안은 사라진다.
//
// 그래서 청구예정은 '계약에서 그때그때 계산한 예상'이 아니라 **저장되고 손댈 수 있는 초안**이다.
import { supabase } from './supabase';
import { listInvoiceRequests, erpAccountOf, type InvoiceCandidate } from './invoiceRequestApi';

export interface InvoiceDraft {
  id: string;
  ym: string;
  team: string;
  entityId: string | null;
  placeId: string | null;
  contractId: string | null;
  installmentId: string | null;
  companyName: string;
  placeName: string;
  contractCode: string;
  typeLabel: string;
  erpAccount: string;
  cpa: string;
  staff: string;
  docEmail: string;
  supplyAmount: number;
  label: string;
  summary: string;
  billingCycle: string;
  billingMonth: number | null;
  confirmed: boolean;
  /** 어디서 왔는가 — 전월복사 | 계약추가 | 수동추가 */
  source: string;
  /** 전월엔 얼마였나(변동 표시용). 전월에 없던 건은 0. */
  prevAmount: number;
  note: string;
}

export type DraftInput = Omit<InvoiceDraft, 'id' | 'ym' | 'team'>;

/* eslint-disable @typescript-eslint/no-explicit-any */
const fromRow = (r: any): InvoiceDraft => ({
  id: r.id, ym: r.ym, team: r.team,
  entityId: r.entity_id, placeId: r.place_id, contractId: r.contract_id, installmentId: r.installment_id,
  companyName: r.company_name ?? '', placeName: r.place_name ?? '', contractCode: r.contract_code ?? '',
  typeLabel: r.type_label ?? '', erpAccount: r.erp_account ?? '', cpa: r.cpa ?? '', staff: r.staff ?? '',
  docEmail: r.doc_email ?? '', supplyAmount: Number(r.supply_amount) || 0,
  label: r.label ?? '', summary: r.summary ?? '',
  billingCycle: r.billing_cycle ?? '', billingMonth: r.billing_month ?? null,
  confirmed: r.confirmed !== false, source: r.source ?? '', prevAmount: Number(r.prev_amount) || 0,
  note: r.note ?? '',
});
/* eslint-enable @typescript-eslint/no-explicit-any */

const toRow = (ym: string, team: string, d: DraftInput) => ({
  ym, team,
  entity_id: d.entityId, place_id: d.placeId, contract_id: d.contractId, installment_id: d.installmentId,
  company_name: d.companyName, place_name: d.placeName, contract_code: d.contractCode,
  type_label: d.typeLabel, erp_account: d.erpAccount, cpa: d.cpa, staff: d.staff,
  doc_email: d.docEmail || null, supply_amount: d.supplyAmount, label: d.label,
  summary: d.summary || null, billing_cycle: d.billingCycle, billing_month: d.billingMonth,
  confirmed: d.confirmed, source: d.source, prev_amount: d.prevAmount, note: d.note || null,
});

export async function listDrafts(ym: string, team = 'taxteam'): Promise<InvoiceDraft[]> {
  const { data, error } = await supabase.from('biz_invoice_draft')
    .select('*').eq('ym', ym).eq('team', team);
  if (error) throw new Error(error.message);
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  return ((data as any[]) ?? []).map(fromRow)
    .sort((a, b) => a.companyName.localeCompare(b.companyName, 'ko'));
}

/** 계약 전개 한 줄을 초안 한 줄로. '계약에서 추가'와 첫 달 채우기가 함께 쓴다. */
export function draftFromCandidate(c: InvoiceCandidate, prevAmount = 0, source = '계약추가'): DraftInput {
  return {
    entityId: c.entityId, placeId: c.placeId, contractId: c.contractId, installmentId: c.installmentId,
    companyName: c.companyName, placeName: c.placeName, contractCode: c.contractCode,
    typeLabel: c.typeLabel, erpAccount: c.erpAccount, cpa: c.cpa, staff: c.staff, docEmail: c.docEmail,
    supplyAmount: c.supplyAmount, label: c.label, summary: '',
    billingCycle: c.billingCycle, billingMonth: c.billingMonth, confirmed: c.confirmed,
    source, prevAmount, note: '',
  };
}

/** 초안 한 줄을 발행요청 등록에 넘길 모양으로. */
export function candidateFromDraft(d: InvoiceDraft): InvoiceCandidate {
  return {
    key: d.id,
    entityId: d.entityId ?? '',
    placeId: d.placeId,
    contractId: d.contractId ?? '',
    installmentId: d.installmentId,
    companyName: d.companyName, placeName: d.placeName, contractCode: d.contractCode,
    typeLabel: d.typeLabel, cpa: d.cpa, staff: d.staff, label: d.label,
    supplyAmount: d.supplyAmount, confirmed: d.confirmed,
    billingCycle: d.billingCycle, billingMonth: d.billingMonth,
    erpAccount: (d.erpAccount || erpAccountOf(d.typeLabel)) as InvoiceCandidate['erpAccount'],
    docEmail: d.docEmail,
  };
}

/**
 * 그 달을 연다 — **전월 발행요청을 그대로 복사**해 초안을 만든다.
 * 전월에 아무것도 없으면(첫 달) 계약 전개분으로 채운다. 이미 초안이 있으면 손대지 않는다.
 */
export async function openDrafts(
  ym: string, prevYm: string, fallback: InvoiceCandidate[], team = 'taxteam',
): Promise<{ created: number; from: '전월복사' | '계약전개' }> {
  const cur = await listDrafts(ym, team);
  if (cur.length) return { created: 0, from: '전월복사' };

  const prev = (await listInvoiceRequests(prevYm, team)).filter((r) => r.status !== '취소');
  let rows: DraftInput[];
  let from: '전월복사' | '계약전개';
  if (prev.length) {
    from = '전월복사';
    rows = prev.map((r) => ({
      entityId: r.entityId, placeId: r.placeId, contractId: r.contractId, installmentId: r.installmentId,
      companyName: r.companyName, placeName: r.placeName, contractCode: r.contractCode,
      typeLabel: '', erpAccount: r.erpAccount, cpa: r.cpa, staff: r.staff, docEmail: r.docEmail,
      supplyAmount: r.supplyAmount, label: r.note, summary: r.summary,
      billingCycle: '', billingMonth: null, confirmed: true,
      source: '전월복사', prevAmount: r.supplyAmount, note: '',
    }));
  } else {
    from = '계약전개';
    rows = fallback.map((c) => draftFromCandidate(c, 0, '계약추가'));
  }
  if (!rows.length) return { created: 0, from };
  const { error } = await supabase.from('biz_invoice_draft').insert(rows.map((d) => toRow(ym, team, d)));
  if (error) throw new Error(error.message);
  return { created: rows.length, from };
}

export async function addDrafts(ym: string, rows: DraftInput[], team = 'taxteam'): Promise<number> {
  if (!rows.length) return 0;
  const { error } = await supabase.from('biz_invoice_draft').insert(rows.map((d) => toRow(ym, team, d)));
  if (error) throw new Error(error.message);
  await writeLog(rows.map((d) => ({
    ym, team, draft_id: null, company: d.companyName, place: d.placeName,
    action: '추가', field: '', before_val: '', after_val: '', amount: d.supplyAmount,
  })));
  return rows.length;
}

/**
 * 초안 한 줄 고치기. **무엇이 어떻게 바뀌었는지 함께 남긴다** —
 * 담당자 확인 요약('수정 3 · 추가 1 · 삭제 2')과 김민섭의 검토가 이 기록 위에 선다.
 * before 를 주면 바뀐 항목만 골라 기록한다.
 */
export async function updateDraft(id: string, patch: Partial<InvoiceDraft>, before?: InvoiceDraft): Promise<void> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const p: any = { updated_at: new Date().toISOString() };
  if (patch.supplyAmount !== undefined) p.supply_amount = patch.supplyAmount;
  if (patch.staff !== undefined) p.staff = patch.staff;
  if (patch.cpa !== undefined) p.cpa = patch.cpa;
  if (patch.summary !== undefined) p.summary = patch.summary;
  if (patch.erpAccount !== undefined) p.erp_account = patch.erpAccount;
  if (patch.label !== undefined) p.label = patch.label;
  if (patch.note !== undefined) p.note = patch.note;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const { error } = await supabase.from('biz_invoice_draft').update(p).eq('id', id);
  if (error) throw new Error(error.message);
  if (!before) return;

  const changes: { field: string; b: string; a: string }[] = [];
  if (patch.supplyAmount !== undefined && Math.round(patch.supplyAmount) !== Math.round(before.supplyAmount)) {
    changes.push({ field: '금액', b: String(Math.round(before.supplyAmount)), a: String(Math.round(patch.supplyAmount)) });
  }
  if (patch.staff !== undefined && patch.staff !== before.staff) changes.push({ field: '담당직원', b: before.staff, a: patch.staff });
  if (patch.summary !== undefined && patch.summary !== before.summary) changes.push({ field: '적요', b: before.summary, a: patch.summary });
  if (!changes.length) return;
  await writeLog(changes.map((c) => ({
    ym: before.ym, team: before.team, draft_id: id,
    company: before.companyName, place: before.placeName,
    action: '수정', field: c.field, before_val: c.b, after_val: c.a, amount: before.supplyAmount,
  })));
}

/** 초안 삭제. 행이 사라지므로 **무엇을 지웠는지 반드시 남긴다**. */
export async function deleteDrafts(ids: string[], rows?: InvoiceDraft[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from('biz_invoice_draft').delete().in('id', ids);
  if (error) throw new Error(error.message);
  const gone = (rows ?? []).filter((r) => ids.includes(r.id));
  if (gone.length) {
    await writeLog(gone.map((d) => ({
      ym: d.ym, team: d.team, draft_id: d.id, company: d.companyName, place: d.placeName,
      action: '삭제', field: '', before_val: '', after_val: '', amount: d.supplyAmount,
    })));
  }
}

/** 그 달 초안을 통째로 지운다(월 초기화) — 변경 기록도 함께. */
export async function clearDrafts(ym: string, team = 'taxteam'): Promise<void> {
  const { error } = await supabase.from('biz_invoice_draft').delete().eq('ym', ym).eq('team', team);
  if (error) throw new Error(error.message);
  await supabase.from('biz_invoice_draft_log').delete().eq('ym', ym).eq('team', team);
}

// ── 변경 기록 ───────────────────────────────────────────
export interface DraftLog {
  id: string; ym: string; company: string; place: string;
  action: string;                       // 추가 | 수정 | 삭제
  field: string; before: string; after: string; amount: number;
  actor: string; at: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function writeLog(rows: any[]): Promise<void> {
  if (!rows.length) return;
  const { data: u } = await supabase.auth.getUser();
  const actor = u.user?.id ?? null;
  // 기록이 실패해도 본작업을 되돌리지 않는다 — 기록 때문에 청구를 막을 이유는 없다.
  await supabase.from('biz_invoice_draft_log').insert(rows.map((r) => ({ ...r, actor })));
}

export async function listDraftLog(ym: string, team = 'taxteam'): Promise<DraftLog[]> {
  const { data, error } = await supabase.from('biz_invoice_draft_log')
    .select('*').eq('ym', ym).eq('team', team).order('at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data as any[]) ?? [];
  const ids = [...new Set(rows.map((r) => r.actor).filter(Boolean))];
  let names = new Map<string, string>();
  if (ids.length) {
    const { data: pr } = await supabase.from('profiles').select('id, name').in('id', ids);
    names = new Map(((pr as any[]) ?? []).map((x) => [x.id as string, ((x.name as string) || '').trim()]));
  }
  return rows.map((r) => ({
    id: r.id, ym: r.ym, company: r.company ?? '', place: r.place ?? '',
    action: r.action, field: r.field ?? '', before: r.before_val ?? '', after: r.after_val ?? '',
    amount: Number(r.amount) || 0, actor: names.get(r.actor) ?? '', at: r.at,
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 그 사람이 이번 달에 무엇을 했는지 한 줄로 — 확인 기록에 붙인다. */
export function changeSummary(logs: DraftLog[], who: string): string {
  const mine = logs.filter((l) => l.actor === who);
  if (!mine.length) return '변경 없음';
  const parts: string[] = [];
  for (const a of ['수정', '추가', '삭제']) {
    const n = mine.filter((l) => l.action === a).length;
    if (n) parts.push(a + ' ' + n);
  }
  return parts.join(' · ');
}

// ── 매출계약 대사 ────────────────────────────────────────
export interface ReconcileRow {
  kind: '계약에만' | '초안에만' | '금액다름';
  company: string;
  place: string;
  contractCode: string;
  /** 그 건의 담당직원 — 담당자가 '내 담당만' 골라 보게 한다. */
  staff: string;
  draftId: string | null;
  cand: InvoiceCandidate | null;
  draftAmount: number;
  candAmount: number;
}

/**
 * 초안과 매출계약 전개분을 맞춰 본다 — **참고자료와의 대사**다.
 *  · 계약에만 = 새로 시작했거나 초안에서 빠뜨린 것 → 추가할지 본다
 *  · 초안에만 = 계약이 없거나 끝난 것 → 지울지, 계약을 등록할지 본다
 *  · 금액다름 = 계약금액이 바뀐 것 → 어느 쪽이 맞는지 본다
 * 계약(+분할회차) 단위로 맞추고, 계약이 없는 초안(수동추가)은 '초안에만'으로 둔다.
 */
export function reconcileDrafts(drafts: InvoiceDraft[], cands: InvoiceCandidate[]): ReconcileRow[] {
  const keyOf = (contractId: string | null | undefined, installmentId: string | null | undefined) =>
    `${contractId ?? ''}|${installmentId ?? ''}`;
  const byDraft = new Map<string, InvoiceDraft>();
  for (const d of drafts) if (d.contractId) byDraft.set(keyOf(d.contractId, d.installmentId), d);
  const seen = new Set<string>();
  const out: ReconcileRow[] = [];

  for (const c of cands) {
    const k = keyOf(c.contractId, c.installmentId);
    seen.add(k);
    const d = byDraft.get(k);
    if (!d) {
      out.push({
        kind: '계약에만', company: c.companyName, place: c.placeName, contractCode: c.contractCode,
        staff: c.staff, draftId: null, cand: c, draftAmount: 0, candAmount: c.supplyAmount,
      });
    } else if (Math.round(d.supplyAmount) !== Math.round(c.supplyAmount)) {
      out.push({
        kind: '금액다름', company: d.companyName, place: d.placeName, contractCode: d.contractCode,
        staff: d.staff || c.staff, draftId: d.id, cand: c, draftAmount: d.supplyAmount, candAmount: c.supplyAmount,
      });
    }
  }
  for (const d of drafts) {
    const k = keyOf(d.contractId, d.installmentId);
    if (d.contractId && seen.has(k)) continue;
    out.push({
      kind: '초안에만', company: d.companyName, place: d.placeName, contractCode: d.contractCode,
      staff: d.staff, draftId: d.id, cand: null, draftAmount: d.supplyAmount, candAmount: 0,
    });
  }
  const order = { 계약에만: 0, 초안에만: 1, 금액다름: 2 } as const;
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.company.localeCompare(b.company, 'ko'));
}
