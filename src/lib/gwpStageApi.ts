// 일반조서 — 자료함(전기 DSD·정산표) · 웹 조서 입력 · 단계 확정 기록(마이그 0153).
//
// 자료함: 사용자 2026-09-27 「DSD·정산표를 왜 저장하면 안 돼? 저장하는 게 더 편리해」 — 작업 건마다 두고
// 2120A(전기 DSD)·8110ARP(확정 정산표)가 다시 고르지 않고 쓴다. 같은 종류를 다시 올리면 줄이 늘고 최신 것을 쓴다.
import { supabase } from './supabase';
import type { StageEvent, StageNo } from './gwpStage';

const BUCKET = 'gwp';

// ── 자료함 ───────────────────────────────────────────────
export type FileKind = '전기DSD' | '당기DSD' | '정산표';
export const FILE_KINDS: { kind: FileKind; label: string; accept: string; use: string }[] = [
  { kind: '전기DSD', label: '전기 DSD', accept: '.dsd', use: '1차 — 2120A 당기 숫자, 2301 계정 목록, 2700A-2 기준 금액' },
  { kind: '정산표', label: '확정 정산표', accept: '.xlsx,.xlsm', use: '3차 — 8110ARP 당기 숫자' },
  { kind: '당기DSD', label: '당기 DSD', accept: '.dsd', use: '감사보고서 DSD(참고)' },
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

/** 종류별 최신 한 개. */
export function latestFile(files: EngFile[], kind: FileKind): EngFile | null {
  return files.find((f) => f.kind === kind) ?? null;
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

/** 엑셀 판에 반영했다 — 확인. */
export async function markApplied(engagementId: string, code: string, data: unknown, version: number): Promise<PaperRow> {
  const { data: u } = await supabase.auth.getUser();
  const { data: row, error } = await supabase.from('gwp_paper').upsert({
    engagement_id: engagementId, code, data, status: '확인', applied_version: version,
    checked_by: u.user?.id ?? null, checked_at: new Date().toISOString(),
  }, { onConflict: 'engagement_id,code' }).select(P_SEL).single();
  if (error) throw new Error(error.message);
  return toPaper(row as unknown as PRow);
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
