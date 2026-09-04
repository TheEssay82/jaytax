// 서비스 사용량 조회 — DB 함수(마이그 0136)를 부른다. 판정·한도는 serviceLimits.ts 에 있다.
// 세 함수 모두 최고관리자에게만 값을 돌려준다(is_superuser 게이트).
import { supabase } from './supabase';

export interface UsageRow { key: string; label: string; bytes: number | null; items: number | null }
export interface TableRow { name: string; bytes: number; rowsEst: number }
export interface BucketRow { name: string; bytes: number; items: number }

/* eslint-disable @typescript-eslint/no-explicit-any */
const num = (v: any): number | null => (v == null ? null : Number(v));

export async function listUsage(): Promise<UsageRow[]> {
  const { data, error } = await supabase.rpc('service_usage');
  if (error) throw new Error(error.message);
  return ((data as any[]) ?? []).map((r) => ({
    key: r.key, label: r.label, bytes: num(r.bytes), items: num(r.items),
  }));
}

export async function listUsageTables(limit = 8): Promise<TableRow[]> {
  const { data, error } = await supabase.rpc('service_usage_tables', { p_limit: limit });
  if (error) throw new Error(error.message);
  return ((data as any[]) ?? []).map((r) => ({
    name: r.name, bytes: Number(r.bytes) || 0, rowsEst: Number(r.rows_est) || 0,
  }));
}

export async function listUsageBuckets(): Promise<BucketRow[]> {
  const { data, error } = await supabase.rpc('service_usage_buckets');
  if (error) throw new Error(error.message);
  return ((data as any[]) ?? []).map((r) => ({
    name: r.name, bytes: Number(r.bytes) || 0, items: Number(r.items) || 0,
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */
