// 기장등청구관리 › 세금계산서 발행요청 데이터 레이어 (마이그 0075)
//
// 흐름: 매출계약에서 그 달 청구예정을 전개(billingSchedule) → 발행요청 생성 → 발행완료(세계번호·발행일).
// 금액은 요청 시점 스냅샷으로 굳힌다 — 계약이 나중에 바뀌어도 이미 나간 요청·발행 이력은 그대로여야 한다.
import { supabase, assertWrote } from './supabase';
import { billingItemsForMonth } from './billingSchedule';
import { listSalesContracts, type SalesContract } from './salesContractApi';
import { corpDisplayName, type BizEntityFull } from './bizRegistryApi';
import { listBizContacts, type BizContact } from './bizContactApi';
import { seedInvoiceStaff } from './invoiceStaffApi';

export const VAT_RATE = 0.1;

/** 인덕 ERP 의 매출계정 7종. 표기가 흔들리지 않게 여기서만 고른다. */
export const ERP_ACCOUNTS = [
  '회계감사수입', '세무조정수입', '기업진단수입', '기장대리수입',
  '경영자문수입', '기타용역수입', '임의감사수입',
] as const;
export type ErpAccount = (typeof ERP_ACCOUNTS)[number];

/**
 * 우리 매출유형 → ERP 매출계정 (2026-09-01 사용자 확정).
 *  · 기장 + **부가세 신고대리 + 원천세** = 기장대리수입   ← 부가세·원천이 세무조정이 아니라 기장이다
 *  · 그 밖의 신고대리(법인세·소득세·양도·상속 등) = 세무조정수입
 *  · 회계감사 = 회계감사수입
 *  · 가치평가·실사·자문 등 = 기타용역수입
 * 기업진단수입·경영자문수입·임의감사수입은 대응하는 매출유형이 아직 없어 화면에서 직접 고른다.
 */
export function erpAccountOf(categoryCode: string): ErpAccount {
  const c = categoryCode || '';
  if (c === 'TAX.BOOK' || c === 'TAX.FILING.VAT' || c === 'TAX.FILING.WHT') return '기장대리수입';
  if (c.startsWith('TAX.FILING') || c.startsWith('AUD.SVC.FILING')) return '세무조정수입';
  if (c === 'AUD.AUDIT') return '회계감사수입';
  return '기타용역수입';
}

/**
 * 발행요청 상태.
 * `수정발행` = ERP 의 (−)수정세금계산서. 금액이 음수로 들어가고 원래 건에 연결된다(corrects_request_id).
 * 미수금이 한 줄로 계산되도록 별도 표로 빼지 않고 같은 표에 담는다(사용자 확정 2026-09-01).
 */
