// 1단계(마크다운 단일 소스 경로): accounting-standards/*.md → 문단 JSON
// PDF 파서(parse.ts)의 휴리스틱과 달리, 커밋되는 .md 의 파싱 규약을 결정적으로 따른다.
// 사용:
//   tsx scripts/standards/parse-md.ts accounting-standards/k-ifrs-1115.md [--out <json>] [--inspect]
//   --inspect : 적재 없이 분해 결과 요약/샘플만 출력
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseMarkdown, summarizeMd } from './md-parser.ts';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const mdPath = process.argv[2];
if (!mdPath || mdPath.startsWith('--')) {
  console.error('마크다운 경로를 첫 인자로 주세요. 예: tsx scripts/standards/parse-md.ts accounting-standards/k-ifrs-1115.md');
  process.exit(1);
}

const raw = readFileSync(resolve(mdPath), 'utf8');
const paras = parseMarkdown(raw);
console.log(`파싱 완료: ${mdPath}`);
console.log(summarizeMd(paras));

if (has('inspect')) {
  console.log('\n[처음 4개]');
  for (const p of paras.slice(0, 4)) {
    console.log(`\n#${p.ordinal} [${p.part}] (§${p.paragraph_no}) 장:${p.chapter_title ?? '-'} / 절:${p.section_title ?? '-'}`);
    console.log('  ' + p.content.slice(0, 160));
  }
  console.log('\n[마지막 3개]');
  for (const p of paras.slice(-3)) {
    console.log(`\n#${p.ordinal} [${p.part}] (§${p.paragraph_no})`);
    console.log('  ' + p.content.slice(0, 160));
  }
  process.exit(0);
}

const outPath = resolve(
  arg('out', `scripts/standards/data/${paras[0]?.standard_set ?? 'K-IFRS'}-${paras[0]?.standard_no ?? 'x'}.paragraphs.json`)!
);
writeFileSync(outPath, JSON.stringify(paras, null, 2), 'utf8');
console.log(`\n저장: ${outPath}`);
console.log('→ 라이브 적재:  tsx scripts/standards/load.ts ' + outPath);
console.log('→ 오프라인 검색 테스트:  tsx scripts/standards/search-offline.ts "<질의>" ' + mdPath);
