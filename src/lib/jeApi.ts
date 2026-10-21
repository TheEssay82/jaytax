// 감사업무관리 › Journal Entry 시스템 — 표 읽고 쓰기(je_job · je_upload · je_line · je_tb · je_pick, 마이그 0181 · 0182).
// 셈은 jeChecks.ts, 읽기는 jeParse.ts. 분개장 줄은 DB 에 저장한다(사용자 2026-10-21) — 감사팀만 읽는다(RLS is_audit_staff).
import { supabase } from './supabase';
import { parseJournalWorkbook, parseBalanceRows, type Erp, type JeLine, type TbRow } from './jeParse';
import { DEFAULT_ON, NEEDS_USER_DATA, defaultParams, type Bench, type BsBalance, type JeParams, type ScenarioCode } from './jeChecks';

const num = (v: unknown) => Number(v ?? 0) || 0;

export interface ScenarioState { on: boolean; reason?: string; conclusion?: string }
export interface Contact { name: string; dept: string; phone: string; email: string }
export interface JeJob {
  engagementId: string;
  erp: Erp;
  listed: boolean;
  relaxed: boolean;
  relaxedNote: string | null;
  bench: Bench;
  params: JeParams & { matExclude: string[]; matSide: '양쪽' | '차변만' };
  scenarios: Partial<Record<ScenarioCode, ScenarioState>>;
  contacts: Contact[];
  preparer: string | null; reviewer: string | null; preparedOn: string | null; reviewedOn: string | null;
  memo: string | null;
  updatedAt: string | null; updatedName: string | null;
}
export interface JeUpload {
  id: string; kind: 'journal' | 'tb'; version: number; current: boolean; fileName: string; erp: string | null;
  lines: number; vouchers: number; drTotal: number; crTotal: number; dateFrom: string | null; dateTo: string | null; masked: number;
  note: string | null; createdAt: string; createdName: string | null;
}

export const defaultScenarios = (): Partial<Record<ScenarioCode, ScenarioState>> =>
  Object.fromEntries(DEFAULT_ON.map((c) => [c, { on: true }]).concat(NEEDS_USER_DATA.map((c) => [c, { on: false, reason: 'ERP 분개장에 작성자 · 승인자 · 입력일 데이터가 없어 수행하지 않음' }])));

function toJob(r: Record<string, unknown>): JeJob {
  const p = (r.params ?? {}) as Record<string, unknown>;
  const dp = defaultParams();
  return {
    engagementId: r.engagement_id as string,
    erp: (r.erp as Erp) ?? '더존',
    listed: !!r.listed, relaxed: !!r.relaxed, relaxedNote: (r.relaxed_note as string) ?? null,
    bench: { name: (p.benchName as string) ?? '매출', amount: num(p.benchAmount), rate: p.benchRate == null ? 0.01 : num(p.benchRate), reason: (p.benchReason as string) ?? '' },
    params: {
      ...dp,
      ...(p.rareCount != null ? { rareCount: num(p.rareCount) } : {}),
      ...(p.roundUnit != null ? { roundUnit: num(p.roundUnit) } : {}),
      ...(typeof p.salesPartnerRe === 'string' ? { salesPartnerRe: p.salesPartnerRe } : {}),
      ...(typeof p.memoWords === 'string' ? { memoWords: p.memoWords } : {}),
      ...(p.closingDays != null ? { closingDays: num(p.closingDays) } : {}),
      ...(Array.isArray(p.holidays) ? { holidays: p.holidays as string[] } : {}),
      matExclude: Array.isArray(p.matExclude) ? (p.matExclude as string[]) : [],
      matSide: p.matSide === '차변만' ? '차변만' : '양쪽',
    },
    scenarios: { ...defaultScenarios(), ...((r.scenarios ?? {}) as JeJob['scenarios']) },
    contacts: (r.contacts as Contact[]) ?? [],
    preparer: (r.preparer as string) ?? null, reviewer: (r.reviewer as string) ?? null,
    preparedOn: (r.prepared_on as string) ?? null, reviewedOn: (r.reviewed_on as string) ?? null,
    memo: (r.memo as string) ?? null,
    updatedAt: (r.updated_at as string) ?? null, updatedName: (r.updated_name as string) ?? null,
  };
}

