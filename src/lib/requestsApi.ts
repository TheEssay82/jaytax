// 업데이트요청(update_requests) Supabase 데이터 레이어 — 게시판 + 댓글
import { supabase } from './supabase';
import type { RequestComment, RequestStatus, UpdateRequest } from '../types';

interface RequestRow {
  id: string;
  requester: string;
  content: string;
  status: string;
  comments: RequestComment[] | null;
  created_at: string;
  updated_at: string;
}

function rowToRequest(r: RequestRow): UpdateRequest {
  return {
    id: r.id,
    requester: r.requester || '',
    content: r.content || '',
    status: (r.status as RequestStatus) || '미접수',
    comments: r.comments || [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** 전체 요청 조회 (최신순) */
export async function listRequests(): Promise<UpdateRequest[]> {
  const { data, error } = await supabase
    .from('update_requests')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as RequestRow[]).map(rowToRequest);
}

/** 새 요청 등록 */
export async function createRequest(requester: string, content: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from('update_requests').insert({
    requester,
    content,
    status: '미접수',
    comments: [],
    created_by: u.user?.id ?? null,
  });
  if (error) throw new Error(error.message);
}

/** 상태 변경 */
export async function updateRequestStatus(id: string, status: RequestStatus): Promise<void> {
  const { error } = await supabase.from('update_requests').update({ status }).eq('id', id);
  if (error) throw new Error(error.message);
}

/** 요청 삭제 */
export async function deleteRequest(id: string): Promise<void> {
  const { error } = await supabase.from('update_requests').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** 댓글 추가 (현재 comments 읽어 append 후 갱신) */
export async function addComment(id: string, author: string, text: string): Promise<void> {
  const { data, error: e1 } = await supabase
    .from('update_requests')
    .select('comments')
    .eq('id', id)
    .single();
  if (e1) throw new Error(e1.message);
  const comments: RequestComment[] = (data?.comments as RequestComment[]) || [];
  comments.push({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    author,
    text,
    createdAt: new Date().toISOString(),
  });
  const { error: e2 } = await supabase.from('update_requests').update({ comments }).eq('id', id);
  if (e2) throw new Error(e2.message);
}
