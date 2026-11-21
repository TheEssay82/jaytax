// 아침 브리핑 — 평일 아침 대표님 텔레그램으로(대표님 2026-11-21). AI 없이 읽기 함수만 → 비용 없음.
//
//   · 지난 근무일 이후 생긴 일(월요일은 금~일) · 오늘 감사 일정 · 결재 대기 · 판단 필요한 감사이슈 · 오래된 미수금
//   · Vercel Cron(vercel.json) 이 /briefing 을 부른다. CRON_SECRET 이 맞아야 하고, 같은 날 두 번 오면 한 번만 보낸다.
//   · 텔레그램에서 /brief 로 아무 때나 받아 볼 수도 있다.
//   · 네이버웍스 요약(메일·일정·연차·회의)은 Claude 앱 예약 작업 「웍스 아침 브리핑」(평일 08:50)이 만들어
//     쏭비서 커넥터 send_morning_briefing 으로 넘긴다 → 여기서 JAYTAX 브리핑과 합쳐 한 통으로 보낸다.
//     그 작업이 안 돌면(PC·앱 꺼짐 등) Vercel Cron(평일 09시대)이 JAYTAX 부분만 보낸다. 같은 날 한 번만.
import { rpc } from './jaytax.js';
import { money, seoulToday, splitMessage } from './tgReports.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type J = any;
const list = (xs: unknown): J[] => (Array.isArray(xs) ? xs : []);
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

/** 한국 날짜 하루 더하기/빼기. */
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dowOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

/** 생긴 일을 볼 기간 — 지난 근무일부터 어제까지(월요일이면 금~일). */
export function digestRange(today: string): { from: string; to: string } {
  const back = dowOf(today) === 1 ? 3 : dowOf(today) === 0 ? 2 : 1;
  return { from: addDays(today, -back), to: addDays(today, -1) };
}

const short = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

export function fmtBriefing(today: string, d: J, audit: J, bill: J, pending: J[]): string {
  const r = digestRange(today);
  const out: string[] = [`🌅 아침 브리핑 · ${short(today)}(${DOW[dowOf(today)]})`];

  // 1. 결재 대기 — 대표님이 하실 일이 맨 위
  if (pending.length) {
    out.push('', `🤖 결재 대기 ${pending.length}건 (JAYTAX 쏭비서 결재함)`, ...pending.slice(0, 5).map((p) => `• ${p.title}`));
  }

  // 2. 오늘 감사 일정
  const days = list(audit?.schedule?.days);
  out.push('', days.length ? `📅 오늘 감사 일정 ${days.length}건` : '📅 오늘 감사 일정 없음');
  out.push(...days.slice(0, 8).map((x) => `• ${x.company} ${x.task ?? x.kind ?? ''}${x.staff ? ` (${Array.isArray(x.staff) ? x.staff.join(', ') : x.staff})` : ''}`));

  // 3. 생긴 일(요약)
  const sec: [string, J[], (x: J) => string][] = [
    ['🆕 새 계약', list(d?.newContracts), (x) => `${x.company} ${money(x.amount)}`],
    ['🧾 발행', list(d?.invoicesIssued), (x) => `${x.company} ${money(x.supply)}`],
    ['💵 수금', list(d?.receipts), (x) => `${x.company} ${money(x.amount)}`],
    ['📮 발송', list(d?.docSends), (x) => `${x.company} ${x.kind} ${x.status}`],
    ['📨 조회서 회수', list(d?.confirmationsCollected), (x) => `${x.company} · ${x.institution}`],
    ['⚠️ 감사이슈', list(d?.auditIssues), (x) => `${x.company} ${x.title}`],
  ];
  const any = sec.some(([, xs]) => xs.length);
  out.push('', `📰 ${r.from === r.to ? short(r.from) : `${short(r.from)}~${short(r.to)}`} 생긴 일${any ? '' : ' — 없음'}`);
  for (const [label, xs, line] of sec) {
    if (!xs.length) continue;
    const sum = label.includes('계약') || label.includes('발행') || label.includes('수금')
      ? ` ${money(xs.reduce((n: number, x: J) => n + Number(x.amount ?? x.supply ?? 0), 0))}` : '';
    out.push(`${label} ${xs.length}건${sum}: ${xs.slice(0, 3).map(line).join(' / ')}${xs.length > 3 ? ` 외 ${xs.length - 3}` : ''}`);
  }

  // 4. 판단 필요한 감사이슈
  const hot = list(audit?.openIssues).filter((x) => x.decisionNeeded);
  if (hot.length) out.push('', `🧭 대표님 판단 필요한 감사이슈 ${hot.length}건`, ...hot.slice(0, 5).map((x) => `• ${x.company} #${x.no} ${x.title}${x.importance === '높음' ? ' (중요)' : ''}`));

  // 5. 조회서 미회수 · 오래된 미수금(한 줄씩)
  const co = list(audit?.confirmationsOutstanding);
  const notCol = co.reduce((n: number, c: J) => n + Number(c.notCollected ?? 0), 0);
  if (co.length) out.push('', `📨 조회서 남은 회사 ${co.length}곳 (미회수 ${notCol}건)`);
  const od = list(bill?.receivables?.overdue);
  if (od.length) {
    const total = od.reduce((n: number, x: J) => n + Number(x.balance ?? 0), 0);
    out.push(`🧾 90일 넘은 미수금 ${od.length}건 ${money(total)} (${bill?.receivables?.asOfLedger ?? '?'} 말 대장)`);
  }
  out.push('', '자세히: 아래 단추나 말로 물어보세요.');
  return out.join('\n');
}

