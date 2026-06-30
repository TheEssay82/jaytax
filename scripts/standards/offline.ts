// 오프라인 결정적 임베더 — OpenAI/Supabase 없이 파이프라인(청크→임베딩→검색) 동작을 증명하기 위함.
// 문자 n-그램 해싱 기반 어휘 벡터다. 의미 임베딩(text-embedding-3-small)을 대체하지 못하며,
// 검색 '품질'이 아니라 파싱·검색 '동작'을 확인하는 용도다. 라이브는 lib.ts/embedBatch + Supabase RPC.

export const OFFLINE_DIM = 512;

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/** 텍스트 → 결정적 단위벡터(L2 정규화). 문자 2·3그램을 해싱해 누적. */
export function offlineEmbed(text: string): number[] {
  const v = new Array<number>(OFFLINE_DIM).fill(0);
  const s = text.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const n of [2, 3]) {
    for (let i = 0; i + n <= s.length; i++) {
      const gram = s.slice(i, i + n);
      v[djb2(gram) % OFFLINE_DIM] += 1;
    }
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

/** 두 단위벡터의 코사인 유사도(= 내적). */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}
