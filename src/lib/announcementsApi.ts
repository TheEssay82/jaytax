// 공지사항(내부홈 전광판) 데이터 레이어.
// 조회는 내부 구성원 전원, 작성·수정·삭제는 최고관리자만(RLS 0040).
import { supabase } from './supabase';

export interface Announcement {
  id: string;
  message: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  message: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const toItem = (r: Row): Announcement => ({
  id: r.id,
  message: r.message,
  isActive: r.is_active,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** 공지 목록. 기본은 게시중인 것만(전광판용), 관리 화면은 includeHidden 으로 전체. */
export async function listAnnouncements(includeHidden = false): Promise<Announcement[]> {
  let q = supabase.from('announcements').select('*');
  if (!includeHidden) q = q.eq('is_active', true);
  const { data, error } = await q
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as Row[]).map(toItem);
}

/** 권한 오류(42501·0행)를 최고관리자 안내로 바꿔 준다. */
function permissionError(): Error {
  return new Error('공지사항은 최고관리자만 등록·수정·삭제할 수 있습니다.');
}

export async function createAnnouncement(message: string): Promise<void> {
  const text = message.trim();
  if (!text) throw new Error('공지 내용을 입력하세요.');
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('announcements')
    .insert({ message: text, created_by: u.user?.id ?? null });
  if (error) throw error.code === '42501' ? permissionError() : new Error(error.message);
}

export async function updateAnnouncement(
  id: string,
  patch: { message?: string; isActive?: boolean; sortOrder?: number },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.message !== undefined) {
    const text = patch.message.trim();
    if (!text) throw new Error('공지 내용을 입력하세요.');
    row.message = text;
  }
  if (patch.isActive !== undefined) row.is_active = patch.isActive;
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
  const { data, error } = await supabase.from('announcements').update(row).eq('id', id).select('id');
  if (error) throw error.code === '42501' ? permissionError() : new Error(error.message);
  if (!data?.length) throw permissionError();
}

export async function deleteAnnouncement(id: string): Promise<void> {
  const { data, error } = await supabase.from('announcements').delete().eq('id', id).select('id');
  if (error) throw error.code === '42501' ? permissionError() : new Error(error.message);
  if (!data?.length) throw permissionError();
}
