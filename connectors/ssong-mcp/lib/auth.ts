import { createHash, timingSafeEqual } from 'node:crypto';

const MIN_SECRET_LENGTH = 32;

/**
 * Constant-time check of the secret that guards the connector URL and the
 * connector (claude.ai request header). Rejects everything if MCP_SECRET is unset or short.
 */
export function checkSecret(given: unknown): boolean {
  const expected = (process.env.MCP_SECRET ?? '').trim();
  if (expected.length < MIN_SECRET_LENGTH) return false;
  if (typeof given !== 'string' || given.length === 0) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function firstQuery(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}
