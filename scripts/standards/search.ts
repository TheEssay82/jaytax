// 3단계: 검색 동작 확인 — 질의문 → 임베딩 → match_accounting_standards RPC → 상위 N개
// 사용: tsx scripts/standards/search.ts "변동대가는 어떻게 추정하나요?" [--n 5] [--no 1115]
import { adminClient, embedBatch } from './lib.ts';

const query = process.argv[2];
if (!query || query.startsWith('--')) {
  console.error('질의문을 첫 인자로 주세요. 예: tsx scripts/standards/search.ts "수행의무는 언제 식별하나요?"');
  process.exit(1);
}
const ni = process.argv.indexOf('--n');
const matchCount = ni >= 0 ? Number(process.argv[ni + 1]) : 5;
const noi = process.argv.indexOf('--no');
const filterNo = noi >= 0 ? process.argv[noi + 1] : null;

console.log(`질의: ${query}`);
const [embedding] = await embedBatch([query]);

const supabase = adminClient();
const { data, error } = await supabase.rpc('match_accounting_standards', {
  query_embedding: embedding,
  match_count: matchCount,
  filter_standard_no: filterNo,
});
if (error) {
  console.error('RPC 실패:', error);
  process.exit(1);
}

console.log(`\n상위 ${data.length}개 문단:\n`);
for (const r of data as Array<Record<string, unknown>>) {
  const sim = (r.similarity as number).toFixed(3);
  console.log(`[${sim}] ${r.standard_set} 제${r.standard_no}호 (${r.paragraph_no}) — ${r.section_title ?? r.part}`);
  console.log(`      ${String(r.content).replace(/\n/g, ' ').slice(0, 160)}\n`);
}
