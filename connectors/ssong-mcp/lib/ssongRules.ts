// 쏭비서 규칙 — 정본은 GitHub 비공개 저장소 TheEssay82/ssong 의 CLAUDE.md.
// 런타임에 읽어 10분 캐시하고, 못 읽으면 마지막으로 읽은 것 → 아주 짧은 기본 규칙 순으로 쓴다.
// 텔레그램과 상관없는 절(이 PC 주의·연결된 것)은 뺀다. 열쇠는 Vercel env SSONG_GITHUB_TOKEN(읽기 전용).

const REPO = process.env.SSONG_RULES_REPO?.trim() || 'TheEssay82/ssong';
const PATH = 'CLAUDE.md';
const TTL_MS = 10 * 60 * 1000;

/** 텔레그램 봇에는 필요 없는 절(## 제목 앞부분으로 맞춘다). */
const DROP = ['이 PC에서 주의할 것', '연결된 것'];

export const FALLBACK_RULES = [
  '# 쏭비서 (규칙 원본을 읽지 못해 기본 규칙만)',
  '- 조회·정리, 장부 갱신, 할 일 등록은 묻지 않고 한다.',
  '- 메일·메시지 발송, 일정 초대·수락, 거래처에 나가는 것, 할 일 영구 삭제는 하지 않는다.',
  '- 장부를 고칠 때는 들은 것만, 「최근 경과」는 맨 앞에 덧붙이고 원래 글은 남긴다.',
].join('\n');

/** CLAUDE.md 에서 DROP 절을 빼고 돌려준다. */
export function pickSections(md: string): string {
  const parts = md.replace(/\r\n/g, '\n').split(/^(?=## )/m);
  return parts
    .filter((p) => !DROP.some((d) => p.startsWith(`## ${d}`)))
    .join('')
    .trim();
}

let cache: { text: string; at: number } | null = null;

export async function ssongRules(now = Date.now()): Promise<{ text: string; source: 'github' | 'cache' | 'fallback' }> {
  if (cache && now - cache.at < TTL_MS) return { text: cache.text, source: 'cache' };
  const token = (process.env.SSONG_GITHUB_TOKEN ?? '').trim();
  if (token) {
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${PATH}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw+json', 'User-Agent': 'ssong-mcp', 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const text = pickSections(await res.text());
        if (text) { cache = { text, at: now }; return { text, source: 'github' }; }
      } else console.warn('ssong rules fetch', res.status);
    } catch (e) { console.warn('ssong rules fetch failed', e instanceof Error ? e.message : e); }
  }
  if (cache) return { text: cache.text, source: 'cache' }; // 오래됐어도 기본 규칙보다 낫다
  return { text: FALLBACK_RULES, source: 'fallback' };
}

export function _resetRulesCache() { cache = null; }
