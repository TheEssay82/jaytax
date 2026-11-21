import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CATEGORIES } from './categories.js';
import { JaytaxError, rpc } from './jaytax.js';
import { notifyTelegram } from './telegram.js';
import { JAYTAX_MAP } from './jaytaxMap.js';

// 문서발송 선택지 — 앱 src/lib/docSendApi.ts 와 같아야 한다(승인 때 앱이 다시 확인한다).
export const WORK_TYPES = ['우체국', '퀵서비스', '회계사책상'] as const;
export const SEND_KINDS = [
  '계약서', '세무조정계산서', '일반감사보고서', '연결감사보고서', '주식가치평가보고서',
  '동업기업 소득계산 및 배분명세서', '상증세평가보고서', '조회서', '실사보고서',
  '기타보고서', '기타증명서', '기타',
] as const;
export const DEADLINES = ['긴급', '보통', '지연가능'] as const;

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
const fail = (e: unknown) => ({
  isError: true,
  content: [{ type: 'text' as const, text: e instanceof JaytaxError || e instanceof Error ? e.message : String(e) }],
});

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const uuid = z.string().uuid();

/** 매출계약 내용 검사 — 분류표에 있는 맨 아래 코드이고 팀이 맞는지. 문제 목록을 돌려준다. */
export function checkContract(i: { team: string; category_code: string; category_etc_name?: string; start_date?: string; end_date?: string }): string[] {
  const errs: string[] = [];
  const c = CATEGORIES.find((x) => x.code === i.category_code);
  if (!c) errs.push(`매출유형 코드가 없습니다: ${i.category_code} (list_contract_categories 로 확인)`);
  else {
    if (c.team !== i.team) errs.push(`${c.label} 은 ${c.team} 유형입니다`);
    if ('needsEtcName' in c && c.needsEtcName && !i.category_etc_name?.trim()) errs.push('「기타」 유형은 category_etc_name 이 필요합니다');
  }
  if (i.start_date && i.end_date && i.end_date < i.start_date) errs.push('end_date 가 start_date 보다 앞입니다');
  return errs;
}

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'jaytax-ssong', version: '0.2.0' }, {
    instructions:
      'JAYTAX(대표님 회계법인 업무 시스템) 연결. JAYTAX 에 무엇이 있는지 모르면 about_jaytax 를 먼저 읽는다. ' +
      '보고·집계는 daily_digest · revenue_summary · billing_watch · audit_watch, 등록·발송은 submit_* 로 결재만 올린다(대표님 승인 뒤 실행). ' +
      '금액은 원 단위, 정산연도는 7월~다음 해 6월이며 시작 연도로 부른다.',
  });

  // ── JAYTAX 지도 ───────────────────────────────────────
  server.registerTool('about_jaytax', {
    title: 'JAYTAX 지도',
    description: `JAYTAX 에 어떤 메뉴·기능이 있고, 최근 무엇이 바뀌었고, 무엇이 아직 계획 단계인지, 쏭비서 도구가 어디를 보는지 알려줍니다(앱 v${JAYTAX_MAP.version} 기준, 앱 소스에서 자동 생성). JAYTAX 에 대해 답하기 전에 읽으세요.`,
    inputSchema: { part: z.enum(['all', 'rules', 'tools', 'menus', 'recent', 'planned']).optional().describe('일부만(기본 all)') },
    annotations: { readOnlyHint: true },
  }, async ({ part }) => {
    const m = JAYTAX_MAP;
    const pick: Record<string, unknown> = {
      rules: m.rules, tools: m.ssongTools, menus: m.menus, recent: m.recentChanges, planned: m.planned,
    };
    return ok(!part || part === 'all' ? m : { version: m.version, asOf: m.asOf, [part]: pick[part] });
  });

  // ── 보고·집계 ─────────────────────────────────────────
  server.registerTool('daily_digest', {
    title: 'JAYTAX 에 생긴 일',
    description: '기간 동안 JAYTAX 에 생긴 일: 새 매출계약 · 문서발송(새 요청·상태 변화·등기번호) · 세금계산서 발행 · 수금 · 조회서 회수 · 감사이슈 · 쏭비서 결재 결과. 기본은 어제~오늘(한국 시각). 아침 브리핑에 씁니다.',
    inputSchema: { from: ymd.optional().describe('시작일(기본 어제)'), to: ymd.optional().describe('끝일(기본 오늘), 두 달 이내') },
    annotations: { readOnlyHint: true },
  }, async ({ from, to }) => {
    try { return ok(await rpc('ssong_daily_digest', { p_from: from ?? null, p_to: to ?? null })); } catch (e) { return fail(e); }
  });

  server.registerTool('revenue_summary', {
    title: '매출 현황',
    description: '정산연도(7월~다음 해 6월, 시작 연도로 부름) 매출을 팀별·거래처별로: 매출계약 금액(contracts) · 발행된 세금계산서 공급가액(issued) · 결산 확정 실적(actual). notes 의 해석 주의를 함께 전하세요. 기본은 올해 정산연도, 전체 팀.',
    inputSchema: {
      fiscal_year: z.number().int().min(2020).max(2100).optional().describe('정산연도(예: 2026 = 2026-07~2027-06)'),
      team: z.enum(['감사team', 'taxteam']).optional().describe('감사팀=감사team, 기장팀=taxteam'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ fiscal_year, team }) => {
    try { return ok(await rpc('ssong_revenue_summary', { p_year: fiscal_year ?? null, p_team: team ?? null })); } catch (e) { return fail(e); }
  });

  server.registerTool('billing_watch', {
    title: '청구·미수금 점검',
    description: '그 달(YYYY-MM) 세금계산서 발행요청 상태·팀별 합계·미발행 대기, 월 마감 여부와 미수금(가장 최근 ERP 미수금대장 기준) 팀별 합계·거래처별 잔액·오래된 미수(기본 90일 이상). 기본은 이번 달.',
    inputSchema: {
      ym: z.string().regex(/^\d{4}-\d{2}$/).optional().describe('YYYY-MM'),
      overdue_days: z.number().int().min(0).max(3650).optional().describe('이 날수 이상 지난 미수만 overdue 에(기본 90)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ ym, overdue_days }) => {
    try { return ok(await rpc('ssong_billing_watch', { p_ym: ym ?? null, p_min_days: overdue_days ?? 90 })); } catch (e) { return fail(e); }
  });

  server.registerTool('audit_watch', {
    title: '감사업무 점검',
    description: '기말감사일정(기간 안의 날짜별 회사·업무·투입인원), 조회서 미발송·미회수(회사별·기관), 아직 닫히지 않은 감사이슈. 기본은 오늘부터 7일.',
    inputSchema: { from: ymd.optional().describe('일정 시작일(기본 오늘)'), days: z.number().int().min(1).max(60).optional().describe('일정 날수(기본 7)') },
    annotations: { readOnlyHint: true },
  }, async ({ from, days }) => {
    try { return ok(await rpc('ssong_audit_watch', { p_from: from ?? null, p_days: days ?? 7 })); } catch (e) { return fail(e); }
  });

  // ── 조회 ──────────────────────────────────────────────
  server.registerTool('search_clients', {
    title: '거래처 검색',
    description: 'JAYTAX 거래처를 이름 일부나 거래처코드로 찾습니다. 거래처 id(entityId)·코드·사업장(placeId·이름·상태·담당회계사)만 돌려줍니다. 매출계약을 올리기 전에 entityId·placeId 를 여기서 확인하세요.',
    inputSchema: { query: z.string().min(1).describe('거래처명 일부 또는 코드') },
    annotations: { readOnlyHint: true },
  }, async ({ query }) => { try { return ok(await rpc('ssong_search_clients', { p_q: query })); } catch (e) { return fail(e); } });

  server.registerTool('search_contacts', {
    title: '발송 수신자(연락처) 검색',
    description: '문서발송 수신자를 거래처명이나 담당자 이름으로 찾습니다. clientId·contactId·이름·직함과 주소/전화가 있는지(hasAddress·hasPhone)만 돌려줍니다. 주소·전화 원문은 주지 않습니다(승인할 때 JAYTAX 가 채움).',
    inputSchema: { query: z.string().min(1).describe('거래처명 또는 담당자 이름 일부') },
    annotations: { readOnlyHint: true },
  }, async ({ query }) => { try { return ok(await rpc('ssong_search_contacts', { p_q: query })); } catch (e) { return fail(e); } });

  server.registerTool('list_staff', {
    title: '직원 이름 목록',
    description: 'JAYTAX 직원 이름 목록. 매출계약의 함께 하는 직원(staff_names)·담당회계사(cpa)·문서발송 의뢰인(requester)을 고를 때 씁니다.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => { try { return ok(await rpc('ssong_list_staff')); } catch (e) { return fail(e); } });

  server.registerTool('list_contract_categories', {
    title: '매출유형 목록',
    description: '매출계약의 매출유형(category_code) 목록. team 과 맞는 코드만 쓸 수 있습니다. 기본 발생단위·청구주기도 함께 줍니다.',
    inputSchema: { team: z.enum(['감사team', 'taxteam']).optional() },
    annotations: { readOnlyHint: true },
  }, async ({ team }) => ok(CATEGORIES.filter((c) => !team || c.team === team)));

  server.registerTool('list_sales_contracts', {
    title: '매출계약 조회',
    description: '거래처 하나의 매출계약 목록(계약코드·유형·금액·담당회계사·기간·확정 여부·담당직원). 같은 계약이 이미 있는지 올리기 전에 확인하세요.',
    inputSchema: { entity_id: uuid.describe('search_clients 의 entityId'), fiscal_year: z.number().int().optional().describe('귀속연도만') },
    annotations: { readOnlyHint: true },
  }, async ({ entity_id, fiscal_year }) => {
    try { return ok(await rpc('ssong_list_contracts', { p_entity_id: entity_id, p_fiscal_year: fiscal_year ?? null })); } catch (e) { return fail(e); }
  });

  server.registerTool('get_doc_send_status', {
    title: '문서발송 상태·등기번호',
    description: '문서발송 요청의 상태(미접수·진행중·발송완료·반송…)·발송일·등기번호(trackingNo). 거래처명 일부나 발송요청 id 로 찾습니다. 결재 승인 뒤 list_my_requests 의 createdIds 가 발송요청 id 입니다.',
    inputSchema: {
      company: z.string().optional().describe('거래처명 일부'),
      ids: z.array(uuid).max(50).optional().describe('발송요청 id'),
      limit: z.number().int().min(1).max(50).optional(),
    },
    annotations: { readOnlyHint: true },
  }, async ({ company, ids, limit }) => {
    try { return ok(await rpc('ssong_doc_send_status', { p_q: company ?? null, p_ids: ids ?? null, p_limit: limit ?? 20 })); } catch (e) { return fail(e); }
  });

  server.registerTool('list_my_requests', {
    title: '내 결재요청',
    description: '쏭비서가 올린 결재요청과 결과(대기·처리중·승인·반려, 승인자·시각, 반려 사유, 만들어진 행 id).',
    inputSchema: { status: z.enum(['대기', '처리중', '승인', '반려']).optional(), limit: z.number().int().min(1).max(100).optional() },
    annotations: { readOnlyHint: true },
  }, async ({ status, limit }) => {
    try { return ok(await rpc('ssong_my_requests', { p_status: status ?? null, p_limit: limit ?? 30 })); } catch (e) { return fail(e); }
  });

  // ── 결재 올리기 (바로 등록되지 않는다) ─────────────────
  server.registerTool('submit_sales_contract', {
    title: '매출계약 등록 결재 올리기',
    description: '매출계약 등록을 대표님 결재함에 올립니다. 바로 등록되지 않고, 대표님이 JAYTAX 「쏭비서 결재함」에서 승인해야 만들어집니다. 올리기 전에 대표님께 내용을 확인받으세요. 고치기·지우기는 할 수 없습니다(반려되면 다시 올림).',
    inputSchema: {
      client_name: z.string().min(1).describe('거래처명(결재함 요약에 씀)'),
      entity_id: uuid.describe('search_clients 의 entityId'),
      place_id: uuid.optional().describe('사업장 단위 계약이면 placeId'),
      team: z.enum(['감사team', 'taxteam']),
      category_code: z.string().describe('list_contract_categories 의 code'),
      category_etc_name: z.string().optional().describe('「기타」 유형의 신고대상명칭'),
      occurrence_unit: z.enum(['사업장', '법인', '개인']),
      billing_unit: z.enum(['사업장', '법인', '개인', '건']).optional(),
      billing_cycle: z.enum(['월', '분기', '반기', '연', '발생시', '건']),
      amount: z.number().min(0).describe('계약금액(원)'),
      includes_vat: z.boolean().optional().describe('금액에 부가세 포함'),
      includes_wht: z.boolean().optional(),
      advisory_type: z.enum(['일반', '전문']).optional(),
      fiscal_year: z.number().int().optional().describe('귀속연도'),
      cpa: z.string().optional().describe('담당 회계사. 비우면 거래처에서 이어받음'),
      staff_names: z.array(z.string()).max(10).optional().describe('함께 하는 직원 이름'),
      contract_date: ymd.optional(),
      start_date: ymd.optional(),
      end_date: ymd.optional().describe('비우면 종료 없는 계속계약'),
      billing_month: z.number().int().min(1).max(12).optional().describe('연 1회 계약의 청구월'),
      confirmed: z.boolean().optional().describe('false=미계약(예정). 날인본 도착 뒤 등록이면 true'),
      note: z.string().max(500).optional(),
      reason: z.string().max(1000).optional().describe('결재함에 보일 근거·메모(예: 날인본 도착 2026-11-20)'),
    },
  }, async (i) => {
    try {
      const errs = checkContract(i);
      if (errs.length) return fail(new Error(errs.join(' · ')));
      const cat = CATEGORIES.find((x) => x.code === i.category_code)!;
      const payload = {
        entityId: i.entity_id, placeId: i.place_id ?? null, team: i.team, categoryCode: i.category_code,
        categoryEtcName: i.category_etc_name, occurrenceUnit: i.occurrence_unit, billingUnit: i.billing_unit ?? null,
        billingCycle: i.billing_cycle, amount: i.amount, includesVat: i.includes_vat, includesWht: i.includes_wht,
        advisoryType: i.advisory_type ?? null, fiscalYear: i.fiscal_year ?? null, cpa: i.cpa,
        staffNames: i.staff_names, contractDate: i.contract_date ?? null, startDate: i.start_date ?? null,
        endDate: i.end_date ?? null, billingMonth: i.billing_month ?? null, confirmed: i.confirmed, note: i.note,
      };
      const title = `${i.client_name} · ${cat.label} · ${won(i.amount)}`;
      const id = await rpc<string>('ssong_submit', { p_kind: 'sales_contract', p_title: title, p_payload: payload, p_reason: i.reason ?? null });
      const phone = await notifyTelegram('sales_contract', title, i.reason);
      return ok({ requestId: id, status: '대기', title, phoneAlert: phone, next: '대표님이 JAYTAX ⚙ 관리 › 쏭비서 결재함에서 승인하면 등록됩니다. list_my_requests 로 결과를 봅니다.' });
    } catch (e) { return fail(e); }
  });

  server.registerTool('submit_doc_send', {
    title: '문서발송 의뢰 결재 올리기',
    description: '문서발송 의뢰(업무지원 > 문서발송관리 > + 새 발송요청)를 대표님 결재함에 올립니다. 바로 의뢰되지 않고 대표님 승인 뒤 만들어집니다. 수신자 주소·전화는 승인 때 JAYTAX 가 연락처에서 채웁니다. 첨부파일은 승인 뒤 문서발송관리에서 붙입니다.',
    inputSchema: {
      company_name: z.string().min(1).describe('수신 거래처명(결재함 요약에 씀)'),
      request_date: ymd.optional().describe('의뢰일자. 비우면 승인한 날'),
      requester: z.string().min(1).describe('의뢰인 이름(list_staff)'),
      work_type: z.enum(WORK_TYPES).describe('업무구분'),
      send_kind: z.enum(SEND_KINDS).describe('송부종류'),
      doc_name: z.string().max(200).optional().describe('문서명'),
      copies: z.number().int().min(1).max(50).optional().describe('발송부수(기본 1)'),
      seal_required: z.boolean().optional().describe('날인 필요'),
      deadline: z.enum(DEADLINES).describe('발송기한'),
      etc_request: z.string().max(500).optional().describe('기타요청'),
      recipients: z.array(z.object({ client_id: uuid, contact_id: uuid })).min(1).max(20).describe('search_contacts 의 clientId·contactId'),
      reason: z.string().max(1000).optional().describe('결재함에 보일 근거·메모'),
    },
  }, async (i) => {
    try {
      const payload = {
        requestDate: i.request_date, requester: i.requester, workType: i.work_type, sendKind: i.send_kind,
        docName: i.doc_name, copies: i.copies ?? 1, sealRequired: !!i.seal_required, deadline: i.deadline,
        etcRequest: i.etc_request, recipients: i.recipients.map((r) => ({ clientId: r.client_id, contactId: r.contact_id })),
      };
      const title = `${i.company_name} · ${i.send_kind}${i.doc_name ? ` «${i.doc_name}»` : ''} · ${i.work_type} · 수신 ${i.recipients.length}곳`;
      const id = await rpc<string>('ssong_submit', { p_kind: 'doc_send', p_title: title, p_payload: payload, p_reason: i.reason ?? null });
      const phone = await notifyTelegram('doc_send', title, i.reason);
      return ok({ requestId: id, status: '대기', title, phoneAlert: phone, next: '대표님 승인 뒤 발송요청이 만들어집니다. 등기번호는 get_doc_send_status 로 봅니다.' });
    } catch (e) { return fail(e); }
  });

  return server;
}
