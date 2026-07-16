// 증빙 자료실(evidence) 데이터 레이어 — 일반업무관리 대분류의 계약서·증빙 보관소.
//  각종 계약서·사업자등록증·위임장·통장사본 등을 업로드·검색·다운로드한다.
//  파일은 Storage 'evidence' 비공개 버킷, 메타데이터는 evidence_documents 테이블(0038).
//  열람=외부인 제외(인당회계사 허용), 업로드=읽기전용·외부인 제외, 수정·삭제=업로더/관리자.
import { supabase } from './supabase';

const BUCKET = 'evidence';

export interface EvidenceDoc {
  id: string;
  title: string;
  description: string;
  category: string;
  counterparty: string;
  tags: string[];
  storagePath: string;
  fileName: string;
  fileExt: string;
  fileSize: number;
  mime: string;
  uploadedById: string | null;
  uploadedEmail: string;
  /** 업로더 담당자명(profiles.name). 없으면 이메일로 대체. */
  uploadedByName: string;
  createdAt: string;
  updatedAt: string;
}

interface EvidenceRow {
  id: string;
  title: string | null;
  description: string | null;
  category: string | null;
  counterparty: string | null;
  tags: string[] | null;
  storage_path: string;
  file_name: string | null;
  file_ext: string | null;
  file_size: number | null;
  mime: string | null;
  uploaded_by: string | null;
  uploaded_email: string | null;
  created_at: string;
  updated_at: string;
}

function rowToDoc(r: EvidenceRow): EvidenceDoc {
  return {
    id: r.id,
    title: r.title || '',
    description: r.description || '',
    category: r.category || '',
    counterparty: r.counterparty || '',
    tags: r.tags || [],
    storagePath: r.storage_path,
    fileName: r.file_name || '',
    fileExt: r.file_ext || '',
    fileSize: r.file_size || 0,
    mime: r.mime || '',
    uploadedById: r.uploaded_by,
    uploadedEmail: r.uploaded_email || '',
    uploadedByName: r.uploaded_email || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** 전체 증빙 조회 (최신순). 업로더 담당자명(profiles.name) 매핑. */
export async function listEvidence(): Promise<EvidenceDoc[]> {
  const { data, error } = await supabase
    .from('evidence_documents')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const docs = (data as EvidenceRow[]).map(rowToDoc);
  const { data: profs } = await supabase.from('profiles').select('id, name');
  const nameById = new Map((profs ?? []).map((p) => [p.id as string, (p.name as string) || '']));
  for (const d of docs) {
    const nm = d.uploadedById ? nameById.get(d.uploadedById) : '';
    if (nm) d.uploadedByName = nm;
  }
  return docs;
}

export interface EvidenceUploadInput {
  title: string;
  description?: string;
  category?: string;
  counterparty?: string;
  tags?: string[];
  file: File;
}

/** 파일명에서 확장자 추출(소문자, 점 없이). 없으면 ''. */
function extOf(name: string): string {
  const m = name.match(/\.([A-Za-z0-9]+)$/);
  return m ? m[1].toLowerCase() : '';
}

/** 증빙 업로드 — 파일을 Storage에 올리고 메타데이터 행을 생성한다. */
export async function uploadEvidence(input: EvidenceUploadInput): Promise<EvidenceDoc> {
  const { data: u } = await supabase.auth.getUser();
  const ext = extOf(input.file.name);
  // 저장키는 UUID(비ASCII 파일명 대비) — 원본명은 file_name 메타로 보관.
  const path = `${crypto.randomUUID()}${ext ? `.${ext}` : ''}`;

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, input.file, {
    upsert: false,
    contentType: input.file.type || undefined,
  });
  if (upErr) throw new Error(upErr.message);

  const { data, error } = await supabase
    .from('evidence_documents')
    .insert({
      title: input.title,
      description: input.description ?? '',
      category: input.category ?? '',
      counterparty: input.counterparty ?? '',
      tags: input.tags ?? [],
      storage_path: path,
      file_name: input.file.name,
      file_ext: ext,
      file_size: input.file.size,
      mime: input.file.type || '',
      uploaded_by: u.user?.id ?? undefined,
      uploaded_email: u.user?.email ?? null,
    })
    .select('*')
    .single();
  if (error) {
    // 행 생성 실패 시 올린 파일을 정리(고아 방지).
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error(error.message);
  }
  return rowToDoc(data as EvidenceRow);
}

/** 증빙 메타데이터 수정 (파일 교체는 지원 안 함 — 새로 업로드). */
export async function updateEvidence(
  id: string,
  patch: Partial<Pick<EvidenceDoc, 'title' | 'description' | 'category' | 'counterparty' | 'tags'>>
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.counterparty !== undefined) row.counterparty = patch.counterparty;
  if (patch.tags !== undefined) row.tags = patch.tags;
  const { error } = await supabase.from('evidence_documents').update(row).eq('id', id);
  if (error) throw new Error(error.message);
}

/** 증빙 삭제 — Storage 파일 + 메타데이터 행. */
export async function deleteEvidence(doc: Pick<EvidenceDoc, 'id' | 'storagePath'>): Promise<void> {
  const { error } = await supabase.from('evidence_documents').delete().eq('id', doc.id);
  if (error) throw new Error(error.message);
  await supabase.storage.from(BUCKET).remove([doc.storagePath]);
}

/** 서명 URL(비공개 버킷 → 열람/다운로드, 기본 1시간). download에 파일명을 주면 첨부로 내려온다. */
export async function getEvidenceUrl(
  storagePath: string,
  opts: { expiresIn?: number; download?: string } = {}
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, opts.expiresIn ?? 3600, opts.download ? { download: opts.download } : undefined);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** 사람이 읽는 파일 크기(예: 1.2 MB). */
export function fmtFileSize(bytes: number): string {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}
