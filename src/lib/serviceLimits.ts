// 외부 서비스 요금제 한도와 그 판정. supabase 를 물지 않는다(테스트가 돌아야 하므로).
//
// **왜 필요한가** — 한도를 넘기면 어느 날 갑자기 막힌다. 미리 알면 요금제를 올리거나
// 자료를 줄일 시간이 있다. 2026-09-04 기준 DB 가 이미 무료 한도의 44% 였고,
// 그중 179MB 가 회계기준 전문 하나였다(아직 채울 기준서가 남아 있다).

/** 한도에 얼마나 다가갔는가. */
export type LimitLevel = 'ok' | 'warn' | 'critical' | 'over';

/** 경고를 띄우는 지점. 70% 에서 알리고 90% 부터 급하다고 본다. */
export const WARN_AT = 0.70;
export const CRITICAL_AT = 0.90;

export interface UsageLimit {
  key: string;
  /** 화면에 쓰는 이름 */
  label: string;
  /** 무료 플랜 한도. null = 한도가 없거나 우리가 알 수 없음(표시만 한다). */
  limit: number | null;
  /** 'bytes' 면 크기로, 'count' 면 개수로 보인다. */
  unit: 'bytes' | 'count';
  /** 한도를 넘기면 무슨 일이 생기는가 — 경고에 그대로 쓴다. */
  consequence: string;
}

/**
 * Supabase 무료 플랜 한도(2026-09 기준).
 * ⚠️ 요금제는 바뀐다. 경고가 뜨면 **숫자를 그대로 믿지 말고** 콘솔에서 현재 한도를 확인할 것.
 */
export const SUPABASE_FREE: UsageLimit[] = [
  {
    key: 'db', label: '데이터베이스', limit: 500 * 1024 * 1024, unit: 'bytes',
    consequence: '한도를 넘기면 쓰기가 막힙니다 — 청구·계약 등록이 안 됩니다.',
  },
  {
    key: 'storage', label: '파일 저장소', limit: 1024 * 1024 * 1024, unit: 'bytes',
    consequence: '한도를 넘기면 파일을 더 올릴 수 없습니다(증빙·기준서 PDF·발송 첨부).',
  },
  {
    key: 'users', label: '가입 계정', limit: 50_000, unit: 'count',
    consequence: '월 활성 사용자 기준입니다. 사내 인원 규모로는 닿을 일이 없습니다.',
  },
];

/** 쓴 양 ÷ 한도. 한도를 모르면 null. */
export function ratioOf(used: number | null, limit: number | null): number | null {
  if (used == null || limit == null || limit <= 0) return null;
  return used / limit;
}

/** 비율 → 등급. 한도를 모르면 'ok'(경고하지 않는다 — 모르는 것으로 겁주지 않는다). */
export function levelOf(ratio: number | null): LimitLevel {
  if (ratio == null) return 'ok';
  if (ratio >= 1) return 'over';
  if (ratio >= CRITICAL_AT) return 'critical';
  if (ratio >= WARN_AT) return 'warn';
  return 'ok';
}

/** 여러 항목 중 가장 나쁜 등급 — 화면 위에 띄울 한 줄을 정할 때 쓴다. */
export function worstLevel(levels: LimitLevel[]): LimitLevel {
  const order: LimitLevel[] = ['ok', 'warn', 'critical', 'over'];
  return levels.reduce((w, l) => (order.indexOf(l) > order.indexOf(w) ? l : w), 'ok' as LimitLevel);
}

export const LEVEL_LABEL: Record<LimitLevel, string> = {
  ok: '여유 있음',
  warn: '살펴볼 때',
  critical: '곧 한도',
  over: '한도 넘음',
};

/** 바이트를 사람이 읽는 크기로. 소수 한 자리까지. */
export function humanBytes(n: number | null): string {
  if (n == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : Math.round(v * 10) / 10}${u[i]}`;
}

/** 사람이 읽는 사용량 문구 — 크기든 개수든. */
export function humanUsed(used: number | null, unit: 'bytes' | 'count'): string {
  if (used == null) return '—';
  return unit === 'bytes' ? humanBytes(used) : used.toLocaleString('ko-KR');
}

/**
 * 앱에서 잴 수 없는 서비스들 — **잊지 않으려고 적어 둔다.**
 * Vercel 대역폭이나 API 사용량은 각자 콘솔에서 봐야 한다.
 */
export interface ExternalService {
  name: string;
  plan: string;
  /** 무엇을 확인해야 하는가. **일반 텍스트다** — 별표를 쓰면 그대로 화면에 보인다. */
  watch: string;
  url: string;
}

export const EXTERNAL_SERVICES: ExternalService[] = [
  {
    name: 'Vercel', plan: 'Hobby(무료)',
    watch: '월 대역폭·빌드 시간. 사내 인원만 쓰므로 여유가 크지만, 상업적 용도로 보이면 Pro 로 올리라는 안내가 올 수 있습니다.',
    url: 'https://vercel.com/dashboard',
  },
  {
    name: 'Supabase', plan: 'Free',
    watch: '이 화면의 수치가 그것입니다. 무료 플랜은 일주일 아무도 안 쓰면 일시정지되는데, 매일 쓰는 앱이라 해당되지 않습니다.',
    url: 'https://supabase.com/dashboard/project/rboqmlwwwgrntasftwki/settings/billing',
  },
  {
    name: 'Anthropic API', plan: '사용한 만큼',
    watch: '상담·AI 기능이 쓰는 만큼 과금됩니다. 앱 안 「AI 사용량」 화면에서도 봅니다.',
    url: 'https://console.anthropic.com/settings/usage',
  },
  {
    name: 'OpenAI API', plan: '사용한 만큼',
    watch: '쓰는 곳이 줄었다면 키를 정리해도 됩니다.',
    url: 'https://platform.openai.com/usage',
  },
];
