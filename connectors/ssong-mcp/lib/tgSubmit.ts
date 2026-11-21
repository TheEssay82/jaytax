// 텔레그램 결재 올리기 — 모델은 「무엇을 올릴지」만 정하고, 실제로 올리는 것은 대표님이 ✅ 를 누른 뒤 서버가 한다.
//
// 2026-11-21 시험: ✅ 를 눌렀는데 모델이 「단추를 눌러 주세요」라고만 하고 올리지 않았다.
// 그래서 ✅ 뒤에는 모델을 부르지 않는다. 모델이 고른 submit_* 와 그 내용을 기억해 두었다가
// 서버 안에서 같은 MCP 도구(lib/tools.ts — 검사·접속기록·텔레그램 알림 그대로)를 그대로 부른다.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type Anthropic from '@anthropic-ai/sdk';
import { buildServer } from './tools.js';

export const SUBMIT_TOOLS = ['submit_sales_contract', 'submit_doc_send'] as const;
export type SubmitTool = typeof SUBMIT_TOOLS[number];
export const isSubmitTool = (n: string): n is SubmitTool => (SUBMIT_TOOLS as readonly string[]).includes(n);
export interface Pending { tool: SubmitTool; args: Record<string, unknown> }

async function localClient(): Promise<Client> {
  const server = buildServer();
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'ssong-telegram', version: '1.0.0' });
  await client.connect(clientSide);
  return client;
}

let defs: Anthropic.Beta.BetaTool[] | null = null;
/** 모델에게 줄 submit_* 도구 정의 — MCP 도구와 같은 입력 모양. 부르면 「확인 단추」로 바뀐다. */
export async function submitToolDefs(): Promise<Anthropic.Beta.BetaTool[]> {
  if (defs) return defs;
  const client = await localClient();
  try {
    const { tools } = await client.listTools();
    defs = tools.filter((t) => isSubmitTool(t.name)).map((t) => ({
      name: t.name,
      description: `${t.description ?? ''} 이 도구를 부르면 바로 올라가지 않고, 대표님께 「✅ 이대로 결재 올리기」 단추가 갑니다. 필요한 값을 다른 도구로 모두 확인한 뒤 한 번만 부릅니다.`,
      input_schema: t.inputSchema as Anthropic.Beta.BetaTool['input_schema'],
    }));
    return defs;
  } finally { await client.close(); }
}

/** ✅ 뒤 서버가 직접 올린다. 돌려주는 글은 대표님께 보일 결과. */
export async function runSubmit(p: Pending): Promise<{ ok: boolean; text: string }> {
  const client = await localClient();
  try {
    const res = await client.callTool({ name: p.tool, arguments: p.args });
    const text = (res.content as { type: string; text?: string }[]).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
    if (res.isError) return { ok: false, text };
    try {
      const j = JSON.parse(text) as { title?: string };
      return { ok: true, text: j.title ?? '' };
    } catch { return { ok: true, text: '' }; }
  } finally { await client.close(); }
}

const won = (n: unknown) => `${Number(n ?? 0).toLocaleString('ko-KR')}원`;
/** 확인 단추와 함께 보일 요약 — 모델 글이 아니라 실제로 올릴 값에서 만든다(눌렀을 때 올라가는 것 그대로). */
export function previewOf(p: Pending): string {
  const a = p.args as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (p.tool === 'submit_doc_send') {
    return [
      '📮 문서발송 의뢰 결재',
      `• 거래처: ${a.company_name}`,
      `• 송부종류: ${a.send_kind}${a.doc_name ? ` · 문서명 ${a.doc_name}` : ''}`,
      `• 업무구분: ${a.work_type} · 발송기한 ${a.deadline}${a.copies ? ` · ${a.copies}부` : ''}${a.seal_required ? ' · 날인' : ''}`,
      `• 수신: ${Array.isArray(a.recipients) ? a.recipients.length : 0}곳`,
      `• 의뢰인: ${a.requester}`,
      ...(a.etc_request ? [`• 기타요청: ${a.etc_request}`] : []),
      ...(a.reason ? [`💬 ${a.reason}`] : []),
    ].join('\n');
  }
  return [
    '📝 매출계약 등록 결재',
    `• 거래처: ${a.client_name} (${a.team === 'taxteam' ? '기장팀' : '감사팀'})`,
    `• 유형: ${a.category_code}${a.category_etc_name ? ` · ${a.category_etc_name}` : ''}`,
    `• 금액: ${won(a.amount)} · ${a.billing_cycle}${a.includes_vat ? ' · 부가세 포함' : ''}`,
    `• 기간: ${a.start_date ?? '?'} ~ ${a.end_date ?? '계속'}${a.fiscal_year ? ` · 귀속 ${a.fiscal_year}` : ''}`,
    ...(a.cpa ? [`• 담당회계사: ${a.cpa}`] : []),
    ...(Array.isArray(a.staff_names) && a.staff_names.length ? [`• 함께: ${a.staff_names.join(', ')}`] : []),
    `• 확정: ${a.confirmed === false ? '미계약(예정)' : '계약'}`,
    ...(a.reason ? [`💬 ${a.reason}`] : []),
  ].join('\n');
}
