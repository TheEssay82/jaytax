/**
 * 상담 회신을 **블록으로 가른다** — 화면은 없다, 규칙만.
 *
 * 회신은 형식이 정해져 있다(consult Edge 의 SYSTEM):
 *   # 제목 / ## 한눈에 / ## 질의요지 / ## 결론 / ## 근거 / ## 실무 유의
 *   적용 법령 시행일: … / --- / ※ 안내
 *
 * 그동안 이 구조를 아무도 쓰지 않고 **글자 그대로** 뿌렸다. 그래서 화면에 `##` 와 `**`
 * 가 그대로 보이고, 결론과 군더더기가 같은 크기로 놓였다. 블록을 알면 블록마다
 * 다른 옷을 입힐 수 있다 — 결론은 크게, 근거는 차분하게.
 *
 * **옛 회신도 깨지지 않아야 한다.** 「한눈에」는 2026-09-10 에 생겼으므로 그전 기록에는
 * 없고, 형식을 안 지킨 회신도 있다. 못 알아본 것은 통째로 `기타` 로 넘겨 그대로 보여 준다.
 */

/** 아는 블록. 그 밖은 `기타`(제목은 title 에 남는다). */
export type SectionKey = '한눈에' | '질의요지' | '결론' | '근거' | '실무유의' | '기타';

export interface DocSection {
  key: SectionKey;
  /** 화면에 쓸 제목. `기타`면 원래 제목 그대로. */
  title: string;
  /** 제목을 뺀 본문(마크다운). */
  body: string;
}

export interface ConsultDoc {
  /** `# …` 한 줄. 없으면 빈 문자열. */
  title: string;
  /** 「한눈에」의 불릿들. 없으면 빈 배열. */
  summary: string[];
  sections: DocSection[];
  /** 「적용 법령 시행일: …」 한 줄(있으면). */
  applied: string;
  /** `---` 아래 안내문. */
  footer: string;
}

/** 제목 글자 → 아는 블록. 띄어쓰기·군더더기를 견딘다(「실무 유의」/「실무유의」). */
function keyOf(title: string): SectionKey {
  const t = title.replace(/\s+/g, '');
  if (t.startsWith('한눈에')) return '한눈에';
  if (t.startsWith('질의요지')) return '질의요지';
  if (t.startsWith('결론')) return '결론';
  if (t.startsWith('근거')) return '근거';
  if (t.startsWith('실무유의')) return '실무유의';
  return '기타';
}

/** `- 한 줄` 형태의 불릿만 뽑는다. 굵게 표시는 벗긴다 — 요약은 짧게 읽는 자리다. */
export function bullets(body: string): string[] {
  return body.split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*•]\s+/.test(l))
    .map((l) => l.replace(/^[-*•]\s+/, '').replace(/\*\*/g, '').trim())
    .filter(Boolean);
}

export function parseConsultDoc(md: string): ConsultDoc {
  const lines = String(md ?? '').replace(/\r/g, '').split('\n');
  const doc: ConsultDoc = { title: '', summary: [], sections: [], applied: '', footer: '' };

  let cur: { title: string; lines: string[] } | null = null;
  const head: string[] = [];      // 첫 ## 앞에 있는 것(제목 빼고)
  let inFooter = false;
  const footer: string[] = [];

  const close = () => {
    if (!cur) return;
    const body = cur.lines.join('\n').trim();
    doc.sections.push({ key: keyOf(cur.title), title: cur.title, body });
    cur = null;
  };

  for (const raw of lines) {
    const t = raw.trim();

    if (inFooter) { footer.push(raw); continue; }

    // 본문이 끝나고 안내가 시작되는 자리
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { close(); inFooter = true; continue; }

    const h1 = t.match(/^#\s+(.*)$/);
    if (h1 && !doc.title && !cur) { doc.title = h1[1].trim(); continue; }

    const h2 = t.match(/^##\s+(.*)$/);
    if (h2) { close(); cur = { title: h2[1].trim(), lines: [] }; continue; }

    // 「적용 법령 시행일: …」 은 어느 블록에도 속하지 않는 꼬리말이다.
    if (/^적용\s*법령\s*시행일\s*[:：]/.test(t)) { doc.applied = t; continue; }

    if (cur) cur.lines.push(raw); else if (t) head.push(raw);
  }
  close();

  // ## 이 하나도 없던 회신(옛 기록·형식 밖) — 통째로 하나의 블록으로 보여 준다.
  if (!doc.sections.length && head.length) {
    doc.sections.push({ key: '기타', title: '', body: head.join('\n').trim() });
  } else if (head.length) {
    // 제목과 첫 ## 사이에 낀 글이 있으면 맨 앞에 둔다(버리지 않는다).
    doc.sections.unshift({ key: '기타', title: '', body: head.join('\n').trim() });
  }

  doc.summary = bullets(doc.sections.find((s) => s.key === '한눈에')?.body ?? '');
  doc.footer = footer.join('\n').trim();
  return doc;
}

/**
 * 슬라이드·목록 미리보기에 쓸 **세 줄**.
 *
 * 「한눈에」가 있으면 그것을, 없으면(옛 회신) 「결론」의 불릿이나 첫 문장들로 대신한다 —
 * 목록에서 결론이 보이는 것이 요점이지, 블록 이름이 요점이 아니다.
 */
export function summaryLines(md: string, max = 3): string[] {
  const doc = parseConsultDoc(md);
  if (doc.summary.length) return doc.summary.slice(0, max);

  const concl = doc.sections.find((s) => s.key === '결론')?.body ?? '';
  const bs = bullets(concl);
  if (bs.length) return bs.slice(0, max);

  // 불릿이 없으면 문장으로 자른다. 번호매김(1., 2.)도 한 줄로 본다.
  return concl.split('\n')
    .map((l) => l.trim().replace(/^\d+[.)]\s*/, '').replace(/\*\*/g, ''))
    .filter(Boolean)
    .slice(0, max);
}
