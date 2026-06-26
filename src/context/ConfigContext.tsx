// 전역 수수료 설정 — 다중 버전 + 활성버전 관리. 앱 전체(계산 포함)에서 활성 config 사용.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AppConfig, ConfigVersion } from '../types';
import { DEFAULT_CONFIG } from '../lib/constants';
import {
  DEFAULT_VERSION_ID,
  defaultVersion,
  listConfigVersions,
  loadActive,
  applyVersion,
  insertVersion,
  updateVersion,
  deleteVersion,
} from '../lib/configApi';

interface ConfigCtx {
  /** 현재 전역 활성 설정 (계산에 사용) */
  config: AppConfig;
  activeId: string;
  activeLabel: string;
  /** DEFAULT + 저장된 버전 전체 */
  versions: ConfigVersion[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** 버전을 전역 활성으로 적용 */
  apply: (id: string) => Promise<void>;
  /** 새 버전으로 저장 + 활성화 */
  saveNew: (config: AppConfig, label: string) => Promise<void>;
  /** 기존 버전 덮어쓰기 */
  overwrite: (id: string, config: AppConfig, label: string) => Promise<void>;
  /** 버전 삭제 */
  remove: (id: string) => Promise<void>;
}

const Ctx = createContext<ConfigCtx | undefined>(undefined);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [activeId, setActiveId] = useState<string>(DEFAULT_VERSION_ID);
  const [activeLabel, setActiveLabel] = useState<string>('DEFAULT (코드 기본값)');
  const [versions, setVersions] = useState<ConfigVersion[]>([defaultVersion()]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const [active, vers] = await Promise.all([loadActive(), listConfigVersions()]);
      setConfig(active.config);
      setActiveId(active.id);
      setActiveLabel(active.label);
      setVersions([defaultVersion(), ...vers]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '설정을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  const apply = useCallback(async (id: string) => {
    await applyVersion(id);
    await reload();
  }, [reload]);

  const saveNew = useCallback(async (cfg: AppConfig, label: string) => {
    await insertVersion(cfg, label);
    await reload();
  }, [reload]);

  const overwrite = useCallback(async (id: string, cfg: AppConfig, label: string) => {
    await updateVersion(id, cfg, label);
    await reload();
  }, [reload]);

  const remove = useCallback(async (id: string) => {
    await deleteVersion(id);
    await reload();
  }, [reload]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <Ctx.Provider
      value={{ config, activeId, activeLabel, versions, loading, error, reload, apply, saveNew, overwrite, remove }}
    >
      {children}
    </Ctx.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfig(): ConfigCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider');
  return ctx;
}
