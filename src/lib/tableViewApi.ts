// 표뷰 개인 화면설정(열 너비·숨김) 저장/불러오기.
//
// 사람마다 보고 싶은 열이 다르다. 회계사는 담당·금액을, 실무자는 홈택스ID·PW를 본다.
// 브라우저에 두면 데스크톱앱·웹·다른 PC에서 따로 놀아서 계정(user_table_view)에 붙였다.
import { supabase } from './supabase';

export interface TableViewSettings {
  widths: Record<string, number>;
  hidden: string[];
}
export const EMPTY_VIEW: TableViewSettings = { widths: {}, hidden: [] };

/** 화면 식별자 — 표 하나당 하나. 값이 바뀌면 저장해 둔 설정과 끊어지니 함부로 고치지 말 것. */
export const VIEW_KEYS = {
  bizRegistry: 'biz_registry',
  salesContract: 'sales_contract',
} as const;

export async function loadTableView(viewKey: string): Promise<TableViewSettings | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from('user_table_view').select('settings')
    .eq('user_id', uid).eq('view_key', viewKey).maybeSingle();
  if (error) throw new Error(error.message);
  const s = (data as { settings?: Partial<TableViewSettings> } | null)?.settings;
  if (!s) return null;
  return { widths: s.widths ?? {}, hidden: s.hidden ?? [] };
}

export async function saveTableView(viewKey: string, settings: TableViewSettings): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('로그인이 필요합니다.');
  const { error } = await supabase.from('user_table_view')
    .upsert({ user_id: uid, view_key: viewKey, settings, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,view_key' });
  if (error) throw new Error(error.message);
}

/** 저장해 둔 설정을 지운다 — 기본 화면으로 되돌릴 때. */
export async function clearTableView(viewKey: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return;
  const { error } = await supabase.from('user_table_view')
    .delete().eq('user_id', uid).eq('view_key', viewKey);
  if (error) throw new Error(error.message);
}
