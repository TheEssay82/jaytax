// 텔레그램 대화 — 대표님이 말로 물으면 Claude 가 쏭비서 도구로 JAYTAX 를 읽고 답한다.
//
// Claude API 의 MCP 연결(mcp-client) 로 **이 서버 자신의 /mcp** 를 붙인다. 그래서 도구·권한·마스킹·
// 접속기록이 claude.ai 쏭비서와 똑같다(따로 만든 도구가 없다). 승인·고치기·지우기 도구는 애초에 없다.
// ANTHROPIC_API_KEY 가 없으면 대화는 꺼지고 단추 보고만 된다.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-5-5'; // 대표님 2026-11-21: Opus 는 비싸다 → Sonnet
const MCP_URL = process.env.SSONG_MCP_URL?.trim() || 'https://jaytax-ssong-mcp.vercel.app/mcp';

const SYSTEM = [
  '너는 「쏭비서」, JAYTAX(대표님 회계법인 업무 시스템)를 읽는 대표님의 비서다. 지금 대표님과 텔레그램으로 대화한다.',
  'JAYTAX 에 관한 질문은 반드시 jaytax 도구로 확인한 뒤 답한다. 지어내지 않는다. 무엇이 있는지 모르면 about_jaytax 를 먼저 본다.',
  '등록·발송 요청은 submit_* 로 결재만 올린다. 실제 등록은 대표님이 JAYTAX 결재함에서 승인해야 일어난다.',
  '텔레그램으로 지시하는 사람은 대표님(정우철)이다. 문서발송 의뢰인은 따로 말이 없으면 정우철로 한다.',
  '결재 올리기 규칙(대표님 2026-11-21): 지시 하나에 결재는 딱 한 건. 먼저 필요한 것을 도구로 확인하고, 올릴 내용을 짧게 요약해 보여 준다. ' +
    '빠진 정보가 없으면 글로 묻지 말고 반드시 ask_approval 도구에 요약을 넣어 부른다 — 그러면 대표님 화면에 「✅ 이대로 결재 올리기」 단추가 붙는다. 빠진 것이 있으면 그것만 글로 묻는다. ' +
    'submit_* 도구는 대표님이 그 단추를 눌렀을 때만 보인다. 도구가 보이면 바로 앞 요약 그대로 딱 한 번 부르고, 결재함에서 승인해야 실제로 일어난다고 짧게 알린다. 같은 결재를 두 번 올리지 않는다. ' +
    '대표님이 글로 「네」라고만 보내면 「위 ✅ 단추를 눌러 주세요」라고 안내한다.',
  '답은 핸드폰 화면에 맞게 짧게: 결론 먼저, 필요한 숫자만, 목록은 10개 이내. 금액은 억·만 원으로.',
  '텔레그램은 마크다운을 그대로 보여 주므로 표·별표(**)·# 제목을 쓰지 말고 줄바꿈과 • 로만 정리한다.',
  '일상 대화에는 짧게 자연스럽게 답한다.',
].join('\n');

export const chatEnabled = () => Boolean((process.env.ANTHROPIC_API_KEY ?? '').trim());

/**
 * 결재 올리기(submit_*)는 대표님이 요약 밑 「✅ 이대로 결재 올리기」 단추를 눌렀을 때만 켠다.
 * 그냥 보낸 글(「네」 포함)에서는 도구 자체가 없어서, 모델이 실수해도 결재가 올라가지 않는다.
 */
export function toolsetFor(allowSubmit: boolean): Anthropic.Beta.BetaMCPToolset {
  return {
    type: 'mcp_toolset', mcp_server_name: 'jaytax',
    ...(allowSubmit ? {} : { configs: { submit_sales_contract: { enabled: false }, submit_doc_send: { enabled: false } } }),
  };
}

function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
}

export interface Turn { role: 'user' | 'assistant'; text: string }
export interface Answer { text: string; confirm: boolean }

/**
 * 결재 확인 요청 — 모델이 이 도구를 부르면 서버가 그 요약 밑에 「✅ 이대로 결재 올리기」 단추를 붙여 보낸다.
 * (예전엔 답 끝 표시 글자에 기댔는데 모델이 빠뜨려 단추가 안 붙었다 — 2026-11-21 18:10.)
 */
export const ASK_APPROVAL: Anthropic.Beta.BetaTool = {
  name: 'ask_approval',
  description: '결재(매출계약 등록·문서발송 의뢰)를 올리기 전에 대표님께 승낙을 구한다. 필요한 정보를 모두 확인한 뒤, 올릴 내용 요약을 넣어 부른다. 부르면 대화가 여기서 끝나고 대표님 화면에 「✅ 이대로 결재 올리기」 단추가 붙는다.',
  input_schema: {
    type: 'object',
    properties: { summary: { type: 'string', description: '올릴 결재 요약. 한 줄에 하나씩 「• 항목: 값」. 마크다운 금지.' } },
    required: ['summary'],
    additionalProperties: false,
  },
  strict: true,
};

/** 모델 응답에서 ask_approval 을 찾아 [앞 글 + 요약]으로 만든다. 없으면 null. */
export function approvalOf(content: Anthropic.Beta.BetaContentBlock[]): string | null {
  const call = content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === 'ask_approval');
  if (!call) return null;
  const summary = String((call.input as { summary?: unknown })?.summary ?? '').trim();
  const before = textOf(content);
  return `${[before, summary].filter(Boolean).join('\n\n')}\n\n이대로 올릴까요? 아래 단추를 눌러 주세요.`.trim();
}

/** 앞 대화(짧은 기억)를 API 메시지로 — user 로 시작하고 역할이 번갈아 오게. */
export function toMessages(history: Turn[], text: string): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const t of history) {
    if (!t.text?.trim()) continue;
    if (!out.length && t.role === 'assistant') out.push({ role: 'user', content: '(앞 대화)' });
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content = `${last.content as string}\n${t.text}`;
    else out.push({ role: t.role, content: t.text });
  }
  const last = out[out.length - 1];
  if (last && last.role === 'user') last.content = `${last.content as string}\n${text}`;
  else out.push({ role: 'user', content: text });
  return out;
}

/** 대표님 말 하나에 답한다. allowSubmit 은 대표님이 ✅ 단추를 눌렀을 때만 true. */
export async function askSsong({ text, history = [], allowSubmit = false }: { text: string; history?: Turn[]; allowSubmit?: boolean }): Promise<Answer> {
  const secret = (process.env.MCP_SECRET ?? '').trim();
  const client = new Anthropic();
  const messages = toMessages(history, text);

  // 서버 쪽 도구 호출이 길어지면 pause_turn 으로 끊겨 온다 — 그대로 이어 보낸다(최대 3번).
  for (let i = 0; i < 4; i++) {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ['mcp-client-2025-11-20', 'server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: SYSTEM,
      mcp_servers: [{ type: 'url', url: MCP_URL, name: 'jaytax', authorization_token: secret }],
      tools: allowSubmit ? [toolsetFor(true)] : [toolsetFor(false), ASK_APPROVAL],
      messages,
    });
    if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }
    if (res.stop_reason === 'refusal') return { text: '이 질문에는 답할 수 없다고 합니다. 다르게 물어봐 주세요.', confirm: false };
    const approval = allowSubmit ? null : approvalOf(res.content);
    if (approval) return { text: approval, confirm: true };
    const out = textOf(res.content);
    return { text: out || '답을 만들지 못했습니다. 다시 물어봐 주세요.', confirm: false };
  }
  return { text: '답이 너무 길어져 멈췄습니다. 범위를 좁혀 물어봐 주세요.', confirm: false };
}
