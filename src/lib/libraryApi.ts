// 자료실(library) 데이터 레이어 — 사무소 내부 문서 보관소.
//  - reference: 내부 참고자료(예규·해석사례·개정세법·체크리스트 등, 검색·열람)
//  - template : 서식·템플릿(회신 서식·검토보고서·위임장 등, 재사용·다운로드)
//  파일은 Storage 'library' 비공개 버킷, 메타데이터는 library_documents 테이블(0024).
import { supabase } from './supabase';

const BUCKET = 'library';

export type LibraryKind = 'reference' | 'template';

export const LIBRARY_KIND_LABEL: Record<LibraryKind, string> = {
  reference: '참고자료',
  template: '서식·템플릿',
};

export interface LibraryDoc {
  id: string;
  kind: LibraryKind;
  title: string;
  description: string;
  category: string;
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

interface LibraryRow {
  id: string;
  kind: string | null;
  title: string | null;
  description: string | null;
  category: string | null;
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

function rowToDoc(r: LibraryRow): LibraryDoc {
  return {
    id: r.id,
    kind: (r.kind as LibraryKind) || 'reference',
    title: r.title || '',
    description: r.description || '',
    category: r.category || '',
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

/** 전체 자료 조회 (최신순). 업로더 담당자명(profiles.name) 매핑. */
export async function listDocuments(): Promise<LibraryDoc[]> {
  const { data, error } = await supabase
    .from('library_documents')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const docs = (data as LibraryRow[]).map(rowToDoc);
  const { data: profs } = await supabase.from('profiles').select('id, name');
  const nameById = new Map((profs ?? []).map((p) => [p.id as string, (p.name as string) || '']));
  for (const d of docs) {
    const nm = d.uploadedById ? nameById.get(d.uploadedById) : '';
    if (nm) d.uploadedByName = nm;
  }
  return docs;
}

export interface LibraryUploadInput {
  kind: LibraryKind;
  title: string;
  description?: string;
  category?: string;
  tags?: string[];
  file: File;
}

/** 파일명에서 확장자 추출(소문자, 점 없이). 없으면 ''. */
function extOf(name: string): string {
  const m = name.match(/\.([A-Za-z0-9]+)$/);
  return m ? m[1].toLowerCase() : '';
}

/** 자료 업로드 — 파일을 Storage에 올리고 메타데이터 행을 생성한다. */
export async function uploadDocument(input: LibraryUploadInput): Promise<LibraryDoc> {
  const { data: u } = await supabase.auth.getUser();
  const ext = extOf(input.file.name);
  // 경로는 kind/uuid[.ext] — 파일명은 비ASCII를 담을 수 있어 저장키엔 UUID를 쓰고 원본명은 메타로 보관.
  const path = `${input.kind}/${crypto.randomUUID()}${ext ? `.${ext}` : ''}`;

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, input.file, {
    upsert: false,
    contentType: input.file.type || undefined,
  });
  if (upErr) throw new Error(upErr.message);

  const { data, error } = await supabase
    .from('library_documents')
    .insert({
      kind: input.kind,
      title: input.title,
      description: input.description ?? '',
      category: input.category ?? '',
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
  return rowToDoc(data as LibraryRow);
}

/** 자료 메타데이터 수정 (파일 교체는 지원 안 함 — 새로 업로드). */
export async function updateDocument(
  id: string,
  patch: Partial<Pick<LibraryDoc, 'kind' | 'title' | 'description' | 'category' | 'tags'>>
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.kind !== undefined) row.kind = patch.kind;
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.tags !== undefined) row.tags = patch.tags;
  const { error } = await supabase.from('library_documents').update(row).eq('id', id);
  if (error) throw new Error(error.message);
}

/** 자료 삭제 — Storage 파일 + 메타데이터 행. */
export async function deleteDocument(doc: Pick<LibraryDoc, 'id' | 'storagePath'>): Promise<void> {
  const { error } = await supabase.from('library_documents').delete().eq('id', doc.id);
  if (error) throw new Error(error.message);
  await supabase.storage.from(BUCKET).remove([doc.storagePath]);
}

/** 서명 URL(비공개 버킷 → 열람/다운로드, 기본 1시간). download에 파일명을 주면 첨부(다운로드)로 내려온다. */
export async function getDocumentUrl(
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
