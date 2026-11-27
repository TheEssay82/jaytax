// 금감원 회계업무자료(Open API 7종) — fss_docs 읽기(인계 4단계, 2026-11-28).
// 수집은 엣지함수 fss-sync(매일 07:30)가 한다. 공개자료라 직원 모두 읽는다(RLS authenticated).
import { supabase } from './supabase';
import { FSS_APIS, fssTerms, type FssApi } from './fss';
export { FSS_APIS, FSS_LABEL, FSS_COLOR, fssTerms, type FssApi } from './fss';

export interface FssDoc {
  api: FssApi; contentId: string; subject: string; regDate: string | null;
  relStand: string | null; issRealm: string | null; rlsNo: string | null; dcsnYr: string | null;
  sprvisnTrgtYr: string | null; deptNm: string | null; originUrl: string | null;
  attachments: { name: string; url: string }[]; bodyText: string;
}

export interface FssFilter { q?: string; apis?: FssApi[]; relStand?: string; issRealm?: string; from?: string; to?: string; limit?: number }

/* eslint-disable @typescript-eslint/no-explicit-any */
const toDoc = (r: any): FssDoc => ({
  api: r.api, contentId: r.content_id, subject: r.subject, regDate: r.reg_date,
  relStand: r.rel_stand, issRealm: r.iss_realm, rlsNo: r.rls_no, dcsnYr: r.dcsn_yr,
  sprvisnTrgtYr: r.sprvisn_trgt_yr, deptNm: r.dept_nm, originUrl: r.origin_url,
  attachments: Array.isArray(r.attachments) ? r.attachments : [], bodyText: r.body_text ?? '',
});

export async function listFssDocs(f: FssFilter = {}): Promise<FssDoc[]> {
  let q = supabase.from('fss_docs')
    .select('api, content_id, subject, reg_date, rel_stand, iss_realm, rls_no, dcsn_yr, sprvisn_trgt_yr, dept_nm, origin_url, attachments, body_text')
    .order('reg_date', { ascending: false, nullsFirst: false })
    .limit(f.limit ?? 200);
  if (f.apis?.length) q = q.in('api', f.apis);
  for (const t of fssTerms(f.q)) q = q.or(`subject.ilike.*${t}*,body_text.ilike.*${t}*,rel_stand.ilike.*${t}*,iss_realm.ilike.*${t}*`);
  if (f.relStand?.trim()) q = q.ilike('rel_stand', `*${fssTerms(f.relStand)[0] ?? ''}*`);
  if (f.issRealm?.trim()) q = q.ilike('iss_realm', `*${fssTerms(f.issRealm)[0] ?? ''}*`);
  if (f.from) q = q.gte('reg_date', `${f.from}T00:00:00+09:00`);
  if (f.to) q = q.lte('reg_date', `${f.to}T23:59:59+09:00`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as any[]).map(toDoc);
}

/** 종류별 건수와 마지막 수집 시각 — 화면 머리의 「쌓이는 중」 안내. */
export async function fssSummary(): Promise<{ counts: Record<FssApi, number>; total: number; lastFetched: string | null }> {
  const counts = Object.fromEntries(FSS_APIS.map((a) => [a, 0])) as Record<FssApi, number>;
  const res = await Promise.all(FSS_APIS.map((a) => supabase.from('fss_docs').select('api', { count: 'exact', head: true }).eq('api', a)));
  FSS_APIS.forEach((a, i) => { counts[a] = res[i].count ?? 0; });
  const { data } = await supabase.from('fss_docs').select('fetched_at').order('fetched_at', { ascending: false }).limit(1);
  return { counts, total: Object.values(counts).reduce((s, n) => s + n, 0), lastFetched: (data as any[] | null)?.[0]?.fetched_at ?? null };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
