// 일반조서 — 자료함(전기 DSD·정산표) · 웹 조서 입력 · 단계 확정 기록(마이그 0153).
//
// 자료함: 사용자 2026-09-27 「DSD·정산표를 왜 저장하면 안 돼? 저장하는 게 더 편리해」 — 작업 건마다 두고
// 2120A(전기 DSD)·8110ARP(확정 정산표)가 다시 고르지 않고 쓴다. 같은 종류를 다시 올리면 줄이 늘고 최신 것을 쓴다.
import { supabase } from './supabase';
import { stageStates, type StageEvent, type StageNo } from './gwpStage';
import { expectedFy, type FileKind } from './gwpFiles';

const BUCKET = 'gwp';

// ── 자료함 ───────────────────────────────────────────────
export type { FileKind };
/** 자료함 칸 — 단계 순서대로. 2차는 기말감사 때 받은 정산표의 수정전 금액(사용자 2026-09-27). */
export const FILE_KINDS: { kind: FileKind; label: string; accept: string; use: string; stage: 1 | 2 | 3 }[] = [
  { kind: '전기DSD', label: '전기 DSD', accept: '.dsd', use: '1차 — 2120A 당기 열, 2301 계정, 2700A-2 기준 금액', stage: 1 },
  { kind: '수정전정산표', label: '정산표(기말감사 수정전)', accept: '.xlsx,.xlsm', use: '2차 — 2700A-3 기준 금액(수정전 열)', stage: 2 },
  { kind: '정산표', label: '확정 정산표(수정후)', accept: '.xlsx,.xlsm', use: '3차 — 2700A-4 기준 금액·8110ARP 당기(수정후 열)', stage: 3 },
  { kind: '당기DSD', label: '당기 DSD', accept: '.dsd', use: '감사보고서 DSD(참고)', stage: 3 },
];

export interface EngFile {
  id: string; kind: FileKind; storagePath: string; fileName: string; fileSize: number;
  meta: Record<string, unknown>; memo: string | null; uploadedEmail: string | null; createdAt: string;
}
type FileRow = {
  id: string; kind: FileKind; storage_path: string; file_name: string; file_size: number;
  meta: Record<string, unknown> | null; memo: string | null; uploaded_email: string | null; created_at: string;
};
const FILE_SEL = 'id, kind, storage_path, file_name, file_size, meta, memo, uploaded_email, created_at';
const toFile = (r: FileRow): EngFile => ({
  id: r.id, kind: r.kind, storagePath: r.storage_path, fileName: r.file_name, fileSize: r.file_size,
  meta: r.meta ?? {}, memo: r.memo, uploadedEmail: r.uploaded_email, createdAt: r.created_at,
});

/** 자료함 — 최신이 앞. */
export async function listFiles(engagementId: string): Promise<EngFile[]> {
  const { data, error } = await supabase.from('engagement_file').select(FILE_SEL)
    .eq('engagement_id', engagementId).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as FileRow[]).map(toFile);
}

/**
 * 종류별로 쓸 파일 — 최신부터, 뺀 것(meta.void)과 **해가 맞지 않는 것**은 건너뛴다.
 * 사용자 2026-09-27: FY2026 건에 FY2025 확정 정산표를 올린 실수 — 그런 파일은 쓰지 않는다.
 */
export function latestFile(files: EngFile[], kind: FileKind, fy?: number): EngFile | null {
  return files.find((f) => f.kind === kind && !f.meta.void
    && (fy == null || typeof f.meta.fy !== 'number' || f.meta.fy === expectedFy(kind, fy))) ?? null;
}

/** 메모·읽어 둔 요약(meta)만 고친다 — 해를 늦게 알아냈을 때, 잘못 올린 것을 뺄 때(void). */
export async function updateFileMeta(id: string, meta: Record<string, unknown>, memo?: string): Promise<void> {
  const row: Record<string, unknown> = { meta };
  if (memo !== undefined) row.memo = memo;
  const { error } = await supabase.from('engagement_file').update(row).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function uploadFile(
  engagementId: string, kind: FileKind, file: { name: string; bytes: Uint8Array }, meta: Record<string, unknown> = {},
): Promise<EngFile> {
  const { data: u } = await supabase.auth.getUser();
  const ext = (/\.[A-Za-z0-9]+$/.exec(file.name)?.[0] ?? '').toLowerCase();
  const path = `files/${engagementId}/${crypto.randomUUID()}${ext}`;
  const { error: upErr } = await supabase.storage.from(BUCKET)
    .upload(path, new Blob([file.bytes as BlobPart]), { upsert: false, contentType: 'application/octet-stream' });
  if (upErr) throw new Error(upErr.message);
  const { data, error } = await supabase.from('engagement_file').insert({
    engagement_id: engagementId, kind, storage_path: path, file_name: file.name, file_size: file.bytes.length, meta,
    uploaded_by: u.user?.id ?? null, uploaded_email: u.user?.email ?? null,
  }).select(FILE_SEL).single();
  if (error) throw new Error(error.message);
  return toFile(data as unknown as FileRow);
}

// ── 웹 조서 ───────────────────────────────────────────────
export type PaperStatus = '작성중' | '확인' | '엑셀로 넘김';
export interface PaperRow {
  code: string; data: unknown; status: PaperStatus; appliedVersion: number | null;
  checkedAt: string | null; updatedAt: string;
}
type PRow = { code: string; data: unknown; status: PaperStatus; applied_version: number | null; checked_at: string | null; updated_at: string };
const P_SEL = 'code, data, status, applied_version, checked_at, updated_at';
const toPaper = (r: PRow): PaperRow => ({
  code: r.code, data: r.data, status: r.status, appliedVersion: r.applied_version, checkedAt: r.checked_at, updatedAt: r.updated_at,
});

export async function listPapers(engagementId: string): Promise<Map<string, PaperRow>> {
  const { data, error } = await supabase.from('gwp_paper').select(P_SEL).eq('engagement_id', engagementId);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as unknown as PRow[]).map((r) => [r.code, toPaper(r)]));
}

/** 입력을 저장한다(작성중). 반영 뒤 다시 고치면 「작성중」으로 돌아간다 — 엑셀과 달라졌으니까. */
export async function savePaper(engagementId: string, code: string, data: unknown): Promise<PaperRow> {
  const { data: row, error } = await supabase.from('gwp_paper').upsert(
    { engagement_id: engagementId, code, data, status: '작성중' }, { onConflict: 'engagement_id,code' },
  ).select(P_SEL).single();
  if (error) throw new Error(error.message);
  return toPaper(row as unknown as PRow);
}

/**
 * 확인 — 입력을 저장하고 「확인」으로 둔다. 엑셀에는 아직 쓰지 않는다: [N차 확정]이 그 단계 조서를 한꺼번에 써 넣어
 * 판을 하나만 만든다(사용자 2026-09-27 「하나씩 저장할 때마다 판 번호가 올라갈 필요가 있을까요?」).
 */
export async function markChecked(engagementId: string, code: string, data: unknown): Promise<PaperRow> {
  const { data: u } = await supabase.auth.getUser();
  const { data: row, error } = await supabase.from('gwp_paper').upsert({
    engagement_id: engagementId, code, data, status: '확인', checked_by: u.user?.id ?? null, checked_at: new Date().toISOString(),
  }, { onConflict: 'engagement_id,code' }).select(P_SEL).single();
  if (error) throw new Error(error.message);
  return toPaper(row as unknown as PRow);
}

/** 엑셀 판에 반영했다 — 확인 + 반영된 판 번호. */
export async function markApplied(engagementId: string, code: string, data: unknown, version: number): Promise<PaperRow> {
  const { data: u } = await supabase.auth.getUser();
  const { data: row, error } = await supabase.from('gwp_paper').upsert({
    engagement_id: engagementId, code, data, status: '확인', applied_version: version,
    checked_by: u.user?.id ?? null, checked_at: new Date().toISOString(),
  }, { onConflict: 'engagement_id,code' }).select(P_SEL).single();
  if (error) throw new Error(error.message);
  return toPaper(row as unknown as PRow);
}

/**
 * 📎 엑셀로 넘기기 — 이 조서의 정본을 엑셀로 바꾼다(기말 별도조서를 붙이려고). 웹은 읽기 전용.
 * 되돌리면(작성중) 다시 웹이 정본 — 그때는 엑셀의 지금 값을 웹으로 읽어 온다(data).
 */
export async function setPaperStatus(engagementId: string, code: string, status: PaperStatus, data?: unknown): Promise<PaperRow> {
  const row: Record<string, unknown> = { engagement_id: engagementId, code, status };
  if (data !== undefined) row.data = data;
  const { data: r, error } = await supabase.from('gwp_paper').upsert(row, { onConflict: 'engagement_id,code' }).select(P_SEL).single();
  if (error) throw new Error(error.message);
  return toPaper(r as unknown as PRow);
}

