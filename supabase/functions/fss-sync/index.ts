// Supabase Edge Function: 금감원 회계업무자료 Open API 수집 → public.fss_docs (인계 3단계, 2026-11-27)
//
// 7종: illust · kifrs · kgaap · icfr · insp · auddata · audfaq. 공개자료.
// 개인용 키 한도(실측): 한 번에 최대 1개월(030) · 하루 30회(033) · 응답 EUC-KR · 자료 없음 900.
//   매일 = 최근 14일 증분(7회) + 남는 호출로 백필(최근 달부터 거꾸로 2011-01 까지). 하루 27회까지만 쓴다(3회는 로컬 스크립트 몫).
//   013(미등록 인증키) · IP 오류가 나면 **바로 멈추고** 접속기록에 한 줄 남긴다 — 우회하지 않는다.
// 호출하는 쪽: pg_cron(0211) — 머리 x-fss-sync 에 DB 토큰. 또는 최고관리자가 직접(로그인 JWT) — ?backfill=YYYY 로 그 해만.
// 신규 · 바뀐 건(body_hash)만 임베딩(OpenAI text-embedding-3-small 1536 — 회계기준 RAG 와 같다).
// Secrets: FSS_API_KEY(금감원 인증키 — Bryan 이 대시보드에서), OPENAI_API_KEY. SUPABASE_URL · SERVICE_ROLE_KEY 는 자동 주입.
// 키는 응답 · 로그 · 오류 문구에 넣지 않는다.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BASE = 'https://www.fss.or.kr/fss/kr/openApi/api/';
const APIS = {
  illust: 'illustDisc', kifrs: 'kifrsQa', kgaap: 'kgaapQa', icfr: 'icfrData',
  insp: 'inspExmpl', auddata: 'audData', audfaq: 'audFaq',
} as const;
type Api = keyof typeof APIS;
const API_LABEL: Record<Api, string> = {
  illust: '주석공시 모범사례', kifrs: 'K-IFRS 질의회신', kgaap: '일반기업회계기준 질의회신', icfr: '내부회계관리제도',
  insp: '심사·감리 지적사례', auddata: '외부감사 업무자료', audfaq: '외부감사 FAQ',
};
const DAILY_BUDGET = 27;          // 하루 30회 중 수집 몫
const INCREMENT_DAYS = 14;
const BACKFILL_FROM = '2011-01';
const EMBED_MODEL = 'text-embedding-3-small';

class StopError extends Error {}   // 033 · 013 · IP — 오늘은 더 부르지 않는다

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-fss-sync',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const toText = (s = '') => unesc(unesc(unesc(s)))
  .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

const pad = (n: number) => String(n).padStart(2, '0');
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
const monthEnd = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`; };
const prevYm = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`; };

