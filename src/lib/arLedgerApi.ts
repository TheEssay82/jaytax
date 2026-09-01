// ERP 부서별 미수금대장 — 건별 잔액과 **실제 발행일**.
//
// 미수금의 나이를 추정하지 않아도 되는 이유가 이 표에 있다.
//   invoiceNo(= 거래전표번호) 26-0225-0099 → 2026-02-25 발행
//   잔금 = 기초이월 + 청구 − 입금 − 대손 을 ERP 가 **건별로** 이미 맞춰 두었다
// 그래서 이 표만 올리면 "무엇이 언제부터 안 들어왔나"를 그대로 알 수 있다.
//
// 다만 대장은 **그 부서 전체**다(우리 담당이 아닌 회계사 건도 나온다). 그래서
// 거래처를 붙이고, 남의 건은 접어 둔다 — 원장 입금과 같은 방식이다.
import { supabase } from './supabase';
import { corpDisplayName, type BizEntityFull } from './bizRegistryApi';
import { dateOfSlip } from './receiptApi';

const num = (v: unknown) => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;
const txt = (v: unknown) => String(v ?? '').trim();

export interface ArItem {
  id?: string;
  ym: string; team: string;
  invoiceNo: string;
  issuedDate: string | null;
  acct: string;
  clientName: string;
  billed: number; opening: number; paid: number; writeoff: number; balance: number;
  contractNo: string; phase: string; kind: string; cpa: string;
  entityId: string | null; placeId: string | null;
  excluded?: boolean;
}
export interface ArRead {
  rows: ArItem[];
  openingTotal: number; billedTotal: number; paidTotal: number; balanceTotal: number;
  sheet: string;
  /** 대장 머리글에 적힌 조회기간(확인용). */
  period: string;
}

/** 미수금대장 엑셀을 읽는다. 저장하지 않고 읽기만 한다. */
export async function parseArLedger(file: File, ym: string, team: string): Promise<ArRead> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = wb.SheetNames[0];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, defval: '' });
  const hi = raw.findIndex((r) => (r as unknown[]).some((c) => txt(c) === 'invoiceNo'));
  if (hi < 0) throw new Error('「invoiceNo」 열이 있는 미수금대장이 아닙니다. ERP ▸ 기간 미수금대장 엑셀을 올려 주세요.');
  const header = (raw[hi] as unknown[]).map(txt);
  const at = (n: string) => header.indexOf(n);
  const col = {
    acct: at('계정명'), client: at('거래처'), inv: at('invoiceNo'), billed: at('청구액'),
    open: at('기초이월액'), paid: at('당기입금액'), bad: at('당기대손액'), bal: at('잔금'),
    con: at('계약번호'), phase: at('청구구분'), kind: at('계약구분'), cpa: at('회계사'),
  };
  if (col.inv < 0 || col.bal < 0) throw new Error('「invoiceNo」·「잔금」 열을 찾지 못했습니다.');
  // 머리글 두 번째 줄에 조회기간이 적혀 있다 — 고른 달과 다르면 화면이 짚어 준다.
  const period = raw.slice(0, hi).flat().map(txt).find((t) => /기간\s*:/.test(t)) ?? '';

  const rows: ArItem[] = [];
  let openingTotal = 0, billedTotal = 0, paidTotal = 0, balanceTotal = 0;
  for (const r0 of raw.slice(hi + 1)) {
    const r = r0 as unknown[];
    const invoiceNo = txt(r[col.inv]);
    if (!invoiceNo || /^(합계|소계|누계|월계)/.test(invoiceNo)) continue;
    const opening = num(r[col.open]), billed = num(r[col.billed]);
    const paid = num(r[col.paid]), writeoff = num(r[col.bad]), balance = num(r[col.bal]);
    openingTotal += opening; billedTotal += billed; paidTotal += paid; balanceTotal += balance;
    rows.push({
      ym, team, invoiceNo, issuedDate: dateOfSlip(invoiceNo),
      acct: col.acct >= 0 ? txt(r[col.acct]) : '',
      clientName: col.client >= 0 ? txt(r[col.client]) : '',
      billed, opening, paid, writeoff, balance,
      contractNo: col.con >= 0 ? txt(r[col.con]) : '',
      phase: col.phase >= 0 ? txt(r[col.phase]) : '',
      kind: col.kind >= 0 ? txt(r[col.kind]) : '',
      cpa: col.cpa >= 0 ? txt(r[col.cpa]) : '',
      entityId: null, placeId: null,
    });
  }
  return { rows, openingTotal, billedTotal, paidTotal, balanceTotal, sheet, period };
}

/**
 * 대장에는 거래처코드가 없다(이름뿐). 그래서 **상호를 정규화해 거래처**에 붙인다.
 * 사업장까지는 정하지 않는다 — 대장이 거래처 단위이고, 사업장이 여럿인 곳에서
 * 이름만 보고 고르면 엉뚱한 곳에 붙기 때문이다(이찬혁·장석종).
 */