// ── 단계 확정 ─────────────────────────────────────────────
type ERow = { stage: StageNo; action: '확정' | '확정 취소'; book_version: number | null; reason: string | null; created_email: string | null; created_at: string };

export async function listStageEvents(engagementId: string): Promise<StageEvent[]> {
  const { data, error } = await supabase.from('gwp_stage_event')
    .select('stage, action, book_version, reason, created_email, created_at')
    .eq('engagement_id', engagementId).order('created_at');
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ERow[]).map((r) => ({
    stage: r.stage, action: r.action, bookVersion: r.book_version, reason: r.reason, createdEmail: r.created_email, createdAt: r.created_at,
  }));
}

export async function addStageEvent(
  engagementId: string, stage: StageNo, action: '확정' | '확정 취소', bookVersion: number | null, reason?: string,
): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from('gwp_stage_event').insert({
    engagement_id: engagementId, stage, action, book_version: bookVersion, reason: reason ?? null,
    created_by: u.user?.id, created_email: u.user?.email ?? null,
  });
  if (error) throw new Error(error.message);
}

// ── 틀 빌리기(2120A — 작년 것이 빈 양식, 사용자 2026-09-30) ─────────────
export interface BorrowCandidate { engagementId: string; entity: string; fy: number; status: PaperStatus }

/**
 * 이 조서를 [확인]까지 해 둔 다른 회사 — 같은 조서 기준(일반·소규모·K-IFRS)만. 가까운 해 먼저.
 * 판은 그 회사의 최신 판을 쓴다(빌릴 때 판 번호를 적어 두어 반영 때 같은 판을 받는다).
 */
export async function borrowCandidates(code: string, engagementId: string): Promise<BorrowCandidate[]> {
  const [{ data: ps, error }, { data: ys, error: e2 }] = await Promise.all([
    supabase.from('gwp_paper').select('engagement_id, status, dsd_engagement(fy, biz_entity(name))').eq('code', code).neq('status', '작성중'),
    supabase.from('gwp_year').select('engagement_id, audit_basis'),
  ]);
  if (error || e2) throw new Error((error ?? e2)!.message);
  const basis = new Map((ys ?? []).map((y: { engagement_id: string; audit_basis: string }) => [y.engagement_id, y.audit_basis]));
  const mine = basis.get(engagementId);
  type Row = { engagement_id: string; status: PaperStatus; dsd_engagement: { fy: number; biz_entity: { name: string } | null } | null };
  return ((ps ?? []) as unknown as Row[])
    .filter((r) => r.engagement_id !== engagementId && (!mine || basis.get(r.engagement_id) === mine))
    .map((r) => ({ engagementId: r.engagement_id, entity: r.dsd_engagement?.biz_entity?.name ?? '(이름 없음)', fy: r.dsd_engagement?.fy ?? 0, status: r.status }))
    .sort((a, b) => b.fy - a.fy || a.entity.localeCompare(b.entity, 'ko'));
}

/** 모든 작업 건의 확정된 단계와 판 수 — 거래처 목록의 진행 색(사용자 2026-10-01). */
export async function listProgress(): Promise<Map<string, { confirmed: StageNo[]; books: number }>> {
  const [{ data: ev, error: e1 }, { data: bk, error: e2 }] = await Promise.all([
    supabase.from('gwp_stage_event').select('engagement_id, stage, action, book_version, reason, created_email, created_at').order('created_at'),
    supabase.from('gwp_book').select('engagement_id, version'),
  ]);
  if (e1 || e2) throw new Error((e1 ?? e2)!.message);
  const byEng = new Map<string, StageEvent[]>();
  for (const r of (ev ?? []) as unknown as (ERow & { engagement_id: string })[]) {
    (byEng.get(r.engagement_id) ?? byEng.set(r.engagement_id, []).get(r.engagement_id)!).push({
      stage: r.stage, action: r.action, bookVersion: r.book_version, reason: r.reason, createdEmail: r.created_email, createdAt: r.created_at,
    });
  }
  const out = new Map<string, { confirmed: StageNo[]; books: number }>();
  for (const b of (bk ?? []) as { engagement_id: string; version: number }[]) {
    const cur = out.get(b.engagement_id) ?? { confirmed: [], books: 0 };
    cur.books = Math.max(cur.books, b.version);
    out.set(b.engagement_id, cur);
  }
  for (const [id, evs] of byEng) {
    const cur = out.get(id) ?? { confirmed: [], books: 0 };
    cur.confirmed = stageStates(evs).filter((s) => s.confirmed).map((s) => s.no);
    out.set(id, cur);
  }
  return out;
}