export type InvoiceStatus = '요청' | '발행완료' | '취소' | '수정발행';

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
  team: string;
  erpAccount: string;
  docEmail: string;
  issueDate: string | null;
  issuedByName: string;         // 발행완료를 누른 사람(누가 처리했는지 화면에 보인다)
  requestedByName: string;      // 요청한 사람(감사팀 건별에서 '발행요청자')
  /** 되돌리는 원 발행요청(수정발행일 때). 원 건이 우리 장부에 없으면 비어 있다. */
  correctsRequestId: string | null;
  /** 되돌리는 원 세금계산서·ERP 전표번호 — 원 건이 우리 장부에 없을 때의 실마리. */
  correctsInvoiceNo: string;
  /** 수정 사유. */
  correctReason: string;
  /** 청구 시점의 담당 회계사(스냅샷). 계약이 나중에 바뀌어도 이 값은 그대로다. */
  cpa: string;
  /** 청구 시점의 담당 직원(스냅샷). 직원별 매출 집계의 근거 — 계속계약은 연중에도 바뀐다. */
  staff: string;
  phase: string;                // 계약금·중도금·잔금·총액 (감사팀 건별)
  summary: string;              // 발행 시 적요
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const toReq = (r: any): InvoiceRequest => ({
  id: r.id, ym: r.ym, entityId: r.entity_id, placeId: r.place_id, contractId: r.contract_id,
  installmentId: r.installment_id, supplyAmount: Number(r.supply_amount) || 0, vat: Number(r.vat) || 0,
  total: Number(r.total) || 0, status: r.status, invoiceNo: r.invoice_no || '', issuedDate: r.issued_date,
  companyName: r.company_name || '', placeName: r.place_name || '', contractCode: r.contract_code || '',
  note: r.note || '', requestedAt: r.requested_at,
  team: r.team || 'taxteam', erpAccount: r.erp_account || '', docEmail: r.doc_email || '',
  issueDate: r.issue_date ?? null,
  issuedByName: r.issued_by_name || '',
  requestedByName: r.requested_by_name || '',
  phase: r.phase || '', summary: r.summary || '',
  cpa: r.cpa || '', staff: r.staff || '',
  correctsRequestId: r.corrects_request_id ?? null,
  correctsInvoiceNo: r.corrects_invoice_no || '',
  correctReason: r.correct_reason || '',
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * 발행요청 조회 — ym 을 주면 그 달만, team 을 주면 그 팀만.
 * 발행완료를 누른 사람 이름을 함께 채운다(누가 처리했는지 화면에 보여야 하므로).
 */
export async function listInvoiceRequests(ym?: string, team?: string): Promise<InvoiceRequest[]> {
  let q = supabase.from('biz_invoice_request').select('*').order('ym', { ascending: false }).order('company_name');
  if (ym) q = q.eq('ym', ym);
  if (team) q = q.eq('team', team);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rows = (data as any[]) ?? [];
  const ids = [...new Set(rows.flatMap((r) => [r.issued_by, r.requested_by]).filter(Boolean))];
  let names = new Map<string, string>();
  if (ids.length) {
    const { data: p } = await supabase.from('profiles').select('id, name').in('id', ids);
    names = new Map((p as any[] ?? []).map((x) => [x.id as string, ((x.name as string) || '').trim()]));
  }
  return rows.map((r) => toReq({
    ...r,
    issued_by_name: names.get(r.issued_by) ?? '',
    requested_by_name: names.get(r.requested_by) ?? '',
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
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
  erpAccount: ErpAccount;       // ERP 매출계정(유형에서 자동)
  docEmail: string;             // 세금계산서 수신 이메일(담당자에서 자동)
}

/**
 * 세금계산서 수신 이메일 고르기.
 * 사업장 담당자 > 대표연락처 > 아무 담당자 순. 거래처에 전용 필드가 생기면 그쪽이 우선이 된다.
 */
function pickDocEmail(contacts: BizContact[], placeId: string | null): string {
  // 이직·퇴사로 접어 둔 담당자에게 보내면 안 된다.
  const cs = contacts.filter((c) => c.email.trim() && c.active);
  if (!cs.length) return '';
  return (placeId ? cs.find((c) => c.placeId === placeId && c.isPrimary)?.email : '')
    || (placeId ? cs.find((c) => c.placeId === placeId)?.email : '')
    || cs.find((c) => c.isPrimary)?.email
    || cs[0].email;
}

/**
 * 그 달에 청구할 계약 항목을 펼쳐 발행요청 후보로 만든다.
 * 이미 요청된 건(취소 제외)은 빼고 돌려준다.
 *
 * team 을 주면 그 팀 계약만 본다. **화면이 감사팀/taxteam 으로 갈리므로 반드시 지정한다** —
 * 안 주면 감사 계약(회계감사 중도금 같은 큰 금액)이 taxteam 목록에 섞여 들어온다.
 */
export async function listInvoiceCandidates(
  ym: string, entities: BizEntityFull[], team?: string,
): Promise<InvoiceCandidate[]> {
  const [contracts, existing, contacts] = await Promise.all([
    listSalesContracts(), listInvoiceRequests(ym), listBizContacts(),
  ]);
  const byEntity = new Map<string, BizContact[]>();
  for (const c of contacts) {
    const l = byEntity.get(c.entityId); if (l) l.push(c); else byEntity.set(c.entityId, [c]);
  }
  const taken = new Set(
    existing.filter((r) => r.status !== '취소')
      .map((r) => `${r.contractId ?? ''}|${r.installmentId ?? ''}`),
  );
  const entMap = new Map(entities.map((e) => [e.id, e]));

  const out: InvoiceCandidate[] = [];
  for (const c of contracts) {
    if (team && c.team !== team) continue;
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
        erpAccount: erpAccountOf(c.categoryCode),
        // 세금계산서 수신 이메일 — 거래처에 전용 필드가 생기기 전까지는 담당자(대표연락처 우선)에서 끌어 쓴다.
        docEmail: pickDocEmail(byEntity.get(c.entityId) ?? [], place?.id ?? null),
      });
    }
  }
  return out.sort((a, b) => a.companyName.localeCompare(b.companyName, 'ko'));
}

/** 후보를 발행요청으로 등록 — 생성 건수 반환 */
export async function createInvoiceRequests(
  ym: string, rows: InvoiceCandidate[], opt: { team?: string; issueDate?: string } = {},
): Promise<number> {
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
      team: opt.team ?? 'taxteam',
      issue_date: opt.issueDate ?? null,
      cpa: r.cpa || null, staff: r.staff || null,     // 청구 시점 담당을 굳혀 둔다
      erp_account: r.erpAccount,
      doc_email: r.docEmail || null,
      company_name: r.companyName,
      place_name: r.placeName,
      contract_code: r.contractCode,
      note: r.label || null,
      requested_by: u.user?.id ?? null,
    };
  });
  const { data, error } = await supabase.from('biz_invoice_request').insert(payload).select('id');
  if (error) throw new Error(error.message);
  // 실적 배분을 주담당 100% 로 깔아 둔다 — 청구 시점에 정해지는 값이라 여기서 굳힌다.
  const ids = ((data as { id: string }[]) ?? []).map((d) => d.id);
  await seedInvoiceStaff(ids, new Map(ids.map((id, i) => [id, rows[i]?.staff ?? ''])));
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
/** 감사팀 건별 발행요청 — 계약 없이도 등록된다(계약금/중도금/잔금이 건별로 생기므로). */
export interface ManualInvoiceInput {
  ym: string;
  team: string;
  entityId: string;
  placeId: string | null;
  contractId?: string | null;
  supplyAmount: number;
  erpAccount: string;
  phase: string;
  summary: string;
  issueDate: string;
  docEmail: string;
  companyName: string;
  placeName: string;
  contractCode?: string;
  cpa?: string;
  staff?: string;
  note?: string;
}
/**
 * 수정세금계산서를 등록한다 — **(−)와 (+) 둘 다**.
 *
 * 새 테이블을 만들지 않는다. 수정발행도 발행이고, 미수금·매출통계·ERP 대사가 모두
 * 이 표를 보므로 `status='수정발행'` 인 행 하나면 그 화면들이 알아서 더하고 뺀다.
 *
 * 방향이 둘인 이유 —
 *  · (−) 이미 발행한 것을 되돌린다(계약 해지·과다청구). 파인즈플래닝 4~6월 기장료가 이 경우.
 *  · (+) 덜 발행했거나, 예전에 끊어 둔 (−)크레딧이 소멸해 채권이 되살아난다. 제이엠스토리가 이 경우.
 * `amount` 는 언제나 **양수로 받아** 여기서 부호를 붙인다 — 사람이 직접 (−)를 치면 빠뜨린다.
 *
 * 원 건이 우리 장부에 있으면 correctsRequestId 로 잇고,
 * 기초미수금에 묻혀 있어 없으면 correctsInvoiceNo(ERP 전표번호)만 적는다.
 */
