// 결재를 올리면 대표님 핸드폰(텔레그램)으로 알린다(2026-11-21 대표님 요청).
//
// 처음에는 업무 내용 없이 결재함 주소만 보냈으나, 대표님이 「거래처명 등을 노출해 달라」고
// 정했다(2026-11-21). 결재 요약(거래처·유형·금액 등)과 쏭비서 메모를 함께 보낸다.
// 전화·주소·주민번호 같은 것은 요약에 들어가지 않는다(애초에 쏭비서가 받지 않는다).
// 봇 토큰·대화방 번호는 서버 환경변수에만 둔다. 둘 중 하나라도 없으면 조용히 건너뛴다.
// 알림이 실패해도 결재 올리기는 실패시키지 않는다.

const KIND_LABEL: Record<string, string> = { sales_contract: '매출계약 등록', doc_send: '문서발송 의뢰', invoice_request: '세금계산서 발행의뢰' };
const INBOX_URL = 'https://www.jaytax.co.kr/?tab=ssong-inbox';

export function telegramText(kind: string, title: string, reason?: string | null): string {
  return [
    `🤖 쏭비서 결재 · ${KIND_LABEL[kind] ?? kind}`,
    title,
    ...(reason?.trim() ? [`💬 ${reason.trim()}`] : []),
    '',
    `승인·반려: ${INBOX_URL}`,
  ].join('\n');
}

export async function notifyTelegram(kind: string, title: string, reason?: string | null): Promise<'sent' | 'skipped' | 'failed'> {
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID ?? '').trim();
  if (!token || !chatId) return 'skipped';
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: telegramText(kind, title, reason), disable_web_page_preview: true }),
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
