// 쏭비서 결재함 — 쏭비서(대표님 비서 AI)가 올린 등록 요청을 최고관리자가 승인·반려한다.
//
// 쏭비서는 커넥터(connectors/ssong-mcp)로 ssong_submit 만 부를 수 있다(0200).
// 승인하면 **이 앱의 기존 등록 함수**가 실제 행을 만든다 — 계약코드 채번·알림·감사로그가
// 지금 화면과 똑같이 돈다. 규칙을 두 벌로 만들지 않는다.
//
// 승인 순서: ssong_claim(처리중으로 잡기) → 등록 → ssong_finish(만들어진 id 기록).
// 등록 중 실패하면 ssong_fail 로 '대기'에 되돌리고 오류를 남긴다.
import { supabase } from './supabase';
import { createSalesContract, saveContractStaff, type ContractInput, type BillingCycle, type OccurrenceUnit, type BillingUnit, type AdvisoryType } from './salesContractApi';
import { findNode, isLeaf, teamOf, type Team } from './salesContractTaxonomy';
import { createSendRequests, WORK_TYPES, DEADLINES, SEND_KINDS, type SendCommon, type SendRecipient } from './docSendApi';
import { listDocClients } from './docClientsApi';
import { pickTitle } from './honorific';
import { todayYmd } from './format';

export type SsongKind = 'sales_contract' | 'doc_send';
export type SsongStatus = '대기' | '처리중' | '승인' | '반려';
export const SSONG_KIND_LABEL: Record<SsongKind, string> = { sales_contract: '매출계약 등록', doc_send: '문서발송 의뢰' };

/** 쏭비서가 올리는 매출계약 내용(커넥터 submit_sales_contract 와 같은 모양). */
export interface SsongContractPayload {
  entityId: string; placeId?: string | null;
  team: Team; categoryCode: string; categoryEtcName?: string;
  occurrenceUnit: OccurrenceUnit; billingUnit?: BillingUnit | null; billingCycle: BillingCycle;
  amount: number; includesVat?: boolean; includesWht?: boolean; advisoryType?: AdvisoryType | null;
  fiscalYear?: number | null; cpa?: string;
  contractDate?: string | null; startDate?: string | null; endDate?: string | null;
  confirmed?: boolean; billingMonth?: number | null; note?: string;
  /** 함께 하는 직원 이름(profiles.name). 승인 때 id 로 바꾼다. */
  staffNames?: string[];
}
/** 쏭비서가 올리는 문서발송 의뢰(커넥터 submit_doc_send 와 같은 모양). */
export interface SsongDocSendPayload {
  requestDate?: string; requester: string; workType: string; sendKind: string; docName?: string;
  copies?: number; sealRequired?: boolean; deadline: string; etcRequest?: string;
  recipients: { clientId: string; contactId: string }[];
}

