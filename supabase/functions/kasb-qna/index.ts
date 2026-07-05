// Supabase Edge Function: KASB 질의회신 본문 프록시 (직원 전용)
// KASB 열람서비스의 개별 질의회신 페이지(db.kasb.or.kr/qnas/:id)는 직접 링크로 열면 본문이 렌더되지 않는다
// (KASB SPA 측 동작). 대신 비공식 JSON API(/api/qnas/:id)는 본문을 정상 반환하므로, 이를 서버에서 받아
// 안전한 텍스트로 정제해 우리 앱에서 직접 표시한다. (앱은 closed 사내 사이트, KASB 자료는 이미 공개 배포)
// 반환: { ok, id, title, relStds, date, docNumber, deprecated, link, body }
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&');
}
// KASB content(HTML) → 섹션 제목은 '### '로, <br/>는 줄바꿈으로 정제한 평문.
function cleanContent(html: string): string {
  return decodeEntities(
    String(html || '')
      .replace(/<div\s+class=['"]title['"]\s*>(.*?)<\/div>/gi, '\n\n### $1\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
// JSON 문자열 배열 필드(nows/answer 등) → 문자열 배열
function parseArr(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x));
  try {
    const a = JSON.parse(String(v));
    return Array.isArray(a) ? a.map((x) => String(x)) : [String(v)];
  } catch {
    return [String(v)];
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    let id: string | number | undefined;
    if (req.method === 'GET') id = new URL(req.url).searchParams.get('id') ?? undefined;
    else id = (await req.json().catch(() => ({})))?.id;
    const idNum = Number(id);
    if (!idNum || !Number.isFinite(idNum)) return json({ ok: false, error: '질의회신 id가 필요합니다.' }, 400);

    const r = await fetch(`https://db.kasb.or.kr/api/qnas/${idNum}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return json({ ok: false, error: `KASB 조회 실패 ${r.status}` }, 502);
    const q = (await r.json())?.qna;
    if (!q) return json({ ok: false, error: '질의회신을 찾을 수 없습니다.' }, 404);

    // 본문: content(HTML) 우선, 없으면 구조화 필드(질의내용/질문/회신/사유)로 조립.
    let body = cleanContent(q.content);
    if (!body) {
      const secs: string[] = [];
      const nows = parseArr(q.nows).filter((s) => s.trim());
      if (nows.length) secs.push('### 진행경과\n' + nows.join('\n'));
      if (q.question) secs.push('### 질의\n' + decodeEntities(String(q.question)));
      const ans = parseArr(q.answer).filter((s) => s.trim());
      if (ans.length) secs.push('### 회신\n' + ans.join('\n'));
      if (q.reason) secs.push('### 사유\n' + decodeEntities(String(q.reason)));
      body = secs.join('\n\n').trim();
    }

    return json({
      ok: true,
      id: q.id,
      title: (q.title || '').trim(),
      relStds: q.relStds ? String(q.relStds).trim() : '',
      date: q.date || '',
      docNumber: q.docNumber || '',
      deprecated: q.deprecatedYn === 1,
      link: `https://db.kasb.or.kr/qnas/${q.id}`,
      body: body || '(본문이 제공되지 않습니다. KASB 원문을 확인하세요.)',
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
