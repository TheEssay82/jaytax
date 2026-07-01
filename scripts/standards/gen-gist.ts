// 요지 정리본 자동 생성 — 원문 PDF → Claude 요약 → accounting-standards/*.md (파싱 규약 준수)
// 1115호는 손으로 정밀 작성됨. 다른 기준서는 원문 PDF 텍스트를 근거로 Claude가 '요지'를 생성한다.
// 생성된 .md는 기존 parse-md → load 파이프라인으로 적재한다(요지는 항상 "(요지)"·원문 대조 권고 규약).
//
// 사용: npm run std:gen:gist -- "<PDF폴더|PDF파일>" [--no <번호>] [--model <id>] [--dry] [--overwrite]
//   --no        : 특정 기준서 번호만 (예: --no 1116). 없으면 폴더 내 전 PDF.
//   --model     : Claude 모델 (기본 claude-sonnet-4-6). 고품질은 claude-opus-4-8.
//   --dry       : Claude 호출/파일쓰기 없이 대상·청크(윈도) 수만 출력.
//   --overwrite : 이미 존재하는 .md도 덮어씀(기본은 건너뜀 — 1115 등 손작성 보호).
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, basename, extname } from 'node:path';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { loadEnv, requireEnv, ROOT } from './lib.ts';
import { CATALOG } from '../../src/lib/standardsCatalog.ts';

// ── 카탈로그 조회 (upload-pdfs / load-pdf-fulltext 와 동일 규약) ──
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
  if (/재무보고를[_\s]*위한[_\s]*개념체계/.test(b)) return '개념체계';
  return null;
}

// ── PDF 원문 정제 ──────────────────────────────────────────
// 요약용이므로 구조(문단번호·헤딩)를 최대한 보존한다. 페이지 마커·머리말/꼬리말만 제거.
function koreanRatio(s: string): number {
  const nonSpace = s.replace(/\s/g, '');
  if (!nonSpace) return 0;
  return (nonSpace.match(/[가-힣]/g) || []).length / nonSpace.length;
}
function cleanPdfText(raw: string): string {
  return raw
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !/^[-\s]*\d{1,4}[-\s]*$/.test(l)) // "- 12 -" 페이지 마커
    .filter((l) => !/^K-IFRS\b.*$/.test(l) || l.length > 20) // 짧은 머리말 제거, 본문줄은 유지
    .join('\n');
}

// 기준서 '본문'만 남긴다. K-IFRS PDF는 [본문+부록] 뒤에 [적용사례·실무적용지침][결론도출근거]가 붙는데,
// 이들은 "기준서를 구성하지 않는" 참고자료(각 PDF 서두에 명시)이므로 요지 대상에서 제외한다.
// 규칙: 목차 구간(앞 5%)을 지난 뒤, 줄 시작이 아래 부클릿 헤더인 최초 지점에서 절단.
const SUPPLEMENT_RE = /^(적용사례|실무적용지침|결론도출근거)(\s|·|$)/;
function trimToBody(text: string): { body: string; cutPct: number | null } {
  const guard = Math.floor(text.length * 0.05);
  const lines = text.split('\n');
  let off = 0;
  for (const ln of lines) {
    if (off > guard && SUPPLEMENT_RE.test(ln.trim())) {
      return { body: text.slice(0, off), cutPct: (100 * off) / text.length };
    }
    off += ln.length + 1;
  }
  return { body: text, cutPct: null };
}

// 긴 원문을 Claude 컨텍스트에 맞게 윈도로 분할(문단 경계 우선, 겹침).
// 윈도 입력이 출력(max_tokens)보다 지나치게 크면 뒷부분(부록 등)이 요약 누락되므로 작게 자른다.
function windows(text: string, size = 22000, overlap = 2000): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + size, text.length);
    if (end < text.length) {
      // 가까운 줄바꿈에서 끊어 문단이 잘리지 않게
      const nl = text.lastIndexOf('\n', end);
      if (nl > i + size * 0.6) end = nl;
    }
    out.push(text.slice(i, end));
    if (end >= text.length) break;
    i = end - overlap;
  }
  return out;
}

