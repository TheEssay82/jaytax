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
  '결재 올리기 규칙(대표님 2026-11-21): 지시 하나에 결재는 딱 한 건. 바로 올리지 말고 먼저 올릴 내용을 요약해 보여 주며 「이대로 올릴까요? 이 메시지에 답장으로 「네」라고 보내 주세요」라고 묻는다. ' +
    '앞 대화에 그 요약이 있고 대표님이 답장으로 승낙했을 때만 submit_* 를 한 번 부른다. 앞 대화가 없으면 절대 submit_* 를 부르지 않는다.',
  '답은 핸드폰 화면에 맞게 짧게: 결론 먼저, 필요한 숫자만, 목록은 10개 이내. 금액은 억·만 원으로.',
  '텔레그램은 마크다운을 그대로 보여 주므로 표·별표(**)·# 제목을 쓰지 말고 줄바꿈과 • 로만 정리한다.',
  '일상 대화에는 짧게 자연스럽게 답한다.',
].join('\n');

export const chatEnabled = () => Boolean((process.env.ANTHROPIC_API_KEY ?? '').trim());

export interface ChatInput { text: string; replyTo?: string | null }

/**
 * 결재 올리기(submit_*)는 대표님이 쏭비서의 요약 메시지에 **답장**했을 때만 켠다.
 * 그냥 보낸 글에서는 도구 자체가 없어서, 모델이 실수해도 결재가 올라가지 않는다.
 */
export function toolsetFor(isReply: boolean): Anthropic.Beta.BetaMCPToolset {
  return {
    type: 'mcp_toolset', mcp_server_name: 'jaytax',
    ...(isReply ? {} : { configs: { submit_sales_contract: { enabled: false }, submit_doc_send: { enabled: false } } }),
  };
}

function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
}

/** 대표님 질문 하나에 답한다. 이전 대화는 대표님이 「답장」으로 찍은 쏭비서 메시지 하나만 이어받는다. */
export async function askSsong({ text, replyTo }: ChatInput): Promise<string> {
  const secret = (process.env.MCP_SECRET ?? '').trim();
  const client = new Anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  if (replyTo?.trim()) {
    messages.push({ role: 'user', content: '(앞 대화)' }, { role: 'assistant', content: replyTo.trim() });
  }
  messages.push({ role: 'user', content: text });

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
      tools: [toolsetFor(Boolean(replyTo?.trim()))],
      messages,
    });
    if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }
    if (res.stop_reason === 'refusal') return '이 질문에는 답할 수 없다고 합니다. 다르게 물어봐 주세요.';
    const out = textOf(res.content);
    return out || '답을 만들지 못했습니다. 다시 물어봐 주세요.';
  }
  return '답이 너무 길어져 멈췄습니다. 범위를 좁혀 물어봐 주세요.';
}
