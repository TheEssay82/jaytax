// 텔레그램 대화 — 대표님이 말로 물으면 Claude 가 쏭비서 도구로 JAYTAX 를 읽고 답한다.
//
// Claude API 의 MCP 연결(mcp-client) 로 **이 서버 자신의 /mcp** 를 붙인다. 그래서 도구·권한·마스킹·
// 접속기록이 claude.ai 쏭비서와 똑같다(따로 만든 도구가 없다). 승인·고치기·지우기 도구는 애초에 없다.
// ANTHROPIC_API_KEY 가 없으면 대화는 꺼지고 단추 보고만 된다.
import Anthropic from '@anthropic-ai/sdk';
import { isSubmitTool, previewOf, submitToolDefs, type Pending } from './tgSubmit.js';

const MODEL = 'claude-sonnet-5-5'; // 대표님 2026-11-21: Opus 는 비싸다 → Sonnet
const MCP_URL = process.env.SSONG_MCP_URL?.trim() || 'https://jaytax-ssong-mcp.vercel.app/mcp';

const SYSTEM = [
  '너는 「쏭비서」, JAYTAX(대표님 회계법인 업무 시스템)를 읽는 대표님의 비서다. 지금 대표님과 텔레그램으로 대화한다.',
  'JAYTAX 에 관한 질문은 반드시 jaytax 도구로 확인한 뒤 답한다. 지어내지 않는다. 무엇이 있는지 모르면 about_jaytax 를 먼저 본다.',
  '텔레그램으로 지시하는 사람은 대표님(정우철)이다. 문서발송 의뢰인은 따로 말이 없으면 정우철로 한다.',
  '결재 올리기(대표님 2026-11-21): 지시 하나에 결재는 딱 한 건. 거래처·수신자 등 필요한 값을 jaytax 도구로 확인하고, 빠진 것이 있으면 그것만 글로 묻는다. ' +
    '다 갖춰지면 submit_sales_contract 또는 submit_doc_send 를 한 번 부른다. 부르면 바로 올라가지 않고 서버가 대표님께 요약과 「✅ 이대로 결재 올리기」 단추를 보낸다. ' +
    '실제 등록은 그 뒤 대표님이 JAYTAX 결재함에서 승인해야 일어난다. 대표님이 글로 「네」라고만 보내면 「앞 메시지의 ✅ 단추를 눌러 주세요」라고 안내한다.',
  '문서발송은 제안하기 전에 날인 필요 여부·발송부수·특별 요청(예: 2부 날인 후 1부만 발송, 1부 보관, 원본 회수 등)을 대표님께 꼭 한 번 묻는다. 대표님이 이미 말했으면 다시 묻지 않는다. ' +
    '날인 부수·보관 부수처럼 칸이 없는 세부는 etc_request 에 그대로 적는다(예: 「2부 날인 후 1부 발송, 1부 보관」). copies 는 실제로 보내는 부수다.',
  '답은 핸드폰 화면에 맞게 짧게: 결론 먼저, 필요한 숫자만, 목록은 10개 이내. 금액은 억·만 원으로.',
  '텔레그램은 마크다운을 그대로 보여 주므로 표·별표(**)·# 제목을 쓰지 말고 줄바꿈과 • 로만 정리한다.',
  '일상 대화에는 짧게 자연스럽게 답한다.',
].join('\n');

export const chatEnabled = () => Boolean((process.env.ANTHROPIC_API_KEY ?? '').trim());

/** MCP 쪽 submit_* 는 늘 끈다 — 결재는 아래 클라이언트 도구로 「제안」만 받고, 올리기는 ✅ 뒤 서버가 한다. */
export const TOOLSET: Anthropic.Beta.BetaMCPToolset = {
  type: 'mcp_toolset', mcp_server_name: 'jaytax',
  configs: { submit_sales_contract: { enabled: false }, submit_doc_send: { enabled: false } },
};

function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
}

export interface Turn { role: 'user' | 'assistant'; text: string; msgId?: number; pending?: Pending }
export interface Answer { text: string; pending?: Pending }

/** 모델 응답에서 첫 submit_* 호출을 꺼낸다(여러 개여도 하나만). */
export function pendingOf(content: Anthropic.Beta.BetaContentBlock[]): Pending | null {
  const call = content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && isSubmitTool(b.name));
  if (!call || !isSubmitTool(call.name)) return null;
  return { tool: call.name, args: (call.input ?? {}) as Record<string, unknown> };
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

/** 대표님 말 하나에 답한다. 결재를 제안하면 pending 이 붙어 온다(✅ 단추용). */
export async function askSsong({ text, history = [] }: { text: string; history?: Turn[] }): Promise<Answer> {
  const secret = (process.env.MCP_SECRET ?? '').trim();
  const client = new Anthropic();
  const messages = toMessages(history, text);
  const submitDefs = await submitToolDefs();

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
      tools: [TOOLSET, ...submitDefs],
      messages,
    });
    if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }
    if (res.stop_reason === 'refusal') return { text: '이 질문에는 답할 수 없다고 합니다. 다르게 물어봐 주세요.' };
    const pending = pendingOf(res.content);
    if (pending) return { text: `${previewOf(pending)}\n\n이대로 올릴까요? 아래 단추를 눌러 주세요.`, pending };
    const out = textOf(res.content);
    return { text: out || '답을 만들지 못했습니다. 다시 물어봐 주세요.' };
  }
  return { text: '답이 너무 길어져 멈췄습니다. 범위를 좁혀 물어봐 주세요.' };
}
