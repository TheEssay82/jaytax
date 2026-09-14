// 회사별 **표준주석엑셀** — 다 채우고 검증까지 마친 주석 엑셀을 작업 건에 등록해 둔다.
//
// 왜 두는가: 사람이 엑셀에 건 수식(재무제표·TB 링크)은 DSD 로 넘어가지 않아 해마다 다시 걸었다.
// 등록해 두면 다음 해 ② 가 그 수식을 이어받는다(noteInherit). 다른 회사 것을 틀로 볼 때도
// 내려받아 쓴다.
//
// ⚠️ 이 시스템에서 **파일을 서버에 두는 유일한 자리**다. 주석은 공시되는 정보라 두어도 된다는
//    사용자 결정(2026-09-14)이다. 재무제표·DSD 파일은 여전히 올리지 않는다.
//
// 파일은 Storage 'dsd-notes' 비공개 버킷, 메타는 dsd_note_book(작업 건마다 한 줄). 외부인은 못 본다.
import { supabase } from './supabase';
import { isNoteSheet, type SheetLayout } from './notePick';
import { sheetNames } from './xlsxRead';

const BUCKET = 'dsd-notes';

export interface NoteBook {
  id: string;
  engagementId: string;
  storagePath: string;
  fileName: string;
  fileSize: number;
  /** 등록할 때의 시트 구성 — 읽을 때 어느 시트가 주석인지 안다. */ sheetLayout: SheetLayout;
  sheetCount: number;
  noteSheets: number;
  memo: string | null;
  uploadedEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

type Row = {
  id: string; engagement_id: string; storage_path: string; file_name: string; file_size: number;
  sheet_layout: string; sheet_count: number; note_sheets: number; memo: string | null;
  uploaded_email: string | null; created_at: string; updated_at: string;
};

const SEL = 'id, engagement_id, storage_path, file_name, file_size, sheet_layout, sheet_count, note_sheets,'
  + ' memo, uploaded_email, created_at, updated_at';

function toBook(r: Row): NoteBook {
  return {
    id: r.id, engagementId: r.engagement_id, storagePath: r.storage_path,
    fileName: r.file_name, fileSize: r.file_size,
    sheetLayout: r.sheet_layout === 'long' ? 'long' : 'sheets',
    sheetCount: r.sheet_count, noteSheets: r.note_sheets, memo: r.memo,
    uploadedEmail: r.uploaded_email, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export async function getNoteBook(engagementId: string): Promise<NoteBook | null> {
  const { data, error } = await supabase
    .from('dsd_note_book').select(SEL).eq('engagement_id', engagementId).maybeSingle();
  if (error) throw error;
  return data ? toBook(data as unknown as Row) : null;
}

/**
 * 등록한다 — 이미 있으면 **바꾼다.** 작업 건마다 한 벌만 둔다(최종본이 뜻이 있다).
 *
 * 주석 시트가 한 장도 없는 파일은 받지 않는다 — ② 에서 만든 파일이 아니면 이어받을 수식도 없다.
 */
export async function registerNoteBook(
  eng: { id: string; sheetLayout: SheetLayout }, file: { name: string; bytes: Uint8Array },
): Promise<NoteBook> {
  const names = sheetNames(file.bytes);
  const noteSheets = names.filter((n) => isNoteSheet(n, eng.sheetLayout)).length;
  if (!noteSheets) {
    throw new Error('이 파일에는 주석 시트가 없습니다 — ② 에서 만든 엑셀에 채워 넣은 것을 등록하십시오.'
      + ` (시트 구성: ${eng.sheetLayout === 'long' ? '한 시트 종단형' : '주석별 시트'})`);
  }
  const { data: u } = await supabase.auth.getUser();
  const old = await getNoteBook(eng.id);
  // 저장키는 UUID — 파일 이름은 한글이라 키로 못 쓴다. 원본 이름은 메타에 남긴다.
  const path = `${eng.id}/${crypto.randomUUID()}.xlsx`;
  const blob = new Blob([file.bytes as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: false });
  if (upErr) throw new Error(upErr.message);

  const { data, error } = await supabase
    .from('dsd_note_book')
    .upsert({
      engagement_id: eng.id, storage_path: path, file_name: file.name, file_size: file.bytes.length,
      sheet_layout: eng.sheetLayout, sheet_count: names.length, note_sheets: noteSheets,
      uploaded_by: u.user?.id ?? null, uploaded_email: u.user?.email ?? null,
    }, { onConflict: 'engagement_id' })
    .select(SEL)
    .single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);   // 고아 파일을 남기지 않는다
    throw new Error(error.message);
  }
  if (old && old.storagePath !== path) await supabase.storage.from(BUCKET).remove([old.storagePath]);
  return toBook(data as unknown as Row);
}

export async function deleteNoteBook(book: Pick<NoteBook, 'id' | 'storagePath'>): Promise<void> {
  const { error } = await supabase.from('dsd_note_book').delete().eq('id', book.id);
  if (error) throw new Error(error.message);
  await supabase.storage.from(BUCKET).remove([book.storagePath]);
}

/** 작업 건을 지울 때 — 행은 cascade 로 지워지지만 파일은 남으므로 먼저 치운다. */
export async function removeNoteBookOf(engagementId: string): Promise<void> {
  const book = await getNoteBook(engagementId).catch(() => null);
  if (book) await deleteNoteBook(book);
}

/** 파일 내용 — ② 가 수식을 이어받을 때 브라우저로 내려 읽는다. */
export async function noteBookBytes(book: Pick<NoteBook, 'storagePath'>): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(BUCKET).download(book.storagePath);
  if (error || !data) throw new Error(error?.message ?? '파일을 내려받지 못했습니다.');
  return new Uint8Array(await data.arrayBuffer());
}

/** 사람이 내려받는 주소 — 2분짜리 서명 URL. */
export async function noteBookUrl(book: Pick<NoteBook, 'storagePath' | 'fileName'>): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET).createSignedUrl(book.storagePath, 120, { download: book.fileName });
  if (error || !data) throw new Error(error?.message ?? '내려받을 주소를 만들지 못했습니다.');
  return data.signedUrl;
}