export async function createCorrection(input: {
  ym: string; team: string;
  entityId: string; placeId: string | null; contractId?: string | null;
  /** 고칠 금액(공급가액, **양수**로 준다). 부호는 sign 이 정한다. */
  amount: number;
  /** '-' 되돌리기(기본) · '+' 되살리기. */
  sign?: '-' | '+';
  reason: string;
  issueDate: string;
  /** 이미 ERP 에서 발행된 것이면 그 날짜 — 넣으면 바로 채권에서 빠진다. */
  issuedDate?: string | null;
  correctsRequestId?: string | null;
  correctsInvoiceNo?: string;
  erpAccount?: string; companyName: string; placeName?: string; contractCode?: string;
  cpa?: string; staff?: string; summary?: string;
}): Promise<string> {
  const dir = input.sign === '+' ? 1 : -1;
  const amt = dir * Math.abs(Math.round(input.amount));
  if (!amt) throw new Error('금액을 넣어 주세요.');
  if (!input.reason.trim()) throw new Error('수정 사유를 적어 주세요 — 나중에 왜 뺐는지 알 수 없게 됩니다.');
  const { data: u } = await supabase.auth.getUser();
  const vat = dir * Math.round(Math.abs(amt) * VAT_RATE);
  const { data, error } = await supabase.from('biz_invoice_request').insert({
    ym: input.ym, team: input.team, entity_id: input.entityId, place_id: input.placeId,
    contract_id: input.contractId ?? null,
    supply_amount: amt, vat, total: amt + vat,
    status: '수정발행',
    erp_account: input.erpAccount || null,
    summary: input.summary || null,
    issue_date: input.issueDate || null,
    issued_date: input.issuedDate ?? null,
    cpa: input.cpa || null, staff: input.staff || null,
    company_name: input.companyName, place_name: input.placeName ?? '',
    contract_code: input.contractCode ?? '',
    corrects_request_id: input.correctsRequestId ?? null,
    corrects_invoice_no: input.correctsInvoiceNo || null,
    correct_reason: input.reason.trim(),
    note: `${dir < 0 ? '(−)' : '(+)'}수정발행 · ${input.reason.trim()}`,
    requested_by: u.user?.id ?? null,
  }).select('id').single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function createManualInvoiceRequest(input: ManualInvoiceInput): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  const vat = Math.round(input.supplyAmount * VAT_RATE);
  const { data, error } = await supabase.from('biz_invoice_request').insert({
    ym: input.ym, team: input.team, entity_id: input.entityId, place_id: input.placeId,
    contract_id: input.contractId ?? null,
    supply_amount: input.supplyAmount, vat, total: input.supplyAmount + vat,
    status: '요청', erp_account: input.erpAccount || null, phase: input.phase || null,
    summary: input.summary || null, issue_date: input.issueDate || null,
    doc_email: input.docEmail || null,
    cpa: input.cpa || null, staff: input.staff || null,
    company_name: input.companyName, place_name: input.placeName,
    contract_code: input.contractCode ?? '', note: input.note ?? null,
    requested_by: u.user?.id ?? null,
  }).select('id').single();
  if (error) throw new Error(error.message);
  const id = (data as { id: string }).id;
  if (input.staff) await seedInvoiceStaff([id], new Map([[id, input.staff]]));
  return id;
}

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
  /** 어느 팀의 기초인가 — 화면의 팀 필터가 쓴다. */
  team: string;
}

export async function listReceivableOpenings(asOf = OPENING_AS_OF): Promise<ReceivableOpening[]> {
  const { data, error } = await supabase.from('biz_receivable_opening').select('*').eq('as_of', asOf);
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data as any[]).map((r) => ({
    id: r.id, placeId: r.place_id, asOf: r.as_of, amount: Number(r.amount) || 0,
    amountGross: Number(r.amount_gross) || 0, note: r.note || '', team: r.team || 'taxteam',
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
