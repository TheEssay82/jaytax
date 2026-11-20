import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleMcp } from '../lib/handler.js';

// POST /mcp — claude.ai 사용자 지정 커넥터. 요청 헤더 Authorization: Bearer <MCP_SECRET>
export default async function handler(req: VercelRequest, res: VercelResponse) {
  await handleMcp(req, res, req.body);
}
