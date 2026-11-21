import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleDocSendEvent, notifyAuthOk, type DocSendEvent } from '../lib/notify.js';

// POST /notify — JAYTAX DB 트리거(0204, pg_net)가 부른다. 헤더 x-ssong-notify 가 맞아야 받는다.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' || !notifyAuthOk(req.headers['x-ssong-notify'])) { res.status(404).send('Not found'); return; }
  const r = await handleDocSendEvent(req.body as DocSendEvent);
  res.status(r === 'bad' ? 400 : 200).send(r);
}
