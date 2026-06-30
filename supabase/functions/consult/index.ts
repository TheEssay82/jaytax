// Supabase Edge Function: 상담 회신 초안 자동작성 (직원 전용)
// 흐름: 질문 → 회계기준 RAG 근거 수집(OpenAI 임베딩 + match RPC) + (선택)첨부된 세법 조문
//        → Claude(Anthropic)로 grounding/email-template 규약에 맞춘 회신 초안 작성.
// 저장은 프런트가 consultations 테이블에 insert(RLS).
//
// 배포: Edge Functions → consult 생성 후 이 코드 붙여넣고 Deploy.
//   Secrets: OPENAI_API_KEY(질의 임베딩), ANTHROPIC_API_KEY(회신 작성). SUPABASE_URL/ANON은 자동주입.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EMBED_MODEL = 'text-embedding-3-small';
// 회신 작성 모델: 프런트에서 선택(기본 Sonnet, 고품질 Opus). allowlist 밖이면 기본으로.
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const ALLOWED_MODELS = new Set(['claude-sonnet-4-6', 'claude-opus-4-8']);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

async function embed(text: string, key: string): Promise<number[]> {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!r.ok) throw new Error(`임베딩 실패 ${r.status}`);
  return (await r.json()).data[0].embedding;
}

const SYSTEM = `당신은 한국 회계·세무 실무 회신 초안을 작성하는 보조자다. 최종 판단·서명은 담당 회계사·세무사가 한다.
[근거 규칙]
- 제공된 '근거'에 있는 내용만 사용한다. 근거에 없으면 추측하지 말고 본문에 [확인 불가]로 표기한다.
- 모든 실질 주장 끝에 각주 [^n]을 달고, 하단 '근거'에 1:1로 매칭한다. 존재하지 않는 문단번호·조문·링크를 지어내지 않는다.
- 회계기준 근거는 '요지 정리본'이다. 인용 시 "(요지)"와 "원문 대조 권고"를 붙인다. 세법 조문은 원문이므로 조문번호·시행일을 명시한다.
[형식] 아래 이메일 구조를 그대로 따른다:
제목: [회계기준 회신] 또는 [세무 회신] + 쟁점 한 줄
본문: 첫 문단에 결론 한 줄 → "■ 사실관계/가정"(가정은 '가정:'으로 분리) → "■ 검토 의견"(각주) → "■ 결론" → "■ 유의사항"(요지 항목 원문대조 권고, 최종 판단 담당자 검토 필요)
하단: "근거" 목록([^n]: 기준서/조문 + 번호 + (요지) + 요점)
[톤] 정중한 실무체. 단정·과장 금지, 한정어로 불확실성 보존. 이모지 미사용.`;

async function compose(question: string, groundingBlock: string, key: string, model: string): Promise<string> {
  const user = `다음 질문에 대해, 아래 '근거' 안의 내용만 사용하여 이메일 회신 초안을 작성하라.

[질문]
${question}

[근거 — 이 범위 안에서만 인용]
${groundingBlock || '(제공된 근거 없음 — 본문에서 [확인 불가] 처리)'}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!r.ok) throw new Error(`Claude 작성 실패 ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return (data.content ?? []).map((c: { text?: string }) => c.text ?? '').join('').trim();
}

interface LawRef { ref: string; text: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!openaiKey) return json({ ok: false, error: '서버에 OPENAI_API_KEY가 없습니다.' }, 500);
    if (!anthropicKey) return json({ ok: false, error: '서버에 ANTHROPIC_API_KEY가 없습니다.' }, 500);

    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ ok: false, error: '로그인이 필요합니다.' }, 401);

    const { question, standardNo = '1115', matchCount = 6, lawRefs = [], model } = await req.json().catch(() => ({}));
    if (!question || typeof question !== 'string' || !question.trim()) {
      return json({ ok: false, error: '질문(question)은 필수입니다.' }, 400);
    }
    const useModel = typeof model === 'string' && ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;

    // 1) 회계기준 RAG 근거
    const qe = await embed(question.trim(), openaiKey);
    const { data: rows, error } = await caller.rpc('match_accounting_standards', {
      query_embedding: qe,
      match_count: Math.min(Math.max(Number(matchCount) || 6, 1), 12),
      filter_standard_no: standardNo || null,
    });
    if (error) return json({ ok: false, error: `근거 검색 실패: ${error.message}` }, 500);

    const stdCites = (rows ?? []).map((r: Record<string, unknown>) => ({
      type: '회계기준',
      ref: `${r.standard_set} 제${r.standard_no}호 문단 ${r.paragraph_no} (요지)`,
      text: String(r.content),
    }));
    const law = (lawRefs as LawRef[]).filter((l) => l && l.ref && l.text).map((l) => ({ type: '세법', ref: l.ref, text: l.text }));
    const citations = [...stdCites, ...law];

    // 2) 근거 블록 구성
    const groundingBlock = citations
      .map((c, i) => `(${i + 1}) [${c.type}] ${c.ref}\n${c.text}`)
      .join('\n\n');

    // 3) Claude로 회신 초안 작성 (선택 모델)
    const answer_md = await compose(question.trim(), groundingBlock, anthropicKey, useModel);

    return json({ ok: true, answer_md, citations, model: useModel });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
