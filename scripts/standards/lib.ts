// 회계기준 RAG 적재 파이프라인 — 공통 유틸
// 실행: tsx (devDependency). 환경변수는 프로젝트 루트 .env.local 에서 로드.
//   필요한 키: VITE_SUPABASE_URL, SUPABASE_SECRET_KEY, OPENAI_API_KEY
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// ── .env.local 간이 로더 (dotenv 의존성 없이) ──────────────────
export function loadEnv(): void {
  try {
    const raw = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // .env.local 없으면 실제 환경변수에 의존
  }
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`환경변수 ${name} 가 필요합니다. .env.local 을 확인하세요.`);
  return v;
}

// ── Supabase 관리자 클라이언트 (service_role: RLS 우회, 적재 전용) ──
export function adminClient(): SupabaseClient {
  loadEnv();
  const url = requireEnv('VITE_SUPABASE_URL');
  const key = requireEnv('SUPABASE_SECRET_KEY'); // secret(service_role) 키
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ── OpenAI 임베딩 ────────────────────────────────────────────
export const EMBED_MODEL = 'text-embedding-3-small';
export const EMBED_DIM = 1536;

/** 텍스트 배열 → 임베딩 배열 (입력 순서 유지). OpenAI 배치 한도 고려해 분할 호출. */
export async function embedBatch(inputs: string[], batchSize = 96): Promise<number[][]> {
  loadEnv();
  const apiKey = requireEnv('OPENAI_API_KEY');
  const out: number[][] = [];
  for (let i = 0; i < inputs.length; i += batchSize) {
    const chunk = inputs.slice(i, i + batchSize);
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: EMBED_MODEL, input: chunk }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI embeddings 실패 ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    // index 순서 보장
    const sorted = json.data.sort((a, b) => a.index - b.index);
    out.push(...sorted.map((d) => d.embedding));
    process.stdout.write(`  임베딩 ${Math.min(i + chunk.length, inputs.length)}/${inputs.length}\r`);
  }
  process.stdout.write('\n');
  return out;
}

// ── 파싱 타입 ────────────────────────────────────────────────
export interface ParsedParagraph {
  standard_set: string;
  standard_no: string;
  standard_title: string;
  part: string;
  chapter_no: string | null;
  chapter_title: string | null;
  section_title: string | null;
  paragraph_no: string;
  content: string;
  ordinal: number;
  revised_date: string | null; // YYYY-MM-DD
  source: string | null;
}

export interface ParseMeta {
  standard_set: string;
  standard_no: string;
  standard_title: string;
  revised_date: string | null;
  source: string | null;
}

// 대략적 토큰 추정(점검용): 한글은 문자≈토큰에 가깝게, 영문은 4자≈1토큰
export function estimateTokens(s: string): number {
  const korean = (s.match(/[가-힣]/g) || []).length;
  const rest = s.length - korean;
  return Math.ceil(korean + rest / 4);
}

// content 해시(멱등 재적재 감지용) — 간단한 djb2
export function hashContent(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
