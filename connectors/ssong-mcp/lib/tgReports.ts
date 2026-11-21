// 텔레그램 단추 보고 — AI 없이 JAYTAX 읽기 함수(ssong_*)를 바로 부르고 정해진 모양으로 적는다(비용 없음).
// 대표님 2026-11-21 「버튼형·대화형 둘 다」. 읽는 함수는 쏭비서 커넥터와 같아서 접속기록도 똑같이 남는다.
import { rpc } from './jaytax.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type J = any;

export const REPORTS = {
  today: '📰 어제오늘 생긴 일',
  revenue: '💰 올해 매출',
  ar: '🧾 90일 넘은 미수금',
  audit: '📅 이번 주 감사',
} as const;
export type ReportKey = keyof typeof REPORTS;
export const isReportKey = (k: string): k is ReportKey => k in REPORTS;

const TEAM: Record<string, string> = { 감사team: '감사팀', taxteam: '기장팀' };
const team = (t: string) => TEAM[t] ?? t;
/** 억·만 원으로 짧게(텔레그램 화면용). */
export function money(n: number | string | null | undefined): string {
  const v = Math.round(Number(n ?? 0));
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(2).replace(/\.?0+$/, '')}억`;
  if (a >= 1e4) return `${Math.round(v / 1e4).toLocaleString('ko-KR')}만`;
  return `${v.toLocaleString('ko-KR')}원`;
}
const more = (n: number, shown: number) => (n > shown ? [`  … 외 ${n - shown}건`] : []);
const list = <T>(xs: T[] | null | undefined): T[] => (Array.isArray(xs) ? xs : []);

export function fmtDigest(d: J): string {
  const out: string[] = [`📰 JAYTAX 생긴 일 (${d.period?.from} ~ ${d.period?.to})`];
  const sec = (title: string, xs: J[], line: (x: J) => string, cap = 8) => {
    if (!xs.length) return;
    out.push('', `${title} ${xs.length}건`, ...xs.slice(0, cap).map((x) => `• ${line(x)}`), ...more(xs.length, cap));
  };
  sec('🆕 새 매출계약', list(d.newContracts), (x) => `${x.company} ${money(x.amount)} (${team(x.team)}${x.cpa ? `·${x.cpa}` : ''})`);
  sec('🧾 세금계산서 발행', list(d.invoicesIssued), (x) => `${x.company} ${money(x.supply)} ${x.issuedDate ?? ''}`);
  sec('💵 수금', list(d.receipts), (x) => `${x.company} ${money(x.amount)} ${x.paidDate ?? ''}`);
  sec('📮 문서발송', list(d.docSends), (x) => `${x.company} · ${x.kind} · ${x.status}${x.trackingNo ? ` (${x.trackingNo})` : ''}`);
  sec('📨 조회서 회수', list(d.confirmationsCollected), (x) => `${x.company} · ${x.institution}`);
  sec('⚠️ 감사이슈', list(d.auditIssues), (x) => `${x.company} #${x.no} ${x.title} (${x.status})`);
  sec('🤖 쏭비서 결재', list(d.ssongDecisions), (x) => `${x.status} · ${x.title}${x.note ? ` — ${x.note}` : ''}`);
  if (Number(d.invoiceRequestsNew) > 0) out.push('', `📝 새 발행요청 ${d.invoiceRequestsNew}건`);
  if (out.length === 1) out.push('', '기록된 일이 없습니다.');
  return out.join('\n');
}

export function fmtRevenue(r: J, year: number): string {
  const out: string[] = [`💰 ${year} 정산연도 매출 (${year}-07 ~ ${year + 1}-06)`];
  const ct = r.contracts?.byTeam ?? {};
  out.push('', '계약금액');
  for (const k of Object.keys(ct)) out.push(`• ${team(k)} ${money(ct[k].amount)} (${ct[k].count}건${ct[k].unconfirmed ? `, 미확정 ${ct[k].unconfirmed}` : ''})`);
  const it = r.issued?.byTeam ?? {};
  out.push('', '세금계산서 발행(공급가액)');
  for (const k of Object.keys(it)) out.push(`• ${team(k)} ${money(it[k])}`);
  const top = list(r.contracts?.byCompany).slice(0, 10);
  if (top.length) out.push('', '계약 큰 거래처 10', ...top.map((x: J, i: number) => `${i + 1}. ${x.company} ${money(x.amount)} (${team(x.team)})`));
  out.push('', '※ 월 청구 기장계약은 1회분 금액입니다. 예측·월할은 JAYTAX 매출통계 화면이 정본입니다.');
  return out.join('\n');
}

