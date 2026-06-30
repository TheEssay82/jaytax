// K-IFRS 문단 파서 (휴리스틱 상태기계)
// ⚠️ 실제 PDF 텍스트 추출 결과에 맞춰 정규식/헤딩 규칙을 조정해야 한다.
//    parse.ts --inspect 로 추출 텍스트와 분해 결과를 먼저 확인할 것.
import type { ParsedParagraph, ParseMeta } from './lib.ts';
import { estimateTokens } from './lib.ts';

// 부(part) 전환 키워드 → 표준 라벨
const PART_RULES: { re: RegExp; label: string }[] = [
  { re: /^부록\s*A\b|^부록\s*가\b|용어의?\s*정의/, label: '부록A 용어정의' },
  { re: /^부록\s*B\b|^부록\s*나\b|적용지침/, label: '부록B 적용지침' },
  { re: /^부록\s*C\b|^부록\s*다\b/, label: '부록C' },
  { re: /결론도출근거/, label: '결론도출근거' },
  { re: /설명\s*사례|적용\s*사례|예제/, label: '적용사례' },
];

// 문단번호 패턴: 본문 '31', '105A' / 부록 'B2', 'B2A' / 사례 'IE3' / 결론근거 'BC4'
//  줄 시작에서 번호 + 공백 + 내용
const PARA_RE = /^(BC\d+[A-Z]?|IE\d+[A-Z]?|B\d+[A-Z]?|C\d+[A-Z]?|\d+[A-Z]?)\s+(\S.*)$/;

// 헤딩(절 제목) 후보: 번호 없이 짧은 한 줄, 문장부호로 끝나지 않음
function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 40) return false;
  if (PARA_RE.test(t)) return false;
  if (/[.。:,)]\s*$/.test(t)) return false; // 문장/절로 이어지는 줄 제외
  // 페이지번호/머리글 잡음 제거
  if (/^\d+$/.test(t)) return false;
  return true;
}

// 절 경계 판정: 헤딩 후보이면서, 바로 다음 비어있지 않은 줄이
//  번호 문단·부 전환·또 다른 헤딩이어야 진짜 헤딩으로 본다(본문 줄바꿈과 구분).
function isSectionBoundary(lines: string[], i: number): boolean {
  if (!looksLikeHeading(lines[i])) return false;
  for (let j = i + 1; j < lines.length; j++) {
    const next = lines[j].trim();
    if (!next) continue;
    if (PARA_RE.test(next)) return true;
    if (PART_RULES.some((r) => r.re.test(next))) return true;
    return looksLikeHeading(next); // 헤딩이 연속되는 경우(장 제목+절 제목)
  }
  return false;
}

/**
 * 추출된 평문 텍스트 → 문단 배열.
 * 한 문단은 번호 라인에서 시작해 다음 번호/헤딩/부 전환 전까지의 줄을 이어붙인다.
 */
export function parseStandardText(rawText: string, meta: ParseMeta): ParsedParagraph[] {
  const lines = rawText
    .replace(/ /g, ' ')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/g, ''));

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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (cur) cur.content += '\n';
      continue;
    }

    // 부(part) 전환?
    const partHit = PART_RULES.find((r) => r.re.test(line));
    if (partHit && !PARA_RE.test(line)) {
      flush();
      part = partHit.label;
      sectionTitle = null;
      continue;
    }

    // 문단 시작?
    const m = line.match(PARA_RE);
    if (m) {
      flush();
      ordinal += 1;
      cur = {
        standard_set: meta.standard_set,
        standard_no: meta.standard_no,
        standard_title: meta.standard_title,
        part,
        chapter_no: chapterNo,
        chapter_title: chapterTitle,
        section_title: sectionTitle,
        paragraph_no: m[1],
        content: m[2],
        ordinal,
        revised_date: meta.revised_date,
        source: meta.source,
      };
      continue;
    }

    // 헤딩(절 제목)? — 다음 줄 lookahead 로 본문 줄바꿈과 구분. 절 경계이면 현재 문단을 닫는다.
    if (isSectionBoundary(lines, i)) {
      flush();
      sectionTitle = line;
      continue;
    }

    // 일반 본문 줄 → 현재 문단에 이어붙임
    if (cur) {
      cur.content += (cur.content.endsWith('\n') ? '' : ' ') + line;
    }
    // cur 가 없고 헤딩도 아닌 떠도는 줄(표지/머리글 등)은 무시
  }
  flush();

  // 토큰 추정 부가
  for (const p of out) (p as ParsedParagraph & { token_count?: number }).token_count = estimateTokens(p.content);
  return out;
}

/** 파싱 결과 요약 통계 (검수용) */
export function summarize(paras: ParsedParagraph[]): string {
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