// ── Claude 호출 ────────────────────────────────────────────
const SYSTEM = `너는 한국채택국제회계기준(K-IFRS) 원문에서 '요지 정리본'을 만드는 편집자다.
아래 원문 발췌를 읽고, 마크다운 본문을 만든다. 목적은 실무 검색·열람용 요지이며 원문 verbatim 복제가 아니다.

[반드시 지킬 출력 규약 — 파서가 결정적으로 읽는다]
- 마크다운 '본문'만 출력한다. 프런트매터(---), 코드펜스(\`\`\`), 문서 제목(#), 해설 문장은 절대 넣지 않는다.
- 대분류는 '## '로 시작한다: 조문 본문은 '## 본문', 부록은 '## 부록A 용어정의' / '## 부록B 적용지침' / '## 부록C 시행일' 처럼.
  긴 본문이 여러 단계·주제로 나뉘면 '## 본문 — <주제>' 형태로 나눠도 된다.
- 절 제목은 '### '로 시작한다. 원문에 '제N장 ...' 장 구분이 있으면 '### 제N장 <제목>'으로 쓴다.
- 각 문단은 '**§<번호>** <요지>' 한 줄(또는 여러 줄)로 쓴다.
  · <번호>는 반드시 원문에 실제로 있는 문단번호를 그대로 쓴다(예: 1, 12, B34, A3, 5.1). 번호를 지어내지 마라.
  · 원문이 문단번호 없이 서술되면 그 부분은 생략하거나 직전 문단에 붙인다(가짜 번호 금지).
  · 연속 문단을 하나로 묶으면 '**§110~129**'처럼 범위로 표기한다.
  · 한국채택 특수문단(예: 2.1, 5.1, 한32.1)이 원문에 있으면 그 번호를 그대로 보존한다(누락 금지).
- 부록 A 용어정의는 각 용어를 '**§<용어>** <정의>' 형태로 쓴다(예: '**§리스** ...'). 용어 자체를 번호 자리에 둔다.
- <요지>는 한국어로, 원문의 핵심 요건·기준·예외를 1~3문장으로 압축한다. 수치·비율·기준일은 원문 표현을 최대한 보존한다.
- 원문에 없는 내용을 추가하거나 추론하지 않는다. 발췌에 담긴 범위만 다룬다.`;

async function callClaude(model: string, key: string, userText: string): Promise<string> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content: userText }],
    }),
  });
  if (!r.ok) throw new Error(`Claude 실패 ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return (data.content ?? []).map((c: { text?: string }) => c.text ?? '').join('').trim();
}

// 코드펜스·프런트매터가 섞여 나오면 제거(방어).
function sanitizeBody(md: string): string {
  let s = md.trim();
  s = s.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '').trim();
  if (s.startsWith('---')) {
    const m = s.match(/^---[\s\S]*?---\s*/);
    if (m) s = s.slice(m[0].length).trim();
  }
  // Claude가 섹션 사이에 넣는 수평선(---, ***, ___)은 문단 본문에 섞이므로 제거.
  s = s
    .split('\n')
    .filter((l) => !/^\s*([-*_]\s*){3,}\s*$/.test(l))
    .join('\n');
  return s.trim();
}

function frontMatter(set: string, no: string, title: string): string {
  return [
    '---',
    `standard_set: ${set}`,
    `standard_no: "${no}"`,
    `standard_title: ${title}`,
    'revised_date: ',
    `source: ${set} 제${no}호 — 원문 PDF 기반 요지 정리본(Claude 생성, 원문 verbatim 아님)`,
    'schema_version: 1',
    'generator: gen-gist',
    '---',
    '',
    `# ${set} 제${no}호 — ${title}`,
    '',
    '> **이 파일의 성격**: 원문 PDF를 근거로 자동 생성한 *요지 정리본*이다(사람 검수 권장).',
    '> 각 문단 content는 원문 요지이며, 인용·답변 시 반드시 문단번호로 공식 원문을 대조한다.',
    '',
  ].join('\n');
}

