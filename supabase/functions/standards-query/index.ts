// Supabase Edge Function: 회계기준 근거 검색 API (직원 전용)
// 인증된 직원이 질문을 보내면 → OpenAI 임베딩 → match_accounting_standards RPC → 근거 문단 N개 반환.
// 스킬의 '확장' 경로(scripts/standards/search.ts)와 동일한 검색 로직을 jaytax.co.kr 백엔드로 노출한다.
//
// 이 함수는 '검색(retrieval)'까지 담당한다. 최종 회신문(이메일) 작성은 호출 측(프런트/LLM)이
// prompts/grounding-instructions.md·email-template.md 규약에 따라 수행한다(다음 증분).
//
// 배포: Supabase 대시보드 → Edge Functions → standards-query 생성 후 이 코드 붙여넣고 Deploy.
//   필요한 Secret: OPENAI_API_KEY  (대시보드 Edge Functions → Secrets, 또는 `supabase secrets set OPENAI_API_KEY=...`)
//   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY 는 런타임이 자동 주입.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EMBED_MODEL = 'text-embedding-3-small'; // scripts/standards/lib.ts 와 동일(차원 1536)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

async function embed(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings 실패 ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return data.data[0].embedding;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) return json({ ok: false, error: '서버에 OPENAI_API_KEY 가 설정되지 않았습니다.' }, 500);

    // 1) 호출자 인증 — 로그인한 직원만 (RLS: accounting_standards 는 authenticated 읽기 허용)
    const authHeader = req.headers.get('Authorization') ?? '';
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const {
      data: { user },
    } = await caller.auth.getUser();
    if (!user) return json({ ok: false, error: '로그인이 필요합니다.' }, 401);

    // 2) 입력 검증
    const { question, standard_no = null, match_count = 5 } = await req.json().catch(() => ({}));
    if (!question || typeof question !== 'string' || !question.trim()) {
      return json({ ok: false, error: '질문(question)은 필수입니다.' }, 400);
    }
    const n = Math.min(Math.max(Number(match_count) || 5, 1), 20);

    // 3) 질의 임베딩 → 유사 문단 검색 (RPC는 authenticated 권한, 호출자 신원으로 실행)
    const queryEmbedding = await embed(question.trim(), openaiKey);
    const { data: rows, error } = await caller.rpc('match_accounting_standards', {
      query_embedding: queryEmbedding,
      match_count: n,
      filter_standard_no: standard_no,
    });
    if (error) return json({ ok: false, error: `검색 실패: ${error.message}` }, 500);

    // 4) 근거 문단 정형화 (정리본 = 요지이므로 인용 규약을 응답에 함께 실어 보냄)
    const matches = (rows ?? []).map((r: Record<string, unknown>) => ({
      standard_set: r.standard_set,
      standard_no: r.standard_no,
      standard_title: r.standard_title,
      part: r.part,
      section_title: r.section_title,
      paragraph_no: r.paragraph_no,
      content: r.content,
      similarity: Number(r.similarity),
      citation: `${r.standard_set} 제${r.standard_no}호 문단 ${r.paragraph_no} (요지)`,
    }));

    return json({
      ok: true,
      question,
      matches,
      notice:
        '근거 문단은 요지 정리본이다. 인용 시 "(요지)"·원문 대조 권고를 붙이고, 못 찾은 항목은 [확인 불가]로 표기한다. 최종 판단은 담당자 검토 필요.',
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
