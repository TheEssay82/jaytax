// 회계기준서 원문 PDF → 텍스트 추출 → 청킹 → 임베딩 → standard_fulltext 적재 (RAG 원문 근거)
// 파일명(제0000호)으로 기준서 판별, 한글 본문만 남기고 청킹, OpenAI 임베딩 후 upsert(멱등).
// 사용: npm run std:load:fulltext -- "<PDF 폴더>" [--dry] [--no <번호>]
//   --dry   : 임베딩/적재 없이 청크 수만 집계
//   --no    : 특정 기준서 번호만 (예: --no 1115)
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { resolve, join, basename, extname } from 'node:path';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { adminClient, embedBatch, hashContent, estimateTokens } from './lib.ts';
import { CATALOG } from '../../src/lib/standardsCatalog.ts';

function setsForNo(no: string): string[] {
  return CATALOG.filter((c) => c.groups.some((g) => g.items.some((it) => it.no === no))).map((c) => c.set);
}
function titleForNo(no: string): string {
  for (const c of CATALOG) for (const g of c.groups) for (const it of g.items) if (it.no === no) return it.title;
  return '';
}
function extractNo(base: string): string | null {
  const b = base.trim();
  if (setsForNo(b).length) return b;
  const m = b.match(/제\s*(\d{3,4})\s*호/);
  if (m && setsForNo(m[1]).length) return m[1];
  const chap = b.match(/제\s*(\d{1,2})\s*장/); // 일반기업회계기준 '제10장_유형자산...' → '10장'
  if (chap && setsForNo(`${chap[1]}장`).length) return `${chap[1]}장`;
  if (/재무보고를[_\s]*위한[_\s]*개념체계/.test(b)) return '개념체계';
  if (/재무회계개념체계/.test(b)) return '재무회계개념체계';
  return null;
}
// 번호 표기: '10장'은 '제10장', 숫자호는 '제0000호', 그 외(개념체계 등)는 그대로.
function refLabel(no: string): string {
  if (/장$/.test(no)) return `제${no}`;
  if (/^\d{3,4}$/.test(no)) return `제${no}호`;
  return no;
}

// 한글 비율(공백 제외)
function koreanRatio(s: string): number {
  const nonSpace = s.replace(/\s/g, '');
  if (!nonSpace) return 0;
  const kr = (nonSpace.match(/[가-힣]/g) || []).length;
  return kr / nonSpace.length;
}

// PDF 원문 → 정제된 청크들. 영문·페이지마커·저작권 잡음 제거 후 ~800자 단위.
function toChunks(raw: string): string[] {
  const lines = raw
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !/^[-\s]*\d{1,4}[-\s]*$/.test(l)) // 페이지 마커 "- 3 -"
    .filter((l) => koreanRatio(l) >= 0.3); // 영문 원문·저작권 등 제거(한글 본문만)

  const chunks: string[] = [];
  let cur = '';
  for (const line of lines) {
    if (cur && (cur.length + line.length) > 800) {
      if (cur.length >= 80) chunks.push(cur.trim());
      cur = '';
    }
    cur += (cur ? ' ' : '') + line;
  }
  if (cur.trim().length >= 80) chunks.push(cur.trim());
  return chunks;
}

// ── 실행 ──────────────────────────────────────────────
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const onlyNo = args.includes('--no') ? args[args.indexOf('--no') + 1] : null;
const folder = args.find((a) => !a.startsWith('--') && a !== onlyNo);
if (!folder) {
  console.error('사용: npm run std:load:fulltext -- "<PDF 폴더>" [--dry] [--no <번호>]');
  process.exit(1);
}
const root = resolve(folder);

const files: string[] = [];
(function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (extname(name).toLowerCase() === '.pdf') files.push(p);
  }
})(root);

const supabase = dry ? null : adminClient();
let totalChunks = 0, done = 0, skipped = 0;

for (const file of files) {
  const no = extractNo(basename(file, extname(file)));
  if (!no) { skipped++; continue; }
  if (onlyNo && no !== onlyNo) continue;
  const set = setsForNo(no)[0] ?? 'K-IFRS';
  const title = titleForNo(no);

  const data = await pdf(readFileSync(file));
  const chunks = toChunks(data.text);
  totalChunks += chunks.length;
  console.log(`${set} ${refLabel(no)} · ${data.numpages}p → 청크 ${chunks.length}개  (${title.slice(0, 20)})`);
  if (dry || !supabase) continue;

  const embeddings = await embedBatch(chunks.map((c) => `${set} ${refLabel(no)} ${title} ${c}`));
  const rows = chunks.map((content, i) => ({
    standard_set: set,
    standard_no: no,
    standard_title: title,
    chunk_index: i,
    content,
    token_count: estimateTokens(content),
    content_hash: hashContent(content),
    embedding: embeddings[i],
  }));
  // 기준서 재적재 시 기존 청크 제거(청크 수 변동 대비) 후 삽입.
  // 벡터+HNSW 인덱스라 큰 배치는 statement timeout → 50행씩(멱등).
  await supabase.from('standard_fulltext').delete().eq('standard_set', set).eq('standard_no', no);
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from('standard_fulltext').insert(rows.slice(i, i + 200));
    if (error) { console.error(`  적재 실패(${no}):`, error.message); process.exit(1); }
  }
  done++;
  console.log(`  ✓ 적재 완료 (${rows.length}청크)`);
}

console.log(`\n${dry ? '[DRY] ' : ''}대상 파일 ${files.length} · 적재 기준서 ${done} · 건너뜀 ${skipped} · 총 청크 ${totalChunks}`);