export async function loadJob(engagementId: string): Promise<JeJob | null> {
  const { data, error } = await supabase.from('je_job').select('*').eq('engagement_id', engagementId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toJob(data) : null;
}

export async function ensureJob(engagementId: string, byName: string): Promise<JeJob> {
  const cur = await loadJob(engagementId);
  if (cur) return cur;
  const { data, error } = await supabase.from('je_job').insert({ engagement_id: engagementId, scenarios: defaultScenarios(), updated_name: byName }).select('*').single();
  if (error) throw new Error(error.message);
  return toJob(data);
}

export async function saveJob(job: JeJob, byName: string): Promise<void> {
  const { matExclude, ...rest } = job.params;
  const params = { ...rest, matExclude, benchName: job.bench.name, benchAmount: job.bench.amount, benchRate: job.bench.rate, benchReason: job.bench.reason };
  const { error } = await supabase.from('je_job').update({
    erp: job.erp, listed: job.listed, relaxed: job.relaxed, relaxed_note: job.relaxedNote,
    materiality: Math.round(job.bench.amount * job.bench.rate), params, scenarios: job.scenarios, contacts: job.contacts,
    preparer: job.preparer, reviewer: job.reviewer, prepared_on: job.preparedOn || null, reviewed_on: job.reviewedOn || null,
    memo: job.memo, updated_name: byName,
  }).eq('engagement_id', job.engagementId);
  if (error) throw new Error(error.message);
}

const toUpload = (r: Record<string, unknown>): JeUpload => ({
  id: r.id as string, kind: r.kind as 'journal' | 'tb', version: Number(r.version), current: !!r.current, fileName: r.file_name as string, erp: (r.erp as string) ?? null,
  lines: Number(r.lines), vouchers: Number(r.vouchers), drTotal: num(r.dr_total), crTotal: num(r.cr_total),
  dateFrom: (r.date_from as string) ?? null, dateTo: (r.date_to as string) ?? null, masked: Number(r.masked ?? 0),
  note: (r.note as string) ?? null, createdAt: r.created_at as string, createdName: (r.created_name as string) ?? null,
});

export async function listUploads(engagementId: string): Promise<JeUpload[]> {
  const { data, error } = await supabase.from('je_upload').select('*').eq('engagement_id', engagementId).order('kind').order('version', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toUpload);
}

/** 감사 건별 JET 진행 요약(회사 목록 색). */
export async function jobSummaries(): Promise<Map<string, { journal: boolean; tb: boolean }>> {
  const { data, error } = await supabase.from('je_upload').select('engagement_id, kind').eq('current', true);
  if (error) throw new Error(error.message);
  const m = new Map<string, { journal: boolean; tb: boolean }>();
  for (const r of data ?? []) { const o = m.get(r.engagement_id) ?? { journal: false, tb: false }; if (r.kind === 'journal') o.journal = true; else o.tb = true; m.set(r.engagement_id, o); }
  return m;
}

async function nextVersion(engagementId: string, kind: 'journal' | 'tb'): Promise<number> {
  const { data, error } = await supabase.from('je_upload').select('version').eq('engagement_id', engagementId).eq('kind', kind).order('version', { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0]?.version ?? 0) + 1;
}

async function insertChunks(table: string, rows: Record<string, unknown>[], onProgress?: (done: number, total: number) => void) {
  const size = 1000;
  let done = 0;
  // 네 개씩 나란히 — 6만 줄이 십여 초 안에 들어간다.
  const chunks: Record<string, unknown>[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  for (let i = 0; i < chunks.length; i += 4) {
    await Promise.all(chunks.slice(i, i + 4).map(async (c) => {
      const { error } = await supabase.from(table).insert(c);
      if (error) throw new Error(error.message);
      done += c.length; onProgress?.(done, rows.length);
    }));
  }
}

async function makeCurrent(engagementId: string, kind: 'journal' | 'tb', id: string) {
  const { error } = await supabase.from('je_upload').update({ current: false }).eq('engagement_id', engagementId).eq('kind', kind).neq('id', id);
  if (error) throw new Error(error.message);
}

const tbRows = (uploadId: string, tb: TbRow[]) => tb.map((t, i) => ({ upload_id: uploadId, ord: i + 1, acct_code: t.acctCode, acct_name: t.acctName, open_bal: t.open, dr: t.dr, cr: t.cr, close_bal: t.close }));

/** 분개장 올리기 — 브라우저에서 읽고(주민번호 꼴 지움) 줄을 DB 에. 이전 판은 남기고 current 만 옮긴다(재요청 경과). */
export async function uploadJournal(engagementId: string, file: File, note: string | null, byName: string, onProgress?: (msg: string) => void): Promise<{ upload: JeUpload; erp: Erp; skipped: number }> {
  onProgress?.('파일을 읽는 중…');
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer());
  const p = parseJournalWorkbook(wb, (sh) => XLSX.utils.sheet_to_json(sh as never, { header: 1, defval: '', raw: true }) as unknown[][]);
  const vset = new Set(p.lines.map((l) => `${l.date}|${l.no}`));
  const dates = p.lines.map((l) => l.date).sort();
  const version = await nextVersion(engagementId, 'journal');
  const { data, error } = await supabase.from('je_upload').insert({
    engagement_id: engagementId, kind: 'journal', version, current: false, file_name: file.name, erp: p.erp,
    lines: p.lines.length, vouchers: vset.size, dr_total: p.lines.reduce((s, l) => s + l.dr, 0), cr_total: p.lines.reduce((s, l) => s + l.cr, 0),
    date_from: dates[0], date_to: dates[dates.length - 1], masked: p.masked, note, created_name: byName,
  }).select('*').single();
  if (error) throw new Error(error.message);
  const id = data.id as string;
  await insertChunks('je_line', p.lines.map((l) => ({
    upload_id: id, seq: l.seq, vdate: l.date, vno: l.no, acct_code: l.acctCode, acct_name: l.acctName, dr: l.dr, cr: l.cr,
    cp_code: l.cpCode, cp_name: l.cpName, memo: l.memo, side: l.side, vtype: l.vtype, appr_date: l.apprDate ?? null, appr_no: l.apprNo ?? null,
  })), (d, t) => onProgress?.(`분개 ${d.toLocaleString()} / ${t.toLocaleString()}줄 저장 중…`));
  if (p.tb?.length) await insertChunks('je_tb', tbRows(id, p.tb));
  // 다 들어간 뒤에야 current — 중간에 끊기면 지난 판이 그대로 쓰인다.
  const { error: e2 } = await supabase.from('je_upload').update({ current: true }).eq('id', id);
  if (e2) throw new Error(e2.message);
  await makeCurrent(engagementId, 'journal', id);
  await supabase.from('je_job').update({ erp: p.erp, updated_name: byName }).eq('engagement_id', engagementId);
  return { upload: toUpload({ ...data, current: true }), erp: p.erp, skipped: p.skipped };
}

/** 회사 제시 잔액표(기초 · 기말) 올리기 — 앱 양식(또는 같은 머리의 표). */
export async function uploadBalances(engagementId: string, file: File, note: string | null, byName: string): Promise<number> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer());
  let rows: ReturnType<typeof parseBalanceRows> | null = null;
  let lastErr: unknown = null;
  for (const s of wb.SheetNames) {
    try { rows = parseBalanceRows(XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1, defval: '', raw: true }) as unknown[][]); if (rows.length) break; } catch (e) { lastErr = e; }
  }
  if (!rows?.length) throw (lastErr instanceof Error ? lastErr : new Error('잔액표에 줄이 없습니다.'));
  return saveBalances(engagementId, rows.map((r) => ({ acctCode: r.acctCode, acctName: r.acctName, open: r.open, close: r.close, group: r.group, side: r.side })), file.name, note, byName);
}

