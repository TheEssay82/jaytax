// Supabase Edge Function: 세법(법령) 검색·조문 열람 API (직원 전용)
// 법제처 국가법령정보 공동활용 Open API(DRF)를 서버에서 호출한다. OC 키는 브라우저에 노출 금지(서버 시크릿).
// 법제처 DRF는 CORS 헤더를 주지 않으므로 브라우저 직접호출 불가 → 이 함수가 프록시한다.
//
// 배포: Supabase 대시보드 → Edge Functions → law-search 생성 후 이 코드 붙여넣고 Deploy.
//   필요한 Secret: LAW_API_OC  (법제처 OC 값. 대시보드 Secrets 또는 `supabase secrets set LAW_API_OC=...`)
//   SUPABASE_URL/ANON_KEY 는 런타임 자동 주입.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DRF = 'https://www.law.go.kr/DRF';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

// DRF 응답은 단건이면 객체, 다건이면 배열 → 항상 배열로
function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// DRF 텍스트 필드는 문자열이거나 {content:'...'} 객체일 수 있다 → 문자열로 정규화
function asText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return String(o['content'] ?? o['소관부처명'] ?? o['_'] ?? '');
  }
  return String(v);
}

async function drf(endpoint: string, params: Record<string, string>, oc: string, target = 'law'): Promise<Record<string, unknown>> {
  const url = new URL(`${DRF}/${endpoint}`);
  url.searchParams.set('OC', oc);
  url.searchParams.set('type', 'JSON');
  url.searchParams.set('target', target);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`법제처 API 실패 ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

// 판례 본문 필드의 HTML/엔티티 정리 → 평문
function stripHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

// 판례일련번호 → OC 없는 법제처 공개 판례 페이지
const precLink = (serial: string) => `https://www.law.go.kr/precInfoP.do?precSeq=${serial}`;

// 조문단위 → 본문 텍스트(조문내용 + 항/호)
function articleText(a: Record<string, unknown>): string {
  const parts: string[] = [];
  if (a['조문내용']) parts.push(String(a['조문내용']).trim());
  for (const h of asArray(a['항'] as Record<string, unknown>)) {
    if (h['항내용']) parts.push(String(h['항내용']).trim());
    for (const ho of asArray(h['호'] as Record<string, unknown>)) {
      if (ho['호내용']) parts.push('  ' + String(ho['호내용']).trim());
    }
  }
  return parts.join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const oc = Deno.env.get('LAW_API_OC');
    if (!oc) return json({ ok: false, error: '서버에 LAW_API_OC(법제처 OC)가 설정되지 않았습니다.' }, 500);

    // 인증: 로그인한 직원만
    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ ok: false, error: '로그인이 필요합니다.' }, 401);

    const { action, query, mst, id, section, display = 20 } = await req.json().catch(() => ({}));

    if (action === 'search') {
      if (!query || typeof query !== 'string' || !query.trim()) return json({ ok: false, error: '검색어(query)는 필수입니다.' }, 400);
      const data = await drf('lawSearch.do', { query: query.trim(), display: String(Math.min(Math.max(Number(display) || 20, 1), 100)) }, oc);
      const search = (data['LawSearch'] ?? {}) as Record<string, unknown>;
      const laws = asArray(search['law'] as Record<string, unknown>).map((l) => ({
        mst: String(l['법령일련번호'] ?? ''),
        lawId: String(l['법령ID'] ?? ''),
        name: String(l['법령명한글'] ?? ''),
        lawType: String(l['법령구분명'] ?? ''),
        effDate: String(l['시행일자'] ?? ''),
        dept: String(l['소관부처명'] ?? ''),
        link: l['법령상세링크'] ? `https://www.law.go.kr${l['법령상세링크']}` : null,
      }));
      return json({ ok: true, query, totalCnt: Number(search['totalCnt'] ?? laws.length), laws });
    }

    if (action === 'detail') {
      if (!mst) return json({ ok: false, error: '법령일련번호(mst)는 필수입니다.' }, 400);
      const data = await drf('lawService.do', { MST: String(mst) }, oc);
      const law = (data['법령'] ?? {}) as Record<string, unknown>;
      const basic = (law['기본정보'] ?? {}) as Record<string, unknown>;
      const units = asArray((law['조문'] as Record<string, unknown>)?.['조문단위'] as Record<string, unknown>);
      const articles = units.map((a) => {
        const title = a['조문제목'] ? String(a['조문제목']) : null;
        const content = articleText(a);
        return {
          no: String(a['조문번호'] ?? ''),
          title,
          isChapter: !title && /^제\s*\d+\s*[편장절관]/.test(content), // 장/절 제목 줄
          content,
          effDate: String(a['조문시행일자'] ?? ''),
        };
      });
      return json({
        ok: true,
        name: asText(basic['법령명_한글']) || asText(basic['법령명한글']),
        effDate: asText(basic['시행일자']),
        dept: asText(basic['소관부처']) || asText(basic['소관부처명']),
        articleCount: articles.length,
        articles,
      });
    }

    // ── 판례 검색 (target=prec) ───────────────────────────────
    if (action === 'prec-search') {
      if (!query || typeof query !== 'string' || !query.trim()) return json({ ok: false, error: '검색어(query)는 필수입니다.' }, 400);
      const sec = Number(section) === 2 ? '2' : '1'; // 1=제목/사건명, 2=본문
      const data = await drf('lawSearch.do', {
        query: query.trim(),
        search: sec,
        display: String(Math.min(Math.max(Number(display) || 20, 1), 100)),
      }, oc, 'prec');
      const search = (data['PrecSearch'] ?? {}) as Record<string, unknown>;
      const precedents = asArray(search['prec'] as Record<string, unknown>).map((p) => {
        const serial = String(p['판례일련번호'] ?? '');
        return {
          serial,
          caseName: String(p['사건명'] ?? ''),
          caseNo: String(p['사건번호'] ?? ''),
          court: String(p['법원명'] ?? ''),
          date: String(p['선고일자'] ?? ''),
          caseType: String(p['사건종류명'] ?? ''),
          judgmentType: String(p['판결유형'] ?? ''),
          link: serial ? precLink(serial) : null,
        };
      });
      return json({ ok: true, query, totalCnt: Number(search['totalCnt'] ?? precedents.length), precedents });
    }

    // ── 판례 본문 (target=prec) ───────────────────────────────
    // 법제처는 대법원 공간판례 등 일부만 전문 제공. 전문 없으면 {Law:"일치하는 판례가 없습니다."} → hasText:false + 링크.
    if (action === 'prec-detail') {
      const serial = String(id ?? '');
      if (!serial) return json({ ok: false, error: '판례일련번호(id)는 필수입니다.' }, 400);
      const data = await drf('lawService.do', { ID: serial }, oc, 'prec');
      const d = data['PrecService'] as Record<string, unknown> | undefined;
      if (!d) return json({ ok: true, hasText: false, serial, link: precLink(serial) });
      return json({
        ok: true,
        hasText: true,
        serial,
        caseName: stripHtml(d['사건명']),
        caseNo: stripHtml(d['사건번호']),
        court: stripHtml(d['법원명']),
        date: stripHtml(d['선고일자']),
        caseType: stripHtml(d['사건종류명']),
        judgmentType: stripHtml(d['판결유형']),
        issue: stripHtml(d['판시사항']),
        summary: stripHtml(d['판결요지']),
        refClauses: stripHtml(d['참조조문']),
        refCases: stripHtml(d['참조판례']),
        body: stripHtml(d['판례내용']),
        link: precLink(serial),
      });
    }

    return json({ ok: false, error: "action은 'search' | 'detail' | 'prec-search' | 'prec-detail' 이어야 합니다." }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
