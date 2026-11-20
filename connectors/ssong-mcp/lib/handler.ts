import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { checkSecret } from './auth.js';
import { buildServer } from './tools.js';

/** 비밀은 요청 헤더로만 받는다(주소에 넣지 않는다). Bearer 뒤 공백은 빠져도 받는다. */
export function secretFromHeaders(headers: IncomingMessage['headers']): string {
  const clean = (s: string) => s.trim().replace(/^["']|["']$/g, '').trim();
  const auth = headers.authorization;
  if (auth) {
    const bearer = /^Bearer\s*(.+)$/i.exec(auth.trim());
    return clean(bearer ? bearer[1] : auth);
  }
  const apiKey = headers['x-api-key'];
  return clean((Array.isArray(apiKey) ? apiKey[0] : apiKey) ?? '');
}

const send = (res: ServerResponse, code: number, body: string, type = 'text/plain; charset=utf-8') => {
  res.statusCode = code; res.setHeader('Content-Type', type); res.end(body);
};

/**
 * Vercel 함수와 맥미니 Node 서버(server.ts)가 같이 쓰는 MCP 처리.
 * 상태 없는 Streamable HTTP — 요청마다 새 서버·전송.
 */
export async function handleMcp(req: IncomingMessage, res: ServerResponse, body: unknown) {
  const given = secretFromHeaders(req.headers);
  if (!checkSecret(given)) {
    // 비밀 자체는 절대 적지 않는다.
    console.warn('mcp refused', { method: req.method, hasAuthorization: Boolean(req.headers.authorization), givenLength: given.length });
    send(res, 404, 'Not found');
    return;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    send(res, 405, JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }), 'application/json');
    return;
  }
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { void transport.close(); void server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (e) {
    console.error('mcp request failed', e instanceof Error ? e.message : e);
    if (!res.headersSent) send(res, 500, JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }), 'application/json');
  }
}
