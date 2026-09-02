// 감사팀 세금계산서 발행요청 — 제안 · 알림.
//
// taxteam 과 구조가 다르다. 감사는 계약금·중도금·잔금이 **건별로** 생기므로 월 마감이 없다.
// 대신 매출계약의 **분할회차 청구기한**이 지나면 그것이 곧 청구할 때가 됐다는 신호다.
//
//   1층 제안 — 기한이 지난 회차를 띄우고 담당 회계사에게 알린다
//   2층 작업 — 회계사가 확인 한 번으로 발행요청 → 김민섭에게 알림 → 발행완료 → 회계사에게 알림
//   3층 이력 — 요청·발행완료를 기간으로 조회한다
import { supabase } from './supabase';
import { billingItemsForMonth } from './billingSchedule';
import { listSalesContracts } from './salesContractApi';
import { erpAccountOf, listInvoiceRequests, type InvoiceCandidate } from './invoiceRequestApi';
import { corpDisplayName, type BizEntityFull } from './bizRegistryApi';
import { listBizContacts } from './bizContactApi';

export const AUDIT_TEAM = '감사team';

export interface AuditProposal extends InvoiceCandidate {
  /** 계약에 적힌 그 회차의 청구기한. */
  dueDate: string;
  /** 기한이 지난 날수(오늘 기준). 음수면 아직 안 왔다. */
  overdueDays: number;
  /** 이 회차로 이미 담당 회계사에게 알렸는가. */
  notified: boolean;
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

/**
 * 청구할 때가 된 감사 계약 회차를 모은다.
 *
 * · 분할회차에 **청구기한이 적힌 것**만 본다 — 기한이 없으면 언제 청구할지 알 수 없다.
 * · 이미 발행요청된 회차(취소 제외)는 뺀다.
 * · 기한이 지났거나 `withinDays` 안에 다가오는 것을 담는다(기본 0 = 지난 것만).
 */
export async function listAuditProposals(
  entities: BizEntityFull[], today: string, withinDays = 0,
): Promise<AuditProposal[]> {
  const [contracts, existing, contacts, notices] = await Promise.all([
    listSalesContracts(),
    listInvoiceRequests(undefined, AUDIT_TEAM),
    listBizContacts(),
    listNotifiedKeys(),
  ]);
  const taken = new Set(
    existing.filter((r) => r.status !== '취소').map((r) => `${r.contractId ?? ''}|${r.installmentId ?? ''}`),
  );
  const entMap = new Map(entities.map((e) => [e.id, e]));
  const out: AuditProposal[] = [];

  for (const c of contracts) {
    if (c.team !== AUDIT_TEAM) continue;
    const e = entMap.get(c.entityId);
    const place = e?.places.find((p) => p.id === c.placeId) ?? e?.places.find((p) => p.isHeadquarters) ?? e?.places[0];
    for (const it of c.installments) {
      if (!it.dueDate || it.billedAt) continue;
      const over = daysBetween(it.dueDate, today);
      if (over < -withinDays) continue;                       // 아직 멀었다
      const key = `${c.id}|${it.id ?? ''}`;
      if (taken.has(key)) continue;
      // 금액은 청구엔진을 그대로 쓴다 — 할인이 걸린 계약도 같은 값이 나오게.
      const ym = it.dueDate.slice(0, 7);
      const item = billingItemsForMonth(c, ym).find((x) => x.installmentId === (it.id ?? null));
      const net = item ? item.net : Math.round(it.amount);
      if (net <= 0) continue;
      const cs = contacts.filter((x) => x.entityId === c.entityId && x.email.trim() && x.active);
      out.push({
        key,
        entityId: c.entityId,
        placeId: place?.id ?? null,
        contractId: c.id,
        installmentId: it.id ?? null,
        companyName: e ? corpDisplayName(e.name, e.corpForm, e.corpFormPosition) : '',
        placeName: place?.placeName ?? '',
        contractCode: c.contractCode,
        typeLabel: c.categoryCode,
        cpa: c.effectiveCpa,
        staff: c.effectiveStaff.map((s) => s.staffName).join(','),
        label: it.label || `${it.seq}회차`,
        supplyAmount: net,
        confirmed: c.confirmed,
        billingCycle: c.billingCycle,
        billingMonth: c.billingMonth,
        erpAccount: erpAccountOf(c.categoryCode),
        docEmail: cs.find((x) => x.placeId === place?.id && x.isPrimary)?.email
          ?? cs.find((x) => x.isPrimary)?.email ?? cs[0]?.email ?? '',
        dueDate: it.dueDate,
        overdueDays: over,
        notified: notices.has(key),
      });
    }
  }
  // 오래 지난 것부터 — 밀린 순서가 곧 급한 순서다.
  return out.sort((a, b) => b.overdueDays - a.overdueDays || a.companyName.localeCompare(b.companyName, 'ko'));
}

/**
 * 이 회차는 이미 청구했다고 표시해 제안에서 뺀다.
 *
 * 예전에 ERP 에서 직접 발행했거나, 계약과 연결하지 않고 건별로 등록해 둔 회차가 있다.
 * 그런 것까지 계속 제안에 뜨면 목록을 믿지 않게 된다 — 계약의 `billed_at` 을 채워 닫는다.
 */
export async function dismissProposals(installmentIds: string[], on = todayOf()): Promise<void> {
  const ids = installmentIds.filter(Boolean);
  if (!ids.length) return;
  const { error } = await supabase.from('biz_contract_installment')
    .update({ billed_at: on }).in('id', ids);
  if (error) throw new Error(error.message);
}
const todayOf = () => new Date().toISOString().slice(0, 10);

async function listNotifiedKeys(): Promise<Set<string>> {
  const { data, error } = await supabase.from('biz_audit_proposal_notice').select('proposal_key');
  if (error) return new Set();
  return new Set(((data as { proposal_key: string }[]) ?? []).map((r) => r.proposal_key));
}

// ── 알림 ────────────────────────────────────────────────
async function notify(name: string, kind: string, title: string, body: string): Promise<number> {
  if (!name.trim()) return 0;
  const { data, error } = await supabase.rpc('biz_audit_notify', {
    p_name: name.trim(), p_kind: kind, p_title: title, p_body: body,
  });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');

/**
 * 아직 알리지 않은 제안만 담당 회계사에게 알린다 — 회계사 한 명에 한 통.
 * 같은 회차로 두 번 알리지 않도록 보낸 것은 적어 둔다(그래야 알림을 계속 본다).
 */
export async function notifyProposals(rows: AuditProposal[]): Promise<{ sent: number; people: string[] }> {
  const fresh = rows.filter((r) => !r.notified && r.cpa.trim());
  if (!fresh.length) return { sent: 0, people: [] };
  const byCpa = new Map<string, AuditProposal[]>();
  for (const r of fresh) {
    const l = byCpa.get(r.cpa) ?? [];
    l.push(r); byCpa.set(r.cpa, l);
  }
  let sent = 0;
  const people: string[] = [];
  for (const [cpa, list] of byCpa) {
    const total = list.reduce((s, r) => s + r.supplyAmount, 0);
    const head = list.slice(0, 3).map((r) => `${r.companyName} ${r.label}`).join(', ');
    const n = await notify(cpa, 'audit_proposal',
      `청구할 때가 된 감사 계약 ${list.length}건`,
      `${head}${list.length > 3 ? ' 외' : ''} — 공급가액 합계 ${won(total)}. `
      + '세금계산서 발행요청 · 감사팀에서 확인하고 발행요청해 주세요.');
    if (n) { sent += n; people.push(cpa); }
  }
  const { data: u } = await supabase.auth.getUser();
  await supabase.from('biz_audit_proposal_notice').upsert(
    fresh.map((r) => ({
      proposal_key: r.key, company: r.companyName, cpa: r.cpa,
      amount: r.supplyAmount, due_date: r.dueDate, notified_by: u.user?.id ?? null,
      notified_at: new Date().toISOString(),
    })),
    { onConflict: 'proposal_key' },
  );
  return { sent, people };
}

/** 회계사가 발행요청했다 → 발행 담당(김민섭)에게. */
export async function notifyRequested(approver: string, rows: { companyName: string; supplyAmount: number }[], by: string): Promise<number> {
  if (!rows.length) return 0;
  const total = rows.reduce((s, r) => s + r.supplyAmount, 0);
  const head = rows.slice(0, 3).map((r) => r.companyName).join(', ');
  return notify(approver, 'audit_request',
    `감사팀 발행요청 ${rows.length}건`,
    `${by ? `${by}가 ` : ''}${head}${rows.length > 3 ? ' 외' : ''} — 공급가액 합계 ${won(total)} 발행요청했습니다.`);
}

/**
 * 요청을 물렸다 → **요청한 회계사에게** 사유와 함께.
 * 사유를 알려 주지 않으면 요청자는 무엇을 고쳐야 할지 알 수 없다.
 */
export async function notifyCanceled(
  rows: { cpa: string; companyName: string; supplyAmount: number }[], reason: string, by: string,
): Promise<number> {
  const byCpa = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.cpa.trim()) continue;
    const l = byCpa.get(r.cpa) ?? [];
    l.push(r); byCpa.set(r.cpa, l);
  }
  let sent = 0;
  for (const [cpa, list] of byCpa) {
    const total = list.reduce((s, r) => s + r.supplyAmount, 0);
    const head = list.slice(0, 3).map((r) => r.companyName).join(', ');
    sent += await notify(cpa, 'audit_cancel',
      `발행요청이 취소되었습니다 — ${list.length}건`,
      `${head}${list.length > 3 ? ' 외' : ''} (공급가액 ${won(total)})${by ? ` · ${by}` : ''}
`
      + `사유: ${reason}
`
      + '발행 이력에서 그 건의 [다시 요청]으로 고쳐서 다시 낼 수 있습니다.');
  }
  return sent;
}

/** 발행완료했다 → 요청한 회계사에게. 회계사별로 한 통. */
export async function notifyIssued(rows: { cpa: string; companyName: string; supplyAmount: number }[]): Promise<number> {
  const byCpa = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.cpa.trim()) continue;
    const l = byCpa.get(r.cpa) ?? [];
    l.push(r); byCpa.set(r.cpa, l);
  }
  let sent = 0;
  for (const [cpa, list] of byCpa) {
    const total = list.reduce((s, r) => s + r.supplyAmount, 0);
    const head = list.slice(0, 3).map((r) => r.companyName).join(', ');
    sent += await notify(cpa, 'audit_issued',
      `세금계산서 발행완료 ${list.length}건`,
      `${head}${list.length > 3 ? ' 외' : ''} — 공급가액 합계 ${won(total)} 발행되었습니다.`);
  }
  return sent;
}
