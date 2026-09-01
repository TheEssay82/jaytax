// ERP 발행내역 대사 — 엑셀 '대조용' 시트가 하던 일.
//
// 담당자가 ERP 에서 내려받은 **거래전표 리스트 엑셀**을 올리면 사업자번호로 우리 발행요청과 맞춘다.
// 열 위치가 아니라 **열 이름**으로 찾는다 — ERP 화면 설정에 따라 순서가 달라질 수 있어서다.
import { supabase } from './supabase';
import { VAT_RATE, type InvoiceRequest } from './invoiceRequestApi';
import type { BizEntityFull } from './bizRegistryApi';

/** 숫자만 남긴다 — 사업자번호는 하이픈 유무가 자료마다 다르다. */
export const digits = (s: unknown) => String(s ?? '').replace(/[^0-9]/g, '');
const num = (v: unknown) => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;
const txt = (v: unknown) => String(v ?? '').trim();

export interface ErpSlip {
  id?: string;
  ym: string;
  slipNo: string;
  acctSlipNo: string;
  bizNo: string;
  clientName: string;
  description: string;
  kind: string;                 // 매출 | 매입
  contractKind: string;
  supplyAmount: number;         // 음수면 (−)수정전표
  vat: number;
  total: number;
  deptName: string;
  requestId: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const toSlip = (r: any): ErpSlip => ({
  id: r.id, ym: r.ym, slipNo: r.slip_no || '', acctSlipNo: r.acct_slip_no || '',
  bizNo: r.biz_no || '', clientName: r.client_name || '', description: r.description || '',
  kind: r.kind || '매출', contractKind: r.contract_kind || '',
  supplyAmount: Number(r.supply_amount) || 0, vat: Number(r.vat) || 0, total: Number(r.total) || 0,
  deptName: r.dept_name || '', requestId: r.request_id ?? null,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * ERP 거래전표 엑셀 읽기. 저장하지 않고 **읽기만** 한다 — 잘못 올렸을 때 되돌릴 수 있게.
 * 매입은 걸러내고 매출만 남긴다.
 */
export async function parseErpSlipFile(file: File, ym: string): Promise<{ rows: ErpSlip[]; skipped: number; header: string[] }> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames.find((n) => /거래전표/.test(n)) ?? wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });

  const hi = raw.findIndex((r) => (r as unknown[]).some((c) => txt(c) === '전표번호'));
  if (hi < 0) throw new Error('거래전표 엑셀이 아닌 것 같습니다. 「전표번호」 열이 있는 파일을 올려 주세요.');
  const header = (raw[hi] as unknown[]).map(txt);
  const at = (name: string) => header.indexOf(name);
  const col = {
    slip: at('전표번호'), acct: at('회계전표번호'), biz: at('사업자등록증'), name: at('거래처명'),
    desc: at('내역'), kind: at('유형'), ck: at('계약유형'),
    sup: at('공급가액'), vat: at('VAT'), tot: at('합계'), dept: at('부서명'),
  };
  if (col.sup < 0 || col.name < 0) throw new Error('「공급가액」·「거래처명」 열을 찾지 못했습니다.');

  const rows: ErpSlip[] = []; let skipped = 0;
  for (const r0 of raw.slice(hi + 1)) {
    const r = r0 as unknown[];
    const slipNo = txt(r[col.slip]);
    if (!slipNo || slipNo === '합  계' || /^합\s*계/.test(slipNo)) continue;
    const kind = col.kind >= 0 ? txt(r[col.kind]) : '매출';
    if (kind && !/매출/.test(kind)) { skipped++; continue; }        // 매입은 대사 대상이 아니다
    const sup = num(r[col.sup]);
    const vat = col.vat >= 0 ? num(r[col.vat]) : Math.round(sup * VAT_RATE);
    rows.push({
      ym, slipNo, acctSlipNo: col.acct >= 0 ? txt(r[col.acct]) : '',
      bizNo: digits(r[col.biz]), clientName: txt(r[col.name]),
      description: col.desc >= 0 ? txt(r[col.desc]) : '',
      kind: '매출', contractKind: col.ck >= 0 ? txt(r[col.ck]) : '',
      supplyAmount: sup, vat, total: col.tot >= 0 ? num(r[col.tot]) : sup + vat,
      deptName: col.dept >= 0 ? txt(r[col.dept]) : '', requestId: null,
    });
  }
  return { rows, skipped, header };
}

