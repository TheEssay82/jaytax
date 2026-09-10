/**
 * 회신을 **슬라이드로 자른다** — 화면은 없다, 규칙만.
 *
 * 왜 자르는 규칙이 따로 필요한가: 슬라이드는 **한 장에 들어가는 양이 정해져 있다.**
 * 근거가 여덟 개인 회신을 한 장에 밀어 넣으면 글자가 깨알이 되어 아무도 못 읽는다.
 * 그래서 블록을 그대로 옮기지 않고 **읽을 수 있는 크기로 쪼갠다.**
 *
 * 지금은 화면에서 넘겨 보는 용도지만, 나중에 이미지·PDF 로 뽑을 것을 염두에 두고
 * **슬라이드 한 장을 독립된 값**으로 만든다. 그래야 그리는 쪽만 바꾸면 그대로 내보낼 수 있다.
 */
import { bullets, parseConsultDoc, type SectionKey } from './consultDoc';

/** 한 장에 담는 불릿 수. 멀리서도 읽히려면 이 정도가 한계다. */
export const BULLETS_PER_SLIDE = 5;
/** 줄글 한 장의 글자 수 목표. 문단 경계에서만 자르므로 넘칠 수 있다. */
export const PROSE_PER_SLIDE = 420;

/** 불릿 한 줄 — 앞머리(조문명·항목명)와 나머지. 슬라이드에서 크기를 달리 준다. */
export interface SlideBullet { lead: string; rest: string }

export type Slide =
  | { kind: 'cover'; title: string; meta: string }
  | { kind: 'glance'; lines: string[] }
  | { kind: 'bullets'; label: string; accent: SectionKey; items: SlideBullet[]; part: number; parts: number }
  | { kind: 'prose'; label: string; accent: SectionKey; text: string; part: number; parts: number }
  | { kind: 'end'; applied: string; footer: string };

/**
 * 불릿을 앞머리와 나머지로 가른다.
 *
 * 근거 줄은 대개 `**법인세법 제21조** — "원문" (→ 풀이)` 꼴이다. 조문명을 크게,
 * 인용을 작게 놓으면 한눈에 무엇에 관한 근거인지 잡힌다.
 */
export function splitBullet(s: string): SlideBullet {
  const t = String(s ?? '').trim();
  const bold = t.match(/^\*\*(.+?)\*\*\s*(?:[—–-]\s*)?([\s\S]*)$/);
  if (bold) return { lead: bold[1].trim(), rest: bold[2].trim() };
  const dash = t.match(/^([\s\S]{1,60}?)\s+[—–]\s+([\s\S]+)$/);
  if (dash) return { lead: dash[1].trim(), rest: dash[2].trim() };
  return { lead: t, rest: '' };
}

/** n개씩 끊는다. 빈 배열이면 빈 결과. */
export function chunk<T>(items: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/**
 * 줄글을 **문단 경계에서** 묶는다.
 *
 * 글자 수로 뚝 자르면 문장이 끊긴다. 문단을 채워 가다 목표를 넘으면 거기서 한 장을 닫는다.
 * 문단 하나가 목표보다 크면 그 문단은 혼자 한 장을 쓴다 — 쪼개서 뜻을 잃느니 넘치는 게 낫다.
 */
export function packProse(text: string, per = PROSE_PER_SLIDE): string[] {
  const paras = String(text ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const p of paras) {
    if (!cur) { cur = p; continue; }
    if (cur.length + p.length + 2 > per) { out.push(cur); cur = p; continue; }
    cur += `\n\n${p}`;
  }
  if (cur) out.push(cur);
  return out;
}

/** 블록 제목 — 화면 라벨과 같은 말을 쓴다. */
function labelOf(key: SectionKey, title: string): string {
  if (key === '결론') return '결론';
  if (key === '근거') return '근거';
  if (key === '실무유의') return '실무 유의';
  if (key === '질의요지') return '질의요지';
  return title || '';
}

/**
 * 회신 → 슬라이드.
 *
 * 표지 · 한눈에 · (질의요지는 뺀다 — 내가 쓴 질문을 다시 띄울 자리가 아니다) ·
 * 결론 · 근거 · 실무 유의 · 마무리.
 */
export function toSlides(md: string, meta = ''): Slide[] {
  const doc = parseConsultDoc(md);
  const out: Slide[] = [];

  if (doc.title) out.push({ kind: 'cover', title: doc.title, meta });
  if (doc.summary.length) out.push({ kind: 'glance', lines: doc.summary });

  for (const sec of doc.sections) {
    if (sec.key === '한눈에' || sec.key === '질의요지') continue;
    const label = labelOf(sec.key, sec.title);

    const bs = bullets(sec.body);
    if (bs.length) {
      const pages = chunk(bs.map(splitBullet), BULLETS_PER_SLIDE);
      pages.forEach((items, i) => out.push({
        kind: 'bullets', label, accent: sec.key, items, part: i + 1, parts: pages.length,
      }));
      continue;
    }

    const pages = packProse(sec.body);
    pages.forEach((text, i) => out.push({
      kind: 'prose', label, accent: sec.key, text, part: i + 1, parts: pages.length,
    }));
  }

  if (doc.applied || doc.footer) out.push({ kind: 'end', applied: doc.applied, footer: doc.footer });
  return out;
}