// ── 실행 ──────────────────────────────────────────────────
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const overwrite = args.includes('--overwrite');
const full = args.includes('--full'); // 참고자료(적용사례·결론도출근거)까지 포함
const onlyNo = args.includes('--no') ? args[args.indexOf('--no') + 1] : null;
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'claude-sonnet-4-6';
const folderArg = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--no' && args[i - 1] !== '--model');
if (!folderArg) {
  console.error('사용: npm run std:gen:gist -- "<PDF폴더|PDF파일>" [--no <번호>] [--model <id>] [--dry] [--overwrite]');
  process.exit(1);
}

loadEnv();
const apiKey = dry ? '' : requireEnv('ANTHROPIC_API_KEY');

const rootPath = resolve(folderArg);
const files: string[] = [];
if (statSync(rootPath).isDirectory()) {
  (function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (extname(name).toLowerCase() === '.pdf') files.push(p);
    }
  })(rootPath);
} else {
  files.push(rootPath);
}

let generated = 0, skipped = 0;
for (const file of files) {
  const no = extractNo(basename(file, extname(file)));
  if (!no) { skipped++; continue; }
  if (onlyNo && no !== onlyNo) continue;
  const set = setsForNo(no)[0] ?? 'K-IFRS';
  const title = titleForNo(no);
  const outPath = resolve(ROOT, `accounting-standards/${set.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${no}.md`);

  if (existsSync(outPath) && !overwrite) {
    console.log(`· ${set} 제${no}호 — 이미 존재, 건너뜀 (덮어쓰려면 --overwrite): ${basename(outPath)}`);
    skipped++;
    continue;
  }

  const data = await pdf(readFileSync(file));
  const cleaned = cleanPdfText(data.text);
  const { body: text, cutPct } = full ? { body: cleaned, cutPct: null } : trimToBody(cleaned);
  const wins = windows(text);
  const kr = koreanRatio(text);
  const trimNote = cutPct != null ? ` · 본문트림 ${cutPct.toFixed(0)}%(적용사례·BC 제외)` : full ? ' · 전체포함' : ' · 트림지점없음';
  console.log(`${set} 제${no}호 · ${data.numpages}p · ${cleaned.length}→${text.length}자 · 한글${(kr * 100).toFixed(0)}%${trimNote} → 윈도 ${wins.length}개  (${title.slice(0, 24)})`);
  if (dry) continue;

  const parts: string[] = [];
  for (let w = 0; w < wins.length; w++) {
    const head = w === 0
      ? ''
      : `(이 발췌는 앞 발췌에 이어지는 부분이다. 앞에서 이미 다룬 문단은 반복하지 말고, 이 발췌의 문단부터 이어서 작성하라.)\n\n`;
    const user = `${head}[기준서] ${set} 제${no}호 「${title}」 (발췌 ${w + 1}/${wins.length})\n\n[원문 발췌]\n${wins[w]}`;
    process.stdout.write(`  Claude 요약 ${w + 1}/${wins.length}...\r`);
    const body = sanitizeBody(await callClaude(model, apiKey, user));
    if (body) parts.push(body);
  }
  process.stdout.write('\n');

  const md = frontMatter(set, no, title) + '\n' + parts.join('\n\n') + '\n';
  writeFileSync(outPath, md, 'utf8');
  generated++;
  console.log(`  ✓ 생성: ${outPath}`);
}

console.log(`\n${dry ? '[DRY] ' : ''}대상 ${files.length} · 생성 ${generated} · 건너뜀 ${skipped}`);
if (generated && !dry) {
  console.log('\n다음 단계(생성된 각 .md):');
  console.log('  npm run std:parse:md -- <생성된 .md> --inspect   # 파싱 검수');
  console.log('  npm run std:parse:md -- <생성된 .md>             # 문단 JSON 저장');
  console.log('  npm run std:load -- scripts/standards/data/<...>.paragraphs.json   # 적재');
}