/** 읽은 전표를 그 달에 저장(같은 달을 다시 올리면 통째로 갈아끼운다). */
export async function saveSlips(ym: string, rows: ErpSlip[], fileName: string): Promise<number> {
  const { data: u } = await supabase.auth.getUser();
  await supabase.from('biz_erp_slip').delete().eq('ym', ym);
  if (rows.length) {
    const payload = rows.map((r) => ({
      ym, slip_no: r.slipNo, acct_slip_no: r.acctSlipNo || null, biz_no: r.bizNo || null,
      client_name: r.clientName, description: r.description, kind: r.kind,
      contract_kind: r.contractKind || null, supply_amount: r.supplyAmount, vat: r.vat,
      total: r.total, dept_name: r.deptName || null,
    }));
    const { error } = await supabase.from('biz_erp_slip').insert(payload);
    if (error) throw new Error(error.message);
  }
  const { error: e2 } = await supabase.from('biz_invoice_reconcile').upsert({
    ym, file_name: fileName, slip_count: rows.length,
    supply_total: rows.reduce((s, r) => s + r.supplyAmount, 0),
    uploaded_at: new Date().toISOString(), uploaded_by: u.user?.id ?? null,
    done_at: null, done_by: null,
  }, { onConflict: 'ym' });
  if (e2) throw new Error(e2.message);
  return rows.length;
}

export async function listSlips(ym: string): Promise<ErpSlip[]> {
  const { data, error } = await supabase.from('biz_erp_slip').select('*').eq('ym', ym).order('slip_no');
  if (error) throw new Error(error.message);
  return (data as unknown[]).map(toSlip);
}

/** 올린 것을 통째로 지운다 — 파일을 잘못 올렸을 때. */
export async function clearSlips(ym: string): Promise<void> {
  await supabase.from('biz_erp_slip').delete().eq('ym', ym);
  const { error } = await supabase.from('biz_invoice_reconcile').delete().eq('ym', ym);
  if (error) throw new Error(error.message);
}

