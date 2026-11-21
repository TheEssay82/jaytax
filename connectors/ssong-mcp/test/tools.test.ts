import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkContract } from '../lib/tools.js';
import { secretFromHeaders } from '../lib/handler.js';
import { checkSecret } from '../lib/auth.js';
import { buildServer } from '../lib/tools.js';

test('매출유형 — 팀이 맞는 맨 아래 코드만 통과', () => {
  assert.deepEqual(checkContract({ team: '감사team', category_code: 'AUD.AUDIT' }), []);
  assert.match(checkContract({ team: 'taxteam', category_code: 'AUD.AUDIT' })[0], /감사team/);
  assert.match(checkContract({ team: '감사team', category_code: 'AUD.SVC' })[0], /코드가 없습니다/);
  assert.match(checkContract({ team: '감사team', category_code: 'AUD.SVC.FILING.ETC' })[0], /기타/);
  assert.match(checkContract({ team: '감사team', category_code: 'AUD.AUDIT', start_date: '2026-12-01', end_date: '2026-01-01' })[0], /앞입니다/);
});

test('비밀 — 헤더로만, 짧으면 전부 거절', () => {
  assert.equal(secretFromHeaders({ authorization: 'Bearer abc' }), 'abc');
  assert.equal(secretFromHeaders({ authorization: 'Bearerabc' }), 'abc');
  assert.equal(secretFromHeaders({ 'x-api-key': 'k' }), 'k');
  const prev = process.env.MCP_SECRET;
  process.env.MCP_SECRET = 'short';
  assert.equal(checkSecret('short'), false);
  process.env.MCP_SECRET = 'x'.repeat(40);
  assert.equal(checkSecret('x'.repeat(40)), true);
  assert.equal(checkSecret('y'.repeat(40)), false);
  process.env.MCP_SECRET = prev;
});

test('도구 — 고치기·지우기·취소·승인 도구가 없다', () => {
  const s = buildServer() as unknown as { _registeredTools: Record<string, unknown> };
  const names = Object.keys(s._registeredTools).sort();
  assert.deepEqual(names, [
    'about_jaytax', 'audit_watch', 'billing_watch', 'consult_history', 'daily_digest', 'engagement_status',
    'get_doc_send_status', 'invoice_requests', 'list_contract_categories', 'list_my_requests', 'list_sales_contracts',
    'list_staff', 'revenue_summary', 'search_clients', 'search_contacts', 'send_morning_briefing', 'submit_doc_send', 'submit_sales_contract',
  ]);
  for (const n of names) assert.doesNotMatch(n, /update|delete|cancel|approve|remove/);
});

test('텔레그램 — 결재 요약·메모·결재함 주소, 설정 없으면 건너뜀', async () => {
  const { telegramText, notifyTelegram } = await import('../lib/telegram.js');
  const t = telegramText('sales_contract', '명진산업개발 · 회계감사 · 1,000원', '날인본 도착');
  assert.match(t, /매출계약 등록/);
  assert.match(t, /명진산업개발 · 회계감사/);
  assert.match(t, /💬 날인본 도착/);
  assert.doesNotMatch(telegramText('doc_send', 'x', ''), /💬/);
  assert.match(t, /tab=ssong-inbox/);
  delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_CHAT_ID;
  assert.equal(await notifyTelegram('doc_send', 'x'), 'skipped');
});
