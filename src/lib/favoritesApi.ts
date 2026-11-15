// 홈 ⭐ 즐겨찾기 — 사람마다 자주 여는 화면(메뉴 id) 몇 개.
//
// 표뷰 개인 설정과 같은 표(user_table_view, 본인 행만 읽고 쓰는 RLS)에 view_key 하나로 둔다.
// 브라우저에 두면 데스크톱앱·웹·다른 PC에서 따로 놀기 때문이다. 표를 새로 만들 일이 없다.
import { supabase } from './supabase';

const VIEW_KEY = 'home_favorites';

export async function loadFavorites(): Promise<string[]> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from('user_table_view').select('settings')
    .eq('user_id', uid).eq('view_key', VIEW_KEY).maybeSingle();
  if (error) throw new Error(error.message);
  const ids = (data as { settings?: { favorites?: unknown } } | null)?.settings?.favorites;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
}

export async function saveFavorites(ids: string[]): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('로그인이 필요합니다.');
  const { error } = await supabase.from('user_table_view')
    .upsert({ user_id: uid, view_key: VIEW_KEY, settings: { favorites: ids }, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,view_key' });
  if (error) throw new Error(error.message);
}