export async function buildBriefing(now = new Date()): Promise<string> {
  const t = seoulToday(now);
  const r = digestRange(t.ymd);
  const [d, audit, bill, pending] = await Promise.all([
    rpc('ssong_daily_digest', { p_from: r.from, p_to: r.to }),
    rpc('ssong_audit_watch', { p_from: t.ymd, p_days: 1 }),
    rpc('ssong_billing_watch', { p_ym: t.ym, p_min_days: 90 }),
    rpc<J[]>('ssong_my_requests', { p_status: '대기', p_limit: 30 }),
  ]);
  return fmtBriefing(t.ymd, d, audit, bill, list(pending));
}

async function sendTelegram(text: string): Promise<boolean> {
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID ?? '').trim();
  if (!token || !chatId) return false;
  let ok = true;
  for (const part of splitMessage(text)) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: part, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) { ok = false; console.warn('briefing telegram', res.status); }
    } catch (e) { ok = false; console.warn('briefing telegram', e instanceof Error ? e.name : 'error'); }
  }
  return ok;
}

/** 웍스 요약을 JAYTAX 브리핑 위에 붙인다. */
export function mergeBriefing(jaytax: string, works?: string | null): string {
  const w = works?.trim();
  if (!w) return jaytax;
  return `📬 네이버웍스 (메일·일정·연차·회의)
${w}

────────
${jaytax}`;
}

/**
 * 아침 브리핑 보내기. 같은 날 두 번 불려도 한 번만(DB ssong_tg_seen 「brief:날짜」).
 * works 가 있으면(Claude 예약 작업) 합쳐서, 없으면(Cron 대비) JAYTAX 부분만.
 */
export async function sendMorningBriefing(now = new Date(), works?: string | null): Promise<'sent' | 'duplicate' | 'off' | 'failed'> {
  if (!(process.env.TELEGRAM_CHAT_ID ?? '').trim()) return 'off';
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now);
  let first = true;
  try { first = await rpc<boolean>('ssong_tg_claim', { p_key: `brief:${day}` }); }
  catch (e) { console.warn('briefing claim failed', e instanceof Error ? e.message : e); }
  if (!first) return 'duplicate';
  let text: string;
  try { text = await buildBriefing(now); }
  catch (e) { text = `🌅 JAYTAX 브리핑을 만들지 못했습니다: ${e instanceof Error ? e.message : '오류'}`; }
  return (await sendTelegram(mergeBriefing(text, works))) ? 'sent' : 'failed';
}