export function fmtReceivables(b: J): string {
  const rc = b.receivables ?? {};
  const out: string[] = [`🧾 미수금 (${rc.asOfLedger ?? '?'} 말 ERP 대장 기준)`];
  const tt = rc.totalByTeam ?? {};
  for (const k of Object.keys(tt)) out.push(`• ${team(k)} ${money(tt[k])}`);
  // 90일 넘은 것을 거래처로 묶는다.
  const by = new Map<string, { team: string; sum: number; days: number; n: number }>();
  for (const x of list<J>(rc.overdue)) {
    const g = by.get(x.company) ?? { team: x.team, sum: 0, days: 0, n: 0 };
    g.sum += Number(x.balance ?? 0); g.days = Math.max(g.days, Number(x.days ?? 0)); g.n += 1;
    by.set(x.company, g);
  }
  const rows = [...by.entries()].sort((a, b) => b[1].sum - a[1].sum);
  out.push('', `90일 넘은 것 ${list(rc.overdue).length}건 · 거래처 ${rows.length}곳`);
  out.push(...rows.slice(0, 15).map(([c, g]) => `• ${c} ${money(g.sum)} (${team(g.team)}, 최장 ${g.days}일${g.n > 1 ? `, ${g.n}건` : ''})`), ...more(rows.length, 15));
  const ir = b.invoiceRequests ?? {};
  const st = ir.byStatus ?? {};
  if (Object.keys(st).length) out.push('', `${b.month} 발행요청`, ...Object.keys(st).map((k) => `• ${k} ${st[k].count}건 ${money(st[k].supply)}`));
  return out.join('\n');
}

export function fmtAudit(a: J): string {
  const s = a.schedule ?? {};
  const out: string[] = [`📅 감사 (${s.from} ~ ${s.to})`];
  const days = list(s.days);
  out.push('', days.length ? `일정 ${days.length}건` : '일정 없음');
  out.push(...days.slice(0, 15).map((d: J) => `• ${String(d.day).slice(5)} ${d.company} ${d.task ?? d.kind ?? ''}${d.confirmed ? '' : ' (미확정)'}`), ...more(days.length, 15));
  const co = list(a.confirmationsOutstanding);
  out.push('', `조회서 남은 회사 ${co.length}곳`);
  out.push(...co.slice(0, 10).map((c: J) => `• ${c.company} 미발송 ${c.notSent}·미회수 ${c.notCollected} (${c.accountant ?? ''})`), ...more(co.length, 10));
  const oi = list(a.openIssues);
  const hot = oi.filter((x: J) => x.decisionNeeded || x.importance === '높음');
  out.push('', `미결 감사이슈 ${oi.length}건 · 판단 필요/중요 ${hot.length}건`);
  out.push(...hot.slice(0, 10).map((x: J) => `• ${x.company} #${x.no} ${x.title} (${x.importance})`), ...more(hot.length, 10));
  return out.join('\n');
}

/** 한국 시각 기준 오늘·정산연도. */
export function seoulToday(now = new Date()): { ymd: string; ym: string; fy: number } {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now);
  const [y, m] = ymd.split('-').map(Number);
  return { ymd, ym: ymd.slice(0, 7), fy: m >= 7 ? y : y - 1 };
}

export async function runReport(key: ReportKey): Promise<string> {
  const t = seoulToday();
  switch (key) {
    case 'today': return fmtDigest(await rpc('ssong_daily_digest', { p_from: null, p_to: null }));
    case 'revenue': return fmtRevenue(await rpc('ssong_revenue_summary', { p_year: t.fy, p_team: null }), t.fy);
    case 'ar': return fmtReceivables(await rpc('ssong_billing_watch', { p_ym: t.ym, p_min_days: 90 }));
    case 'audit': return fmtAudit(await rpc('ssong_audit_watch', { p_from: t.ymd, p_days: 7 }));
  }
}
