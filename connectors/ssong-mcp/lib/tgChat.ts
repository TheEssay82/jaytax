// 텔레그램 대화 — 대표님이 말로 물으면 Claude 가 쏭비서 도구로 JAYTAX 를 읽고 답한다.
//
// Claude API 의 MCP 연결(mcp-client) 로 **이 서버 자신의 /mcp** 를 붙인다. 그래서 도구·권한·마스킹·
// 접속기록이 claude.ai 쏭비서와 똑같다(따로 만든 도구가 없다). 승인·고치기·지우기 도구는 애초에 없다.
// ANTHROPIC_API_KEY 가 없으면 대화는 꺼지고 단추 보고만 된다.
import Anthropic from '@anthropic-ai/sdk';
import { isSubmitTool, previewOf, submitToolDefs, type Pending } from './tgSubmit.js';
import { ssongRules } from './ssongRules.js';

const MODEL = 'claude-sonnet-5-5'; // 대표님 2026-11-21: Opus 는 비싸다 → Sonnet
const MCP_URL = process.env.SSONG_MCP_URL?.trim() || 'https://jaytax-ssong-mcp.vercel.app/mcp';
// 같은 서버의 개인 도구(업무 장부·캘린더). /mcp 주소에서 끝만 바꾼다.
const PERSONAL_URL = process.env.SSONG_PERSONAL_URL?.trim() || MCP_URL.replace(/\/mcp$/, '/personal');
const TOODLEDO_URL = process.env.TOODLEDO_MCP_URL?.trim() || 'https://jay-toodledo-mcp.vercel.app/mcp';

/** 텔레그램 봇만의 규칙 — CLAUDE.md(쏭비서 규칙) 뒤에 붙고, 서로 다르면 이쪽이 우선. */
const BOT = [
  '너는 「쏭비서」, 대표님(정우철, 회계사·세무사)의 개인 비서다. 위 규칙(쏭비서 작업실 CLAUDE.md)을 그대로 따른다. 지금은 PC 가 아니라 텔레그램(Vercel 서버)에서 대표님과 대화한다.',
  '여기서 쓸 수 있는 곳(도구로 확인한 뒤 답하고 지어내지 않는다):',
  '• jaytax 도구 — JAYTAX(회계법인 업무 시스템). 무엇이 있는지 모르면 about_jaytax 를 먼저 본다.',
  '• toodledo 도구 — 할 일. 조회·등록·고치기·완료는 바로 한다. 영구 삭제는 여기서 못 한다(PC 에서).',
  '• ledger_list · ledger_update — Notion 업무 장부. 고칠 때는 들은 것만, 최근 경과는 progress 에 한 줄만(날짜·머리말은 서버가 붙인다).',
  '• calendar_events — Google 캘린더 「인덕업무」 + 기본 캘린더(읽기만). 일정 등록·초대·수락은 여기서 못 한다.',
  '여기서 못 보는 곳: 네이버웍스(메일·일정·연차)·Gmail·Dropbox·IBCENTER. 물으면 「텔레그램에서는 못 봅니다, 아침 브리핑이나 PC 쏭비서에서」라고 짧게 안내한다.',
  '아침 브리핑(send_morning_briefing)은 PC 예약 작업이 보내는 것이라 여기서 부르지 않는다.',
  '「오늘 할 일 보여줘」「이번 주 뭐 남았어?」는 규칙대로 Toodledo·캘린더·장부 세 곳을 다 본다. 어느 한 곳을 못 읽었으면 그 이름을 끝에 밝힌다.',
  '텔레그램으로 지시하는 사람은 대표님(정우철)이다. 문서발송 의뢰인은 따로 말이 없으면 정우철로 한다.',
  'JAYTAX 결재 올리기(대표님 2026-11-21): 지시 하나에 결재는 딱 한 건. 거래처·수신자 등 필요한 값을 jaytax 도구로 확인하고, 빠진 것이 있으면 그것만 글로 묻는다. ' +
    '다 갖춰지면 submit_sales_contract · submit_doc_send · submit_invoice_request 중 하나를 한 번 부른다. 부르면 바로 올라가지 않고 서버가 대표님께 요약과 「✅ 이대로 결재 올리기」 단추를 보낸다(이것이 규칙의 「먼저 보여 주고 확인받기」다). ' +
    '실제 등록은 그 뒤 대표님이 JAYTAX 결재함에서 승인해야 일어난다. 대표님이 글로 「네」라고만 보내면 「앞 메시지의 ✅ 단추를 눌러 주세요」라고 안내한다.',
  '문서발송은 제안하기 전에 날인 필요 여부·발송부수·특별 요청(예: 2부 날인 후 1부만 발송, 1부 보관, 원본 회수 등)을 대표님께 꼭 한 번 묻는다. 대표님이 이미 말했으면 다시 묻지 않는다. ' +
    '날인 부수·보관 부수처럼 칸이 없는 세부는 etc_request 에 그대로 적는다(예: 「2부 날인 후 1부 발송, 1부 보관」). copies 는 실제로 보내는 부수다.',
  '답은 핸드폰 화면에 맞게 짧게: 결론 먼저, 필요한 숫자만, 목록은 10개 이내. 금액은 억·만 원으로. 규칙이 「표」로 보여 주라고 해도 여기서는 줄 목록으로.',
  '텔레그램은 마크다운을 그대로 보여 주므로 표·별표(**)·# 제목을 쓰지 말고 줄바꿈과 • 로만 정리한다.',
  '일상 대화에는 짧게 자연스럽게 답한다.',
].join('\n');

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
/** 오늘(한국) — 캐시가 깨지지 않게 시스템 프롬프트 맨 끝 따로 둔다. */
export function todayLine(now = new Date()): string {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now);
  const dow = DOW[new Date(`${ymd}T12:00:00+09:00`).getUTCDay()];
  return `오늘은 ${ymd}(${dow}) 한국 시각 ${new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(now)} 이다.`;
}

