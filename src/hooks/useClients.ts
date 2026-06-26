// 거래처 목록 상태 관리 훅 — 로드/새로고침
import { useCallback, useEffect, useState } from 'react';
import type { Client } from '../types';
import { listClients } from '../lib/clientsApi';

export function useClients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await listClients();
      setClients(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '거래처를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { clients, loading, error, refresh };
}
