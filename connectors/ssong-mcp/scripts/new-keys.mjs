// 쏭비서 연결 열쇠 만들기 — 화면에만 찍고 어디에도 저장하지 않는다.
//   node connectors/ssong-mcp/scripts/new-keys.mjs
// SSONG_DB_KEY · MCP_SECRET 은 Vercel 환경변수에, hash 는 DB ssong_keys 에(원문은 채팅에 적지 않는다).
import { randomBytes, createHash } from 'node:crypto';
const key = randomBytes(32).toString('hex');
console.log('');
console.log('1) Vercel 환경변수 SSONG_DB_KEY =', key);
console.log('2) Vercel 환경변수 MCP_SECRET   =', randomBytes(24).toString('hex'));
console.log('   (MCP_SECRET 은 claude.ai 커넥터 요청 헤더에도 씁니다: Authorization = Bearer <MCP_SECRET>)');
console.log('3) Claude 에게 보낼 hash         =', createHash('sha256').update(key).digest('hex'));
console.log('');
