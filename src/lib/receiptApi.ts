// 수금(입금)과 거래처별 미수금 — ERP 부서별원장의 외상매출금 시트를 읽는다.
//
//   미수금 = 기초 + 발행 − 입금   (전부 VAT 포함 기준)
//
// 발행은 거래전표(사업자번호)로, 입금은 원장(거래처코드)으로 들어온다.
// 원장에는 사업자번호가 없어서 **거래처코드(biz_place.erp_client_code)** 가 유일한 키다.
import { supabase } from './supabase';
import type { BizEntityFull } from './bizRegistryApi';

const num = (v: unknown) => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;
const txt = (v: unknown) => String(v ?? '').trim();

export interface Receipt {
  id?: string;
  ym: string; team: string;
  slipNo: string; lineNo: number; paidDate: string | null;
  clientCode: string; clientName: string; summary: string;
  amount: number;                       // VAT 포함
  placeId: string | null; entityId: string | null;
  /** 우리와 무관하다고 판단해 접어 둔 건. 미매칭 목록에서만 빠진다. */
  excluded?: boolean;
  excludeNote?: string;
}
export interface LedgerRead {
  rows: Receipt[];
  opening: number;                      // 이월액
  debitTotal: number;                   // 차변 합(발행)
  creditTotal: number;                  // 대변 합(입금)
  closing: number;                      // 기말 = 이월 + 차변 − 대변
  sheet: string;
}

