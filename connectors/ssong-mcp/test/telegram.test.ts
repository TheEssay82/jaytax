import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtAudit, fmtDigest, fmtReceivables, fmtRevenue, money, seoulToday } from '../lib/tgReports.js';
import { firstTime, forget, handleUpdate, recall, remember, reportOf, splitMessage, webhookSecretOk } from '../lib/tgBot.js';
import { TOOLSET, pendingOf, toMessages } from '../lib/tgChat.js';
import { previewOf, runSubmit, submitToolDefs } from '../lib/tgSubmit.js';

test('결재 제안 — submit_* 호출을 꺼내 실제 올릴 값으로 요약', async () => {
  const blocks = [
    { type: 'text', text: '확인했습니다.', citations: null },
    { type: 'tool_use', id: 't1', name: 'submit_doc_send', input: { company_name: '명진산업개발㈜', requester: '정우철', work_type: '우체국', send_kind: '계약서', doc_name: '감사계약서', deadline: '보통', recipients: [{ client_id: 'a', contact_id: 'b' }] } },
    { type: 'tool_use', id: 't2', name: 'submit_doc_send', input: { company_name: '두 번째' } },
  ] as unknown as Parameters<typeof pendingOf>[0];
  const p = pendingOf(blocks)!;
  assert.equal(p.tool, 'submit_doc_send');
  assert.equal(p.args.company_name, '명진산업개발㈜'); // 여러 개여도 첫 하나만
  assert.match(previewOf(p), /거래처: 명진산업개발㈜\n• 송부종류: 계약서 · 문서명 감사계약서\n• 업무구분: 우체국 · 발송기한 보통\n• 발송부수: 1부 · 날인: 없음\n• 기타요청: 없음\n• 수신: 1곳\n• 의뢰인: 정우철/);
  // 날인·부수 세부는 늘 보인다
  assert.match(previewOf({ tool: 'submit_doc_send', args: { ...p.args, copies: 1, seal_required: true, etc_request: '2부 날인 후 1부 발송, 1부 보관' } }),
    /발송부수: 1부 · 날인: 필요\n• 기타요청: 2부 날인 후 1부 발송, 1부 보관/);
  assert.equal(pendingOf([blocks[0]]), null);
  // MCP 쪽 submit 은 늘 꺼짐, 대신 같은 모양의 클라이언트 도구 2개
  assert.deepEqual(Object.keys(TOOLSET.configs ?? {}).sort(), ['submit_doc_send', 'submit_sales_contract']);
  const defs = await submitToolDefs();
  assert.deepEqual(defs.map((d) => d.name).sort(), ['submit_doc_send', 'submit_sales_contract']);
  assert.ok((defs[0].input_schema as { properties?: object }).properties);
  // 서버 쪽 검사는 그대로 — 모양이 틀리면 올라가지 않는다
  const bad = await runSubmit({ tool: 'submit_doc_send', args: { company_name: 'x' } });
  assert.equal(bad.ok, false);
});

test('짧은 기억', () => {
  const m = toMessages([{ role: 'assistant', text: '요약' }], '네');
  assert.deepEqual(m.map((x) => x.role), ['user', 'assistant', 'user']);
  assert.deepEqual(toMessages([{ role: 'user', text: 'a' }, { role: 'user', text: 'b' }], 'c'), [{ role: 'user', content: 'a\nb\nc' }]);
  forget('7');
  remember('7', { role: 'user', text: 'q' }, { role: 'assistant', text: 'a' });
  assert.equal(recall('7').length, 2);
  for (let i = 0; i < 10; i++) remember('7', { role: 'user', text: String(i) });
  assert.equal(recall('7').length, 8);
});

test('✅ 단추 — 대표님 대화방에서만, 같은 메시지 두 번 안 됨', async () => {
  const prev = { ...process.env };
  process.env.TELEGRAM_CHAT_ID = '111';
  delete process.env.TELEGRAM_BOT_TOKEN;
  const cb = (id: string, from: number, mid: number) => ({ callback_query: { id, data: 'ssong:no', from: { id: from }, message: { message_id: mid, chat: { id: 111 }, text: '요약' } } });
  assert.equal(await handleUpdate(cb('x', 222, 5)), 'ignored');
  assert.equal(await handleUpdate(cb('y', 111, 6)), 'chat');
  assert.equal(await handleUpdate(cb('y2', 111, 6)), 'ignored');
  process.env = prev;
});

test('금액 — 억·만으로 짧게', () => {
  assert.equal(money(959300000), '9.59억');
  assert.equal(money(200000000), '2억');
  assert.equal(money(36410000), '3,641만');
  assert.equal(money(5000), '5,000원');
});

test('정산연도 — 7월부터 그 해', () => {
  assert.equal(seoulToday(new Date('2026-11-21T00:00:00Z')).fy, 2026);
  assert.equal(seoulToday(new Date('2027-03-01T00:00:00Z')).fy, 2026);
  assert.equal(seoulToday(new Date('2026-06-30T16:00:00Z')).ymd, '2026-07-01'); // 한국 시각
});

