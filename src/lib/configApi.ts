// 설정(app_config) Supabase 데이터 레이어 — 다중 버전 + 전역 활성버전
// 각 행 = 하나의 설정 버전(전체 스냅샷). is_active=true 인 1개 행이 전역 적용 버전.
// DEFAULT(코드 기본값)는 DB에 없는 가상 고정 버전(id='default').
import { supabase, assertWrote } from './supabase';
import type { AppConfig, ConfigVersion } from '../types';
import { DEFAULT_CONFIG } from './constants';

export const DEFAULT_VERSION_ID = 'default';

/** 가상 DEFAULT 버전 (수정 불가, 항상 선택지로 제공) */
export function defaultVersion(): ConfigVersion {
  return {
    id: DEFAULT_VERSION_ID,
    label: 'DEFAULT (코드 기본값)',
    config: structuredClone(DEFAULT_CONFIG),
    isActive: false,
  };
}

interface ConfigRow {
  id: string;
  version_label: string;
  config: AppConfig;
  is_active: boolean;
}

/** 저장된 모든 버전 (생성순) — 누락 키는 DEFAULT_CONFIG로 보정 */
export async function listConfigVersions(): Promise<ConfigVersion[]> {
  const { data, error } = await supabase
    .from('app_config')
    .select('id, version_label, config, is_active')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as ConfigRow[]).map((r) => ({
    id: r.id,
    label: r.version_label,
    config: { ...structuredClone(DEFAULT_CONFIG), ...r.config },
    isActive: r.is_active,
  }));
}

/** 전역 활성 버전 (활성 행 없으면 DEFAULT) */
export async function loadActive(): Promise<{ config: AppConfig; id: string; label: string }> {
  const versions = await listConfigVersions();
  const act = versions.find((v) => v.isActive);
  if (act) return { config: act.config, id: act.id, label: act.label };
  const d = defaultVersion();
  return { config: d.config, id: d.id, label: d.label };
}

/** 모든 활성 플래그 해제 (부분 유니크 인덱스 충돌 방지: 활성화 전 호출) */
async function deactivateAll(): Promise<void> {
  const { error } = await supabase.from('app_config').update({ is_active: false }).eq('is_active', true);
  if (error) throw new Error(error.message);
}

/** 버전 적용(전역 활성화). id='default' 면 모두 해제 → DEFAULT 사용 */
export async function applyVersion(id: string): Promise<void> {
  await deactivateAll();
  if (id !== DEFAULT_VERSION_ID) {
    const { data, error } = await supabase.from('app_config').update({ is_active: true }).eq('id', id).select('id');
    if (error) throw new Error(error.message);
    assertWrote(data, '저장');
    assertWrote(data, '버전 적용');
  }
}

/** 새 버전으로 저장 + 즉시 활성화 */
export async function insertVersion(config: AppConfig, label: string): Promise<string> {
  await deactivateAll();
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('app_config')
    .insert({
      version_id: 'v' + Date.now(),
      version_label: label,
      config: { ...config, cfgVersionLabel: label },
      is_active: true,
      created_by: u.user?.id ?? null,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

/** 기존 버전 덮어쓰기 (DEFAULT 제외) */
export async function updateVersion(id: string, config: AppConfig, label: string): Promise<void> {
  const { data, error } = await supabase
    .from('app_config')
    .update({ version_label: label, config: { ...config, cfgVersionLabel: label } })
    .eq('id', id)
    .select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '저장');
}

/** 버전 삭제 (DEFAULT 제외, 활성 버전이면 삭제 후 DEFAULT로) */
export async function deleteVersion(id: string): Promise<void> {
  const { data, error } = await supabase.from('app_config').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  assertWrote(data, '삭제');
}
