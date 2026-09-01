// 미수금 나이 분석(aging)과 오래 묵은 채권 알림.
//
// ERP 는 입금을 청구건에 연결하지 않는다(입금 전표에 거래#가 없다). 그래서 "이 입금이 어느 청구를
// 갚은 것인가"는 자료로 알 수 없다. 회계 실무의 통상대로 **오래된 것부터 갚은 것으로 본다(FIFO)**.
//   기초미수금(2026-07-01) → 발행일 순 청구 → 그 순서로 입금을 상계하고, 남은 것의 나이를 잰다.
// 이 가정이 곧 이 화면의 전부이므로, 화면에도 그대로 적어 둔다.
import { supabase } from './supabase';
import { OPENING_AS_OF } from './invoiceRequestApi';
import { listArItems } from './arLedgerApi';

/** 나이 구간 — 경계는 '기준일 − 발행일'의 날수. */
export const BUCKETS = [
  { key: 'b30', label: '30일 이내', min: 0, max: 30 },
  { key: 'b60', label: '31~60일', min: 31, max: 60 },
  { key: 'b90', label: '61~90일', min: 61, max: 90 },
  { key: 'b180', label: '91~180일', min: 91, max: 180 },
  { key: 'over', label: '180일 초과', min: 181, max: 99999 },
] as const;
export type BucketKey = (typeof BUCKETS)[number]['key'];

/** 6개월 = 180일. 이 선을 넘은 잔액이 알림 대상이다. */
export const OVERDUE_DAYS = 180;

/** 이 나이 분석이 무엇에 근거했는가 — 화면이 그대로 밝혀야 한다. */
export type AgingSource = '미수금대장' | '추정(FIFO)';

export interface AgingRow {
  placeId: string;
  code: string;
  company: string;
  place: string;
  cpa: string;
  staff: string;
  team: string;
  total: number;
  buckets: Record<BucketKey, number>;
  /** 6개월(180일)을 넘긴 잔액. */
  overdue: number;
  /** 남아 있는 것 중 가장 오래된 건의 날짜와 나이. */
  oldestDate: string | null;
  oldestDays: number;
  /** 이번 달에 이미 알렸는가. */
  notified: boolean;
  /** 남은 채권의 내역(오래된 순). */
  items: { date: string; label: string; amount: number; days: number }[];
}

/**
 * ERP 미수금대장이 올라와 있으면 **그것으로** 나이를 잰다.
 *
 * 대장은 건별로 invoiceNo(= 거래전표번호, 26-0225-0099 → 2026-02-25)와 잔금을 들고 있다.
 * 즉 "무엇이 언제 발행되어 얼마가 남았나"를 ERP 가 이미 맞춰 두었다 — 추정할 이유가 없다.
 * 대장이 없는 달만 아래 estimate 로 떨어진다.
 */
