// 사용자(프로필) 관리 데이터 레이어 — 최고관리자 전용
import { supabase } from './supabase';
import { normalizeRole, type Role } from './roles';

export interface UserProfile {
  id: string;
  name: string;
  role: Role;
  createdAt: string;
}

/** 전체 프로필 조회 (가입순) */
export async function listProfiles(): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, role, created_at')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as { id: string; name: string; role: string; created_at: string }[]).map((r) => ({
    id: r.id,
    name: r.name || '',
    role: normalizeRole(r.role),
    createdAt: r.created_at,
  }));
}

/** 프로필 수정 (역할·이름) — RLS상 superuser만 타인 수정 가능 */
export async function updateProfile(id: string, patch: { role?: Role; name?: string }): Promise<void> {
  const { error } = await supabase.from('profiles').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}
