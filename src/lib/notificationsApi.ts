// 사용자 알림 데이터 레이어. 생성은 서버 트리거만 하고(0048), 앱은 조회·읽음처리만 한다.
import { supabase } from './supabase';

export interface Notification {
  id: number;
  kind: string;
  title: string;
  body: string;
  tab: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

interface Row {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  tab: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

const toItem = (r: Row): Notification => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  body: r.body || '',
  tab: r.tab,
  entityId: r.entity_id,
  readAt: r.read_at,
  createdAt: r.created_at,
});

/** 최근 알림(읽음 포함). RLS 상 본인 것만 온다. */
export async function listNotifications(limit = 30): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, kind, title, body, tab, entity_id, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data as Row[]).map(toItem);
}

/** 안 읽은 개수 — 벨 배지용. 가볍게 head+count 로. */
export async function countUnread(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** 한 건 읽음 처리 */
export async function markRead(id: number): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null);
  if (error) throw new Error(error.message);
}

/** 모두 읽음 처리 */
export async function markAllRead(): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
  if (error) throw new Error(error.message);
}
