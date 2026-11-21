// 텔레그램에서 쏭비서에게 묻기(대표님 2026-11-21 「버튼형·대화형 둘 다」).
//
//   · 입력창 아래 단추 4개 → AI 없이 바로 보고(tgReports, 비용 없음)
//   · 그 밖의 글 → Claude 대화(tgChat, ANTHROPIC_API_KEY 가 있을 때만)
//
// 지키는 것
//   · 웹훅 비밀(TELEGRAM_WEBHOOK_SECRET)이 맞는 요청만 받는다 — 텔레그램이 헤더로 붙여 보낸다.
//   · 대표님 대화방(TELEGRAM_CHAT_ID)에서 온 메시지만 답한다. 다른 사람이 봇에 말을 걸면 아무 답도 하지 않는다.
//   · 읽기는 쏭비서와 같은 ssong_* 함수로만 → 접속기록에 「쏭비서」로 남는다. 승인·고치기·지우기는 없다.
import { timingSafeEqual, createHash } from 'node:crypto';
import { REPORTS, isReportKey, runReport, type ReportKey } from './tgReports.js';
import { askSsong, chatEnabled, splitConfirm, type Turn } from './tgChat.js';

const LIMIT = 4000; // 텔레그램 한 메시지 4096자

export const KEYBOARD = {
  keyboard: [
    [{ text: REPORTS.today }, { text: REPORTS.revenue }],
    [{ text: REPORTS.ar }, { text: REPORTS.audit }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

export function webhookSecretOk(given: string | string[] | undefined): boolean {
  const expected = (process.env.TELEGRAM_WEBHOOK_SECRET ?? '').trim();
  const g = Array.isArray(given) ? given[0] : given;
  if (expected.length < 16 || !g) return false;
  const h = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(g), h(expected));
}

/** 줄 단위로 4000자 안쪽 조각으로 나눈다. */
export function splitMessage(text: string, limit = LIMIT): string[] {
  const parts: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    const add = cur ? `${cur}\n${line}` : line;
    if (add.length <= limit) { cur = add; continue; }
    if (cur) parts.push(cur);
    let rest = line;
    while (rest.length > limit) { parts.push(rest.slice(0, limit)); rest = rest.slice(limit); }
    cur = rest;
  }
  if (cur) parts.push(cur);
  return parts.length ? parts : [''];
}

async function tg(method: string, body: Record<string, unknown>): Promise<void> {
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!token) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) console.warn('telegram', method, res.status);
  } catch (e) {
    console.warn('telegram', method, e instanceof Error ? e.name : 'error'); // 토큰 든 주소는 남기지 않는다
  }
}

export const CONFIRM_KEYBOARD = {
  inline_keyboard: [[{ text: '✅ 이대로 결재 올리기', callback_data: 'ssong:ok' }, { text: '그만', callback_data: 'ssong:no' }]],
};

/** 보낸다. confirm 이면 마지막 조각 밑에 ✅ 단추를 붙인다. */
async function reply(chatId: number | string, text: string, confirm = false) {
  const parts = splitMessage(text);
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    await tg('sendMessage', {
      chat_id: chatId, text: parts[i], disable_web_page_preview: true,
      reply_markup: confirm && last ? CONFIRM_KEYBOARD : KEYBOARD,
    });
  }
}

// 짧은 대화 기억 — 같은 서버 인스턴스가 살아 있는 동안 최근 8마디·30분만(서버가 바뀌면 잊는다).
// 「답장」으로 보낸 글은 그 쏭비서 메시지를 확실히 이어받는다.
const MEMORY_TURNS = 8;
const MEMORY_MS = 30 * 60_000;
const memory = new Map<string, { at: number; turns: Turn[] }>();
export function recall(chatId: string): Turn[] {
  const m = memory.get(chatId);
  if (!m || Date.now() - m.at > MEMORY_MS) { memory.delete(chatId); return []; }
  return m.turns;
}
export function remember(chatId: string, ...turns: Turn[]) {
  memory.set(chatId, { at: Date.now(), turns: [...recall(chatId), ...turns].slice(-MEMORY_TURNS) });
}
export function forget(chatId: string) { memory.delete(chatId); }

async function chat(chatId: string, text: string, history: Turn[], allowSubmit: boolean) {
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
  try {
    const { text: answer, confirm } = splitConfirm(await askSsong({ text, history, allowSubmit }));
    remember(chatId, { role: 'user', text }, { role: 'assistant', text: answer });
    await reply(chatId, answer, confirm && !allowSubmit);
  } catch (e) {
    console.error('chat failed', e instanceof Error ? e.message : e);
    await reply(chatId, '지금 답을 만들지 못했습니다. 잠시 뒤 다시 물어봐 주세요. (단추 보고는 계속 됩니다)');
  }
}

