// 거래처 목록 상태 관리 훅 — 로드/새로고침
import { useCallback, useEffect, useState } from 'react';
import type { Client } from '../types';
import { listClients, listClientsMasked } from '../lib/clientsApi';
import { useAuth } from '../context/AuthContext';

export function useClients() {
  const { role } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      // 외부인은 식별정보를 서버에서 마스킹한 데모 목록만 받는다.
      const data = role === 'external' ? await listClientsMasked() : await listClients();
      setClients(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '거래처를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { clients, loading, error, refresh };
}