export function attachEntities(rows: ArItem[], entities: BizEntityFull[]): ArItem[] {
  const norm = (s: string) => s
    .replace(/주식회사|유한회사|\(주\)|\(유\)|㈜|\(재\)|재단법인|사단법인/g, '')
    .replace(/[()[\]\s\-_.,·]/g, '').toLowerCase();
  const byName = new Map<string, { entityId: string; placeId: string | null }>();
  for (const e of entities) {
    const hq = e.places.find((p) => p.isHeadquarters) ?? e.places[0];
    const put = (k: string, placeId: string | null) => {
      const n = norm(k);
      if (n && !byName.has(n)) byName.set(n, { entityId: e.id, placeId });
    };
    put(e.name, e.places.length === 1 ? (hq?.id ?? null) : null);
    put(corpDisplayName(e.name, e.corpForm, e.corpFormPosition), e.places.length === 1 ? (hq?.id ?? null) : null);
    // 사업장 이름이 상호와 다른 곳은 그 이름으로도 찾는다(사업장이 특정된다).
    for (const p of e.places) if (norm(p.placeName) !== norm(e.name)) put(p.placeName, p.id);
  }
  return rows.map((r) => {
    const hit = byName.get(norm(r.clientName));
    return hit ? { ...r, entityId: hit.entityId, placeId: hit.placeId } : r;
  });
}

export async function saveArItems(
  ym: string, team: string, rows: ArItem[], fileName: string,
  totals: { openingTotal: number; billedTotal: number; paidTotal: number; balanceTotal: number },
): Promise<number> {
  const { data: u } = await supabase.auth.getUser();
  // 이 달 것을 통째로 갈아끼운다 — 같은 달을 두 번 올려도 두 배가 되지 않게.
  await supabase.from('biz_ar_item').delete().eq('ym', ym).eq('team', team);
  if (rows.length) {
    const { error } = await supabase.from('biz_ar_item').insert(rows.map((r) => ({
      ym, team, invoice_no: r.invoiceNo, issued_date: r.issuedDate, acct: r.acct,
      client_name: r.clientName, billed: r.billed, opening: r.opening, paid: r.paid,
      writeoff: r.writeoff, balance: r.balance, contract_no: r.contractNo || null,
      phase: r.phase || null, kind: r.kind || null, cpa: r.cpa || null,
      entity_id: r.entityId, place_id: r.placeId,
    })));
    if (error) throw new Error(error.message);
  }
  const { error: e2 } = await supabase.from('biz_ar_upload').upsert({
    ym, team, file_name: fileName, row_count: rows.length,
    opening_total: totals.openingTotal, billed_total: totals.billedTotal,
    paid_total: totals.paidTotal, balance_total: totals.balanceTotal,
    uploaded_at: new Date().toISOString(), uploaded_by: u.user?.id ?? null,
  }, { onConflict: 'ym,team' });
  if (e2) throw new Error(e2.message);
  return rows.length;
}

export async function listArItems(ym?: string, team?: string): Promise<ArItem[]> {
  let q = supabase.from('biz_ar_item').select('*').order('issued_date');
  if (ym) q = q.eq('ym', ym);
  if (team) q = q.eq('team', team);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return ((data as any[]) ?? []).map((r) => ({
    id: r.id, ym: r.ym, team: r.team, invoiceNo: r.invoice_no, issuedDate: r.issued_date,
    acct: r.acct || '', clientName: r.client_name || '',
    billed: Number(r.billed) || 0, opening: Number(r.opening) || 0, paid: Number(r.paid) || 0,
    writeoff: Number(r.writeoff) || 0, balance: Number(r.balance) || 0,
    contractNo: r.contract_no || '', phase: r.phase || '', kind: r.kind || '', cpa: r.cpa || '',
    entityId: r.entity_id, placeId: r.place_id, excluded: !!r.excluded,
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export interface ArUpload {
  ym: string; team: string; fileName: string; rowCount: number;
  openingTotal: number; billedTotal: number; paidTotal: number; balanceTotal: number;
  uploadedAt: string; uploadedBy: string;
}
export async function listArUploads(): Promise<ArUpload[]> {
  const { data, error } = await supabase.from('biz_ar_upload').select('*').order('ym');
  if (error) throw new Error(error.message);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rows = (data as any[]) ?? [];
  const ids = [...new Set(rows.map((r) => r.uploaded_by).filter(Boolean))];
  let names = new Map<string, string>();
  if (ids.length) {
    const { data: p } = await supabase.from('profiles').select('id, name').in('id', ids);
    names = new Map(((p as any[]) ?? []).map((x) => [x.id as string, ((x.name as string) || '').trim()]));
  }
  return rows.map((r) => ({
    ym: r.ym, team: r.team, fileName: r.file_name || '', rowCount: r.row_count || 0,
    openingTotal: Number(r.opening_total) || 0, billedTotal: Number(r.billed_total) || 0,
    paidTotal: Number(r.paid_total) || 0, balanceTotal: Number(r.balance_total) || 0,
    uploadedAt: r.uploaded_at, uploadedBy: names.get(r.uploaded_by) ?? '',
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** 대장 줄에 거래처를 손으로 붙인다(같은 이름의 다른 달 줄도 함께). */
export async function assignArClient(clientName: string, entityId: string, placeId: string | null): Promise<number> {
  const { data, error } = await supabase.from('biz_ar_item')
    .update({ entity_id: entityId, place_id: placeId, excluded: false })
    .eq('client_name', clientName).select('id');
  if (error) throw new Error(error.message);
  return (data as { id: string }[] | null)?.length ?? 0;
}

/** 우리 담당이 아닌 거래처를 접는다(같은 이름 전부). */
export async function excludeArClient(clientName: string, on: boolean): Promise<number> {
  const { data, error } = await supabase.from('biz_ar_item')
    .update({ excluded: on }).eq('client_name', clientName).select('id');
  if (error) throw new Error(error.message);
  return (data as { id: string }[] | null)?.length ?? 0;
}

export async function clearArItems(ym: string, team: string): Promise<void> {
  await supabase.from('biz_ar_item').delete().eq('ym', ym).eq('team', team);
  const { error } = await supabase.from('biz_ar_upload').delete().eq('ym', ym).eq('team', team);
  if (error) throw new Error(error.message);
}