test('단추 보고 — DB 응답 모양 그대로 적는다', () => {
  const d = fmtDigest({
    period: { from: '2026-11-20', to: '2026-11-21' },
    newContracts: [{ company: '님블뉴런', amount: 6000000, team: '감사team', cpa: '정우철' }],
    invoicesIssued: [], receipts: [], confirmationsCollected: [], auditIssues: [], invoiceRequestsNew: 0,
    docSends: [{ company: '㈜폴라리스세원', kind: '계약서', status: '발송완료', trackingNo: '18990-5111-8261' }],
    ssongDecisions: [{ status: '반려', title: '명진산업개발 · 회계감사 · 0원', note: '시험반려' }],
  });
  assert.match(d, /새 매출계약 1건\n• 님블뉴런 600만 \(감사팀·정우철\)/);
  assert.match(d, /18990-5111-8261/);
  assert.doesNotMatch(d, /수금/);

  const r = fmtRevenue({
    contracts: { byTeam: { 감사team: { count: 57, amount: 959300000, unconfirmed: 0 }, taxteam: { count: 151, amount: 197627272.73, unconfirmed: 78 } },
      byCompany: [{ company: '윤성에프앤씨', amount: 235000000, team: '감사team' }] },
    issued: { byTeam: { 감사team: 202050000 } },
  }, 2026);
  assert.match(r, /감사팀 9\.59억 \(57건\)/);
  assert.match(r, /기장팀 1\.98억 \(151건, 미확정 78\)/);
  assert.match(r, /1\. 윤성에프앤씨 2\.35억/);

  const b = fmtReceivables({
    month: '2026-11',
    receivables: { asOfLedger: '2026-10', totalByTeam: { 감사team: 112090000 },
      overdue: [
        { company: '이귀남외1', team: 'taxteam', balance: 500000, days: 1639 },
        { company: '이귀남외1', team: 'taxteam', balance: 700000, days: 904 },
      ] },
    invoiceRequests: { byStatus: { 발행완료: { count: 2, supply: 15000000 } } },
  });
  assert.match(b, /90일 넘은 것 2건 · 거래처 1곳/);
  assert.match(b, /이귀남외1 120만 \(기장팀, 최장 1639일, 2건\)/);

  const a = fmtAudit({
    schedule: { from: '2026-11-21', to: '2026-11-27', days: [] },
    confirmationsOutstanding: [{ company: '로이비쥬얼', notSent: 9, notCollected: 0, accountant: '김준성' }],
    openIssues: [{ company: '알티스트', no: 3, title: '손상검토', importance: '높음', decisionNeeded: true },
      { company: '알티스트', no: 1, title: 'MLA', importance: '낮음', decisionNeeded: false }],
  });
  assert.match(a, /일정 없음/);
  assert.match(a, /미결 감사이슈 2건 · 판단 필요\/중요 1건\n• 알티스트 #3 손상검토/);
});

test('단추·명령 알아보기, 긴 글 나누기', () => {
  assert.equal(reportOf('💰 올해 매출'), 'revenue');
  assert.equal(reportOf('/ar'), 'ar');
  assert.equal(reportOf('/today@ssong_bot'), 'today');
  assert.equal(reportOf('매출 알려줘'), null);
  const parts = splitMessage(Array.from({ length: 300 }, (_, i) => `줄 ${i} ${'가'.repeat(30)}`).join('\n'));
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 4000));
});

test('웹훅 비밀·대표님 대화방만', async () => {
  const prev = { ...process.env };
  process.env.TELEGRAM_WEBHOOK_SECRET = 's'.repeat(32);
  assert.equal(webhookSecretOk('s'.repeat(32)), true);
  assert.equal(webhookSecretOk('t'.repeat(32)), false);
  assert.equal(webhookSecretOk(undefined), false);
  process.env.TELEGRAM_WEBHOOK_SECRET = 'short';
  assert.equal(webhookSecretOk('short'), false);

  process.env.TELEGRAM_CHAT_ID = '111';
  delete process.env.TELEGRAM_BOT_TOKEN; // 실제로 보내지 않는다
  assert.equal(await handleUpdate({ message: { chat: { id: 222 }, text: '/ar' } }), 'ignored');
  assert.equal(await handleUpdate({}), 'ignored');
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(await handleUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 111 }, text: '매출 알려줘' } }), 'off');
  assert.equal(await handleUpdate({ update_id: 2, message: { message_id: 2, chat: { id: 111 }, text: '/start' } }), 'help');
  process.env = prev;
});

test('같은 메시지는 한 번만', () => {
  assert.equal(firstTime(9001), true);
  assert.equal(firstTime(9001), false);
  assert.equal(firstTime(9002), true);
});
