// 맥미니(상시 서버)용 진입점 — Vercel 없이 같은 코드를 Node 로 띄운다.
//   PORT=8787 npx tsx server.ts
// 앞단에 HTTPS(예: Cloudflare Tunnel·Tailscale Funnel)를 두고 그 주소/mcp 를 claude.ai 에 등록한다.
import { createServer } from 'node:http';
import { handleMcp } from './lib/handler.js';

const port = Number(process.env.PORT ?? 8787);
createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/' ) { res.end('ok'); return; }
  if (path !== '/mcp') { res.statusCode = 404; res.end('Not found'); return; }
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => { chunks.push(c); if (chunks.reduce((n, b) => n + b.length, 0) > 1_000_000) req.destroy(); });
  req.on('end', () => {
    let body: unknown;
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined; }
    catch { res.statusCode = 400; res.end('Bad JSON'); return; }
    void handleMcp(req, res, body);
  });
}).listen(port, () => console.log(`ssong-mcp listening on :${port}`));
