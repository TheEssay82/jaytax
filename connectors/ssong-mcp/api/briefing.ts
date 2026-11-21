import type { VercelRequest, VercelResponse } from '@vercel/node';
import { timingSafeEqual, createHash } from 'node:crypto';
import { sendMorningBriefing } from '../lib/tgBot.js';

// GET /briefing — Vercel Cron 이 평일 09시대(KST)에 부른다(vercel.json). 웍스 브리핑(08:50)이 먼저 보냈으면 그냥 넘어간다. 헤더 Authorization: Bearer <CRON_SECRET>.
const h = (s: string) => createHash('sha256').update(s).digest();
export function cronOk(auth: string | undefined): boolean {
  const secret = (process.env.CRON_SECRET ?? '').trim();
  if (secret.length < 16 || !auth) return false;
  return timingSafeEqual(h(auth.trim()), h(`Bearer ${secret}`));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!cronOk(req.headers.authorization)) { res.status(404).send('Not found'); return; }
  const r = await sendMorningBriefing();
  res.status(200).send(r);
}
