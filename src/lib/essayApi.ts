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
export type EssayNext = { done: boolean; total: number; read: number; piece?: EssayPieceView };
export type ReaderState = { name: string; total: number; read: number; submitted: boolean; locked: boolean; comment: string };
/** 순위 화면에 필요한 것 — 전체 공개작(다시 읽기용 본문 포함)과 내가 이미 낸 순서 */
export type RankingSheet = {
  name: string;
  comment: string;
  submitted: boolean;
  /** 확정 후 일정 시간이 지나 잠긴 상태 — 수정·재열람 불가 */
  locked: boolean;
  pieces: EssayPieceView[];
  myOrder: string[];
};

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

/** 이름이 겹칠 때 쓸 수 있는 대안 이름(동명이인 대비). 실패해도 화면을 막지 않는다. */
export async function nameSuggestions(name: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('essay_name_suggestions', { p_name: name });
  if (error) return [];
  return (data as string[] | null) ?? [];
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

/** 한 편 다 읽음 → 곧바로 다음 편을 돌려준다(없으면 done) */
export async function markRead(token: string, pieceId: string): Promise<EssayNext> {
  const { data, error } = await supabase.rpc('essay_mark_read', { p_token: token, p_piece: pieceId });
  if (error) throw new Error(error.message);
  return data as EssayNext;
}

export async function rankingSheet(token: string): Promise<RankingSheet> {
  const { data, error } = await supabase.rpc('essay_ranking_sheet', { p_token: token });
  if (error) throw new Error(error.message);
  return data as RankingSheet;
}

/** 순위 확정. order 는 1위부터 나열한 작품 id. 다시 내면 이전 것을 대체한다. */
export async function submitRanking(token: string, order: string[], comment: string): Promise<void> {
  const { error } = await supabase.rpc('essay_submit_ranking', {
    p_token: token,
    p_order: order,
    p_comment: comment,
  });
  if (error) {
    if (error.message.includes('ESSAY_LOCKED')) {
      throw new Error('평가가 마감되어 순위를 바꿀 수 없습니다.');
    }
    if (error.message.includes('ESSAY_BADORDER')) {
      throw new Error('작품 목록이 바뀌었습니다. 새로고침한 뒤 다시 정해 주세요.');
    }
    throw new Error(error.message);
  }
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

/** 관리용 원자료 — 이걸로 평균순위·1위표·평가자별 분석을 화면에서 계산한다. */
export type RankRow = { reader: string; pieceId: string; rank: number };
export type ReaderRow = { name: string; comment: string | null; submittedAt: string | null; readCount: number };

export async function listRankings(): Promise<RankRow[]> {
  const { data, error } = await supabase
    .from('essay_ranking')
    .select('rank,piece_id,essay_reader(name)')
    .order('rank');
  if (error) throw new Error(error.message);
  type Row = { rank: number; piece_id: string; essay_reader: { name: string } | null };
  return (data as unknown as Row[]).map((r) => ({
    reader: r.essay_reader?.name ?? '(알 수 없음)',
    pieceId: r.piece_id,
    rank: r.rank,
  }));
}

export async function listReaders(): Promise<ReaderRow[]> {
  const { data, error } = await supabase
    .from('essay_reader')
    .select('name,comment,submitted_at,essay_read(count)')
    .order('created_at');
  if (error) throw new Error(error.message);
  type Row = { name: string; comment: string | null; submitted_at: string | null; essay_read: { count: number }[] };
  return (data as unknown as Row[]).map((r) => ({
    name: r.name,
    comment: r.comment,
    submittedAt: r.submitted_at,
    readCount: r.essay_read?.[0]?.count ?? 0,
  }));
}

/** 평가 기록 전체 삭제(독자·읽음·순위). 작품은 그대로 둔다 — 시험 데이터 정리용. */
export async function resetEvaluations(): Promise<number> {
  const { data, error } = await supabase.from('essay_reader').delete().not('id', 'is', null).select('id');
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
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
