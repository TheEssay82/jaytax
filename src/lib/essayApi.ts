// 습작(에세이) 열람·평점 — 공개 페이지(/essay)와 숨김 관리화면(/essay/admin)의 데이터 계층.
// 마이그레이션 0065. 비로그인 독자는 테이블에 직접 접근하지 못하고 SECURITY DEFINER RPC 만 호출한다.
import { supabase } from './supabase';

const TOKEN_KEY = 'essay.reader.token';
const BG_BUCKET = 'essay-bg';

// ── 독자(비로그인) ───────────────────────────────────────────────────────
export type EssayPieceView = {
  id: string;
  title: string;
  body: string;
  bgKey: string;
  bgPath: string | null;
  fontKey: string;
};
export type EssayNext = { done: boolean; total: number; rated: number; piece?: EssayPieceView };
export type ReaderState = { name: string; total: number; rated: number };

/** 이 기기에 기억된 독자 토큰(이어보기용) */
export function savedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function saveToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* 시크릿 모드 등 — 저장 실패해도 이번 세션은 동작 */
  }
}
export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* noop */
  }
}

/** 이름 등록. 중복이면 Error(message='DUP') */
export async function registerReader(name: string): Promise<{ token: string; name: string }> {
  const { data, error } = await supabase.rpc('essay_register', { p_name: name });
  if (error) {
    if (error.message.includes('ESSAY_DUP')) throw new Error('DUP');
    throw new Error(error.message);
  }
  const row = data as { token: string; name: string };
  saveToken(row.token);
  return row;
}

/** 토큰으로 진행상태 복원. 토큰이 무효면 null */
export async function readerState(token: string): Promise<ReaderState | null> {
  const { data, error } = await supabase.rpc('essay_state', { p_token: token });
  if (error) throw new Error(error.message);
  return (data as ReaderState | null) ?? null;
}

export async function nextPiece(token: string): Promise<EssayNext> {
  const { data, error } = await supabase.rpc('essay_next', { p_token: token });
  if (error) throw new Error(error.message);
  return data as EssayNext;
}

/** 별점 확정 → 곧바로 다음 작품을 돌려준다(없으면 done) */
export async function ratePiece(token: string, pieceId: string, stars: number): Promise<EssayNext> {
  const { data, error } = await supabase.rpc('essay_rate', {
    p_token: token,
    p_piece: pieceId,
    p_stars: stars,
  });
  if (error) throw new Error(error.message);
  return data as EssayNext;
}

// ── 관리(로그인·최고관리자) ──────────────────────────────────────────────
export type EssayPiece = {
  id: string;
  title: string;
  body: string;
  bgKey: string;
  bgPath: string | null;
  fontKey: string;
  status: 'draft' | 'published';
  createdAt: string;
};

type PieceRow = {
  id: string;
  title: string;
  body: string;
  bg_key: string;
  bg_path: string | null;
  font_key: string;
  status: 'draft' | 'published';
  created_at: string;
};

const toPiece = (r: PieceRow): EssayPiece => ({
  id: r.id,
  title: r.title,
  body: r.body,
  bgKey: r.bg_key,
  bgPath: r.bg_path,
  fontKey: r.font_key,
  status: r.status,
  createdAt: r.created_at,
});

export async function listPieces(): Promise<EssayPiece[]> {
  const { data, error } = await supabase
    .from('essay_piece')
    .select('id,title,body,bg_key,bg_path,font_key,status,created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as PieceRow[]).map(toPiece);
}

export type PieceInput = {
  title: string;
  body: string;
  bgKey: string;
  bgPath: string | null;
  fontKey: string;
  status: 'draft' | 'published';
};

export async function createPiece(input: PieceInput): Promise<EssayPiece> {
  const { data, error } = await supabase
    .from('essay_piece')
    .insert({
      title: input.title,
      body: input.body,
      bg_key: input.bgKey,
      bg_path: input.bgPath,
      font_key: input.fontKey,
      status: input.status,
    })
    .select('id,title,body,bg_key,bg_path,font_key,status,created_at')
    .single();
  if (error) throw new Error(error.message);
  return toPiece(data as PieceRow);
}

export async function updatePiece(id: string, input: Partial<PieceInput>): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.body !== undefined) patch.body = input.body;
  if (input.bgKey !== undefined) patch.bg_key = input.bgKey;
  if (input.bgPath !== undefined) patch.bg_path = input.bgPath;
  if (input.fontKey !== undefined) patch.font_key = input.fontKey;
  if (input.status !== undefined) patch.status = input.status;
  const { data, error } = await supabase.from('essay_piece').update(patch).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error('수정되지 않았습니다 — 권한이 없거나 대상이 없습니다.');
}

export async function deletePiece(piece: EssayPiece): Promise<void> {
  const { data, error } = await supabase.from('essay_piece').delete().eq('id', piece.id).select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error('삭제되지 않았습니다 — 권한이 없거나 대상이 없습니다.');
  if (piece.bgPath) await supabase.storage.from(BG_BUCKET).remove([piece.bgPath]);
}

/** 배경 이미지 업로드 → storage 경로 반환 */
export async function uploadBg(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BG_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw new Error(error.message);
  return path;
}

export function bgUrl(path: string): string {
  return supabase.storage.from(BG_BUCKET).getPublicUrl(path).data.publicUrl;
}

export type ScoreRow = {
  pieceId: string;
  title: string;
  status: 'draft' | 'published';
  votes: number;
  avgStars: number;
};

export async function scoreboard(): Promise<ScoreRow[]> {
  const { data, error } = await supabase.rpc('essay_scoreboard');
  if (error) throw new Error(error.message);
  return (data as { piece_id: string; title: string; status: 'draft' | 'published'; votes: number; avg_stars: number }[]).map(
    (r) => ({ pieceId: r.piece_id, title: r.title, status: r.status, votes: r.votes, avgStars: Number(r.avg_stars) }),
  );
}

/** 어떤 독자가 어떤 작품에 몇 점을 줬는지(관리용 상세) */
export type RatingDetail = { reader: string; pieceId: string; stars: number; at: string };
export async function listRatings(): Promise<RatingDetail[]> {
  const { data, error } = await supabase
    .from('essay_rating')
    .select('stars,created_at,piece_id,essay_reader(name)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  type Row = { stars: number; created_at: string; piece_id: string; essay_reader: { name: string } | null };
  return (data as unknown as Row[]).map((r) => ({
    reader: r.essay_reader?.name ?? '(알 수 없음)',
    pieceId: r.piece_id,
    stars: r.stars,
    at: r.created_at,
  }));
}

// ── Word(.docx) → 본문 텍스트 ────────────────────────────────────────────
/** 문단 배열로 변환한다(서식은 버림 — 표시 서체는 프리셋으로 통일). */
export async function docxToParagraphs(file: File): Promise<string[]> {
  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/ /g, ' ').trim())
    .filter((line) => line !== '');
}

/** 문서 첫 줄이 제목처럼 보이는가(짧고 문장부호로 끝나지 않음). 본문에서 빼고 제목칸으로 올리기 위한 판정. */
export function looksLikeTitle(line: string | undefined): boolean {
  if (!line) return false;
  const t = line.trim();
  return t.length > 0 && t.length <= 40 && !/[.!?…]$/.test(t);
}
