// 전역 수수료 설정(config) — DB 활성 설정을 로드해 앱 전체(계산 포함)에서 사용
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AppConfig } from '../types';
import { DEFAULT_CONFIG } from '../lib/constants';
import { loadActiveConfig, persistConfig } from '../lib/configApi';

interface ConfigCtx {
  config: AppConfig;
  loading: boolean;
  error: string | null;
  /** DB에서 다시 로드 */
  reload: () => Promise<void>;
  /** 새 설정을 DB에 저장하고 전역 반영 */
  persist: (config: AppConfig) => Promise<void>;
}

const Ctx = createContext<ConfigCtx | undefined>(undefined);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      setConfig(await loadActiveConfig());
    } catch (e) {
      setError(e instanceof Error ? e.message : '설정을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  const persist = useCallback(async (next: AppConfig) => {
    await persistConfig(next);
    setConfig(next);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return <Ctx.Provider value={{ config, loading, error, reload, persist }}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfig(): ConfigCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider');
  return ctx;
}
