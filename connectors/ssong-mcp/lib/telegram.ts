// 결재를 올리면 대표님 핸드폰(텔레그램)으로 알린다(2026-11-21 대표님 요청).
//
// 텔레그램은 외부 회사다 — 거래처명·금액 같은 업무 내용은 보내지 않고
// 「결재 1건이 올라왔다」와 결재함 주소만 보낸다(개인정보 요건). 내용은 JAYTAX 에서 본다.
// 봇 토큰·대화방 번호는 서버 환경변수에만 둔다. 둘 중 하나라도 없으면 조용히 건너뛴다.
// 알림이 실패해도 결재 올리기는 실패시키지 않는다.

const KIND_LABEL: Record<string, string> = { sales_contract: '매출계약 등록', doc_send: '문서발송 의뢰' };
const INBOX_URL = 'https://www.jaytax.co.kr/?tab=ssong-inbox';

export function telegramText(kind: string): string {
  return `🤖 쏭비서 결재 1건 · ${KIND_LABEL[kind] ?? kind}\nJAYTAX 쏭비서 결재함에서 승인·반려해 주세요.\n${INBOX_URL}`;
}

export async function notifyTelegram(kind: string): Promise<'sent' | 'skipped' | 'failed'> {
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID ?? '').trim();
  if (!token || !chatId) return 'skipped';
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: telegramText(kind), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) { console.warn('telegram failed', res.status); return 'failed'; }
    return 'sent';
  } catch (e) {
    // 토큰이 들어간 주소를 남기지 않게 메시지만.
    console.warn('telegram failed', e instanceof Error ? e.name : 'error');
    return 'failed';
  }
}