/** 단추 글자 또는 /today 같은 명령을 보고 종류로. */
export function reportOf(text: string): ReportKey | null {
  const t = text.trim();
  for (const [k, label] of Object.entries(REPORTS)) if (t === label) return k as ReportKey;
  const cmd = /^\/([a-z]+)(@\w+)?$/i.exec(t)?.[1]?.toLowerCase();
  return cmd && isReportKey(cmd) ? cmd : null;
}

const HELP = [
  '🤖 쏭비서입니다.',
  '아래 단추를 누르면 바로 보고드립니다(무료).',
  '그 밖에는 말로 물어보세요. 예: 「명진 올해 계약 얼마야?」, 「알티스트 조회서 어디까지 왔어?」',
  '결재를 올리라고 하시면 요약을 먼저 보여 드리고, 「✅ 이대로 결재 올리기」를 누르셔야 한 건 올라갑니다.',
].join('\n');

// 같은 텔레그램 메시지를 두 번 처리하지 않는다(2026-11-21 시험 때 한 지시로 결재 2건이 올라옴).
// 같은 서버 인스턴스 안에서만 막는다 — 다른 인스턴스로 간 중복은 로그(update_id)로 확인한다.
const seen = new Map<string, number>();
export function firstTime(id: unknown): boolean {
  if (id === undefined || id === null) return true;
  const k = String(id); const now = Date.now();
  for (const [key, t] of seen) if (now - t > 10 * 60_000) seen.delete(key);
  if (seen.has(k)) return false;
  seen.set(k, now);
  return true;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function handleCallback(cq: any, allowed: string): Promise<'ignored' | 'chat'> {
  const chatId = cq?.message?.chat?.id;
  if (String(chatId) !== allowed || String(cq?.from?.id) !== allowed) return 'ignored';
  await tg('answerCallbackQuery', { callback_query_id: cq.id });
  if (!firstTime(`cb:${cq.id}`) || !firstTime(`cbmsg:${cq.message.message_id}`)) return 'ignored';
  // 단추를 바로 지워 두 번 누를 수 없게 한다.
  await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } });
  const summary: string = cq.message.text ?? '';
  if (cq.data !== 'ssong:ok') {
    remember(String(chatId), { role: 'assistant', text: summary }, { role: 'user', text: '그만. 올리지 마.' }, { role: 'assistant', text: '올리지 않았습니다.' });
    await reply(chatId, '올리지 않았습니다.');
    return 'chat';
  }
  if (!chatEnabled()) { await reply(chatId, '말로 묻기가 꺼져 있어 결재를 올리지 못했습니다.'); return 'chat'; }
  await chat(String(chatId), '네, 위 요약 그대로 결재 한 건 올려 주세요.', [{ role: 'assistant', text: summary }], true);
  return 'chat';
}

export async function handleUpdate(update: any): Promise<'ignored' | 'report' | 'chat' | 'help' | 'off'> {
  const allowed = (process.env.TELEGRAM_CHAT_ID ?? '').trim();
  if (!allowed) return 'ignored';
  if (update?.callback_query) return handleCallback(update.callback_query, allowed);
  const msg = update?.message;
  const chatId = msg?.chat?.id;
  if (!msg || String(chatId) !== allowed) return 'ignored';
  if (!firstTime(update.update_id ?? `${chatId}:${msg.message_id}`)) { console.warn('telegram duplicate', update.update_id); return 'ignored'; }
  console.log('telegram update', update.update_id, msg.message_id);
  const text: string = typeof msg.text === 'string' ? msg.text : '';
  if (!text.trim()) { await reply(chatId, '글로 보내 주세요. 음성은 핸드폰 키보드의 🎤 받아쓰기를 쓰시면 됩니다.'); return 'help'; }
  if (/^\/(start|menu|help)\b/i.test(text.trim())) { forget(String(chatId)); await reply(chatId, HELP); return 'help'; }

  const key = reportOf(text);
  if (key) {
    await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
    try { await reply(chatId, await runReport(key)); }
    catch (e) { await reply(chatId, `JAYTAX 를 읽지 못했습니다: ${e instanceof Error ? e.message : '오류'}`); }
    return 'report';
  }
  if (!chatEnabled()) {
    await reply(chatId, '말로 묻기는 아직 꺼져 있습니다(Claude API 키 없음). 아래 단추로 보고를 받아 보세요.');
    return 'off';
  }
  // 「답장」으로 찍은 쏭비서 메시지가 기억에 없으면(서버가 바뀐 경우) 그것을 앞 대화로 쓴다.
  let history = recall(String(chatId));
  const quoted: string | null = msg.reply_to_message?.from?.is_bot ? (msg.reply_to_message.text ?? null) : null;
  if (quoted && !history.some((t) => t.role === 'assistant' && t.text === quoted)) history = [{ role: 'assistant', text: quoted }];
  await chat(String(chatId), text, history, false);
  return 'chat';
}
