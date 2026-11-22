import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK_RULES, _resetRulesCache, pickSections, ssongRules } from '../lib/ssongRules.js';
import { buildProperties, chunks, progressPrefix, rowOf } from '../lib/notionLedger.js';
import { eventsFromIcs } from '../lib/gcal.js';
import { buildPersonalServer } from '../lib/personalTools.js';
import { TOODLEDO_TOOLSET, failedServer, mcpSetup, todayLine, withoutServer } from '../lib/tgChat.js';

test('규칙 — PC 전용 절은 빼고 권한·오늘 질문은 남긴다, 열쇠 없으면 기본 규칙', async () => {
  const md = '# 쏭비서\n\n## 권한\nA\n\n## 오늘·이번 주 질문\nB\n\n## 연결된 것\nC\n\n## 이 PC에서 주의할 것\nD\n';
  const t = pickSections(md);
  assert.match(t, /## 권한\nA/);
  assert.match(t, /## 오늘·이번 주 질문\nB/);
  assert.doesNotMatch(t, /연결된 것|이 PC/);
  _resetRulesCache();
  const prev = process.env.SSONG_GITHUB_TOKEN;
  delete process.env.SSONG_GITHUB_TOKEN;
  assert.deepEqual(await ssongRules(), { text: FALLBACK_RULES, source: 'fallback' });
  if (prev !== undefined) process.env.SSONG_GITHUB_TOKEN = prev;
});

test('장부 — 최근 경과는 맨 앞에 덧붙이고 원래 조각(서식)은 그대로', () => {
  const old = [
    { type: 'text', plain_text: '11-20 견적 보냄', text: { content: '11-20 견적 보냄', link: null }, annotations: { bold: true } },
    { type: 'mention', plain_text: '@페이지' },
  ];
  const p = buildProperties({ page_id: 'x', today: '2026-11-22', progress: '  날인본\n도착 ' }, old as never) as Record<string, { rich_text: { text: { content: string }; annotations?: unknown }[] }>;
  const rt = p['최근 경과'].rich_text;
  assert.equal(rt[0].text.content, '2026-11-22 사용자 확인: 날인본 도착 / ');
  assert.equal(rt[1].text.content, '11-20 견적 보냄');
  assert.deepEqual(rt[1].annotations, { bold: true });
  assert.equal(rt[2].text.content, '@페이지'); // 글자로 남긴다
  // 말하지 않은 칸은 건드리지 않는다
  assert.deepEqual(Object.keys(p), ['최근 경과']);
  const q = buildProperties({ page_id: 'x', today: '2026-11-22', next_deadline: null, stage: '④ 날인본 도착', status: '진행' }, []);
  assert.deepEqual(q['다음 마감'], { date: null });
  assert.deepEqual(q['상태'], { select: { name: '진행' } });
  assert.equal(chunks('a'.repeat(4500)).length, 3);
  assert.equal(progressPrefix('2026-11-22', 'x'), '2026-11-22 사용자 확인: x / ');
  const row = rowOf({ id: 'p1', url: '', properties: { 건: { type: 'title', title: [{ type: 'text', plain_text: '명진 기말' }] }, '다음 마감': { type: 'date', date: { start: '2026-12-01', end: null } }, 상태: { type: 'select', select: { name: '진행' } } } } as never);
  assert.equal(row.건, '명진 기말');
  assert.equal(row.다음마감, '2026-12-01');
  assert.equal(row.상태, '진행');
});

const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:test',
  'BEGIN:VTIMEZONE', 'TZID:Asia/Seoul', 'BEGIN:STANDARD', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:KST', 'DTSTART:19700101T000000', 'END:STANDARD', 'END:VTIMEZONE',
  // 한 번짜리 시각 일정(UTC 로 적힘 → 한국 10시)
  'BEGIN:VEVENT', 'UID:a', 'SUMMARY:[임시/기말] 명진', 'DTSTART:20261123T010000Z', 'DTEND:20261123T020000Z', 'LOCATION:회사', 'ATTENDEE:mailto:x@y.z', 'END:VEVENT',
  // 종일 이틀
  'BEGIN:VEVENT', 'UID:b', 'SUMMARY:중간감사', 'DTSTART;VALUE=DATE:20261124', 'DTEND;VALUE=DATE:20261126', 'END:VEVENT',
  // 매주 월요일 9시, 11/30 회차는 11시로 옮김, 범위 밖 일정
  'BEGIN:VEVENT', 'UID:c', 'SUMMARY:주간회의', 'DTSTART;TZID=Asia/Seoul:20261102T090000', 'DTEND;TZID=Asia/Seoul:20261102T100000', 'RRULE:FREQ=WEEKLY', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:c', 'RECURRENCE-ID;TZID=Asia/Seoul:20261130T090000', 'SUMMARY:주간회의(변경)', 'DTSTART;TZID=Asia/Seoul:20261130T110000', 'DTEND;TZID=Asia/Seoul:20261130T120000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:d', 'SUMMARY:취소됨', 'STATUS:CANCELLED', 'DTSTART:20261123T050000Z', 'DTEND:20261123T060000Z', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('캘린더 — 한국 시각·종일·반복·예외·취소', () => {
  const ev = eventsFromIcs(ICS, '인덕업무', '2026-11-23', '2026-11-30');
  assert.deepEqual(ev.map((e) => `${e.start}|${e.end}|${e.title}`), [
    '2026-11-24|2026-11-25|중간감사',
    '2026-11-23 09:00|2026-11-23 10:00|주간회의',
    '2026-11-23 10:00|2026-11-23 11:00|[임시/기말] 명진',
    '2026-11-30 11:00|2026-11-30 12:00|주간회의(변경)',
  ].sort());
  assert.equal(ev.find((e) => e.title === '중간감사')!.allDay, true);
  assert.equal(ev.find((e) => e.title.startsWith('[임시'))!.location, '회사');
  assert.ok(!JSON.stringify(ev).includes('mailto')); // 참석자는 내보내지 않는다
});

