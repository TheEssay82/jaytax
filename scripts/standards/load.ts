// 2단계: 문단 JSON → 임베딩 생성 → Supabase 적재(upsert, 멱등)
// 사용: tsx scripts/standards/load.ts <json경로> [--dry]
//   --dry : 임베딩/적재 없이 건수만 확인
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { adminClient, embedBatch, hashContent, estimateTokens, type ParsedParagraph } from './lib.ts';

const jsonPath = process.argv[2];
if (!jsonPath || jsonPath.startsWith('--')) {
  console.error('문단 JSON 경로를 주세요. 예: tsx scripts/standards/load.ts scripts/standards/data/K-IFRS-1115.paragraphs.json');
  process.exit(1);
}
const dry = process.argv.includes('--dry');

const paras = JSON.parse(readFileSync(resolve(jsonPath), 'utf8')) as ParsedParagraph[];
console.log(`${paras.length} 문단 로드`);
if (dry) {
  console.log('--dry: 적재하지 않고 종료');
  process.exit(0);
}

// 임베딩 입력: 검색 품질을 위해 메타(절 제목)를 본문 앞에 덧붙인다.
const inputs = paras.map((p) =>
  [p.standard_set, `제${p.standard_no}호`, p.section_title, `(${p.paragraph_no})`, p.content]
    .filter(Boolean)
    .join(' ')
);

console.log('OpenAI 임베딩 생성 중...');
const embeddings = await embedBatch(inputs);

const rows = paras.map((p, i) => ({
  standard_set: p.standard_set,
  standard_no: p.standard_no,
  standard_title: p.standard_title,
  part: p.part,
  chapter_no: p.chapter_no,
  chapter_title: p.chapter_title,
  section_title: p.section_title,
  paragraph_no: p.paragraph_no,
  content: p.content,
  ordinal: p.ordinal,
  token_count: estimateTokens(p.content),
  content_hash: hashContent(p.content),
  revised_date: p.revised_date,
  source: p.source,
  embedding: embeddings[i],
}));

const supabase = adminClient();
console.log('Supabase upsert 중...');
let done = 0;
for (let i = 0; i < rows.length; i += 200) {
  const batch = rows.slice(i, i + 200);
  const { error } = await supabase
    .from('accounting_standards')
    .upsert(batch, { onConflict: 'standard_set,standard_no,part,paragraph_no' });
  if (error) {
    console.error('upsert 실패:', error);
    process.exit(1);
  }
  done += batch.length;
  process.stdout.write(`  적재 ${done}/${rows.length}\r`);
}
process.stdout.write('\n');
console.log('완료.');