export interface SsongRequest {
  id: string; kind: SsongKind; title: string; payload: Record<string, unknown>; reason: string;
  status: SsongStatus; submittedAt: string; keyLabel: string;
  decidedByName: string; decidedAt: string | null; decisionNote: string;
  createdTable: string | null; createdIds: string[]; lastError: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const toReq = (r: any): SsongRequest => ({
  id: r.id, kind: r.kind, title: r.title, payload: r.payload ?? {}, reason: r.reason ?? '',
  status: r.status, submittedAt: r.submitted_at, keyLabel: r.key_label ?? '',
  decidedByName: r.decided_by_name ?? '', decidedAt: r.decided_at, decisionNote: r.decision_note ?? '',
  createdTable: r.created_table, createdIds: r.created_ids ?? [], lastError: r.last_error ?? '',
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listSsongRequests(limit = 200): Promise<SsongRequest[]> {
  const { data, error } = await supabase.from('ssong_requests').select('*')
    .order('submitted_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toReq);
}

/** 홈·메뉴 배지용 대기 건수. 최고관리자가 아니면 RLS 로 0. */
export async function countSsongPending(): Promise<number> {
  const { count, error } = await supabase.from('ssong_requests').select('*', { count: 'exact', head: true }).eq('status', '대기');
  if (error) return 0;
  return count ?? 0;
}

// ── 검증(승인 전 화면에도 보여 준다) ─────────────────────
/** 매출계약 내용을 앱 규칙으로 본다. 문제 목록(빈 배열이면 통과). */
export function checkContractPayload(p: SsongContractPayload): string[] {
  const errs: string[] = [];
  const node = findNode(p.categoryCode)?.node;
  if (!node) errs.push(`매출유형 코드가 없습니다: ${p.categoryCode}`);
  else {
    if (!isLeaf(node)) errs.push(`매출유형이 맨 아래 단계가 아닙니다: ${node.label}`);
    if (teamOf(p.categoryCode) !== p.team) errs.push(`매출유형(${node.label})이 ${p.team} 것이 아닙니다`);
    if (node.needsEtcName && !p.categoryEtcName?.trim()) errs.push('「기타」 유형은 신고대상명칭이 필요합니다');
  }
  if (!(p.amount >= 0)) errs.push('금액이 올바르지 않습니다');
  if (p.startDate && p.endDate && p.endDate < p.startDate) errs.push('종료일이 시작일보다 앞입니다');
  if (p.billingMonth != null && !(p.billingMonth >= 1 && p.billingMonth <= 12)) errs.push('청구월은 1~12');
  return errs;
}
export function checkDocSendPayload(p: SsongDocSendPayload): string[] {
  const errs: string[] = [];
  if (!(WORK_TYPES as readonly string[]).includes(p.workType)) errs.push(`업무구분이 올바르지 않습니다: ${p.workType}`);
  if (!(DEADLINES as readonly string[]).includes(p.deadline)) errs.push(`발송기한이 올바르지 않습니다: ${p.deadline}`);
  if (!(SEND_KINDS as readonly string[]).includes(p.sendKind)) errs.push(`송부종류가 올바르지 않습니다: ${p.sendKind}`);
  if (!p.recipients?.length) errs.push('수신자가 없습니다');
  return errs;
}

// ── 승인 ────────────────────────────────────────────────
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export interface Made { ids: string[]; warn?: string }

async function createContractFrom(p: SsongContractPayload): Promise<Made> {
  const errs = checkContractPayload(p);
  if (errs.length) throw new Error(errs.join(' · '));
  const input: ContractInput = {
    entityId: p.entityId, placeId: p.placeId ?? null, occurrenceUnit: p.occurrenceUnit,
    billingUnit: p.billingUnit ?? null, team: p.team, categoryCode: p.categoryCode,
    categoryEtcName: p.categoryEtcName, includesVat: p.includesVat, includesWht: p.includesWht,
    advisoryType: p.advisoryType ?? null, fiscalYear: p.fiscalYear ?? null, billingCycle: p.billingCycle,
    amount: p.amount, cpa: p.cpa, contractDate: p.contractDate ?? null, startDate: p.startDate ?? null,
    endDate: p.endDate ?? null, note: p.note, confirmed: p.confirmed, billingMonth: p.billingMonth ?? null,
  };
  // 직원 이름 → id. 모르는 이름이 있으면 만들기 전에 멈춘다.
  const names = Array.from(new Set((p.staffNames ?? []).map((s) => s.trim()).filter(Boolean)));
  let staff: { staffId: string; staffName: string }[] = [];
  if (names.length) {
    const { data, error } = await supabase.from('profiles').select('id, name').in('name', names);
    if (error) throw new Error(error.message);
    const byName = new Map((data ?? []).map((r: { id: string; name: string }) => [r.name.trim(), r.id]));
    const missing = names.filter((n) => !byName.has(n));
    if (missing.length) throw new Error(`직원을 찾지 못했습니다: ${missing.join(', ')}`);
    staff = names.map((n) => ({ staffId: byName.get(n)!, staffName: n }));
  }
  const id = await createSalesContract(input);
  // 계약이 이미 생긴 뒤의 실패는 결재를 '대기'로 되돌리지 않는다 — 다시 승인하면 계약이 두 건이 된다.
  // 승인으로 닫고 메모에 남겨, 매출계약등록 화면에서 담당직원만 고치게 한다.
  if (staff.length) {
    try { await saveContractStaff(id, staff); }
    catch (e) { return { ids: [id], warn: `담당직원 저장 실패 — 매출계약등록에서 직접 넣어 주세요 (${e instanceof Error ? e.message : String(e)})` }; }
  }
  return { ids: [id] };
}

async function createDocSendFrom(p: SsongDocSendPayload): Promise<Made> {
  const errs = checkDocSendPayload(p);
  if (errs.length) throw new Error(errs.join(' · '));
  const clients = await listDocClients();
  const recipients: SendRecipient[] = p.recipients.map((r) => {
    const c = clients.find((x) => x.id === r.clientId);
    const ct = c?.contacts.find((x) => x.id === r.contactId);
    if (!c || !ct) throw new Error('수신자 연락처를 찾지 못했습니다');
    // 주소·전화는 쏭비서가 보내지 않는다 — 여기서 연락처 표에서 채운다.
    return {
      clientId: c.id, contactId: ct.id, companyName: c.companyName, recipientName: ct.contactName,
      recipientTitle: pickTitle(ct.position, ct.honorific), address: ct.address, phone: ct.phone,
    };
  });
  const common: SendCommon = {
    requestDate: p.requestDate || todayYmd(), requester: p.requester, workType: p.workType,
    sendKind: p.sendKind, docName: p.docName ?? '', copies: p.copies || 1,
    sealRequired: !!p.sealRequired, deadline: p.deadline, etcRequest: p.etcRequest ?? '',
  };
  const batchId = crypto.randomUUID();
  await createSendRequests(common, recipients, batchId);
  const { data, error } = await supabase.from('doc_send_requests').select('id').eq('batch_id', batchId);
  if (error) throw new Error(error.message);
  return { ids: (data ?? []).map((r: { id: string }) => r.id) };
}

/** 승인 — 실제 행을 만들고 결재를 닫는다. 만들어진 id 를 돌려준다. */
export async function approveSsongRequest(id: string, note?: string): Promise<Made> {
  const claimed = toReq(await rpc('ssong_claim', { p_id: id }));
  let made: Made;
  try {
    made = claimed.kind === 'sales_contract'
      ? await createContractFrom(claimed.payload as unknown as SsongContractPayload)
      : await createDocSendFrom(claimed.payload as unknown as SsongDocSendPayload);
  } catch (e) {
    // 아무것도 만들어지지 않았다 — '대기'로 되돌린다.
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.rpc('ssong_fail', { p_id: id, p_error: msg });
    throw new Error(msg);
  }
  const table = claimed.kind === 'sales_contract' ? 'biz_sales_contract' : 'doc_send_requests';
  const memo = [note?.trim(), made.warn].filter(Boolean).join(' / ') || null;
  await rpc('ssong_finish', { p_id: id, p_created_table: table, p_created_ids: made.ids, p_note: memo });
  return made;
}

export async function rejectSsongRequest(id: string, note: string): Promise<void> {
  await rpc('ssong_reject', { p_id: id, p_note: note });
}
