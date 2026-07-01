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

// 번호 → 그 번호를 가진 세트들 (카탈로그 기준)
function setsForNo(no: string): string[] {
  return CATALOG.filter((c) => c.groups.some((g) => g.items.some((it) => it.no === no))).map((c) => c.set);
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

const folder = process.argv[2];
if (!folder) {
  console.error('사용: npm run std:upload:pdfs -- "<PDF 폴더 경로>"');
  process.exit(1);
}
const root = resolve(folder);

const files: { file: string; forcedSet: string | null }[] = [];
collect(root, null, files);
if (!files.length) {
  console.error(`PDF를 찾지 못했습니다: ${root}`);
  process.exit(1);
}

// 파일 → job (세트 판별)
const jobs: Job[] = [];
const skipped: string[] = [];
for (const { file, forcedSet } of files) {
  const no = basename(file, extname(file)).trim();
  let set = forcedSet;
  if (!set) {
    const cands = setsForNo(no);
    if (cands.length === 1) set = cands[0];
    else if (cands.length === 0) { skipped.push(`${basename(file)} → 카탈로그에 없는 번호 '${no}'`); continue; }
    else { skipped.push(`${basename(file)} → 세트 모호(${cands.join(', ')}) — 하위폴더로 구분 필요`); continue; }
  }
  jobs.push({ file, set, no });
}

console.log(`대상 ${jobs.length}건${skipped.length ? ` · 건너뜀 ${skipped.length}건` : ''}`);
skipped.forEach((s) => console.log(`  ⚠ ${s}`));

const sb = adminClient();
let ok = 0, fail = 0;
for (const j of jobs) {
  const path = `${j.set}/${j.no}.pdf`;
  const bytes = readFileSync(j.file);
  const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { upsert: true, contentType: 'application/pdf' });
  if (error) { fail++; console.log(`  ✗ ${path} — ${error.message}`); }
  else { ok++; console.log(`  ✓ ${path} (${(bytes.length / 1024).toFixed(0)} KB)`); }
}
console.log(`\n완료: 업로드 ${ok}건, 실패 ${fail}건, 건너뜀 ${skipped.length}건`);
