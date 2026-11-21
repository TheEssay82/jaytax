import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtAudit, fmtDigest, fmtReceivables, fmtRevenue, money, seoulToday } from '../lib/tgReports.js';
import { firstTime, handleUpdate, reportOf, splitMessage, webhookSecretOk } from '../lib/tgBot.js';
import { toolsetFor } from '../lib/tgChat.js';

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

test('결재 올리기 — 답장일 때만 켜지고, 같은 메시지는 한 번만', () => {
  assert.deepEqual(toolsetFor(false).configs, { submit_sales_contract: { enabled: false }, submit_doc_send: { enabled: false } });
  assert.equal(toolsetFor(true).configs, undefined);
  assert.equal(firstTime(9001), true);
  assert.equal(firstTime(9001), false);
  assert.equal(firstTime(9002), true);
});
