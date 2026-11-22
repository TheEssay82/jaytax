// 쏭비서 개인 도구(/personal) — 업무 장부(Notion)·Google 캘린더. JAYTAX 도구(/mcp)와 따로 둔다:
// claude.ai 「JAYTAX 쏭비서」 커넥터에는 보이지 않고, 텔레그램 대화만 붙인다. 열쇠는 같은 MCP_SECRET.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { STATUSES, ledgerEnabled, listLedger, updateLedger } from './notionLedger.js';
import { gcalEnabled, listEvents } from './gcal.js';
import { seoulToday } from './tgReports.js';

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }] });
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export function buildPersonalServer(): McpServer {
  const server = new McpServer({ name: 'ssong-personal', version: '0.1.0' }, {
    instructions: '쏭비서의 업무 장부(Notion)와 Google 캘린더. 오늘·이번 주 질문은 Toodledo·캘린더·장부 세 곳을 함께 본다.',
  });

  server.registerTool('ledger_list', {
    title: '업무 장부 보기',
    description: '쏭비서 업무 장부(Notion DB 「업무 장부」)의 줄을 봅니다. 기본은 상태 「완료」를 뺀 전부(다음 마감 순). 최근 경과는 앞 300자만. 고치려면 pageId 를 ledger_update 에 넘깁니다.',
    inputSchema: {
      q: z.string().max(50).optional().describe('건·거래처·다음 할 일·현재 단계·담당에서 찾을 말'),
      include_done: z.boolean().optional().describe('완료 줄도 볼지(기본 아니오)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ q, include_done }) => {
    try {
      const rows = await listLedger({ q, includeDone: include_done });
      return ok({ today: seoulToday().ymd, count: rows.length, rows });
    } catch (e) { return fail(e); }
  });

  server.registerTool('ledger_update', {
    title: '업무 장부 고치기',
    description: '업무 장부 한 줄을 고칩니다. 대표님께 들은 것만 적습니다. progress 는 「최근 경과」 맨 앞에 「오늘날짜 사용자 확인: 한 줄 / 」로 자동으로 붙고 원래 글은 남습니다(날짜·머리말은 쓰지 마세요). ' +
      '다음 할 일·현재 단계는 통째로 바뀌니 원래 값을 보고 고칩니다. 지우기·새 줄 만들기는 못 합니다.',
    inputSchema: {
      page_id: z.string().min(32).max(40).describe('ledger_list 의 pageId'),
      progress: z.string().max(300).optional().describe('최근 경과에 덧붙일 한 줄(예: 「날인본 도착」)'),
      next_action: z.string().max(500).optional().describe('다음 할 일(새 값 전체)'),
      next_deadline: ymd.nullable().optional().describe('다음 마감 YYYY-MM-DD, 지우려면 null'),
      stage: z.string().max(200).optional().describe('현재 단계(새 값 전체, 계약 추적은 「④ 날인본 도착」처럼 규칙의 이름으로)'),
      status: z.enum(STATUSES).optional().describe('상태'),
    },
  }, async (i) => {
    try {
      const r = await updateLedger({ ...i, today: seoulToday().ymd });
      return ok({ updated: true, ...r });
    } catch (e) { return fail(e); }
  });

  server.registerTool('calendar_events', {
    title: 'Google 캘린더 일정',
    description: 'Google 캘린더 「인덕업무」(팀 일정)와 기본 캘린더(김준성 회계사 초대 일정 등)의 일정을 함께 봅니다. 날짜는 한국 기준, 양끝 포함. 제목·시간·장소만 돌려줍니다. 감사 일정은 제목에 「감사」가 빠지기도 하니 「기말」·「중간」으로도 찾습니다.',
    inputSchema: {
      from: ymd.describe('시작 날짜'),
      to: ymd.describe('끝 날짜(최대 62일)'),
      q: z.string().max(50).optional().describe('제목에서 찾을 말(띄어쓰기로 여러 개, 하나라도 맞으면)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ from, to, q }) => {
    try {
      if (to < from) throw new Error('to 가 from 보다 앞입니다');
      if ((Date.parse(to) - Date.parse(from)) / 86400000 > 62) throw new Error('기간은 62일까지');
      return ok(await listEvents(from, to, q));
    } catch (e) { return fail(e); }
  });

  return server;
}

/** 무엇이 연결돼 있는지(시스템 프롬프트에 알릴 때). */
export const personalStatus = () => ({ ledger: ledgerEnabled(), calendar: gcalEnabled() });
