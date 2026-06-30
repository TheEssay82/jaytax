// 1단계: PDF → 문단 JSON
// 사용:
//   tsx scripts/standards/parse.ts <pdf경로> [--out <json경로>] \
//       [--no 1115] [--title "고객과의 계약에서 생기는 수익"] \
//       [--revised 2023-12-01] [--source "한국회계기준원 공개본"] [--inspect]
//   --inspect : 적재하지 않고 추출 텍스트/분해 결과 샘플만 출력(파서 튜닝용)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
// pdf-parse: 라이브러리 본체를 직접 import (index.js의 자체 테스트 코드 회피)
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { parseStandardText, summarize } from './parser.ts';
import type { ParseMeta } from './lib.ts';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const pdfPath = process.argv[2];
if (!pdfPath || pdfPath.startsWith('--')) {
  console.error('PDF 경로를 첫 인자로 주세요. 예: tsx scripts/standards/parse.ts data/kifrs-1115.pdf');
  process.exit(1);
}

const meta: ParseMeta = {
  standard_set: arg('set', 'K-IFRS')!,
  standard_no: arg('no', '1115')!,
  standard_title: arg('title', '고객과의 계약에서 생기는 수익')!,
  revised_date: arg('revised') ?? null,
  source: arg('source', '한국회계기준원 공개본') ?? null,
};

const buf = readFileSync(resolve(pdfPath));
const { text, numpages } = await pdfParse(buf);
console.log(`PDF 추출 완료: ${numpages}페이지, ${text.length}자`);

if (has('inspect')) {
  console.log('\n──────── 추출 텍스트 앞 2000자 ────────\n');
  console.log(text.slice(0, 2000));
  console.log('\n──────── 분해 결과 샘플 ────────\n');
  const paras = parseStandardText(text, meta);
  console.log(summarize(paras));
  console.log('\n[처음 5개]');
  for (const p of paras.slice(0, 5)) {
    console.log(`\n#${p.ordinal} [${p.part}] (${p.paragraph_no}) 절:${p.section_title ?? '-'}`);
    console.log(p.content.slice(0, 200));
  }
  console.log('\n[마지막 3개]');
  for (const p of paras.slice(-3)) {
    console.log(`\n#${p.ordinal} [${p.part}] (${p.paragraph_no})`);
    console.log(p.content.slice(0, 200));
  }
  process.exit(0);
}

const paras = parseStandardText(text, meta);
const outPath = resolve(arg('out', `scripts/standards/data/${meta.standard_set}-${meta.standard_no}.paragraphs.json`)!);
writeFileSync(outPath, JSON.stringify(paras, null, 2), 'utf8');
console.log(summarize(paras));
console.log(`\n저장: ${outPath}`);
console.log('→ 내용 검수 후  tsx scripts/standards/load.ts ' + outPath + '  로 임베딩·적재하세요.');