async function sha(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** 금감원 한 번 — 응답은 EUC-KR. 반환 null = 자료 없음(900). */
async function pull(api: Api, start: string, end: string, key: string) {
  const u = `${BASE}${APIS[api]}.jsp?apiType=json&startDate=${start}&endDate=${end}&authKey=${encodeURIComponent(key)}`;
  let r: Response;
  try { r = await fetch(u, { headers: { 'User-Agent': 'jaytax-fss-sync/1.0' } }); }
  catch { throw new Error(`${api} ${start}~${end} 접속 실패`); }
  const buf = new Uint8Array(await r.arrayBuffer());
  const ct = r.headers.get('content-type') ?? '';
  const cs = /charset=euc-?kr/i.test(ct) ? 'euc-kr' : 'utf-8';
  let text: string;
  try { text = new TextDecoder(cs).decode(buf); } catch { text = new TextDecoder('utf-8').decode(buf); }
  let j: Record<string, unknown>;
  try { j = JSON.parse(text); }
  catch { throw new StopError(`${api} 응답이 JSON 이 아님(HTTP ${r.status}) — IP 제한 등일 수 있어 멈춤`); }
  // deno-lint-ignore no-explicit-any
  const b: any = (j as any).reponse ?? (j as any).response ?? {};
  const code = String(b.resultCode ?? ''), msg = String(b.resultMsg ?? '');
  if (code === '1') return (b.result ?? []) as Record<string, string>[];
  if (code === '900' || (Number(b.resultCnt ?? 0) === 0 && msg.includes('없'))) return [];
  if (code === '033' || code === '013' || /IP/i.test(msg)) throw new StopError(`${api} ${code} ${msg}`);
  throw new Error(`${api} ${start}~${end} ${code} ${msg}`);
}

function toRow(api: Api, r: Record<string, string>) {
  const names = String(r.atchfileNm ?? '').split('|'), urls = String(r.atchfileUrl ?? '').split('|');
  // 등록일 — 「2025-01-15」·「2025.01.15」·「20250115」·「2025-01-15 10:20:30」 모두(실물 형식 미확인 — 2026-11-27).
  const rd = String(r.regDate ?? '').trim().replace(/\./g, '-');
  const reg = /^\d{8}/.test(rd) ? `${rd.slice(0, 4)}-${rd.slice(4, 6)}-${rd.slice(6, 8)}${rd.slice(8)}` : rd;
  return {
    api, content_id: String(r.contentId), subject: String(r.subject ?? '').trim() || '(제목 없음)',
    reg_date: /^\d{4}-\d{2}-\d{2}/.test(reg) ? (reg.length <= 10 ? `${reg}T00:00:00+09:00` : reg.replace(' ', 'T') + (/[+Z]/.test(reg.slice(10)) ? '' : '+09:00')) : null,
    rel_stand: r.relStand || null, iss_realm: r.issRealm || null, rls_no: r.rlsNo || null,
    dcsn_yr: r.dcsnYr || null, sprvisn_trgt_yr: r.sprvisnTrgtYr || null, dept_nm: r.deptNm || null,
    origin_url: r.originUrl || null, body_text: toText(r.contentsKor ?? r.contentKor ?? ''),
    attachments: urls.map((url, i) => ({ name: names[i] ?? '', url: url.trim() })).filter((a) => a.url),
  };
}
type Row = ReturnType<typeof toRow>;

const embedText = (d: Row) => [
  `[${API_LABEL[d.api]}] ${d.subject}`,
  d.rel_stand ? `관련기준서: ${d.rel_stand}` : '', d.iss_realm ? `쟁점분야: ${d.iss_realm}` : '',
  d.body_text ?? '',
].filter(Boolean).join('\n').slice(0, 8000);

async function embedMany(texts: string[], key: string): Promise<number[][]> {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!r.ok) throw new Error(`임베딩 실패 ${r.status}`);
  // deno-lint-ignore no-explicit-any
  return ((await r.json()).data as any[]).sort((a, b) => a.index - b.index).map((x) => x.embedding);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // 누가 불렀나 — cron(토큰) 또는 최고관리자(로그인).
  const token = req.headers.get('x-fss-sync');
  let mode = 'daily';
  if (token) {
    const { data } = await db.from('fss_sync_secret').select('token').eq('id', 1).single();
    if (!data || data.token !== token) return json({ ok: false, error: '권한 없음' }, 401);
  } else {
    const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u } = await db.auth.getUser(jwt);
    const { data: p } = u?.user ? await db.from('profiles').select('role').eq('id', u.user.id).single() : { data: null };
    if (p?.role !== 'superuser') return json({ ok: false, error: '최고관리자만 직접 실행할 수 있습니다.' }, 403);
    mode = 'manual';
  }
  const q = new URL(req.url).searchParams;
  const onlyYear = q.get('backfill');               // 최고관리자 수동: 그 해만(남은 한도 안에서)
  if (onlyYear && mode === 'manual') mode = 'backfill';

  const key = Deno.env.get('FSS_API_KEY');
  const openai = Deno.env.get('OPENAI_API_KEY');
  const { data: run } = await db.from('fss_sync_run').insert({ mode }).select('id').single();
  const runId = run?.id as number;
  let calls = 0, inserted = 0, updated = 0, embedded = 0;
  const months: string[] = [];
  const fail = async (msg: string) => { await db.rpc('fss_sync_log_failure', { p_msg: msg }); };
  const finish = async (error?: string, detail?: unknown) => {
    await db.from('fss_sync_run').update({ finished_at: new Date().toISOString(), calls, inserted, updated, embedded, months, error: error ?? null, detail: detail ?? null }).eq('id', runId);
  };

  if (!key) { const m = 'FSS_API_KEY 가 없습니다 — Supabase 대시보드 Edge Functions → Secrets 에 넣어 주세요.'; await fail(m); await finish(m); return json({ ok: false, error: m }, 500); }

  const { data: used } = await db.rpc('fss_calls_today');
  let budget = Math.max(0, DAILY_BUDGET - Number(used ?? 0));
  const fetched: Row[] = [];
  const doneMonths: { api: Api; ym: string; n: number }[] = [];
  let stopped = null as string | null;
  const errors: string[] = [];

  const call = async (api: Api, s: string, e: string) => {
    if (budget <= 0) return null;
    budget--; calls++;
    try { return await pull(api, s, e, key); }
    catch (x) {
      if (x instanceof StopError) { stopped = x.message; budget = 0; }
      else errors.push((x as Error).message);
      return null;
    }
  };

  try {
    // ① 증분 — 최근 14일(1개월 안이라 한 번씩). 수동 백필이면 건너뜀.
    if (mode !== 'backfill') {
      const end = kstToday(), start = addDays(end, -INCREMENT_DAYS);
      for (const api of Object.keys(APIS) as Api[]) {
        const rows = await call(api, start, end);
        if (rows) fetched.push(...rows.map((r) => toRow(api, r)));
        if (stopped) break;
      }
    }
    // ② 백필 — 받지 않은 (종류, 달)을 최근 달부터. 이번 달은 증분이 맡는다.
    if (!stopped && budget > 0) {
      const { data: have } = await db.from('fss_sync_month').select('api, ym');
      const got = new Set((have ?? []).map((x) => `${x.api}:${x.ym}`));
      let ym = onlyYear ? `${onlyYear}-12` : prevYm(kstToday().slice(0, 7));
      const stopYm = onlyYear ? `${onlyYear}-01` : BACKFILL_FROM;
      outer: while (ym >= stopYm) {
        for (const api of Object.keys(APIS) as Api[]) {
          if (got.has(`${api}:${ym}`)) continue;
          if (budget <= 0 || stopped) break outer;
          const rows = await call(api, `${ym}-01`, monthEnd(ym));
          if (rows === null) continue;          // 오류 — 다음에 다시
          fetched.push(...rows.map((r) => toRow(api, r)));
          doneMonths.push({ api, ym, n: rows.length });
          months.push(`${api}:${ym}`);
        }
        ym = prevYm(ym);
      }
    }

    // ③ 저장 — 바뀐 것만(body_hash). 같은 건이 증분·백필에 겹치면 하나로.
    const uniq = new Map<string, Row>();
    for (const r of fetched) uniq.set(`${r.api}:${r.content_id}`, r);
    const rows = [...uniq.values()];
    if (rows.length) {
      const hashes = await Promise.all(rows.map((r) => sha(JSON.stringify([r.subject, r.body_text, r.rel_stand, r.iss_realm, r.attachments]))));
      const old = new Map<string, string | null>();
      for (const api of Object.keys(APIS) as Api[]) {
        const ids = rows.filter((r) => r.api === api).map((r) => r.content_id);
        for (let i = 0; i < ids.length; i += 200) {
          const { data } = await db.from('fss_docs').select('content_id, body_hash').eq('api', api).in('content_id', ids.slice(i, i + 200));
          for (const x of data ?? []) old.set(`${api}:${x.content_id}`, x.body_hash);
        }
      }
      const changed = rows.map((r, i) => ({ r, h: hashes[i], k: `${r.api}:${r.content_id}` })).filter((x) => old.get(x.k) !== x.h);
      for (const x of changed) { if (old.has(x.k)) updated++; else inserted++; }
      // 임베딩 — 64건씩. 실패하면 임베딩 없이 저장하고 다음 실행 때 다시(embedding null 인 것).
      const { data: missing } = await db.from('fss_docs').select('api, content_id, subject, rel_stand, iss_realm, body_text').is('embedding', null).limit(200);
      const toEmbed: Row[] = [...changed.map((x) => x.r), ...((missing ?? []) as unknown as Row[]).filter((m) => !uniq.has(`${m.api}:${m.content_id}`))];
      const vec = new Map<string, number[]>();
      if (openai) {
        for (let i = 0; i < toEmbed.length; i += 64) {
          const part = toEmbed.slice(i, i + 64);
          try { const v = await embedMany(part.map(embedText), openai); part.forEach((p, j) => vec.set(`${p.api}:${p.content_id}`, v[j])); }
          catch (e) { errors.push((e as Error).message); break; }
        }
      }
      const now = new Date().toISOString();
      const up = changed.map((x) => {
        const v = vec.get(x.k);
        return { ...x.r, body_hash: x.h, updated_at: now, fetched_at: now, ...(v ? { embedding: JSON.stringify(v), embedded_at: now } : { embedding: null, embedded_at: null }) };
      });
      for (let i = 0; i < up.length; i += 100) {
        const { error } = await db.from('fss_docs').upsert(up.slice(i, i + 100), { onConflict: 'api,content_id' });
        if (error) throw new Error(`저장 실패: ${error.message}`);
      }
      // 이번에 안 바뀌었지만 임베딩이 비어 있던 것
      for (const m of toEmbed.filter((t) => !changed.some((c) => c.k === `${t.api}:${t.content_id}`))) {
        const v = vec.get(`${m.api}:${m.content_id}`);
        if (v) await db.from('fss_docs').update({ embedding: JSON.stringify(v), embedded_at: now }).eq('api', m.api).eq('content_id', m.content_id);
      }
      embedded = vec.size;
    }
    // ④ 다 받은 달 기록 — 저장이 끝난 뒤에(중간에 죽으면 다음에 다시 받는다).
    if (doneMonths.length) await db.from('fss_sync_month').upsert(doneMonths.map((m) => ({ ...m, fetched_at: new Date().toISOString() })), { onConflict: 'api,ym' });

    const err = stopped ?? (errors.length ? errors.join(' / ') : undefined);
    // 033(오늘 한도 다 씀)은 정상 멈춤 — 접속기록엔 013 · IP · 기타 오류만.
    if (err && !(stopped && /\b033\b/.test(stopped) && !errors.length)) await fail(err);
    const { count: total } = await db.from('fss_docs').select('*', { count: 'exact', head: true });
    await finish(err, { budgetLeft: budget, total });
    return json({ ok: !err || /\b033\b/.test(err), mode, calls, inserted, updated, embedded, backfilled: months.length, total, error: err ?? null });
  } catch (e) {
    const m = (e as Error).message;
    await fail(m); await finish(m);
    return json({ ok: false, error: m }, 500);
  }
});