/** 잔액표를 새 판으로 저장(화면에서 고친 묶음 · 방향 포함). */
export async function saveBalances(engagementId: string, rows: BsBalance[], fileName: string, note: string | null, byName: string): Promise<number> {
  const version = await nextVersion(engagementId, 'tb');
  const { data, error } = await supabase.from('je_upload').insert({ engagement_id: engagementId, kind: 'tb', version, current: false, file_name: fileName, lines: rows.length, note, created_name: byName }).select('id').single();
  if (error) throw new Error(error.message);
  const id = data.id as string;
  await insertChunks('je_tb', rows.map((r, i) => ({ upload_id: id, ord: i + 1, acct_code: r.acctCode, acct_name: r.acctName, open_bal: r.open, close_bal: r.close, grp: r.group || null, side: r.side ?? null })));
  const { error: e2 } = await supabase.from('je_upload').update({ current: true }).eq('id', id);
  if (e2) throw new Error(e2.message);
  await makeCurrent(engagementId, 'tb', id);
  return rows.length;
}

export async function loadLines(uploadId: string, onProgress?: (n: number) => void): Promise<JeLine[]> {
  // 배열 하나로 받는다(0183) — 쪽으로 나눠 읽으면 6만 줄에 45초.
  const { data, error } = await supabase.rpc('je_lines_json', { p_upload: uploadId });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown[][];
  onProgress?.(rows.length);
  return rows.map((r) => ({
    seq: Number(r[0]), date: r[1] as string, no: r[2] as string, acctCode: r[3] as string, acctName: r[4] as string,
    dr: num(r[5]), cr: num(r[6]), cpCode: (r[7] as string) ?? null, cpName: (r[8] as string) ?? null, memo: (r[9] as string) ?? '',
    side: (r[10] as string) ?? null, vtype: (r[11] as JeLine['vtype']) ?? '일반', apprDate: (r[12] as string) ?? null, apprNo: (r[13] as string) ?? null,
  }));
}

