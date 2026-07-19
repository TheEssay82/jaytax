// 사용자(프로필) 관리 데이터 레이어 — 최고관리자 전용
import { supabase, assertWrote } from './supabase';
import { normalizeRole, type Role } from './roles';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

/** 전체 프로필 조회 (가입순) */
export async function listProfiles(): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email, role, created_at')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as { id: string; name: string; email: string | null; role: string; created_at: string }[]).map(
    (r) => ({
      id: r.id,
      name: r.name || '',
      email: r.email || '',
      role: normalizeRole(r.role),
      createdAt: r.created_at,
    }),
  );
}

/** 프로필 수정 (역할·이름) — RLS상 superuser만 타인 수정 가능 */
export async function updateProfile(id: string, patch: { role?: Role; name?: string }): Promise<void> {
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '저장');
}

/** 직원 계정 생성 — Edge Function(create-employee) 호출. 최고관리자만 성공. */
export async function createEmployee(input: {
  email: string;
  password: string;
  name: string;
  role: Role;
}): Promise<void> {
  const { data, error } = await supabase.functions.invoke('create-employee', { body: input });
  if (error) throw new Error(error.message);
  if (data && data.ok === false) throw new Error(data.error || '직원 생성에 실패했습니다.');
}
