// 업데이트요청 목록 상태 관리 훅
import { useCallback, useEffect, useState } from 'react';
import type { UpdateRequest } from '../types';
import { listRequests } from '../lib/requestsApi';

export function useRequests() {
  const [requests, setRequests] = useState<UpdateRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setRequests(await listRequests());
    } catch (e) {
      setError(e instanceof Error ? e.message : '요청을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { requests, loading, error, refresh };
}
