// 아침 브리핑 — 평일 아침 대표님 텔레그램으로(대표님 2026-11-21). AI 없이 읽기 함수만 → 비용 없음.
//
//   · 지난 근무일 이후 생긴 일(월요일은 금~일) · 오늘 감사 일정 · 결재 대기 · 판단 필요한 감사이슈 · 오래된 미수금
//   · Vercel Cron(vercel.json) 이 /briefing 을 부른다. CRON_SECRET 이 맞아야 하고, 같은 날 두 번 오면 한 번만 보낸다.
//   · 텔레그램에서 /brief 로 아무 때나 받아 볼 수도 있다.
import { rpc } from './jaytax.js';
import { money, seoulToday } from './tgReports.js';

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
