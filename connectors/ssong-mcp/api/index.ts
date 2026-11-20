import type { VercelRequest, VercelResponse } from '@vercel/node';

// 연결이나 주인에 대해 아무것도 말하지 않는다.
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.status(200).send('ok');
}