async function fromLedger(
  asOf: string, places: PlaceInfo[], team: string | undefined, ym: string,
): Promise<AgingRow[] | null> {
  const items = (await listArItems(ym, team)).filter((r) => !r.excluded && Math.round(r.balance) !== 0);
  if (!items.length) return null;

  const byEntity = new Map<string, PlaceInfo>();
  const byPlace = new Map<string, PlaceInfo>();
  for (const p of places) {
    byPlace.set(p.placeId, p);
    if (p.entityId && !byEntity.has(p.entityId)) byEntity.set(p.entityId, p);
  }
  const ymOfAsOf = asOf.slice(0, 7);
  const { data: nt } = await supabase.from('biz_receivable_notice').select('place_id').eq('ym', ymOfAsOf);
  const notified = new Set(((nt as { place_id: string }[]) ?? []).map((r) => r.place_id));

  // 대장은 거래처 단위다 — 사업장이 정해진 줄은 그 사업장으로, 아니면 거래처 대표로 묶는다.
  const groups = new Map<string, { info: PlaceInfo; items: AgingRow['items'] }>();
  for (const it of items) {
    const info = (it.placeId && byPlace.get(it.placeId))
      || (it.entityId && byEntity.get(it.entityId))
      || null;
    if (!info) continue;                       // 거래처를 못 붙인 줄은 아래에서 따로 알린다
    const date = it.issuedDate ?? OPENING_AS_OF;
    const g = groups.get(info.placeId) ?? { info, items: [] };
    g.items.push({
      date,
      label: `${it.invoiceNo}${it.kind ? ` · ${it.kind}` : ''}${it.phase ? ` ${it.phase}` : ''}`,
      amount: it.balance,
      days: days(date, asOf),
    });
    groups.set(info.placeId, g);
  }

  const out: AgingRow[] = [];
  for (const g of groups.values()) {
    const left = settle(g.items.sort((a, b) => a.date.localeCompare(b.date)));
    // 상계하고 나면 남는 게 없는 곳이 있다(마이너스 전표로 이미 정리된 건).
    // 그런 곳까지 '705일 경과'로 세우면 목록을 믿지 않게 된다.
    if (!left.length) continue;
    const buckets = Object.fromEntries(BUCKETS.map((b) => [b.key, 0])) as Record<BucketKey, number>;
    for (const x of left) {
      const b = BUCKETS.find((k) => x.days >= k.min && x.days <= k.max) ?? BUCKETS[BUCKETS.length - 1];
      buckets[b.key] += x.amount;
    }
    out.push({
      ...g.info,
      total: left.reduce((s, x) => s + x.amount, 0),
      buckets,
      overdue: left.filter((x) => x.days > OVERDUE_DAYS).reduce((s, x) => s + x.amount, 0),
      oldestDate: left[0]?.date ?? null,
      oldestDays: left[0]?.days ?? 0,
      notified: notified.has(g.info.placeId),
      items: left,
    });
  }
  return out.sort((a, b) => b.overdue - a.overdue || b.total - a.total);
}

/**
 * 마이너스 전표(수정·취소)를 같은 거래처의 채권에서 **오래된 것부터** 덜어 낸다.
 *
 * 대장에는 (−)전표가 별개 줄로 남고 어느 청구를 되돌린 것인지 적혀 있지 않다.
 * 그대로 두면 합계가 0인 거래처가 "705일 경과"로 목록에 서는 일이 생긴다(이티머니).
 * 상계 방향을 오래된 쪽으로 잡은 것은 그쪽이 **경고를 부풀리지 않는** 쪽이기 때문이다.
 */
function settle(items: AgingRow['items']): AgingRow['items'] {
  let credit = items.filter((x) => x.amount < 0).reduce((s, x) => s - x.amount, 0);
  if (!credit) return items.filter((x) => Math.round(x.amount) !== 0);
  const out: AgingRow['items'] = [];
  for (const x of items) {
    if (x.amount <= 0) continue;
    let amt = x.amount;
    if (credit > 0) { const cut = Math.min(credit, amt); amt -= cut; credit -= cut; }
    if (Math.round(amt) !== 0) out.push({ ...x, amount: amt });
  }
  // 갚고도 남은 마이너스는 선수금이다 — 감추지 않고 가장 최근 자리에 남긴다.
  if (credit > 0.5) {
    const last = items[items.length - 1];
    out.push({ date: last.date, label: '선수금(마이너스 잔액)', amount: -credit, days: last.days });
  }
  return out;
}

/** 대장에 있는데 거래처를 못 붙인 줄 — 화면에서 손으로 붙이거나 접을 대상. */
export async function listArUnmatched(ym: string, team?: string) {
  const items = (await listArItems(ym, team)).filter((r) => Math.round(r.balance) !== 0);
  const by = new Map<string, { clientName: string; cpa: string; count: number; balance: number; excluded: boolean }>();
  for (const it of items) {
    if (it.entityId || it.placeId) continue;
    const g = by.get(it.clientName) ?? { clientName: it.clientName, cpa: it.cpa, count: 0, balance: 0, excluded: !!it.excluded };
    g.count += 1; g.balance += it.balance;
    by.set(it.clientName, g);
  }
  return [...by.values()].sort((a, b) => b.balance - a.balance);
}

