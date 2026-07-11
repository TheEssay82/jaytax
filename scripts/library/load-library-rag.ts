// 자료실(library) 참고자료 PDF → Storage 다운로드 → 텍스트 추출 → 청킹 → 임베딩 → library_fulltext 적재
// standards의 load-pdf-fulltext와 같은 파이프라인이나, 원본이 로컬 폴더가 아니라 Supabase Storage('library' 버킷)다.
// 대상: library_documents 중 kind='reference' && file_ext='pdf'. 서식(template)·비PDF는 건너뛴다(로그).
// 멱등: 이미 적재됐고(indexed_at) 그 이후 수정이 없으면 건너뜀. --force로 전건 재적재.
// 사용: npm run lib:load:rag [-- --dry | --force | --id <문서UUID>]
//   --dry   : 다운로드·청킹까지만(임베딩/적재 없이 청크 수 집계)
//   --force : rag_indexed 여부와 무관하게 재적재
//   --id    : 특정 문서 하나만
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { adminClient, embedBatch, hashContent, estimateTokens } from '../standards/lib.ts';

const BUCKET = 'library';

// 한글 비율(공백 제외)
function koreanRatio(s: string): number {
  const nonSpace = s.replace(/\s/g, '');
  if (!nonSpace) return 0;
  return (nonSpace.match(/[가-힣]/g) || []).length / nonSpace.length;
}

// PDF 원문 → 정제된 청크들. 페이지마커·영문 원문 잡음 제거 후 ~800자 단위(standards와 동일 규약).
function toChunks(raw: string): string[] {
  const lines = raw
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !/^[-\s]*\d{1,4}[-\s]*$/.test(l)) // 페이지 마커 "- 3 -"
    .filter((l) => koreanRatio(l) >= 0.3); // 한글 본문만(영문·표잡음 제거)

  const chunks: string[] = [];
  let cur = '';
  for (const line of lines) {
    if (cur && cur.length + line.length > 800) {
      if (cur.length >= 80) chunks.push(cur.trim());
      cur = '';
    }
    cur += (cur ? ' ' : '') + line;
  }
  if (cur.trim().length >= 80) chunks.push(cur.trim());
  return chunks;
}

interface DocRow {
  id: string;
  kind: string | null;
  title: string | null;
  category: string | null;
  file_name: string | null;
  file_ext: string | null;
  storage_path: string;
  updated_at: string;
  indexed_at: string | null;
}

// ── 실행 ──────────────────────────────────────────────
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const force = args.includes('--force');
const onlyId = args.includes('--id') ? args[args.indexOf('--id') + 1] : null;

const supabase = adminClient();

let q = supabase
  .from('library_documents')
  .select('id, kind, title, category, file_name, file_ext, storage_path, updated_at, indexed_at')
  .eq('kind', 'reference')
  .order('created_at', { ascending: true });
if (onlyId) q = q.eq('id', onlyId);
const { data, error } = await q;
if (error) {
  console.error('문서 목록 조회 실패:', error.message);
  process.exit(1);
}
const docs = (data ?? []) as DocRow[];

let done = 0,
  skippedNonPdf = 0,
  skippedFresh = 0,
  totalChunks = 0;

for (const d of docs) {
  const label = d.title || d.file_name || d.id;
  const ext = (d.file_ext || '').toLowerCase();
  if (ext !== 'pdf') {
    skippedNonPdf++;
    console.log(`· 건너뜀(비PDF ${ext || '?'}): ${label}`);
    continue;
  }
  // 멱등: 수정 이후 재적재된 적 있으면 건너뜀(--force 예외)
  if (!force && d.indexed_at && new Date(d.indexed_at) >= new Date(d.updated_at)) {
    skippedFresh++;
    continue;
  }

  // Storage에서 다운로드
  const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(d.storage_path);
  if (dlErr || !blob) {
    console.error(`  다운로드 실패(${label}): ${dlErr?.message ?? '빈 응답'}`);
    continue;
  }
  const buf = Buffer.from(await blob.arrayBuffer());

  let text = '';
  try {
    text = (await pdf(buf)).text;
  } catch (e) {
    console.error(`  PDF 파싱 실패(${label}): ${e instanceof Error ? e.message : String(e)}`);
    continue;
  }
  const chunks = toChunks(text);
  totalChunks += chunks.length;
  console.log(`${label} → 청크 ${chunks.length}개  (${d.category || '분류없음'})`);
  if (dry) continue;
  if (!chunks.length) {
    console.warn(`  추출 텍스트 없음 — 스캔본(이미지) PDF일 수 있음. 건너뜀.`);
    continue;
  }

  const title = d.title || d.file_name || '';
  const category = d.category || '';
  const embeddings = await embedBatch(chunks.map((c) => `자료실 ${category} ${title} ${c}`));
  const rows = chunks.map((content, i) => ({
    document_id: d.id,
    title,
    category,
    kind: 'reference',
    chunk_index: i,
    content,
    token_count: estimateTokens(content),
    content_hash: hashContent(content),
    embedding: embeddings[i],
  }));

  // 재적재: 기존 청크 제거 후 삽입(멱등). 벡터+HNSW라 큰 배치는 timeout → 200행씩.
  await supabase.from('library_fulltext').delete().eq('document_id', d.id);
  let insErr: string | null = null;
  for (let i = 0; i < rows.length; i += 200) {
    const { error: e } = await supabase.from('library_fulltext').insert(rows.slice(i, i + 200));
    if (e) {
      insErr = e.message;
      break;
    }
  }
  if (insErr) {
    console.error(`  적재 실패(${label}): ${insErr}`);
    continue;
  }
  await supabase
    .from('library_documents')
    .update({ rag_indexed: true, rag_chunks: rows.length, indexed_at: new Date().toISOString() })
    .eq('id', d.id);
  done++;
  console.log(`  ✓ 적재 완료 (${rows.length}청크)`);
}

console.log(
  `\n${dry ? '[DRY] ' : ''}참고자료 ${docs.length}건 · 적재 ${done} · 최신(건너뜀) ${skippedFresh} · 비PDF ${skippedNonPdf} · 총 청크 ${totalChunks}`
);