export interface ReconcileState {
  ym: string; fileName: string; slipCount: number; supplyTotal: number;
  uploadedAt: string | null; uploadedBy: string; doneAt: string | null; doneBy: string;
}
export async function getReconcileState(ym: string): Promise<ReconcileState | null> {
  const { data, error } = await supabase.from('biz_invoice_reconcile').select('*').eq('ym', ym).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const r = data as any;
  const ids = [r.uploaded_by, r.done_by].filter(Boolean);
  let names = new Map<string, string>();
  if (ids.length) {
    const { data: p } = await supabase.from('profiles').select('id, name').in('id', ids);
    names = new Map((p as any[] ?? []).map((x) => [x.id as string, ((x.name as string) || '').trim()]));
  }
  return {
    ym, fileName: r.file_name || '', slipCount: r.slip_count || 0, supplyTotal: Number(r.supply_total) || 0,
    uploadedAt: r.uploaded_at, uploadedBy: names.get(r.uploaded_by) ?? '',
    doneAt: r.done_at, doneBy: names.get(r.done_by) ?? '',
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export async function setReconcileDone(ym: string, on: boolean): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from('biz_invoice_reconcile')
    .update({ done_at: on ? new Date().toISOString() : null, done_by: on ? (u.user?.id ?? null) : null })
    .eq('ym', ym);
  if (error) throw new Error(error.message);
}

// ── 맞추기 ────────────────────────────────────────────────
export interface MatchRow {
  bizNo: string;
  clientName: string;             // ERP 표기
  ourName: string;                // 우리 표기
  placeId: string | null;
  entityId: string | null;
  erpAmount: number;
  ourAmount: number;
  slips: ErpSlip[];
  requests: InvoiceRequest[];
  known: boolean;                 // 우리 거래처관리에 있는 사업자번호인가
}
export interface MatchResult {
  matched: MatchRow[];            // ✅ 금액까지 같음
  amountDiff: MatchRow[];         // ⚠️ 금액 다름
  erpOnly: MatchRow[];            // ❓ ERP 에만 (건별매출·신규)
  ourOnly: MatchRow[];            // ❗ 우리에만 (발행 누락)
  corrections: ErpSlip[];         // ➖ (−)수정전표
}

/**
 * 사업자번호로 ERP 전표와 우리 발행요청을 맞춘다.
 * (−)수정전표는 금액 비교를 흐리므로 따로 빼서 보여준다.
 */
export function matchSlips(
  slips: ErpSlip[], requests: InvoiceRequest[], entities: BizEntityFull[],
): MatchResult {
  const placeByBiz = new Map<string, { placeId: string; entityId: string; name: string }>();
  for (const e of entities) {
    for (const p of e.places) {
      const b = digits(p.bizRegNo);
      if (b && !placeByBiz.has(b)) placeByBiz.set(b, { placeId: p.id, entityId: e.id, name: `${e.name} ${p.placeName}`.trim() });
    }
  }
  const corrections = slips.filter((s) => s.supplyAmount < 0);
  const plus = slips.filter((s) => s.supplyAmount >= 0);

  const keyOf = (r: InvoiceRequest) => {
    for (const e of entities) {
      const p = e.places.find((x) => x.id === r.placeId) ?? (r.entityId === e.id ? (e.places.find((x) => x.isHeadquarters) ?? e.places[0]) : undefined);
      if (p) return digits(p.bizRegNo);
    }
    return '';
  };

  const bag = new Map<string, MatchRow>();
  const touch = (b: string, erpName: string) => {
    let row = bag.get(b);
    if (!row) {
      const known = placeByBiz.get(b);
      row = {
        bizNo: b, clientName: erpName, ourName: known?.name ?? '', placeId: known?.placeId ?? null,
        entityId: known?.entityId ?? null, erpAmount: 0, ourAmount: 0, slips: [], requests: [], known: !!known,
      };
      bag.set(b, row);
    }
    if (erpName && !row.clientName) row.clientName = erpName;
    return row;
  };
  for (const s of plus) { const r = touch(s.bizNo, s.clientName); r.erpAmount += s.supplyAmount; r.slips.push(s); }
  for (const q of requests) {
    if (q.status === '취소' || q.status === '수정발행') continue;
    const b = keyOf(q); if (!b) continue;
    const r = touch(b, ''); r.ourAmount += q.supplyAmount; r.requests.push(q);
    if (!r.ourName) r.ourName = `${q.companyName} ${q.placeName}`.trim();
  }

  const out: MatchResult = { matched: [], amountDiff: [], erpOnly: [], ourOnly: [], corrections };
  for (const r of bag.values()) {
    if (!r.slips.length) out.ourOnly.push(r);
    else if (!r.requests.length) out.erpOnly.push(r);
    else if (Math.abs(r.erpAmount - r.ourAmount) >= 1) out.amountDiff.push(r);
    else out.matched.push(r);
  }
  const byName = (a: MatchRow, b: MatchRow) => (b.erpAmount || b.ourAmount) - (a.erpAmount || a.ourAmount);
  out.matched.sort(byName); out.amountDiff.sort(byName); out.erpOnly.sort(byName); out.ourOnly.sort(byName);
  return out;
}

/** 맞은 건을 발행완료로. 전표번호·발행일을 함께 남긴다. */
export async function markMatchedIssued(rows: MatchRow[], issuedDate: string): Promise<number> {
  const { data: u } = await supabase.auth.getUser();
  let n = 0;
  for (const row of rows) {
    for (const q of row.requests) {
      if (q.status !== '요청') continue;
      const slip = row.slips[0];
      const { error } = await supabase.from('biz_invoice_request').update({
        status: '발행완료', issued_date: issuedDate,
        invoice_no: q.invoiceNo || slip?.slipNo || null,
        issued_by: u.user?.id ?? null,
      }).eq('id', q.id);
      if (error) throw new Error(error.message);
      n++;
    }
  }
  return n;
}

/** 우리 요청 금액을 ERP 실제 발행액으로 맞춘다(ERP 가 사실이라고 판단했을 때). */
export async function alignToErp(row: MatchRow): Promise<void> {
  if (row.requests.length !== 1) throw new Error('요청이 여러 건이라 자동으로 맞출 수 없습니다. 건별로 수정해 주세요.');
  const q = row.requests[0];
  const sup = row.erpAmount, vat = Math.round(sup * VAT_RATE);
  const { error } = await supabase.from('biz_invoice_request')
    .update({ supply_amount: sup, vat, total: sup + vat })
    .eq('id', q.id);
  if (error) throw new Error(error.message);
}

/** ERP 계약유형 → 우리 ERP 매출계정. */
function accountOfContractKind(kind: string): string {
  if (/감사\s*및\s*검토/.test(kind)) return '회계감사수입';
  if (/임의감사|비외감/.test(kind)) return '임의감사수입';
  if (/기장/.test(kind)) return '기장대리수입';
  if (/세무조정/.test(kind)) return '세무조정수입';
  return '기타용역수입';
}
/** 적요에서 회차를 읽는다 — '2026년 회계감사 착수금', '외감법감사(지정)-중도금'. */
function phaseOfDescription(desc: string): string {
  if (/착수금|계약금/.test(desc)) return '계약금';
  if (/중도금/.test(desc)) return '중도금';
  if (/잔금/.test(desc)) return '잔금';
  return '총액';
}

/**
 * 그 거래처의 살아있는 계약 중 이 발행에 붙일 것을 찾는다.
 *
 * 감사 계약은 계약금·중도금·잔금이 건별로 나가는데 **분할청구일자를 jaytax 에 넣지 않는 경우가 많다**.
 * 그래서 회차를 못 찾아도 계약만 맞으면 **그 계약의 부분청구로 붙인다**(사용자 확정 2026-09-01).
 * 계약이 여럿이면 붙이지 않는다 — 잘못 붙는 것보다 비워 두고 사람이 고르는 편이 낫다.
 */
async function findContract(entityId: string, team: string, ym: string): Promise<{ id: string; code: string } | null> {
  const { data } = await supabase.from('biz_sales_contract')
    .select('id, contract_code, start_date, end_date, category_code')
    .eq('entity_id', entityId).eq('team', team);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rows = (data as any[] ?? []).filter((c) => {
    const from = `${ym}-01`, to = `${ym}-31`;
    return (!c.start_date || c.start_date <= to) && (!c.end_date || c.end_date >= from);
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (rows.length !== 1) return null;
  return { id: rows[0].id, code: rows[0].contract_code || '' };
}

/**
 * ERP 에만 있는 발행을 우리 발행요청으로 들여온다.
 * 계약이 하나로 좁혀지면 **그 계약의 부분청구로 붙이고**, 아니면 계약 없이 넣는다.
 */
export async function importErpOnly(
  row: MatchRow, ym: string, issuedDate: string, team = 'taxteam',
): Promise<void> {
  if (!row.entityId) throw new Error('우리 거래처관리에 없는 사업자번호입니다. 거래처를 먼저 등록해 주세요.');
  const { data: u } = await supabase.auth.getUser();
  const sup = row.erpAmount, vat = Math.round(sup * VAT_RATE);
  const desc = row.slips.map((s) => s.description).filter(Boolean).join(' / ');
  const kind = row.slips.map((s) => s.contractKind).find(Boolean) ?? '';
  const linked = await findContract(row.entityId, team, ym);
  const { data, error } = await supabase.from('biz_invoice_request').insert({
    ym, entity_id: row.entityId, place_id: row.placeId, team,
    contract_id: linked?.id ?? null, contract_code: linked?.code ?? '',
    supply_amount: sup, vat, total: sup + vat,
    status: '발행완료', issued_date: issuedDate,
    invoice_no: row.slips[0]?.slipNo ?? null,
    erp_account: accountOfContractKind(kind), phase: phaseOfDescription(desc),
    company_name: row.ourName || row.clientName, place_name: '',
    summary: desc,
    note: linked ? 'ERP 대사에서 들여옴 — 계약의 부분청구로 연결' : 'ERP 대사에서 들여옴 — 매출계약 미연결',
    requested_by: u.user?.id ?? null, issued_by: u.user?.id ?? null,
  }).select('id').single();
  if (error) throw new Error(error.message);
  const id = (data as { id: string }).id;
  await supabase.from('biz_erp_slip').update({ request_id: id })
    .eq('ym', ym).in('slip_no', row.slips.map((s) => s.slipNo));
}

/** (−)수정전표를 수정발행으로 기록한다. 금액은 음수 그대로. */
export async function importCorrection(
  slip: ErpSlip, entities: BizEntityFull[], team = 'taxteam',
): Promise<void> {
  let entityId: string | null = null, placeId: string | null = null, name = '';
  for (const e of entities) {
    const p = e.places.find((x) => digits(x.bizRegNo) === slip.bizNo);
    if (p) { entityId = e.id; placeId = p.id; name = `${e.name} ${p.placeName}`.trim(); break; }
  }
  if (!entityId) throw new Error('우리 거래처관리에 없는 사업자번호입니다. 거래처를 먼저 등록해 주세요.');
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('biz_invoice_request').insert({
    ym: slip.ym, entity_id: entityId, place_id: placeId, team,
    supply_amount: slip.supplyAmount, vat: slip.vat, total: slip.total,
    status: '수정발행', issued_date: null, invoice_no: slip.slipNo,
    company_name: name, place_name: '', summary: slip.description,
    note: 'ERP (−)수정전표',
    requested_by: u.user?.id ?? null, issued_by: u.user?.id ?? null,
  }).select('id').single();
  if (error) throw new Error(error.message);
  await supabase.from('biz_erp_slip').update({ request_id: (data as { id: string }).id })
    .eq('ym', slip.ym).eq('slip_no', slip.slipNo);
}