/** 전표번호 26-0701-0010 → 2026-07-01. 원장에는 날짜 열이 없어 여기서 읽는다. */
export function dateOfSlip(slipNo: string): string | null {
  const m = /^(\d{2})-(\d{2})(\d{2})-/.exec(slipNo.trim());
  if (!m) return null;
  return `20${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * 부서별원장 엑셀에서 외상매출금 시트를 읽는다. 저장하지 않고 읽기만 한다.
 * 이월·차변·대변을 함께 돌려줘 화면이 바로 검산할 수 있게 한다.
 */
export async function parseLedgerFile(file: File, ym: string, team: string): Promise<LedgerRead> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = wb.SheetNames.find((n) => /외상매출금/.test(n));
  if (!sheet) {
    throw new Error('「외상매출금」 시트를 찾지 못했습니다. 부서별원장 엑셀을 올려 주세요.');
  }
  const raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, defval: '' });
  const hi = raw.findIndex((r) => (r as unknown[]).some((c) => txt(c) === '전표번호'));
  if (hi < 0) throw new Error('「전표번호」 열이 있는 원장이 아닙니다.');
  const header = (raw[hi] as unknown[]).map(txt);
  const at = (n: string) => header.indexOf(n);
  const col = {
    slip: at('전표번호'), line: at('번호'), code: at('거래처코드'), name: at('거래처'),
    sum: at('적 요') >= 0 ? at('적 요') : at('적요'),
    debit: at('차변금액'), credit: at('대변금액'),
  };
  if (col.credit < 0 || col.code < 0) throw new Error('「대변금액」·「거래처코드」 열을 찾지 못했습니다.');

  const rows: Receipt[] = [];
  const seen = new Map<string, number>();          // 전표당 줄 번호가 비어 있을 때 대비
  let opening = 0, debitTotal = 0, creditTotal = 0;
  for (const r0 of raw.slice(hi + 1)) {
    const r = r0 as unknown[];
    const slipNo = txt(r[col.slip]);
    if (slipNo === '이월액') { opening = num(r[col.debit]) - num(r[col.credit]); continue; }
    if (!slipNo || /^(월계|누계|합계)/.test(slipNo)) continue;
    const debit = num(r[col.debit]), credit = num(r[col.credit]);
    debitTotal += debit; creditTotal += credit;
    if (credit <= 0) continue;                     // 입금(대변)만 담는다
    const n = seen.get(slipNo) ?? 0; seen.set(slipNo, n + 1);
    rows.push({
      ym, team, slipNo,
      lineNo: col.line >= 0 && num(r[col.line]) ? num(r[col.line]) : n + 1,
      paidDate: dateOfSlip(slipNo),
      clientCode: txt(r[col.code]), clientName: txt(r[col.name]),
      summary: col.sum >= 0 ? txt(r[col.sum]) : '',
      amount: credit, placeId: null, entityId: null,
    });
  }
  return { rows, opening, debitTotal, creditTotal, closing: opening + debitTotal - creditTotal, sheet };
}

/** 거래처코드로 사업장을 찾아 붙인다. 코드가 없으면 이름으로 한 번 더 본다. */
export function attachPlaces(rows: Receipt[], entities: BizEntityFull[]): Receipt[] {
  const byCode = new Map<string, { placeId: string; entityId: string }>();
  const byName = new Map<string, { placeId: string; entityId: string }>();
  const norm = (s: string) => s.replace(/주식회사|유한회사|\(주\)|\(유\)|㈜/g, '').replace(/[()[\]\s\-_.,·]/g, '').toLowerCase();
  for (const e of entities) {
    for (const p of e.places) {
      if (p.erpClientCode) byCode.set(p.erpClientCode, { placeId: p.id, entityId: e.id });
      const k = norm(e.name); if (k && !byName.has(k)) byName.set(k, { placeId: p.id, entityId: e.id });
      const k2 = norm(p.placeName); if (k2 && !byName.has(k2)) byName.set(k2, { placeId: p.id, entityId: e.id });
    }
  }
  return rows.map((r) => {
    const hit = (r.clientCode && byCode.get(r.clientCode)) || byName.get(norm(r.clientName));
    return hit ? { ...r, placeId: hit.placeId, entityId: hit.entityId } : r;
  });
}

export async function saveReceipts(
  ym: string, team: string, rows: Receipt[], fileName: string,
  totals: { opening: number; debitTotal: number; creditTotal: number },
): Promise<number> {
  const { data: u } = await supabase.auth.getUser();
  await supabase.from('biz_receipt').delete().eq('ym', ym).eq('team', team);
  if (rows.length) {
    const { error } = await supabase.from('biz_receipt').insert(rows.map((r) => ({
      ym, team, slip_no: r.slipNo, line_no: r.lineNo, paid_date: r.paidDate, client_code: r.clientCode || null,
      client_name: r.clientName, summary: r.summary || null, amount: r.amount,
      place_id: r.placeId, entity_id: r.entityId,
    })));
    if (error) throw new Error(error.message);
  }
  const { error: e2 } = await supabase.from('biz_receipt_upload').upsert({
    ym, team, file_name: fileName, row_count: rows.length,
    amount_total: totals.creditTotal, opening: totals.opening, debit_total: totals.debitTotal,
    uploaded_at: new Date().toISOString(), uploaded_by: u.user?.id ?? null,
  }, { onConflict: 'ym,team' });
  if (e2) throw new Error(e2.message);
  return rows.length;
}

export async function listReceipts(ym?: string, team?: string): Promise<Receipt[]> {
  let q = supabase.from('biz_receipt').select('*').order('paid_date');
  if (ym) q = q.eq('ym', ym);
  if (team) q = q.eq('team', team);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data as any[]).map((r) => ({
    id: r.id, ym: r.ym, team: r.team, slipNo: r.slip_no, lineNo: r.line_no ?? 1, paidDate: r.paid_date,
    clientCode: r.client_code || '', clientName: r.client_name || '', summary: r.summary || '',
    amount: Number(r.amount) || 0, placeId: r.place_id, entityId: r.entity_id,
    excluded: !!r.excluded, excludeNote: r.exclude_note || '',
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * 못 붙은 입금에 거래처를 손으로 붙인다.
 *
 * `saveCode` 를 주면 그 사업장에 **ERP 거래처코드를 적어 둔다** — 다음 달부터는 저절로 붙는다.
 * 한 번 손으로 붙이고 끝나는 게 아니라 다음을 위해 배우는 것이 요점이다.
 */
export async function assignReceipt(
  id: string, placeId: string, entityId: string, clientCode: string, saveCode: boolean,
): Promise<void> {
  const { error } = await supabase.from('biz_receipt')
    .update({ place_id: placeId, entity_id: entityId, excluded: false }).eq('id', id);
  if (error) throw new Error(error.message);
  if (saveCode && clientCode.trim()) {
    const e2 = await supabase.from('biz_place')
      .update({ erp_client_code: clientCode.trim() }).eq('id', placeId);
    if (e2.error) throw new Error(e2.error.message);
  }
}

/** 우리와 무관한 입금을 접거나 되돌린다. */
export async function excludeReceipts(ids: string[], on: boolean, note = ''): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from('biz_receipt')
    .update({ excluded: on, exclude_note: on ? (note || null) : null }).in('id', ids);
  if (error) throw new Error(error.message);
}

/**
 * 아직 못 붙은 입금을 **거래처코드로만** 다시 붙여 본다.
 * 이름으로 억지로 붙이지 않는 이유 — 사업장이 여럿인 거래처(이찬혁·차트 등)에서
 * 엉뚱한 사업장에 붙으면 미수금이 조용히 틀어진다. 그런 건은 손으로 고르게 둔다.
 */
export async function rematchReceipts(entities: BizEntityFull[]): Promise<number> {
  const byCode = new Map<string, { placeId: string; entityId: string }>();
  for (const e of entities) {
    for (const pl of e.places) if (pl.erpClientCode) byCode.set(pl.erpClientCode, { placeId: pl.id, entityId: e.id });
  }
  const { data, error } = await supabase.from('biz_receipt')
    .select('id, client_code').is('place_id', null).eq('excluded', false);
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rows = ((data as any[]) ?? []).filter((r) => r.client_code && byCode.has(r.client_code));
  /* eslint-enable @typescript-eslint/no-explicit-any */
  for (const r of rows) {
    const hit = byCode.get(r.client_code)!;
    await supabase.from('biz_receipt').update({ place_id: hit.placeId, entity_id: hit.entityId }).eq('id', r.id);
  }
  return rows.length;
}

export async function clearReceipts(ym: string, team: string): Promise<void> {
  await supabase.from('biz_receipt').delete().eq('ym', ym).eq('team', team);
  const { error } = await supabase.from('biz_receipt_upload').delete().eq('ym', ym).eq('team', team);
  if (error) throw new Error(error.message);
}

export interface UploadState {
  ym: string; team: string; fileName: string; rowCount: number;
  amountTotal: number; opening: number; debitTotal: number; uploadedAt: string; uploadedBy: string;
}
export async function listUploads(): Promise<UploadState[]> {
  const { data, error } = await supabase.from('biz_receipt_upload').select('*').order('ym');
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rows = (data as any[]) ?? [];
  const ids = [...new Set(rows.map((r) => r.uploaded_by).filter(Boolean))];
  let names = new Map<string, string>();
  if (ids.length) {
    const { data: p } = await supabase.from('profiles').select('id, name').in('id', ids);
    names = new Map((p as any[] ?? []).map((x) => [x.id as string, ((x.name as string) || '').trim()]));
  }
  return rows.map((r) => ({
    ym: r.ym, team: r.team, fileName: r.file_name || '', rowCount: r.row_count || 0,
    amountTotal: Number(r.amount_total) || 0, opening: Number(r.opening) || 0,
    debitTotal: Number(r.debit_total) || 0, uploadedAt: r.uploaded_at,
    uploadedBy: names.get(r.uploaded_by) ?? '',
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
