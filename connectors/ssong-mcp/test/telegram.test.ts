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
  assert.deepEqual(Object.keys(TOOLSET.configs ?? {}).sort(), ['submit_doc_send', 'submit_invoice_request', 'submit_sales_contract']);
  const defs = await submitToolDefs();
  assert.deepEqual(defs.map((d) => d.name).sort(), ['submit_doc_send', 'submit_invoice_request', 'submit_sales_contract']);
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

test('아침 브리핑 — 기간·모양·크론 비밀', async () => {
  const { digestRange, fmtBriefing } = await import('../lib/tgBriefing.js');
  const { cronOk } = await import('../api/briefing.js');
  assert.deepEqual(digestRange('2026-11-23'), { from: '2026-11-20', to: '2026-11-22' }); // 월요일 → 금~일
  assert.deepEqual(digestRange('2026-11-24'), { from: '2026-11-23', to: '2026-11-23' });
  const text = fmtBriefing('2026-11-23',
    { newContracts: [{ company: '님블뉴런', amount: 6000000 }], docSends: [], invoicesIssued: [], receipts: [], confirmationsCollected: [], auditIssues: [] },
    { schedule: { days: [{ day: '2026-11-23', company: '알티스트', entityId: 'e1', task: '기말감사', staff: ['김준성'] },
                         { day: '2026-11-27', company: '명진', entityId: 'e2', task: '중간감사' }] },
      openIssues: [{ company: '알티스트', entityId: 'e1', no: 3, title: '손상검토', decisionNeeded: true, importance: '높음' },
        { company: '명진', entityId: 'e2', no: 1, title: '재고', decisionNeeded: true },
        { company: '명진', entityId: 'e2', no: 2, title: '판단 안 함', decisionNeeded: false },
        { company: '더그림', entityId: 'e9', no: 4, title: '일정 없음', decisionNeeded: true }],
      confirmationsOutstanding: [{ notCollected: 2 }, { notCollected: 0 }] },
    { receivables: { asOfLedger: '2026-10', overdue: [{ balance: 500000 }, { balance: 700000 }] } },
    [{ title: '명진산업개발㈜ · 계약서 «감사계약서»' }]);
  assert.match(text, /^🌅 아침 브리핑 · 11\/23\(월\)/);
  assert.match(text, /결재 대기 1건[^\n]*\n• 명진산업개발/);
  assert.match(text, /오늘 감사 일정 1건\n• 알티스트 기말감사 \(김준성\)/);
  assert.match(text, /11\/20~11\/22 생긴 일\n🆕 새 계약 1건 600만: 님블뉴런 600만/);
  assert.match(text, /1주 안 감사 회사의 판단 필요 이슈 2건\n• 알티스트 #3 손상검토 \(중요\)\n• 명진 #1 재고/);
  assert.match(text, /오늘 감사 일정 1건\n/);
  assert.doesNotMatch(text, /더그림|판단 안 함|명진 중간감사/);
  const none = fmtBriefing('2026-11-23', {}, { schedule: { days: [] },
    openIssues: [{ company: '더그림', entityId: 'e9', no: 4, title: '일정 없음', decisionNeeded: true }] }, {}, []);
  assert.doesNotMatch(none, /🧭/);
  assert.doesNotMatch(none, /금감원/);   // 금감원 새 자료 0건이면 줄을 넣지 않는다
  const withFss = fmtBriefing('2026-11-23', {}, { schedule: { days: [] } }, {}, [],
    { count: 4, items: [{ kind: 'kifrs', subject: '리스 변경' }, { kind: 'insp', subject: '수익인식 진행기준' }, { kind: 'audfaq', subject: '조회서' }] });
  assert.match(withFss, /📰 금감원 새 회계자료 4건: \[K-IFRS 질의회신\] 리스 변경 \/ \[감리지적\] 수익인식 진행기준 \/ \[외감 FAQ\] 조회서 외 1/);
  assert.doesNotMatch(fmtBriefing('2026-11-23', {}, {}, {}, [], { count: 0, items: [] }), /금감원/);
  assert.match(text, /조회서 남은 회사 2곳 \(미회수 2건\)\n🧾 90일 넘은 미수금 2건 120만/);
  const prev = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'c'.repeat(32);
  assert.equal(cronOk(`Bearer ${'c'.repeat(32)}`), true);
  assert.equal(cronOk('Bearer nope'), false);
  assert.equal(cronOk(undefined), false);
  process.env.CRON_SECRET = 'short';
  assert.equal(cronOk('Bearer short'), false);
  process.env.CRON_SECRET = prev;
});

test('아침 브리핑 — 웍스 요약을 위에 합친다', async () => {
  const { mergeBriefing } = await import('../lib/tgBriefing.js');
  assert.equal(mergeBriefing('🌅 JAYTAX', null), '🌅 JAYTAX');
  assert.equal(mergeBriefing('🌅 JAYTAX', '  '), '🌅 JAYTAX');
  assert.match(mergeBriefing('🌅 JAYTAX', '• 메일 3통'), /^📬 네이버웍스 \(메일·일정·연차·회의\)\n• 메일 3통\n\n────────\n🌅 JAYTAX$/);
});

test('문서발송 진행 알림 — 열쇠 해시로만, 글 모양', async () => {
  const { createHash } = await import('node:crypto');
  const { notifyAuthOk, docSendText, handleDocSendEvent } = await import('../lib/notify.js');
  const prev = process.env.SSONG_DB_KEY;
  process.env.SSONG_DB_KEY = 'k'.repeat(64);
  const good = createHash('sha256').update('k'.repeat(64)).digest('hex');
  assert.equal(notifyAuthOk(good), true);
  assert.equal(notifyAuthOk(good.toUpperCase()), true);
  assert.equal(notifyAuthOk('0'.repeat(64)), false);
  assert.equal(notifyAuthOk(undefined), false);
  process.env.SSONG_DB_KEY = prev;
  const t = docSendText({ kind: 'doc_send', id: 'x', company: '명진산업개발㈜', sendKind: '계약서', docName: '감사계약서', status: '발송완료', sentDate: '2026-11-24', trackingNo: '18990-5111-8259', viaSsong: true });
  assert.equal(t, '📮 발송 진행 (쏭비서 결재건)\n명진산업개발㈜ · 계약서 «감사계약서»\n✅ 발송완료 (11/24)\n등기번호 18990-5111-8259\n조회: https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=1899051118259');
  assert.equal(docSendText({ kind: 'doc_send', id: 'x', company: 'A', sendKind: '기타', status: '진행중' }), '📮 발송 진행\nA · 기타\n⏳ 진행중');
  assert.equal(await handleDocSendEvent({ kind: 'doc_send', id: 'not-a-uuid' }), 'bad');
});

test('세금계산서 발행의뢰 — 확인 요약', async () => {
  const { previewOf } = await import('../lib/tgSubmit.js');
  const t = previewOf({ tool: 'submit_invoice_request', args: { client_name: '평안정공㈜', team: '감사team', phase: '잔금', erp_account: '회계감사수입', supply_amount: 7000000, summary: '2026년 회계감사 잔금', issue_date: '2026-12-15' } });
  assert.equal(t, '🧾 세금계산서 발행의뢰 결재\n• 거래처: 평안정공㈜ (감사팀)\n• 구분: 잔금 · ERP 회계감사수입\n• 공급가액: 7,000,000원 (부가세 700,000원, 합계 7,700,000원)\n• 적요: 2026년 회계감사 잔금\n• 발행일: 2026-12-15\n• 청구서(서면): 없음\n• 받는 메일: 승인 때 거래처정보에서');
});
