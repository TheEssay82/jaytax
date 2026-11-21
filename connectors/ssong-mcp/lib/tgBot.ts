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
import { askSsong, chatEnabled } from './tgChat.js';

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

async function reply(chatId: number | string, text: string) {
  for (const part of splitMessage(text)) {
    await tg('sendMessage', { chat_id: chatId, text: part, disable_web_page_preview: true, reply_markup: KEYBOARD });
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
  '앞 답에 이어 물으려면 그 메시지를 길게 눌러 「답장」으로 보내 주세요.',
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
export async function handleUpdate(update: any): Promise<'ignored' | 'report' | 'chat' | 'help' | 'off'> {
  const msg = update?.message;
  const chatId = msg?.chat?.id;
  const allowed = (process.env.TELEGRAM_CHAT_ID ?? '').trim();
  if (!msg || !allowed || String(chatId) !== allowed) return 'ignored';
  if (!firstTime(update.update_id ?? `${chatId}:${msg.message_id}`)) { console.warn('telegram duplicate', update.update_id); return 'ignored'; }
  console.log('telegram update', update.update_id, msg.message_id);
  const text: string = typeof msg.text === 'string' ? msg.text : '';
  if (!text.trim()) { await reply(chatId, '글로 보내 주세요. 음성은 핸드폰 키보드의 🎤 받아쓰기를 쓰시면 됩니다.'); return 'help'; }
  if (/^\/(start|menu|help)\b/i.test(text.trim())) { await reply(chatId, HELP); return 'help'; }

  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
  const key = reportOf(text);
  if (key) {
    try { await reply(chatId, await runReport(key)); }
    catch (e) { await reply(chatId, `JAYTAX 를 읽지 못했습니다: ${e instanceof Error ? e.message : '오류'}`); }
    return 'report';
  }
  if (!chatEnabled()) {
    await reply(chatId, '말로 묻기는 아직 꺼져 있습니다(Claude API 키 없음). 아래 단추로 보고를 받아 보세요.');
    return 'off';
  }
  try {
    const replyTo = msg.reply_to_message?.from?.is_bot ? (msg.reply_to_message.text ?? null) : null;
    await reply(chatId, await askSsong({ text, replyTo }));
  } catch (e) {
    console.error('chat failed', e instanceof Error ? e.message : e);
    await reply(chatId, '지금 답을 만들지 못했습니다. 잠시 뒤 다시 물어봐 주세요. (단추 보고는 계속 됩니다)');
  }
  return 'chat';
}
