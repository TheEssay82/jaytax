// 위저드/청구 관련 공용 데이터 로더 — 청구기록 + 청구대상
import { useCallback, useEffect, useState } from 'react';
import type { BillingRecord } from '../types';
import { listBillingRecords } from '../lib/billingApi';
import { listTargets, type Target } from '../lib/targetsApi';

export function useBillingData() {
  const [records, setRecords] = useState<BillingRecord[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [recs, tgts] = await Promise.all([listBillingRecords(), listTargets()]);
      setRecords(recs);
      setTargets(tgts);
    } catch (e) {
      setError(e instanceof Error ? e.message : '청구 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { records, targets, loading, error, refresh };
}
