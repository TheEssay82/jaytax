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

const SYSTEM = `당신은 한국 회계·세무 실무 회신을 작성하는 보조자다. 결과물은 담당 회계사·세무사가 검토 후 고객에게 그대로 보낼 수 있는 '완성된 회신'이어야 한다(최종 판단·서명은 담당자).

[근거 규칙]
- 제공된 '근거' 안의 내용만 사용한다. 근거에 없으면 추측하지 말고 [확인 불가]로 표기하고, 필요하면 "정확한 확인을 위해 추가 조회가 필요하다"고 안내한다. 존재하지 않는 조문·문단번호·판례(심판례)번호·링크를 지어내지 않는다.
- 근거 유형별 인용법:
  · [회계기준(원문)]: 게시된 기준서 원문 발췌 — 문단번호와 함께 인용(발췌라 앞뒤 맥락 확인 권고).
  · [회계기준(요지)]: 정리본 — "(요지)"와 원문 대조 권고를 붙인다.
  · [세법]: 법령 원문 — 법령명·조문번호·시행일을 명시하고, 핵심 문구를 "직접 인용"한 뒤 쉬운 말로 풀이한다.
  · [판례]/[심판례]: 사건(의결)번호·선고(의결)일·요지를 적고, 사실관계 차이 가능성을 유의로 덧붙인다.

[형식] 아래 5블록을 마크다운으로 그대로 따른다:
# <제목 — 쟁점을 한 줄로. 세무면 "[세무 회신]", 회계면 "[회계 회신]", 둘 다면 "[회계·세무 회신]" 접두>
## 질의요지
<무엇을 물었는지 1~3문장. 제공된 사실관계·가정을 요약.>
## 결론
<바로 쓸 수 있는 답. 단정적으로. 결론이 조건에 따라 갈리면 번호(1., 2., …)로 경우를 나눠 각각 결론을 주고, 원칙과 예외를 분명히 구분한다.>
## 근거
- **<법령명> 제○조 (시행 YYYY.MM.DD)** — "<원문 핵심 직접인용>" (→ 쉬운 말 풀이: 이 조문이 왜 결론의 근거인지)
- **<기준서> 문단 N** — 요점 ((요지)면 표기·원문대조 권고)
- **<심판례/판례> 번호 (기관, 선고·의결일)** — 요지 (사실관계 차이 유의)
- (근거를 못 찾은 항목은 [확인 불가]로 표기)
## 실무 유의
<실무에서 어떻게 처리하는지 + 놓치기 쉬운 점을 구체적으로 여러 항목(- 불릿)으로. 입증·증빙·안분·업종특성 등 실행 지침 포함.>

적용 법령 시행일: <핵심 근거들의 시행일>   |   원문: 법제처/기준서 근거 참조

---
※ 본 회신은 AI 보조 자료입니다. 전문가 최종검토 필요 — 최종 판단·서명은 담당 회계사·세무사.

[작성 지침]
- 회신은 반드시 완결한다. 중간에 끊지 말고 근거·실무유의·하단 안내까지 끝맺는다.
- 근거가 풍부하면 결론·검토를 충분히 상세하게 풀어 쓴다(빈약하게 요약하지 말 것). 각 근거는 근거 블록에 빠짐없이 정리한다.
- 정중한 실무체. 단정·과장 금지, 불확실성은 한정어로 보존. 이모지 미사용.`;

