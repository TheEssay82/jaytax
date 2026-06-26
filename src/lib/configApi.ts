// 설정(app_config) Supabase 데이터 레이어 — 활성 설정 1행을 로드/저장
import { supabase } from './supabase';
import type { AppConfig } from '../types';
import { DEFAULT_CONFIG } from './constants';

interface ConfigRow {
  id: string;
  version_id: string;
  version_label: string;
  config: AppConfig;
  is_active: boolean;
}

/** 활성 설정 로드 (없으면 기본값). 누락 키는 DEFAULT_CONFIG로 보정 */
export async function loadActiveConfig(): Promise<AppConfig> {
  const { data, error } = await supabase
    .from('app_config')
    .select('*')
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return structuredClone(DEFAULT_CONFIG);
  const row = data as ConfigRow;
  return { ...structuredClone(DEFAULT_CONFIG), ...row.config };
}

/** 활성 설정 저장 (config.cfgVersionId/Label 을 컬럼에도 반영) */
export async function persistConfig(config: AppConfig): Promise<void> {
  const { error } = await supabase
    .from('app_config')
    .update({
      config,
      version_id: config.cfgVersionId || 'v0',
      version_label: config.cfgVersionLabel || '기본',
    })
    .eq('is_active', true);
  if (error) throw new Error(error.message);
}
