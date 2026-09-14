// 일반조서 — 서버에 두는 것: 표준양식 묶음(연도×기준)과 회사 조서 워크북(작업 건×판).
//
// 파일은 'gwp' 비공개 버킷(감사팀만, 마이그 0148). 회사 조서는 **판이 쌓일 뿐 지우지 않는다**(외감법 제19조).
// 목록(catalog)은 브라우저에서 읽어 함께 저장한다 — 화면에서 파일을 내려받지 않고도 상태를 본다.
import { supabase } from './supabase';
import type { Catalog } from './gwpCatalog';
import type { TemplateCatalog } from './gwpTemplate';
import type { Basis } from './dsdNotes';

const BUCKET = 'gwp';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 사람이 읽는 크기 — 「2.2MB」·「345KB」. */
export function fmtKb(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
}

export interface GwpTemplate {
  id: string;
  fy: number;
  basis: Basis;
  storagePath: string;
  fileName: string;
  fileSize: number;
  catalog: TemplateCatalog;
  note: string | null;
  uploadedEmail: string | null;
  updatedAt: string;
}
type TplRow = {
  id: string; fy: number; basis: Basis; storage_path: string; file_name: string; file_size: number;
  catalog: TemplateCatalog; note: string | null; uploaded_email: string | null; updated_at: string;
};
const TPL_SEL = 'id, fy, basis, storage_path, file_name, file_size, catalog, note, uploaded_email, updated_at';
function toTpl(r: TplRow): GwpTemplate {
  return {
    id: r.id, fy: r.fy, basis: r.basis, storagePath: r.storage_path, fileName: r.file_name, fileSize: r.file_size,
    catalog: r.catalog ?? { files: [], sheets: [], skipped: [] }, note: r.note, uploadedEmail: r.uploaded_email, updatedAt: r.updated_at,
  };
}

export async function listTemplates(): Promise<GwpTemplate[]> {
  const { data, error } = await supabase.from('gwp_template').select(TPL_SEL)
    .order('fy', { ascending: false }).order('basis');
  if (error) throw error;
  return ((data ?? []) as unknown as TplRow[]).map(toTpl);
}

export async function getTemplate(fy: number, basis: Basis): Promise<GwpTemplate | null> {
  const { data, error } = await supabase.from('gwp_template').select(TPL_SEL).eq('fy', fy).eq('basis', basis).maybeSingle();
  if (error) throw error;
  return data ? toTpl(data as unknown as TplRow) : null;
}

/** 묶음을 등록한다 — 같은 연도·기준이 있으면 바꾼다(양식은 조서가 아니라 바꿔도 된다). */
export async function saveTemplate(
  fy: number, basis: Basis, file: { name: string; bytes: Uint8Array }, catalog: TemplateCatalog, note?: string,
): Promise<GwpTemplate> {
  const { data: u } = await supabase.auth.getUser();
  const old = await getTemplate(fy, basis);
  const path = `templates/${fy}-${crypto.randomUUID()}.zip`;
  const blob = new Blob([file.bytes as BlobPart], { type: 'application/zip' });
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: false });
  if (upErr) throw new Error(upErr.message);
  const { data, error } = await supabase.from('gwp_template').upsert({
    fy, basis, storage_path: path, file_name: file.name, file_size: file.bytes.length, catalog,
    note: note ?? old?.note ?? null, uploaded_by: u.user?.id ?? null, uploaded_email: u.user?.email ?? null,
  }, { onConflict: 'fy,basis' }).select(TPL_SEL).single();
  if (error) throw new Error(error.message);
  // 옛 묶음 파일은 남겨 둔다(지우기 정책 없음). 행이 새 경로를 가리키므로 쓰이지 않을 뿐이다.
  return toTpl(data as unknown as TplRow);
}

export async function deleteTemplate(t: GwpTemplate): Promise<void> {
  const { error } = await supabase.from('gwp_template').delete().eq('id', t.id);
  if (error) throw new Error(error.message);
}