export async function loadTb(uploadId: string): Promise<(TbRow & { group: string | null; side: 1 | -1 | null })[]> {
  const { data, error } = await supabase.from('je_tb').select('*').eq('upload_id', uploadId).order('ord');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ acctCode: r.acct_code, acctName: r.acct_name, open: num(r.open_bal), dr: num(r.dr), cr: num(r.cr), close: num(r.close_bal), group: r.grp ?? null, side: (r.side ?? null) as 1 | -1 | null }));
}

// ── 선정 전표 · 증빙요청 · 결과(je_pick, 마이그 0181 · 0186) ─────────────────────────
export interface JePick {
  vdate: string; vno: string; scenarios: string[]; amount: number; reason: string | null; selected: boolean;
  /** 감사인이 확인한 증빙 · REF 조서 */ evidence: string | null;
  /** 회사 설명(회신) */ answer: string | null;
  result: '이상없음' | '예외' | '확인중' | null; note: string | null;
  reqNo?: number | null; reqDocs?: string | null; requestedAt?: string | null; replyDocs?: string | null; repliedAt?: string | null; checkedBy?: string | null;
}

const toPick = (r: Record<string, unknown>): JePick => ({
  vdate: r.vdate as string, vno: r.vno as string, scenarios: (r.scenarios as string[]) ?? [], amount: num(r.amount), reason: (r.reason as string) ?? null,
  selected: !!r.selected, evidence: (r.evidence as string) ?? null, answer: (r.answer as string) ?? null, result: (r.result as JePick['result']) ?? null, note: (r.note as string) ?? null,
  reqNo: (r.req_no as number) ?? null, reqDocs: (r.req_docs as string) ?? null, requestedAt: (r.requested_at as string) ?? null,
  replyDocs: (r.reply_docs as string) ?? null, repliedAt: (r.replied_at as string) ?? null, checkedBy: (r.checked_by as string) ?? null,
});
const fromPick = (engagementId: string, p: JePick, byName: string) => ({
  engagement_id: engagementId, vdate: p.vdate, vno: p.vno, scenarios: p.scenarios, amount: p.amount, reason: p.reason, selected: p.selected,
  evidence: p.evidence, answer: p.answer, result: p.result, note: p.note,
  req_no: p.reqNo ?? null, req_docs: p.reqDocs ?? null, requested_at: p.requestedAt ?? null, reply_docs: p.replyDocs ?? null, replied_at: p.repliedAt ?? null, checked_by: p.checkedBy ?? null,
  updated_name: byName,
});

export async function listPicks(engagementId: string): Promise<JePick[]> {
  const { data, error } = await supabase.from('je_pick').select('*').eq('engagement_id', engagementId);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toPick);
}

export async function savePick(engagementId: string, p: JePick, byName: string): Promise<void> {
  const { error } = await supabase.from('je_pick').upsert(fromPick(engagementId, p, byName), { onConflict: 'engagement_id,vdate,vno' });
  if (error) throw new Error(error.message);
}

export async function savePicks(engagementId: string, ps: JePick[], byName: string): Promise<void> {
  for (let i = 0; i < ps.length; i += 500) {
    const { error } = await supabase.from('je_pick').upsert(ps.slice(i, i + 500).map((p) => fromPick(engagementId, p, byName)), { onConflict: 'engagement_id,vdate,vno' });
    if (error) throw new Error(error.message);
  }
}

/** 전기 분개장 계정(같은 회사 · 앞 사업연도 · 같은 별도/연결 건의 현재 판). 없으면 null. */
export async function priorAccounts(entityId: string, fy: number, scope: string): Promise<Map<string, string> | null> {
  const { data: e, error } = await supabase.from('dsd_engagement').select('id').eq('entity_id', entityId).eq('fy', fy - 1).eq('scope', scope).maybeSingle();
  if (error) throw new Error(error.message);
  if (!e) return null;
  const { data: u, error: e2 } = await supabase.from('je_upload').select('id').eq('engagement_id', e.id).eq('kind', 'journal').eq('current', true).maybeSingle();
  if (e2) throw new Error(e2.message);
  if (!u) return null;
  const { data: a, error: e3 } = await supabase.rpc('je_accounts', { p_upload: u.id });
  if (e3) throw new Error(e3.message);
  return new Map(((a ?? []) as { acct_code: string; acct_name: string }[]).map((x) => [x.acct_code, x.acct_name]));
}