test('연결 — Toodledo 는 열쇠 있을 때만, 영구 삭제는 끔 / 개인 도구 3개', () => {
  const off = mcpSetup({ MCP_SECRET: 's' });
  assert.deepEqual(off.servers.map((s) => s.name), ['jaytax', 'personal']);
  assert.ok(off.servers[1].url.endsWith('/personal'));
  const on = mcpSetup({ MCP_SECRET: 's', TOODLEDO_MCP_SECRET: 't' });
  assert.deepEqual(on.servers.map((s) => s.name), ['jaytax', 'personal', 'toodledo']);
  assert.equal(on.servers[2].authorization_token, 't');
  assert.equal(on.toolsets.length, 3);
  assert.deepEqual(TOODLEDO_TOOLSET.configs, { delete_tasks: { enabled: false } });
  const tools = Object.keys((buildPersonalServer() as unknown as { _registeredTools: Record<string, unknown> })._registeredTools).sort();
  assert.deepEqual(tools, ['calendar_events', 'ledger_list', 'ledger_update']);
  assert.match(todayLine(new Date('2026-11-22T03:00:00Z')), /^오늘은 2026-11-22\(일\) 한국 시각 12:00/);
});

test('연결 실패 — 거절한 곳만 빼고 다시, JAYTAX 는 안 뺀다', () => {
  const names = ['jaytax', 'personal', 'toodledo'];
  assert.equal(failedServer(new Error('400 Connection error while communicating with MCP server toodledo'), names), 'toodledo');
  assert.equal(failedServer(new Error('400 MCP server personal returned 404'), names), 'personal');
  assert.equal(failedServer(new Error('400 MCP server jaytax returned 404'), names), null);
  assert.equal(failedServer(new Error('529 overloaded'), names), null);
  const on = mcpSetup({ MCP_SECRET: 's', TOODLEDO_MCP_SECRET: 't' });
  const w = withoutServer(on.servers, on.toolsets, 'toodledo');
  assert.deepEqual(w.servers.map((s) => s.name), ['jaytax', 'personal']);
  assert.equal(w.toolsets.length, 2);
});