export async function systemBlocks(now = new Date()): Promise<Anthropic.Beta.BetaTextBlockParam[]> {
  const rules = await ssongRules();
  if (rules.source === 'fallback') console.warn('ssong rules: fallback');
  return [
    { type: 'text', text: `${rules.text}\n\n---\n# 텔레그램에서\n${BOT}` },
    { type: 'text', text: todayLine(now) },
  ];
}

export const chatEnabled = () => Boolean((process.env.ANTHROPIC_API_KEY ?? '').trim());

/** MCP 쪽 submit_* 는 늘 끈다 — 결재는 아래 클라이언트 도구로 「제안」만 받고, 올리기는 ✅ 뒤 서버가 한다. */
export const TOOLSET: Anthropic.Beta.BetaMCPToolset = {
  type: 'mcp_toolset', mcp_server_name: 'jaytax',
  configs: { submit_sales_contract: { enabled: false }, submit_doc_send: { enabled: false }, submit_invoice_request: { enabled: false } },
};

/** Toodledo — 영구 삭제는 끈다(규칙: 할 일 영구 삭제는 묻고 할 일, 텔레그램에서는 아예 안 함). */
export const TOODLEDO_TOOLSET: Anthropic.Beta.BetaMCPToolset = {
  type: 'mcp_toolset', mcp_server_name: 'toodledo', configs: { delete_tasks: { enabled: false } },
};
export const PERSONAL_TOOLSET: Anthropic.Beta.BetaMCPToolset = { type: 'mcp_toolset', mcp_server_name: 'personal' };

/** 붙일 MCP 서버 — 열쇠가 없는 곳은 뺀다(봇은 그대로 돈다). */
export function mcpSetup(env = process.env): { servers: Anthropic.Beta.BetaRequestMCPServerURLDefinition[]; toolsets: Anthropic.Beta.BetaMCPToolset[] } {
  const secret = (env.MCP_SECRET ?? '').trim();
  const servers: Anthropic.Beta.BetaRequestMCPServerURLDefinition[] = [
    { type: 'url', url: MCP_URL, name: 'jaytax', authorization_token: secret },
    { type: 'url', url: PERSONAL_URL, name: 'personal', authorization_token: secret },
  ];
  const toolsets = [TOOLSET, PERSONAL_TOOLSET];
  const tdSecret = (env.TOODLEDO_MCP_SECRET ?? '').trim();
  if (tdSecret) { servers.push({ type: 'url', url: TOODLEDO_URL, name: 'toodledo', authorization_token: tdSecret }); toolsets.push(TOODLEDO_TOOLSET); }
  return { servers, toolsets };
}

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

