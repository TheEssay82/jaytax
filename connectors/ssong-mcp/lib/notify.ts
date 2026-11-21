// 문서발송 진행 알림(대표님 2026-11-21) — DB 트리거(0204)가 pg_net 으로 부른다.
// 대표님이 의뢰인이거나 쏭비서 결재로 만든 발송요청의 상태·등기번호가 바뀌면 텔레그램으로 한 줄.
import { createHash, timingSafeEqual } from 'node:crypto';
import { rpc } from './jaytax.js';
import { sendTelegram } from './tgBriefing.js';

/** DB 가 붙여 보내는 x-ssong-notify = 쏭비서 열쇠의 sha256. 서버의 SSONG_DB_KEY 로 맞춰 본다. */
export function notifyAuthOk(given: string | string[] | undefined): boolean {
  const key = (process.env.SSONG_DB_KEY ?? '').trim();
  const g = (Array.isArray(given) ? given[0] : given)?.trim().toLowerCase();
  if (key.length < 32 || !g || g.length !== 64) return false;
  const expected = createHash('sha256').update(key).digest('hex');
  return timingSafeEqual(Buffer.from(g), Buffer.from(expected));
}

export interface DocSendEvent {
  kind: 'doc_send'; id: string; company?: string | null; sendKind?: string | null; docName?: string | null;
  status?: string | null; sentDate?: string | null; trackingNo?: string | null; statusNote?: string | null; viaSsong?: boolean;
}

const ICON: Record<string, string> = { 미접수: '📝', 진행중: '⏳', 발송완료: '✅', 반송: '↩️', 재발송요청: '🔁', 재발송완료: '✅', 취소: '✖️' };
const md = (ymd?: string | null) => (ymd ? `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}` : '');

export function docSendText(e: DocSendEvent): string {
  const trk = e.trackingNo?.trim();
  const digits = trk?.replace(/\D/g, '');
  return [
    `📮 발송 진행${e.viaSsong ? ' (쏭비서 결재건)' : ''}`,
    `${e.company ?? ''} · ${e.sendKind ?? ''}${e.docName ? ` «${e.docName}»` : ''}`,
    `${ICON[e.status ?? ''] ?? '•'} ${e.status ?? ''}${e.sentDate ? ` (${md(e.sentDate)})` : ''}`,
    ...(trk ? [`등기번호 ${trk}`] : []),
    ...(e.statusNote?.trim() ? [`💬 ${e.statusNote.trim()}`] : []),
    ...(digits && digits.length >= 10 ? [`조회: https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=${digits}`] : []),
  ].join('\n');
}

/** 같은 상태·등기번호는 한 번만 보낸다. */
export async function handleDocSendEvent(e: DocSendEvent): Promise<'sent' | 'duplicate' | 'failed' | 'bad'> {
  if (e?.kind !== 'doc_send' || !/^[0-9a-f-]{36}$/i.test(String(e.id ?? ''))) return 'bad';
  const key = `doc:${e.id}:${e.status ?? ''}:${e.trackingNo ?? ''}`.slice(0, 200);
  let first = true;
  try { first = await rpc<boolean>('ssong_tg_claim', { p_key: key }); }
  catch (err) { console.warn('notify claim failed', err instanceof Error ? err.message : err); }
  if (!first) return 'duplicate';
  return (await sendTelegram(docSendText(e))) ? 'sent' : 'failed';
}