export async function fileBytes(storagePath: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error || !data) throw new Error(error?.message ?? '파일을 내려받지 못했습니다.');
  return new Uint8Array(await data.arrayBuffer());
}

export async function fileUrl(storagePath: string, downloadName: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 120, { download: downloadName });
  if (error || !data) throw new Error(error?.message ?? '내려받을 주소를 만들지 못했습니다.');
  return data.signedUrl;
}

// ── 회사 조서 워크북 ─────────────────────────────────────────────
export type BookKind = '이월본' | '작업중' | '최종본';

export interface GwpBook {
  id: string;
  engagementId: string;
  version: number;
  kind: BookKind;
  storagePath: string;
  fileName: string;
  fileSize: number;
  catalog: Catalog;
  memo: string | null;
  uploadedEmail: string | null;
  createdAt: string;
}
type BookRow = {
  id: string; engagement_id: string; version: number; kind: BookKind; storage_path: string; file_name: string;
  file_size: number; catalog: Catalog; memo: string | null; uploaded_email: string | null; created_at: string;
};
const BOOK_SEL = 'id, engagement_id, version, kind, storage_path, file_name, file_size, catalog, memo, uploaded_email, created_at';
const EMPTY_CAT: Catalog = { company: '', closing: '', period: '', reportDate: '', sheets: [], index: [] };
function toBook(r: BookRow): GwpBook {
  return {
    id: r.id, engagementId: r.engagement_id, version: r.version, kind: r.kind, storagePath: r.storage_path,
    fileName: r.file_name, fileSize: r.file_size, catalog: r.catalog ?? EMPTY_CAT, memo: r.memo,
    uploadedEmail: r.uploaded_email, createdAt: r.created_at,
  };
}

/** 판 목록 — 최신이 앞. */
export async function listBooks(engagementId: string): Promise<GwpBook[]> {
  const { data, error } = await supabase.from('gwp_book').select(BOOK_SEL)
    .eq('engagement_id', engagementId).order('version', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as BookRow[]).map(toBook);
}

/** 이어받을 판 — 최종본이 있으면 그것, 없으면 최신 판. */
export function pickBase(books: GwpBook[]): GwpBook | null {
  return books.find((b) => b.kind === '최종본') ?? books[0] ?? null;
}

/** 새 판을 올린다. 판 번호는 그 건의 마지막 + 1. */
export async function addBook(
  engagementId: string, kind: BookKind, file: { name: string; bytes: Uint8Array }, catalog: Catalog, memo?: string,
): Promise<GwpBook> {
  const { data: u } = await supabase.auth.getUser();
  const had = await listBooks(engagementId);
  const version = (had[0]?.version ?? 0) + 1;
  const path = `books/${engagementId}/v${version}-${crypto.randomUUID()}.xlsx`;
  const blob = new Blob([file.bytes as BlobPart], { type: XLSX });
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: false });
  if (upErr) throw new Error(upErr.message);
  const { data, error } = await supabase.from('gwp_book').insert({
    engagement_id: engagementId, version, kind, storage_path: path, file_name: file.name,
    file_size: file.bytes.length, catalog, memo: memo ?? null,
    uploaded_by: u.user?.id ?? null, uploaded_email: u.user?.email ?? null,
  }).select(BOOK_SEL).single();
  if (error) throw new Error(error.message);
  return toBook(data as unknown as BookRow);
}

/** 고칠 수 있는 것은 판의 종류(최종본 표시)와 메모뿐 — 나머지는 서버 트리거가 막는다. */
export async function setBookKind(id: string, kind: BookKind, memo?: string | null): Promise<void> {
  const row: Record<string, unknown> = { kind };
  if (memo !== undefined) row.memo = memo;
  const { error } = await supabase.from('gwp_book').update(row).eq('id', id);
  if (error) throw new Error(error.message);
}