const LABELS: Record<string, string> = { toodledo: 'Toodledo', personal: '업무 장부·캘린더', jaytax: 'JAYTAX' };
const label = (n: string) => LABELS[n] ?? n;

/** 오류가 붙인 곳 중 하나 때문인지 — JAYTAX 는 빼지 않는다(빼면 봇 구실을 못 함). */
export function failedServer(e: unknown, names: string[]): string | null {
  const msg = e instanceof Error ? e.message : String(e);
  if (!/mcp|server|connect/i.test(msg)) return null;
  const optional = names.filter((n) => n !== 'jaytax');
  return optional.find((n) => msg.includes(n)) ?? (optional.includes('toodledo') && /mcp/i.test(msg) && !msg.includes('jaytax') ? 'toodledo' : null);
}

export function withoutServer(
  servers: Anthropic.Beta.BetaRequestMCPServerURLDefinition[], toolsets: Anthropic.Beta.BetaMCPToolset[], name: string,
) {
  return { servers: servers.filter((s) => s.name !== name), toolsets: toolsets.filter((t) => t.mcp_server_name !== name) };
}

/** 대표님 말 하나에 답한다. 결재를 제안하면 pending 이 붙어 온다(✅ 단추용). */
export async function askSsong({ text, history = [] }: { text: string; history?: Turn[] }): Promise<Answer> {
  const client = new Anthropic();
  const messages = toMessages(history, text);
  const [submitDefs, system] = await Promise.all([submitToolDefs(), systemBlocks()]);
  let { servers, toolsets } = mcpSetup();
  const dropped: string[] = [];

  // 서버 쪽 도구 호출이 길어지면 pause_turn 으로 끊겨 온다 — 그대로 이어 보낸다(최대 3번).
  for (let i = 0; i < 4; i++) {
    const req = () => client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ['mcp-client-2025-11-20', 'server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      cache_control: { type: 'ephemeral' }, // 도구 설명·규칙·앞 대화를 캐시(입력값 1/10)
      system,
      mcp_servers: servers,
      tools: [...toolsets, ...submitDefs],
      messages,
    });
    let res: Awaited<ReturnType<typeof req>>;
    try {
      res = await req();
    } catch (e) {
      // 붙인 곳 하나(Toodledo 등)가 연결을 거절하면 요청 전체가 실패한다 — 그곳만 빼고 한 번 더.
      const bad = failedServer(e, servers.map((s) => s.name));
      if (!bad) throw e;
      console.warn('ssong chat: mcp server dropped', bad, e instanceof Error ? e.message.slice(0, 300) : e);
      dropped.push(bad);
      ({ servers, toolsets } = withoutServer(servers, toolsets, bad));
      i--;
      continue;
    }
    const u = res.usage;
    console.log('ssong chat usage', { in: u.input_tokens, out: u.output_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens, stop: res.stop_reason });
    if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }
    if (res.stop_reason === 'refusal') return { text: '이 질문에는 답할 수 없다고 합니다. 다르게 물어봐 주세요.' };
    const pending = pendingOf(res.content);
    if (pending) return { text: `${previewOf(pending)}\n\n이대로 올릴까요? 아래 단추를 눌러 주세요.`, pending };
    const out = textOf(res.content) || '답을 만들지 못했습니다. 다시 물어봐 주세요.';
    return { text: dropped.length ? `${out}

(이번에는 ${dropped.map(label).join('·')}에 연결하지 못해 빼고 답했습니다)` : out };
  }
  return { text: '답이 너무 길어져 멈췄습니다. 범위를 좁혀 물어봐 주세요.' };
}
