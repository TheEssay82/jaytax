// 마크다운 단일 소스 파서 (결정적)
// accounting-standards/*.md 의 파싱 규약을 그대로 따른다(휴리스틱 없음):
//   - 프런트매터(--- ... ---): 기준서 수준 메타(standard_set/no/title/revised_date/source)
//   - '## '  헤딩 → part (본문 / 부록A 용어정의 / 부록B 적용지침 / 부록C 시행일)
//             '본문 — <장>' 형태면 em-dash 뒤를 chapter_title 로 사용
//   - '### ' 헤딩 → section_title. '제N장 ...' 이면 chapter_no/title 도 분리
//   - '**§<번호>**' 로 시작하는 줄 → 새 문단. 번호 범위(110~129)는 시작번호로 저장
//   - '>' 블록인용, '# ' H1, 프런트매터 본문은 무시
import type { ParsedParagraph, ParseMeta } from './lib.ts';
import { estimateTokens } from './lib.ts';

// 문단번호 토큰: 선택적 접두(B·C·A 또는 한국문단 '한') + 숫자 + 다단계 소수점(3.2.14 등 IFRS9식) + 선택적 접미문자(A·D 등)
// 범위(~) 허용. 예: 12, B34, C20D, 46A, 2.1, 3.2.14, 한2.1.1, 110~129
const NO = String.raw`(?:[A-Za-z]|한)?\d+(?:\.\d+)*[A-Za-z]?`;
const PARA_RE = new RegExp(String.raw`^\*\*§\s*(${NO}(?:~${NO})?)\s*\*\*\s*(.*)$`);

function normalizePart(headingText: string): { part: string; chapter: string | null } {
  const t = headingText.trim();
  if (/^부록\s*A/i.test(t)) return { part: '부록A 용어정의', chapter: null };
  if (/^부록\s*B/i.test(t)) return { part: '부록B 적용지침', chapter: null };
  if (/^부록\s*C/i.test(t)) return { part: '부록C 시행일', chapter: null };
  // '본문 — 1단계: 계약의 식별' → chapter = '1단계: 계약의 식별'
  const dash = t.split(/\s[—–-]\s/);
  const chapter = dash.length > 1 ? dash.slice(1).join(' — ').trim() : null;
  return { part: '본문', chapter };
}

// '### ' 헤딩에서 절 제목과(있으면) 장 번호/제목 추출. 끝의 ' (§..)' 표기는 제거.
function parseSectionHeading(headingText: string): {
  section: string;
  chapterNo: string | null;
  chapterTitle: string | null;
} {
  const clean = headingText.replace(/\s*\(§[^)]*\)\s*$/, '').trim();
  const m = clean.match(/^제\s*(\d+)\s*장\s*(.*)$/);
  if (m) return { section: clean, chapterNo: m[1], chapterTitle: (m[2] || clean).trim() };
  return { section: clean, chapterNo: null, chapterTitle: null };
}

// 프런트매터(맨 앞 --- ... ---)에서 단순 key: value 만 읽는다. 블록 스칼라('>'·'|')는 무시.
export function parseFrontMatter(raw: string): Partial<ParseMeta> & { body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if (val === '>' || val === '|' || val === '') continue; // 블록 스칼라 시작줄은 건너뜀
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    meta[kv[1]] = val;
  }
  return {
    standard_set: meta.standard_set,
    standard_no: meta.standard_no,
    standard_title: meta.standard_title,
    revised_date: meta.revised_date ?? null,
    source: meta.source ?? null,
    body: m[2],
  };
}

/** 마크다운 단일 소스 → 문단 배열. metaOverride 로 프런트매터 값을 덮어쓸 수 있다. */
export function parseMarkdown(raw: string, metaOverride: Partial<ParseMeta> = {}): ParsedParagraph[] {
  const fm = parseFrontMatter(raw);
  const meta: ParseMeta = {
    standard_set: metaOverride.standard_set ?? fm.standard_set ?? 'K-IFRS',
    standard_no: metaOverride.standard_no ?? fm.standard_no ?? '',
    standard_title: metaOverride.standard_title ?? fm.standard_title ?? '',
    revised_date: metaOverride.revised_date ?? fm.revised_date ?? null,
    source: metaOverride.source ?? fm.source ?? null,
  };

  const lines = fm.body.split(/\r?\n/);
  const out: ParsedParagraph[] = [];
  let part = '본문';
  let sectionTitle: string | null = null;
  let chapterNo: string | null = null;
  let chapterTitle: string | null = null;
  let ordinal = 0;
  let cur: ParsedParagraph | null = null;

  const flush = () => {
    if (cur) {
      cur.content = cur.content.trim();
      if (cur.content) out.push(cur);
      cur = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith('> ') || line === '>') {
      // 블록인용(파싱 규약·주석)은 문단에 포함하지 않는다. 진행 중 문단도 닫지 않음.
      continue;
    }
    if (line.startsWith('## ')) {
      flush();
      const np = normalizePart(line.slice(3));
      part = np.part;
      chapterTitle = np.chapter;
      chapterNo = null;
      sectionTitle = null;
      continue;
    }
    if (line.startsWith('### ')) {
      flush();
      const sh = parseSectionHeading(line.slice(4));
      sectionTitle = sh.section;
      if (sh.chapterNo) {
        chapterNo = sh.chapterNo;
        chapterTitle = sh.chapterTitle;
      }
      continue;
    }
    if (line.startsWith('# ')) {
      // H1(문서 제목)은 메타에서 이미 처리. 문단 경계로만 사용.
      flush();
      continue;
    }

    const pm = line.match(PARA_RE);
    if (pm) {
      flush();
      ordinal += 1;
      const paragraphNo = pm[1].split('~')[0].trim(); // 범위는 시작번호로 저장
      cur = {
        standard_set: meta.standard_set,
        standard_no: meta.standard_no,
        standard_title: meta.standard_title,
        part,
        chapter_no: chapterNo,
        chapter_title: chapterTitle,
        section_title: sectionTitle,
        paragraph_no: paragraphNo,
        content: pm[2].trim(),
        ordinal,
        revised_date: meta.revised_date,
        source: meta.source,
      };
      continue;
    }

    // 일반 본문 줄 → 진행 중 문단에 이어붙임(여러 줄 문단 지원)
    if (cur && line) {
      cur.content += (cur.content ? ' ' : '') + line;
    }
  }
  flush();

  for (const p of out) {
    (p as ParsedParagraph & { token_count?: number }).token_count = estimateTokens(p.content);
  }
  return out;
}

/** 파싱 결과 요약(검수용) */
export function summarizeMd(paras: ParsedParagraph[]): string {
  const byPart = new Map<string, number>();
  let maxTok = 0;
  for (const p of paras) {
    byPart.set(p.part, (byPart.get(p.part) || 0) + 1);
    const t = (p as ParsedParagraph & { token_count?: number }).token_count || 0;
    if (t > maxTok) maxTok = t;
  }
  const lines = [`총 ${paras.length} 문단`, `최대 토큰(추정): ${maxTok}`];
  for (const [k, v] of byPart) lines.push(`  - ${k}: ${v}`);
  return lines.join('\n');
}
