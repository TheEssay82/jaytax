// 기준서 원문 PDF 일괄 업로드 — 로컬 폴더의 PDF들을 Storage(standard-pdfs)에 올린다.
// 파일명(확장자 제외)=기준서 번호로 카탈로그와 대조해 세트를 자동 판별하고 '{set}/{no}.pdf'로 업로드(교체 포함).
// 하위 폴더로 세트를 명시할 수도 있다: <folder>/K-IFRS/1115.pdf 처럼 두면 그 폴더명을 세트로 사용.
//
// 사용: npm run std:upload:pdfs -- "C:\경로\pdf폴더"
//   (환경변수 VITE_SUPABASE_URL, SUPABASE_SECRET_KEY 필요 — .env.local 자동 로드)
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { resolve, join, basename, extname } from 'node:path';
import { adminClient } from './lib.ts';
import { CATALOG } from '../../src/lib/standardsCatalog.ts';

const BUCKET = 'standard-pdfs';
const SETS = CATALOG.map((c) => c.set); // 하위 폴더명이 세트인지 판별용

// Storage 키는 비ASCII 거부 → src/lib/standardsApi.ts의 encodeSeg와 동일 규약(ASCII면 그대로, 아니면 '_b64_'+base64url).
function encodeSeg(s: string): string {
  if (/^[A-Za-z0-9._-]+$/.test(s)) return s;
  return '_b64_' + Buffer.from(s, 'utf8').toString('base64url');
}
const pdfPath = (set: string, no: string) => `${encodeSeg(set)}/${encodeSeg(no)}.pdf`;

// 번호 → 그 번호를 가진 세트들 (카탈로그 기준)
function setsForNo(no: string): string[] {
  return CATALOG.filter((c) => c.groups.some((g) => g.items.some((it) => it.no === no))).map((c) => c.set);
}

// 파일명(확장자 제외)에서 기준서 번호 추출.
//  1) 파일명이 그대로 카탈로그 번호(예: '1115', '16장')  2) '제1115호' 패턴  3) 개념체계류
function extractNo(base: string): string | null {
  const b = base.trim();
  if (setsForNo(b).length) return b;
  const m = b.match(/제\s*(\d{3,4})\s*호/); // '시행중_K-IFRS_제1115호_...' → 1115 (첫 번호)
  if (m && setsForNo(m[1]).length) return m[1];
  const chap = b.match(/제\s*(\d{1,2})\s*장/); // 일반기업회계기준 '제10장_유형자산...' → '10장'
  if (chap && setsForNo(`${chap[1]}장`).length) return `${chap[1]}장`;
  if (/재무보고를[_\s]*위한[_\s]*개념체계/.test(b)) return '개념체계';
  if (/재무회계개념체계/.test(b)) return '재무회계개념체계';
  if (/중소기업회계기준/.test(b)) return '중소기업회계기준';
  if (/비영리조직회계기준/.test(b)) return '비영리조직회계기준';
  return null;
}

interface Job { file: string; set: string; no: string }

// 폴더를 재귀 순회하며 (파일, 지정세트?) 수집
function collect(dir: string, forcedSet: string | null, out: { file: string; forcedSet: string | null }[]) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      collect(p, SETS.includes(name) ? name : forcedSet, out);
    } else if (extname(name).toLowerCase() === '.pdf') {
      out.push({ file: p, forcedSet });
    }
  }
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const folder = args.find((a) => !a.startsWith('--'));
if (!folder) {
  console.error('사용: npm run std:upload:pdfs -- "<PDF 폴더 경로>" [--dry]');
  process.exit(1);
}
const root = resolve(folder);

const files: { file: string; forcedSet: string | null }[] = [];
collect(root, null, files);
if (!files.length) {
  console.error(`PDF를 찾지 못했습니다: ${root}`);
  process.exit(1);
}

// 파일 → job (번호 추출 + 세트 판별)
const jobs: Job[] = [];
const skipped: string[] = [];
for (const { file, forcedSet } of files) {
  const no = extractNo(basename(file, extname(file)));
  if (!no) { skipped.push(`${basename(file)} → 기준서 번호를 못 찾음`); continue; }
  let set = forcedSet;
  if (!set) {
    const cands = setsForNo(no);
    if (cands.length === 1) set = cands[0];
    else if (cands.length === 0) { skipped.push(`${basename(file)} → 카탈로그에 없는 번호 '${no}'`); continue; }
    else { skipped.push(`${basename(file)} → 세트 모호(${cands.join(', ')}) — 하위폴더로 구분 필요`); continue; }
  }
  jobs.push({ file, set, no });
}

console.log(`대상 ${jobs.length}건${skipped.length ? ` · 건너뜀 ${skipped.length}건` : ''}${dryRun ? ' · [DRY RUN]' : ''}`);
skipped.forEach((s) => console.log(`  ⚠ ${s}`));

if (dryRun) {
  for (const j of jobs) console.log(`  → ${j.set}/${j.no}.pdf  ⟵  ${basename(j.file)}`);
  console.log(`\n[DRY RUN] 업로드 없이 매핑만 표시. 실제 업로드하려면 --dry 없이 실행하세요.`);
  process.exit(0);
}

const sb = adminClient();
let ok = 0;
const failed: string[] = [];
for (const j of jobs) {
  const path = pdfPath(j.set, j.no);
  const bytes = readFileSync(j.file);
  let lastErr = '';
  let done = false;
  for (let attempt = 1; attempt <= 3 && !done; attempt++) {
    const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { upsert: true, contentType: 'application/pdf' });
    if (!error) { done = true; ok++; console.log(`  ✓ ${path} (${(bytes.length / 1024).toFixed(0)} KB)`); }
    else { lastErr = error.message; if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt)); }
  }
  if (!done) { failed.push(`${path} — ${lastErr}`); console.log(`  ✗ ${path} — ${lastErr} (3회 재시도 실패)`); }
}
console.log(`\n완료: 업로드 ${ok}건, 실패 ${failed.length}건, 건너뜀 ${skipped.length}건`);
failed.forEach((f) => console.log(`  ✗ ${f}`));
