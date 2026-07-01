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
const TAG_MODEL = 'claude-haiku-4-5'; // 키워드 추출(저비용)

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
- 근거 유형별로 다룬다: [회계기준(원문)]은 게시된 기준서 PDF에서 추출한 법정 원문 발췌이므로 그대로 인용한다(단 발췌라 문단 앞뒤 맥락은 확인 권고). [회계기준(요지)]는 정리본이므로 "(요지)"·원문 대조 권고를 붙인다. [세법]은 원문이므로 조문번호·시행일을 명시한다. [판례]는 참고 판례이므로 사건번호·선고일을 명시하고, 사실관계 차이 가능성을 유의로 덧붙인다.
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

// 키워드 해시태그 추출 — 질문+회신에서 주요 쟁점 키워드 5~8개(저비용 모델). 실패해도 빈 배열로 흡수.
async function extractTags(question: string, answer: string, key: string): Promise<string[]> {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: TAG_MODEL,
        max_tokens: 200,
        system:
          '회계·세무 상담 내용에서 핵심 쟁점 키워드를 뽑는다. 규칙: 한국어 명사구 5~8개, 각 2~12자, 공백 없는 단어 위주(예: 수익인식, 매입세액공제, 리스부채). 한글로만 표기(한자·영문·기호 혼용 금지, 예: 안분(O) 按分(X)). 기준서/조문 번호·회사명·인명은 제외. 반드시 JSON 문자열 배열만 출력(설명·코드펜스 금지).',
        messages: [{ role: 'user', content: `[질문]\n${question}\n\n[회신]\n${answer.slice(0, 4000)}` }],
      }),
    });
    if (!r.ok) return [];
    const data = await r.json();
    const text = (data.content ?? []).map((c: { text?: string }) => c.text ?? '').join('').trim();
    const m = text.match(/\[[\s\S]*\]/);
    const arr = JSON.parse(m ? m[0] : text);
    if (!Array.isArray(arr)) return [];
    return [...new Set(arr.map((t) => String(t).trim()).filter((t) => t && t.length <= 20))].slice(0, 8);
  } catch {
    return [];
  }
}