export interface PlaceInfo {
  placeId: string; entityId?: string; code: string; company: string; place: string;
  cpa: string; staff: string; team: string;
}

const days = (from: string, to: string) =>
  Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86400000));

/**
 * 기준일 현재의 미수금을 나이별로 나눈다.
 *
 * · 채권 = 기초미수금 + **발행완료**된 청구(VAT 포함). 아직 '요청'인 건은 채권이 아니다.
 * · 입금은 사업장 단위로 오래된 채권부터 상계한다(FIFO).
 * · 날짜는 발행일 → 없으면 작성일 → 없으면 귀속월 말일 순으로 본다.
 */
export async function agingReport(
  asOf: string, places: PlaceInfo[], team?: string,
): Promise<{ rows: AgingRow[]; source: AgingSource }> {
  const ledger = await fromLedger(asOf, places, team, asOf.slice(0, 7));
  if (ledger) return { rows: ledger, source: '미수금대장' };
  return { rows: await estimate(asOf, places, team), source: '추정(FIFO)' };
}

/** 대장이 없는 달의 대비책 — 기초미수금 + 발행완료 청구를 FIFO 로 상계해 나이를 추정한다. */
async function estimate(
  asOf: string, places: PlaceInfo[], team?: string,
): Promise<AgingRow[]> {
  const ymOfAsOf = asOf.slice(0, 7);
  const [op, req, pay, notices] = await Promise.all([
    supabase.from('biz_receivable_opening').select('place_id, amount_gross'),
    supabase.from('biz_invoice_request')
      .select('place_id, ym, team, total, status, issued_date, issue_date, company_name, summary, note, erp_account')
      .in('status', ['발행완료', '수정발행']),
    supabase.from('biz_receipt').select('place_id, amount, paid_date, ym'),
    supabase.from('biz_receivable_notice').select('place_id, ym').eq('ym', ymOfAsOf),
  ]);
  for (const r of [op, req, pay, notices]) if (r.error) throw new Error(r.error.message);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const items = new Map<string, { date: string; label: string; amount: number }[]>();
  const push = (pid: string | null, date: string, label: string, amount: number) => {
    if (!pid || amount <= 0 || date > asOf) return;
    const l = items.get(pid) ?? [];
    l.push({ date, label, amount });
    items.set(pid, l);
  };
  for (const r of (op.data as any[]) ?? []) {
    push(r.place_id, OPENING_AS_OF, '기초미수금', Number(r.amount_gross) || 0);
  }
  for (const r of (req.data as any[]) ?? []) {
    if (team && r.team !== team) continue;
    const d = r.issued_date || r.issue_date || endOfMonth(r.ym);
    push(r.place_id, d, `${r.ym} ${r.erp_account || r.summary || r.note || '청구'}`.trim(), Number(r.total) || 0);
  }
  const paid = new Map<string, number>();
  for (const r of (pay.data as any[]) ?? []) {
    if (team && r.team && r.team !== team) continue;
    const d = r.paid_date || endOfMonth(r.ym);
    if (!r.place_id || d > asOf) continue;
    paid.set(r.place_id, (paid.get(r.place_id) ?? 0) + (Number(r.amount) || 0));
  }
  const notifiedSet = new Set(((notices.data as any[]) ?? []).map((r) => r.place_id as string));
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const out: AgingRow[] = [];
  for (const p of places) {
    if (team && p.team && !p.team.includes(team)) { /* 팀 필터는 청구 쪽에서 이미 걸렀다 */ }
    const list = (items.get(p.placeId) ?? []).sort((a, b) => a.date.localeCompare(b.date));
    if (!list.length) continue;
    // 오래된 것부터 갚은 것으로 본다.
    let rest = paid.get(p.placeId) ?? 0;
    const left: AgingRow['items'] = [];
    for (const it of list) {
      let amt = it.amount;
      if (rest > 0) { const cut = Math.min(rest, amt); amt -= cut; rest -= cut; }
      if (amt > 0.5) left.push({ ...it, amount: amt, days: days(it.date, asOf) });
    }
    // 입금이 채권보다 많으면(선수금·미반영 발행) 음수 잔액으로 남긴다 — 감추면 원인을 못 찾는다.
    const over = rest > 0.5 ? -rest : 0;
    const total = left.reduce((s, x) => s + x.amount, 0) + over;
    if (Math.round(total) === 0 && !left.length) continue;

    const buckets = Object.fromEntries(BUCKETS.map((b) => [b.key, 0])) as Record<BucketKey, number>;
    for (const x of left) {
      const b = BUCKETS.find((k) => x.days >= k.min && x.days <= k.max) ?? BUCKETS[BUCKETS.length - 1];
      buckets[b.key] += x.amount;
    }
    if (over < 0) buckets.b30 += over;      // 선수금은 가장 최근 칸에서 빼 준다
    out.push({
      ...p,
      total,
      buckets,
      overdue: left.filter((x) => x.days > OVERDUE_DAYS).reduce((s, x) => s + x.amount, 0),
      oldestDate: left[0]?.date ?? null,
      oldestDays: left[0]?.days ?? 0,
      notified: notifiedSet.has(p.placeId),
      items: left,
    });
  }
  return out.sort((a, b) => b.overdue - a.overdue || b.total - a.total);
}

const endOfMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/**
 * 6개월 넘은 미수금을 담당 회계사·담당 직원에게 알린다.
 * 사람 한 명에 한 통으로 묶고, **같은 달에 같은 거래처로 두 번 보내지 않는다**.
 */
export async function notifyOverdue(
  rows: AgingRow[], asOf: string,
): Promise<{ sent: number; people: string[]; places: number }> {
  const targets = rows.filter((r) => r.overdue > 0 && !r.notified);
  if (!targets.length) return { sent: 0, people: [], places: 0 };

  const byPerson = new Map<string, AgingRow[]>();
  for (const r of targets) {
    const names = [r.cpa, ...r.staff.split(',')].map((x) => x.trim()).filter(Boolean);
    for (const n of [...new Set(names)]) {
      const l = byPerson.get(n) ?? [];
      l.push(r); byPerson.set(n, l);
    }
  }
  const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
  let sent = 0;
  const people: string[] = [];
  for (const [name, list] of byPerson) {
    const total = list.reduce((s, r) => s + r.overdue, 0);
    const head = list.slice(0, 4).map((r) => `${r.company} ${won(r.overdue)}`).join(', ');
    const { data, error } = await supabase.rpc('biz_receivable_notify', {
      p_name: name,
      p_title: `6개월 넘은 미수금 ${list.length}곳 · ${won(total)}`,
      p_body: `${head}${list.length > 4 ? ' 외' : ''} — ${asOf} 기준으로 180일이 지난 채권입니다. `
        + '수금·미수금 화면에서 확인해 주세요.',
    });
    if (error) throw new Error(error.message);
    const n = (data as number) ?? 0;
    if (n) { sent += n; people.push(name); }
  }
  const { data: u } = await supabase.auth.getUser();
  const ym = asOf.slice(0, 7);
  await supabase.from('biz_receivable_notice').upsert(
    targets.map((r) => ({
      place_id: r.placeId, ym, company: r.company, amount: r.overdue,
      recipients: [...new Set([r.cpa, ...r.staff.split(',')].map((x) => x.trim()).filter(Boolean))].join(','),
      notified_at: new Date().toISOString(), notified_by: u.user?.id ?? null,
    })),
    { onConflict: 'place_id,ym' },
  );
  return { sent, people, places: targets.length };
}
