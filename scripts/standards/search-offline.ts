// 3단계(오프라인): 질의 → 결정적 임베딩 → 코사인 상위 N개. OpenAI/Supabase 불필요.
// 파싱·청크·검색 파이프라인의 '동작'을 키 없이 증명한다(품질은 라이브 search.ts 로 확인).
// 사용:
//   tsx scripts/standards/search-offline.ts "변동대가는 어떻게 추정하나요?" accounting-standards/k-ifrs-1115.md [--n 5] [--no 1115]
//   소스 인자가 .md 면 파싱, .json 이면 파싱 결과를 그대로 읽는다.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ParsedParagraph } from './lib.ts';
import { parseMarkdown } from './md-parser.ts';
import { offlineEmbed, cosine } from './offline.ts';

const query = process.argv[2];
const source = process.argv[3] ?? 'accounting-standards/k-ifrs-1115.md';
if (!query || query.startsWith('--')) {
  console.error('사용: tsx scripts/standards/search-offline.ts "<질의>" [소스.md|소스.json] [--n 5] [--no 1115]');
  process.exit(1);
}
const ni = process.argv.indexOf('--n');
const matchCount = ni >= 0 ? Number(process.argv[ni + 1]) : 5;
const noi = process.argv.indexOf('--no');
const filterNo = noi >= 0 ? process.argv[noi + 1] : null;

const rawSrc = readFileSync(resolve(source), 'utf8');
let paras: ParsedParagraph[] = source.endsWith('.json')
  ? (JSON.parse(rawSrc) as ParsedParagraph[])
  : parseMarkdown(rawSrc);
if (filterNo) paras = paras.filter((p) => p.standard_no === filterNo);

if (paras.length === 0) {
  console.error('문단이 없습니다. 소스/필터를 확인하세요.');
  process.exit(1);
}

// 라이브 load.ts 와 동일하게 메타를 본문 앞에 덧붙여 임베딩 입력을 만든다.
function embedInput(p: ParsedParagraph): string {
  return [p.standard_set, `제${p.standard_no}호`, p.section_title, `(§${p.paragraph_no})`, p.content]
    .filter(Boolean)
    .join(' ');
}

const qv = offlineEmbed(query);
const scored = paras
  .map((p) => ({ p, sim: cosine(qv, offlineEmbed(embedInput(p))) }))
  .sort((a, b) => b.sim - a.sim)
  .slice(0, Math.max(matchCount, 1));

console.log(`질의: ${query}`);
console.log(`소스: ${source} (${paras.length}문단${filterNo ? `, no=${filterNo}` : ''}) — 오프라인 임베더\n`);
console.log(`상위 ${scored.length}개 문단:\n`);
for (const { p, sim } of scored) {
  console.log(`[${sim.toFixed(3)}] ${p.standard_set} 제${p.standard_no}호 (§${p.paragraph_no}) — ${p.section_title ?? p.part}`);
  console.log(`      ${p.content.replace(/\n/g, ' ').slice(0, 150)}\n`);
}
