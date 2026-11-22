import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleMcp } from '../lib/handler.js';
import { buildPersonalServer } from '../lib/personalTools.js';

// POST /personal — 쏭비서 개인 도구(업무 장부·Google 캘린더). 텔레그램 대화만 붙인다. 헤더 Authorization: Bearer <MCP_SECRET>
export default async function handler(req: VercelRequest, res: VercelResponse) {
  await handleMcp(req, res, req.body, buildPersonalServer);
}