// ── 판례 자동참조 (법제처 target=prec, LAW_API_OC) ────────────────
// 질문에서 검색어 추출 → 판례 검색 → 상위 전문 있는 건의 판시사항·판결요지를 근거로.
function stripTags(v: unknown): string {
  return String(v ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}
async function precKeyword(question: string, key: string): Promise<string> {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: TAG_MODEL, max_tokens: 40,
        system: '세무·회계 질문에서 판례 검색에 쓸 핵심어 2~4개를 공백으로 이어 한 줄로만 출력한다(설명 금지). 예: "매입세액 안분 공통매입".',
        messages: [{ role: 'user', content: question.slice(0, 1500) }],
      }),
    });
    if (!r.ok) return '';
    const data = await r.json();
    return (data.content ?? []).map((c: { text?: string }) => c.text ?? '').join('').trim().split('\n')[0].slice(0, 60);
  } catch { return ''; }
}
async function fetchPrecedents(term: string, oc: string): Promise<{ type: string; ref: string; text: string }[]> {
  try {
    const su = new URL('https://www.law.go.kr/DRF/lawSearch.do');
    su.searchParams.set('OC', oc); su.searchParams.set('type', 'JSON'); su.searchParams.set('target', 'prec');
    su.searchParams.set('query', term); su.searchParams.set('search', '1'); su.searchParams.set('display', '10');
    const sj = await (await fetch(su)).json();
    const arr = sj?.PrecSearch?.prec;
    const list = Array.isArray(arr) ? arr : (arr ? [arr] : []);
    const full: { type: string; ref: string; text: string }[] = []; // 전문 보유(강한 근거)
    const meta: { type: string; ref: string; text: string }[] = []; // 사건명만(법제처 전문 미제공)
    for (const p of list) {
      if (full.length >= 3 && meta.length >= 2) break;
      const serial = String(p['판례일련번호'] ?? '');
      if (!serial) continue;
      const link = `https://www.law.go.kr/precInfoP.do?precSeq=${serial}`;
      // 전문 시도(대법원 공간판례 등)
      if (full.length < 3) {
        const du = new URL('https://www.law.go.kr/DRF/lawService.do');
        du.searchParams.set('OC', oc); du.searchParams.set('type', 'JSON'); du.searchParams.set('target', 'prec'); du.searchParams.set('ID', serial);
        const d = (await (await fetch(du)).json())?.PrecService;
        const issue = stripTags(d?.['판시사항']);
        const summary = stripTags(d?.['판결요지']);
        if (d && (issue || summary)) {
          full.push({
            type: '판례',
            ref: `${stripTags(d['법원명'])} ${stripTags(d['사건번호'])} (선고 ${stripTags(d['선고일자'])})`,
            text: [issue && `[판시사항] ${issue}`, summary && `[판결요지] ${summary}`].filter(Boolean).join('\n').slice(0, 1200),
          });
          continue;
        }
      }
      // 전문 없으면 사건명·링크만(가벼운 근거)
      if (meta.length < 2) {
        meta.push({
          type: '판례(사건명)',
          ref: `${String(p['법원명'] ?? '')} ${String(p['사건번호'] ?? '')} (선고 ${String(p['선고일자'] ?? '')})`,
          text: `${String(p['사건명'] ?? '')} — 법제처 전문 미제공(사건명만). 원문: ${link}`,
        });
      }
    }
    return [...full, ...meta];
  } catch { return []; }
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

    const lawOc = Deno.env.get('LAW_API_OC');
    const { question, standardNo = '1115', matchCount = 6, lawRefs = [], model, includePrecedents = false } =
      await req.json().catch(() => ({}));
    if (!question || typeof question !== 'string' || !question.trim()) {
      return json({ ok: false, error: '질문(question)은 필수입니다.' }, 400);
    }
    const useModel = typeof model === 'string' && ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;

    // 1) 회계기준 RAG 근거
    const qe = await embed(question.trim(), openaiKey);
    const nStd = standardNo || null; // 미지정 시 전 기준서 검색

    // 1-a) 원문(게시 PDF 추출) 근거 — 전 기준서(61종) 대상, 주 근거
    const { data: fullRows, error: eFull } = await caller.rpc('match_standard_fulltext', {
      query_embedding: qe,
      match_count: Math.min(Math.max(Number(matchCount) || 6, 1), 12),
      filter_standard_no: nStd,
    });
    if (eFull) return json({ ok: false, error: `원문 근거 검색 실패: ${eFull.message}` }, 500);
    const fullCites = (fullRows ?? []).map((r: Record<string, unknown>) => ({
      type: '회계기준(원문)',
      ref: `${r.standard_set} 제${r.standard_no}호 「${r.standard_title}」 원문 발췌`,
      text: String(r.content),
    }));

    // 1-b) 요지(정리본) 근거 — 적재된 기준서만(현재 1115), 보조
    const { data: gistRows } = await caller.rpc('match_accounting_standards', {
      query_embedding: qe,
      match_count: 3,
      filter_standard_no: nStd,
    });
    const gistCites = (gistRows ?? []).map((r: Record<string, unknown>) => ({
      type: '회계기준(요지)',
      ref: `${r.standard_set} 제${r.standard_no}호 문단 ${r.paragraph_no} (요지)`,
      text: String(r.content),
    }));

    const law = (lawRefs as LawRef[]).filter((l) => l && l.ref && l.text).map((l) => ({ type: '세법', ref: l.ref, text: l.text }));

    // 1-c) 판례 자동참조 (선택) — 질문에서 검색어 추출 → 법제처 판례 전문 근거
    let precCites: { type: string; ref: string; text: string }[] = [];
    if (includePrecedents && lawOc) {
      let term = (await precKeyword(question.trim(), anthropicKey))
        .replace(/["'`]/g, '').replace(/[^가-힣0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!term) term = question.trim().replace(/[^가-힣0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
      precCites = await fetchPrecedents(term, lawOc);
    }

    const citations = [...fullCites, ...gistCites, ...law, ...precCites];

    // 2) 근거 블록 구성
    const groundingBlock = citations
      .map((c, i) => `(${i + 1}) [${c.type}] ${c.ref}\n${c.text}`)
      .join('\n\n');

    // 3) Claude로 회신 초안 작성 (선택 모델)
    const answer_md = await compose(question.trim(), groundingBlock, anthropicKey, useModel);

    // 4) 키워드 해시태그 추출 (저비용 모델, 실패 무시)
    const tags = await extractTags(question.trim(), answer_md, anthropicKey);

    return json({ ok: true, answer_md, citations, model: useModel, tags });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
