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

/**
 * 한 장에 담는 불릿의 **개수** 상한과 **길이** 예산.
 *
 * 처음에는 개수만 셌다(5개씩). 그런데 근거 줄은 조문 원문 인용에 쉬운 말 풀이까지
 * 붙어 한 줄이 200자를 넘기도 한다. 다섯 개를 담으면 판 밖으로 넘쳐 **말없이 잘렸다.**
 * 슬라이드에서 글이 잘리는 것은 못 읽는 것보다 나쁘다 — 잘린 줄 모르기 때문이다.
 *
 * 그래서 **길이로 먼저 재고 개수로 막는다.** 짧은 줄(실무 유의 같은)은 개수 상한까지,
 * 긴 줄(근거)은 두어 개에서 끊긴다.
 */
export const BULLETS_PER_SLIDE = 6;
/** 불릿 한 장의 글자 수 예산. 16:9 판에서 열 줄 남짓이 들어가는 양(실측). */
export const BULLET_CHARS = 520;
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

/** 불릿 한 줄의 길이 — 앞머리와 나머지를 합친 글자 수. */
const bulletLen = (b: SlideBullet) => b.lead.length + b.rest.length;

/**
 * 불릿을 **길이 예산 + 개수 상한**으로 묶는다.
 *
 * 한 줄이 예산보다 길어도 버리지 않는다 — 혼자 한 장을 쓴다. 쪼개면 인용이 두 동강 나고,
 * 빼면 근거가 사라진다. 넘치는 것이 그중 낫다.
 */
export function packBullets(items: SlideBullet[], chars = BULLET_CHARS, max = BULLETS_PER_SLIDE): SlideBullet[][] {
  const out: SlideBullet[][] = [];
  let cur: SlideBullet[] = [];
  let len = 0;
  for (const b of items) {
    const n = bulletLen(b);
    if (cur.length && (cur.length >= max || len + n > chars)) { out.push(cur); cur = []; len = 0; }
    cur.push(b);
    len += n;
  }
  if (cur.length) out.push(cur);
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
      const pages = packBullets(bs.map(splitBullet));
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
