import type { VercelRequest, VercelResponse } from '@vercel/node';
import { waitUntil } from '@vercel/functions';
import { handleUpdate, webhookSecretOk } from '../lib/tgBot.js';

// POST /telegram — 텔레그램 웹훅. 헤더 X-Telegram-Bot-Api-Secret-Token 이 맞아야 받는다.
// 텔레그램에는 바로 200 을 돌려주고(늦으면 같은 메시지를 다시 보낸다) 답은 뒤에서 만든다.
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' || !webhookSecretOk(req.headers['x-telegram-bot-api-secret-token'])) {
    res.status(404).send('Not found');
    return;
  }
  waitUntil(handleUpdate(req.body).catch((e) => console.error('telegram update failed', e instanceof Error ? e.message : e)));
  res.status(200).send('ok');
}