async function compose(question: string, groundingBlock: string, key: string, model: string): Promise<string> {
  const user = `다음 질문에 대해, 아래 '근거' 안의 내용만 사용하여 완성된 이메일 회신을 작성하라.

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
      max_tokens: 8000,
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

// ── 세법 조문 자동근거 (법제처 target=law: search → detail, LAW_API_OC) ──
// 질문 → 관련 세법 식별(haiku) → 법령 조문목록 → 관련 조문 선별(haiku) → 조문 원문+시행일 근거.
// 법령은 수십~수백 조라 전문 투입 불가 → Claude가 조문제목 목록에서 선별한 조문만 원문 추출.
async function haikuJson(key: string, system: string, user: string, maxTokens = 300): Promise<unknown> {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: TAG_MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const text = (data.content ?? []).map((c: { text?: string }) => c.text ?? '').join('').trim();
    const m = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : text);
  } catch { return null; }
}
function asArr<T>(v: T | T[] | undefined | null): T[] {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}
async function drfLaw(endpoint: string, params: Record<string, string>, oc: string): Promise<Record<string, unknown>> {
  const u = new URL(`https://www.law.go.kr/DRF/${endpoint}`);
  u.searchParams.set('OC', oc); u.searchParams.set('type', 'JSON'); u.searchParams.set('target', 'law');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u.toString());
  if (!r.ok) throw new Error(`법제처 API 실패 ${r.status}`);
  return (await r.json()) as Record<string, unknown>;
}
function articleBody(a: Record<string, unknown>): string {
  const parts: string[] = [];
  if (a['조문내용']) parts.push(String(a['조문내용']).trim());
  for (const h of asArr(a['항'] as Record<string, unknown>)) {
    if (h['항내용']) parts.push(String(h['항내용']).trim());
    for (const ho of asArr(h['호'] as Record<string, unknown>)) if (ho['호내용']) parts.push('  ' + String(ho['호내용']).trim());
  }
  return parts.join('\n');
}
function fmtDate(s: string): string {
  const m = String(s ?? '').match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : String(s ?? '');
}
async function fetchTaxLaw(question: string, key: string, oc: string): Promise<{ type: string; ref: string; text: string }[]> {
  try {
    // 1) 관련 세법 식별
    const idn = await haikuJson(
      key,
      '세무·회계 질문에서 근거가 될 한국 세법 법령명을 고른다. 법제처 정식 명칭으로 최대 3개. 예: 부가가치세법, 법인세법, 소득세법, 국세기본법, 조세특례제한법, 상속세 및 증여세법, 지방세법. 시행령 조문이 꼭 필요하면 "부가가치세법 시행령"처럼 포함. 세법 쟁점이 없으면 빈 배열. JSON 문자열 배열만 출력.',
      question.slice(0, 1500),
    );
    const lawNames = Array.isArray(idn) ? idn.filter((x) => typeof x === 'string' && x.trim()).slice(0, 3) : [];
    if (!lawNames.length) return [];

    const cites: { type: string; ref: string; text: string }[] = [];
    for (const name of lawNames) {
      // 2) 법령 식별 → MST (정식명 일치 우선)
      const s = await drfLaw('lawSearch.do', { query: name, display: '5' }, oc);
      const laws = asArr((s['LawSearch'] as Record<string, unknown>)?.['law'] as Record<string, unknown>);
      if (!laws.length) continue;
      const pick = laws.find((l) => String(l['법령명한글'] ?? '') === name) ?? laws[0];
      const mst = String(pick['법령일련번호'] ?? '');
      if (!mst) continue;

      // 3) 조문 목록
      const d = await drfLaw('lawService.do', { MST: mst }, oc);
      const law = (d['법령'] ?? {}) as Record<string, unknown>;
      const basic = (law['기본정보'] ?? {}) as Record<string, unknown>;
      const basicEff = String(basic['시행일자'] ?? '');
      const lawName = String(basic['법령명_한글'] ?? basic['법령명한글'] ?? name);
      const units = asArr((law['조문'] as Record<string, unknown>)?.['조문단위'] as Record<string, unknown>);
      const arts = units
        .map((a) => {
          const branch = String(a['조문가지번호'] ?? '');
          const content = articleBody(a);
          return {
            no: String(a['조문번호'] ?? ''),
            branch: branch === '00' || branch === '' ? '' : String(Number(branch)),
            title: a['조문제목'] ? String(a['조문제목']) : '',
            content,
            eff: String(a['조문시행일자'] ?? '') || basicEff,
            isChapter: !a['조문제목'] && /^제\s*\d+\s*[편장절관]/.test(content),
          };
        })
        .filter((a) => a.no && !a.isChapter && a.content && !a.content.startsWith('삭제'));
      if (!arts.length) continue;

      // 4) 관련 조문 선별(haiku) — 조문 제목 목록에서 최대 4개
      const label = (a: { no: string; branch: string }) => `제${a.no}조${a.branch ? '의' + a.branch : ''}`;
      const idx = arts.map((a) => `${label(a)}${a.title ? ` (${a.title})` : ''}`).join('\n');
      const sel = await haikuJson(
        key,
        `아래 「${lawName}」 조문 목록에서 질문과 직접 관련된 조문만 최대 4개 고른다. "제38조" 또는 "제38조의2" 형태 문자열 JSON 배열만 출력. 관련 없으면 빈 배열.`,
        `[질문]\n${question.slice(0, 1200)}\n\n[조문 목록]\n${idx}`,
        200,
      );
      const wanted = Array.isArray(sel) ? sel.map((x) => String(x).replace(/\s/g, '')) : [];
      const chosen = arts.filter((a) => wanted.includes(label(a))).slice(0, 4);
      for (const a of chosen) {
        cites.push({
          type: '세법',
          ref: `${lawName} ${label(a)}${a.title ? `(${a.title})` : ''}${a.eff ? ` (시행 ${fmtDate(a.eff)})` : ''}`,
          text: a.content.slice(0, 1400),
        });
      }
    }
    return cites;
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
    const { question, standardNo = '1115', matchCount = 6, lawRefs = [], model, includePrecedents = false, includeTaxLaw = true, domain = '공통' } =
      await req.json().catch(() => ({}));
    if (!question || typeof question !== 'string' || !question.trim()) {
      return json({ ok: false, error: '질문(question)은 필수입니다.' }, 400);
    }
    const useModel = typeof model === 'string' && ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;
    // 분야별 근거 조회: 회계 → 회계기준만, 세무 → 세법만, 공통 → 둘 다
    const doAccounting = domain !== '세무';
    const doTax = domain !== '회계';

    // 1) 회계기준 RAG 근거 (회계·공통에서만)
    let fullCites: { type: string; ref: string; text: string }[] = [];
    let gistCites: { type: string; ref: string; text: string }[] = [];
    if (doAccounting) {
      const qe = await embed(question.trim(), openaiKey);
      const nStd = standardNo || null; // 미지정 시 전 기준서 검색

      // 1-a) 원문(게시 PDF 추출) 근거 — 전 기준서(61종) 대상, 주 근거
      const { data: fullRows, error: eFull } = await caller.rpc('match_standard_fulltext', {
        query_embedding: qe,
        match_count: Math.min(Math.max(Number(matchCount) || 6, 1), 12),
        filter_standard_no: nStd,
      });
      if (eFull) return json({ ok: false, error: `원문 근거 검색 실패: ${eFull.message}` }, 500);
      fullCites = (fullRows ?? []).map((r: Record<string, unknown>) => ({
        type: '회계기준(원문)',
        ref: `${r.standard_set} 제${r.standard_no}호 「${r.standard_title}」 원문 발췌`,
        text: String(r.content),
      }));

      // 1-b) 요지(정리본) 근거 — 적재된 기준서만, 보조
      const { data: gistRows } = await caller.rpc('match_accounting_standards', {
        query_embedding: qe,
        match_count: 3,
        filter_standard_no: nStd,
      });
      gistCites = (gistRows ?? []).map((r: Record<string, unknown>) => ({
        type: '회계기준(요지)',
        ref: `${r.standard_set} 제${r.standard_no}호 문단 ${r.paragraph_no} (요지)`,
        text: String(r.content),
      }));
    }

    // 세법 수동 첨부(LawRefPicker) — 사용자가 직접 고른 조문
    const law = (lawRefs as LawRef[]).filter((l) => l && l.ref && l.text).map((l) => ({ type: '세법', ref: l.ref, text: l.text }));

    // 1-b') 세법 조문 자동근거 (세무·공통 + 선택) — 질문 → 관련 세법 식별 → 조문 선별 → 원문+시행일
    let taxCites: { type: string; ref: string; text: string }[] = [];
    if (doTax && includeTaxLaw && lawOc) {
      taxCites = await fetchTaxLaw(question.trim(), anthropicKey, lawOc);
    }

    // 1-c) 판례 자동참조 (선택) — 질문에서 검색어 추출 → 법제처 판례 전문 근거
    let precCites: { type: string; ref: string; text: string }[] = [];
    if (includePrecedents && lawOc) {
      let term = (await precKeyword(question.trim(), anthropicKey))
        .replace(/["'`]/g, '').replace(/[^가-힣0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!term) term = question.trim().replace(/[^가-힣0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
      precCites = await fetchPrecedents(term, lawOc);
    }

    const citations = [...fullCites, ...gistCites, ...taxCites, ...law, ...precCites];

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
