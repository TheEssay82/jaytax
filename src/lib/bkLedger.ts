// 기장배분 — ERP 부서별원장(여러 달 한 파일)을 거래처별 입금·청구·대손으로 모은다. supabase 를 물지 않는다.
//
//   · 입금 = 외상매출금 대변(정정 음수 줄 포함). 대손 전표(대손상각비가 있는 전표)의 외상매출금 대변은 입금이 아니다.
//   · 청구 = 수입 계정 대변 − 차변(VAT 제외). 기장대리수입 → 기장, 세무조정수입(법인·소득) → 세무조정, 그 밖의 「…수입」 → 기타(감사·용역).
//   · 입금의 성격(기장 / 세무조정 / 기타)은 선입선출로 그 해 청구서에 맞춘다(아래 aggregateLedger).
//   · 자문(컨설팅)은 ERP 에 따로 계정이 없어 기장대리수입에 섞여 있다 → 앱 매출 실적의 비율(advRatio)로 기장 입금에서 뗀다.
//   · 세무조정 구분 기본값: 기장팀 원장에 기장 청구가 있으면 기장수행, 아니면 자가(감사팀 원장은 늘 자가).
// 원본 엑셀은 이 일을 입금 줄마다 손으로 했다(기장24 시트 F~J열·A열).

export type Dept = '기장팀' | '감사팀';
export interface LedgerLine { acct: string; slip: string; code: string; name: string; dr: number; cr: number; sum?: string; staff?: string }
export interface ClientAgg {
  dept: Dept; code: string; name: string;
  cash: number; cash_bk: number; cash_adv: number; cash_tax: number; cash_other: number;
  billed_bk: number; billed_tax: number; billed_other: number; writeoff: number;
  tax_mode: '기장수행' | '자가';
}

const t = (v: unknown) => String(v ?? '').trim();
const n = (v: unknown) => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;

/** 부서별원장 엑셀(시트 「1_외상매출금」 「8_세무조정수입(법인)」 …)을 줄로 읽는다. */
export function readLedgerWorkbook(wb: { SheetNames: string[]; Sheets: Record<string, unknown> }, toRows: (sheet: unknown) => unknown[][]): LedgerLine[] {
  const out: LedgerLine[] = [];
  for (const sh of wb.SheetNames.filter((s) => /^\d+_/.test(s))) {
    const acct = sh.replace(/^\d+_/, '');
    const raw = toRows(wb.Sheets[sh]);
    const hi = raw.findIndex((r) => r.some((c) => t(c) === '전표번호'));
    if (hi < 0) continue;
    const h = raw[hi].map(t);
    const at = (x: string) => h.indexOf(x);
    for (const r of raw.slice(hi + 1)) {
      const slip = t(r[at('전표번호')]);
      if (!slip || slip === '이월액' || /^(월계|누계|합계)/.test(slip)) continue;
      const dr = n(r[at('차변금액')]), cr = n(r[at('대변금액')]);
      if (!dr && !cr) continue;
      out.push({ acct, slip, code: t(r[at('거래처코드')]), name: t(r[at('거래처')]), dr, cr, sum: t(r[at('적 요')] ?? r[at('적요')]), staff: at('사원명') >= 0 ? t(r[at('사원명')]) : undefined });
    }
  }
  return out;
}

const isRevenue = (a: string) => /수입/.test(a) && !/^(잡이익|유형자산처분)/.test(a);
const kindOf = (a: string): 'bk' | 'tax' | 'other' => (a === '기장대리수입' ? 'bk' : /^세무조정수입/.test(a) ? 'tax' : 'other');

/**
 * 거래처별로 모은다. advRatio: ERP 코드 → 기장 청구 중 자문(컨설팅) 비율(0~1).
 *
 * 입금의 성격은 **선입선출**로 정한다 — 거래처마다 전표 순서(전표번호 = 날짜)대로, 그 해 청구서(외상매출금 차변)를
 * 먼저 생긴 것부터 입금(대변)이 지워 나간다. 청구서의 성격은 같은 전표의 수입 계정으로 안다.
 * 그 해 청구가 생기기 전에 받은 돈(= 지난해 미수금)은 성격을 모른다 → 기장팀은 기장, 감사팀은 기타로 본다.
 * (원장의 이월액은 부서 합계 한 줄뿐이라 거래처별 기초 잔액을 알 수 없다.)
 */
export function aggregateLedger(lines: LedgerLine[], dept: Dept, advRatio: Map<string, number> = new Map()): ClientAgg[] {
  const badSlips = new Set(lines.filter((x) => x.acct === '대손상각비').map((x) => x.slip));
  const unknownKind: 'bk' | 'other' = dept === '기장팀' ? 'bk' : 'other';
  const m = new Map<string, ClientAgg>();
  const get = (code: string, name: string) => {
    let c = m.get(code);
    if (!c) {
      c = { dept, code, name, cash: 0, cash_bk: 0, cash_adv: 0, cash_tax: 0, cash_other: 0, billed_bk: 0, billed_tax: 0, billed_other: 0, writeoff: 0, tax_mode: '자가' };
      m.set(code, c);
    }
    return c;
  };
  // 전표·거래처마다 수입 성격별 금액 — 청구서(차변)의 성격을 나누는 데 쓴다.
  const slipKinds = new Map<string, Record<'bk' | 'tax' | 'other', number>>();
  const ar: LedgerLine[] = [];
  for (const x of lines) {
    if (!x.code) continue;
    if (x.acct === '외상매출금') { if (!(x.cr && badSlips.has(x.slip))) ar.push(x); get(x.code, x.name); }
    else if (x.acct === '대손상각비') get(x.code, x.name).writeoff += x.dr;
    else if (isRevenue(x.acct)) {
      const c = get(x.code, x.name);
      const k = kindOf(x.acct);
      const v = x.cr - x.dr;
      c[k === 'bk' ? 'billed_bk' : k === 'tax' ? 'billed_tax' : 'billed_other'] += v;
      const key = `${x.slip}|${x.code}`;
      const sk = slipKinds.get(key) ?? { bk: 0, tax: 0, other: 0 };
      sk[k] += v;
      slipKinds.set(key, sk);
    }
  }
  const byClient = new Map<string, LedgerLine[]>();
  for (const x of ar) byClient.set(x.code, [...(byClient.get(x.code) ?? []), x]);
  for (const [code, xs] of byClient) {
    const c = m.get(code)!;
    const paid = { bk: 0, tax: 0, other: 0 };
    const queue: { k: 'bk' | 'tax' | 'other'; amt: number }[] = [];
    // 같은 날 청구와 입금이 함께 있으면 청구를 먼저 놓는다.
    xs.sort((a, b) => a.slip.localeCompare(b.slip) || (b.dr ? 1 : 0) - (a.dr ? 1 : 0));
    for (const x of xs) {
      if (x.dr) {
        const sk = slipKinds.get(`${x.slip}|${code}`);
        const tot = sk ? sk.bk + sk.tax + sk.other : 0;
        const parts: ['bk' | 'tax' | 'other', number][] = tot ? (['bk', 'tax', 'other'] as const).map((k) => [k, (x.dr * sk![k]) / tot]) : [[unknownKind, x.dr]];
        for (const [k, a] of parts) {
          if (a > 0) queue.push({ k, amt: a });
          else if (a < 0) { // 차변 음수(정정) — 같은 성격의 남은 청구에서 뺀다
            let left = -a;
            for (let i = queue.length - 1; i >= 0 && left > 0; i--) if (queue[i].k === k) { const d = Math.min(left, queue[i].amt); queue[i].amt -= d; left -= d; }
          }
        }
      }
      if (x.cr) {
        c.cash += x.cr;
        if (x.cr < 0) { paid[unknownKind] += x.cr; continue; } // 정정 음수 입금
        let left = x.cr;
        while (left > 0 && queue.length) {
          const q = queue[0];
          const d = Math.min(left, q.amt);
          paid[q.k] += d; q.amt -= d; left -= d;
          if (q.amt <= 0.5) queue.shift();
        }
        if (left > 0) paid[unknownKind] += left; // 그 해 청구보다 먼저 받은 돈 = 지난해 미수금
      }
    }
    c.cash_tax = Math.round(paid.tax);
    c.cash_other = Math.round(paid.other);
    c.cash_bk = c.cash - c.cash_tax - c.cash_other;
  }
  for (const c of m.values()) {
    c.cash_adv = Math.round(c.cash_bk * Math.min(1, Math.max(0, advRatio.get(c.code) ?? 0)));
    c.tax_mode = dept === '기장팀' && c.billed_bk > 0 ? '기장수행' : '자가';
  }
  // 배분과 상관없는 거래처(감사·용역만 있는 곳)는 감사팀 원장에서 뺀다.
  return [...m.values()].filter((c) => dept === '기장팀' ? (c.cash || c.billed_bk || c.billed_tax || c.writeoff) : (c.billed_tax || c.cash_tax))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

/** 회사 이름 비교용 — ㈜·(주)·주식회사·공백을 뗀다. */
export const normName = (s: string) => s.replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|\s/g, '');

export interface ClientRow extends ClientAgg { cpa: string | null; mode_by_hand?: boolean; cpa_by_hand?: boolean; memo?: string | null; ar_open?: number; ar_close?: number; source?: string | null; erp_cpa?: string | null }

/** 회계사별 합계 → bk_settle_cpa 칸. 대손은 VAT 제외로(미수금이 VAT 제외라서) ÷ 1.1. */
export function sumByCpa(rows: ClientRow[]) {
  const z = () => ({ bk_fee: 0, tax_bk: 0, tax_self: 0, advisory_excl: 0, writeoff: 0, ar_open: 0, ar_close: 0, clients: 0 });
  const out: Record<string, ReturnType<typeof z>> = { 조현규: z(), 김준성: z(), 정우철: z() };
  const loose = { cash: 0, writeoff: 0, ar_open: 0, ar_close: 0, clients: 0 };
  for (const r of rows) {
    const o = r.cpa ? out[r.cpa] : undefined;
    if (!o) { if (r.cash_bk || r.cash_tax || r.writeoff || r.ar_open || r.ar_close) { loose.cash += r.cash_bk + r.cash_tax; loose.writeoff += r.writeoff; loose.ar_open += r.ar_open ?? 0; loose.ar_close += r.ar_close ?? 0; loose.clients++; } continue; }
    o.clients++;
    o.bk_fee += r.cash_bk;
    o.advisory_excl += r.cash_adv;
    if (r.tax_mode === '기장수행') o.tax_bk += r.cash_tax; else o.tax_self += r.cash_tax;
    // 대손은 미수금 변동의 일부라 미수금처럼 기장팀 것만 본다(감사팀 대손 = 감사 보수 미수금).
    if (r.dept === '기장팀') o.writeoff += Math.round(r.writeoff / 1.1);
    o.ar_open += r.ar_open ?? 0;
    o.ar_close += r.ar_close ?? 0;
  }
  return { byCpa: out, loose };
}

// ── ERP 기간 미수금대장(시트 「부서별 미수금현황」) ─────────────────────────
// 청구서마다 계약구분(기장 · 세무조정 · 감사 및 검토 …) · 청구액 · 기초이월액 · 당기입금액 · 당기대손액 · 잔금이 있다.
// 원장보다 정확하다 — 입금이 어느 청구서(어떤 일)에 대한 것인지 ERP 가 이미 맞춰 두었다. 기장팀 자료에는 VAT 제외 칸(…_부가세)도 있다.
// 「회계사」 칸: 감사팀은 담당 회계사, 기장팀은 담당 직원.

export interface ArFlowItem {
  name: string; invoice: string; kind: 'bk' | 'tax' | 'other'; contract: string; person: string;
  billed: number; billedNet: number; open: number; openNet: number; paid: number; paidNet: number; writeoff: number; close: number; closeNet: number;
}
export interface ArFlow { dept: Dept | null; from: string | null; to: string | null; items: ArFlowItem[] }

export function readArFlow(raw: unknown[][]): ArFlow | null {
  const hi = raw.findIndex((r) => r.some((c) => t(c) === 'invoiceNo') && r.some((c) => t(c) === '계약구분'));
  if (hi < 0) return null;
  const head = raw.slice(0, hi).map((r) => r.map(t).join(' ')).join(' ');
  const period = head.match(/기간\s*:\s*(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/);
  const dept: Dept | null = /기장\d*팀/.test(head) ? '기장팀' : /2본부5팀|\[0205\]/.test(head) ? '감사팀' : null;
  const h = raw[hi].map(t);
  const at = (x: string) => h.indexOf(x);
  const val = (r: unknown[], x: string) => (at(x) >= 0 ? n(r[at(x)]) : null);
  const items: ArFlowItem[] = [];
  for (const r of raw.slice(hi + 1)) {
    const name = t(r[at('거래처')]);
    if (!name || t(r[at('계정명')]) !== '외상매출금') continue;
    const contract = t(r[at('계약구분')]);
    const g = (x: string) => val(r, x) ?? 0;
    const net = (x: string) => val(r, `${x}_부가세`) ?? Math.round(g(x) / 1.1);
    items.push({
      name, invoice: t(r[at('invoiceNo')]), contract, person: t(r[at('회계사')]),
      kind: contract === '기장' ? 'bk' : /세무조정/.test(contract) ? 'tax' : 'other',
      billed: g('청구액'), billedNet: net('청구액'), open: g('기초이월액'), openNet: net('기초이월액'),
      paid: g('당기입금액'), paidNet: net('당기입금액'), writeoff: g('당기대손액'), close: g('잔금'), closeNet: net('잔금'),
    });
  }
  return { dept, from: period?.[1] ?? null, to: period?.[2] ?? null, items };
}

/**
 * 원장에서 「청구번호|거래처명」마다 수입 성격별 금액. 미수금대장의 invoiceNo 는 원장 외상매출금 차변 적요의
 * 「거래#:26-0331-0719」 번호다(전표번호와 다르다 — 2026-10-19 백련·에이치앤아비즈로 확인). 거래#가 없으면 전표번호로도 찾게 둔다.
 */
export function slipKindsByName(lines: LedgerLine[]): Map<string, Record<'bk' | 'tax' | 'other', number>> {
  const bySlip = new Map<string, Record<'bk' | 'tax' | 'other', number>>();
  for (const x of lines) {
    if (!isRevenue(x.acct)) continue;
    const key = `${x.slip}|${normName(x.name)}`;
    const o = bySlip.get(key) ?? { bk: 0, tax: 0, other: 0 };
    o[kindOf(x.acct)] += x.cr - x.dr;
    bySlip.set(key, o);
  }
  const m = new Map(bySlip);
  for (const x of lines) {
    if (x.acct !== '외상매출금' || !x.dr) continue;
    const inv = (x.sum ?? '').match(/거래#\s*:?\s*(\d{2}-\d{4}-\d{4})/)?.[1];
    const k = bySlip.get(`${x.slip}|${normName(x.name)}`);
    if (inv && k) m.set(`${inv}|${normName(x.name)}`, k);
  }
  return m;
}

/**
 * 미수금대장 → 거래처 줄. codeOf: 거래처명 → ERP 코드(부르는 쪽이 준다). 감사팀은 세무조정이 있는 거래처만.
 * slipKinds(원장)가 있으면 청구서마다 **원장의 수입 계정 비율**로 기장 / 세무조정 / 기타를 나눈다 —
 * 감사 계약 청구서 안에 세무조정 보수가 든 경우가 많아 계약구분만으로는 세무조정이 빠진다(2026-10-19 감사팀 확인).
 * 원장에 그 전표가 없으면(지난해 청구서) 계약구분을 따른다.
 * 감사팀 담당(erp_cpa)은 세무조정 부분이 있는 청구서의 「회계사」를 금액으로 가중해 고른다.
 */
export function aggregateArFlow(flow: ArFlow, dept: Dept, codeOf: (name: string) => string, advRatio: Map<string, number> = new Map(), slipKinds?: Map<string, Record<'bk' | 'tax' | 'other', number>>): (ClientAgg & { ar_open: number; ar_close: number; erp_cpa: string | null })[] {
  type Row = ClientAgg & { ar_open: number; ar_close: number; erp_cpa: string | null; persons: Map<string, number>; taxPersons: Map<string, number>; hasBk: boolean };
  const m = new Map<string, Row>();
  for (const x of flow.items) {
    const code = codeOf(x.name);
    let c = m.get(code);
    if (!c) {
      c = { dept, code, name: x.name, cash: 0, cash_bk: 0, cash_adv: 0, cash_tax: 0, cash_other: 0, billed_bk: 0, billed_tax: 0, billed_other: 0, writeoff: 0, tax_mode: '자가', ar_open: 0, ar_close: 0, erp_cpa: null, persons: new Map(), taxPersons: new Map(), hasBk: false };
      m.set(code, c);
    }
    const sk = slipKinds?.get(`${x.invoice}|${normName(x.name)}`);
    const tot = sk ? sk.bk + sk.tax + sk.other : 0;
    const frac: Record<'bk' | 'tax' | 'other', number> = tot > 0 ? { bk: sk!.bk / tot, tax: sk!.tax / tot, other: sk!.other / tot } : { bk: 0, tax: 0, other: 0, [x.kind]: 1 };
    c.cash += x.paid;
    c.cash_bk += x.paid * frac.bk; c.cash_tax += x.paid * frac.tax; c.cash_other += x.paid * frac.other;
    c.billed_bk += x.billedNet * frac.bk; c.billed_tax += x.billedNet * frac.tax; c.billed_other += x.billedNet * frac.other;
    if (frac.bk > 0) c.hasBk = true;
    c.writeoff += x.writeoff;
    // 미수금은 기장 관련만 본다(원본 AR 시트도 감사 관련을 뺐다) — 감사팀 자료의 미수금은 넣지 않는다.
    if (dept === '기장팀') { c.ar_open += x.openNet; c.ar_close += x.closeNet; }
    if (x.person) {
      c.persons.set(x.person, (c.persons.get(x.person) ?? 0) + Math.abs(x.billed) + Math.abs(x.paid) + 1);
      if (frac.tax > 0) c.taxPersons.set(x.person, (c.taxPersons.get(x.person) ?? 0) + (Math.abs(x.billed) + Math.abs(x.paid)) * frac.tax + 1);
    }
  }
  const top = (mp: Map<string, number>) => [...mp.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return [...m.values()].map(({ persons, taxPersons, hasBk, ...c }) => {
    c.cash_tax = Math.round(c.cash_tax); c.cash_other = Math.round(c.cash_other); c.cash_bk = c.cash - c.cash_tax - c.cash_other;
    c.billed_bk = Math.round(c.billed_bk); c.billed_tax = Math.round(c.billed_tax); c.billed_other = Math.round(c.billed_other);
    c.erp_cpa = (dept === '감사팀' ? top(taxPersons) : null) ?? top(persons);
    c.cash_adv = Math.round(c.cash_bk * Math.min(1, Math.max(0, advRatio.get(c.code) ?? 0)));
    c.tax_mode = dept === '기장팀' && hasBk ? '기장수행' : '자가';
    return c;
  }).filter((c) => dept === '기장팀' || c.billed_tax || c.cash_tax)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

/** 원장의 대손 — 거래처명 → 대손상각비(VAT 포함). 미수금대장은 대손 처리분을 「당기입금액」에 넣어 두기 때문에 빼야 한다. */
export function writeoffsByName(lines: LedgerLine[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of lines) if (x.acct === '대손상각비' && x.dr) m.set(normName(x.name), (m.get(normName(x.name)) ?? 0) + x.dr);
  return m;
}

/**
 * 미수금대장 줄에서 대손 처리분을 입금에서 빼고 대손으로 옮긴다. 어느 일(기장·세무조정)의 미수금이었는지는
 * 그 거래처 기초 미수금의 구성 비율로 나눈다(대손은 지난해 미수금을 떠는 것이라).
 */
export function applyWriteoffs<T extends ClientAgg>(rows: T[], flow: ArFlow, wo: Map<string, number>): T[] {
  return rows.map((r) => {
    const w = wo.get(normName(r.name)) ?? 0;
    if (!w || r.writeoff) return r;
    const its = flow.items.filter((x) => normName(x.name) === normName(r.name));
    const open = { bk: 0, tax: 0, other: 0 };
    for (const x of its) open[x.kind] += x.open;
    const tot = open.bk + open.tax + open.other;
    const part = (k: 'bk' | 'tax' | 'other') => (tot ? Math.round((w * open[k]) / tot) : k === 'bk' ? w : 0);
    const pt = part('tax'), po = part('other'), pb = w - pt - po;
    return { ...r, writeoff: w, cash: r.cash - w, cash_bk: r.cash_bk - pb, cash_tax: r.cash_tax - pt, cash_other: r.cash_other - po };
  });
}

// ── 기장팀 비용(ERP 실제 발생분) ───────────────────────────────────────────────
// 부서별원장의 비용 계정을 계정 · 소분류 · 사원으로 모은다. 결산 엑셀(급여_연도 · (FY연도) 기장팀 칸)과 나란히 대 보려는 것.
// 자산 · 부채 · 수입 계정과 대손상각비(② 거래처 입금의 대손으로 따로 셈)는 비용이 아니다.
const NOT_COST = /^(외상매출금|부가세|본지점|미지급금|미수금|선급|선수|예수금|가지급금|가수금|보통예금|현금|차량운반구|비품|감가상각누계액|임차보증금|잡이익|유형자산처분|대손상각비)|수입/;
export const isCostAcct = (a: string) => !NOT_COST.test(a);

export interface ErpCostLine { slip: string; sum: string; amount: number }
export interface ErpCost { acct: string; sub: string; staff: string; amount: number; n: number; lines: ErpCostLine[] }

/** 계정 안에서 비용 항목이 갈리는 것만 소분류로 나눈다(4대보험 / 주민세, 퇴직연금수수료 / CMS, 노트북 / 소모품 …). */
export function costSub(acct: string, sum: string): string {
  if (acct === '세금과공과금') {
    if (/\(본인\)/.test(sum)) return '4대보험(본인분)';
    if (/정산/.test(sum) && /보험/.test(sum)) return '4대보험 정산';
    if (/\(법인\)|산재|고용보험|국민연금|건강보험|장기요양/.test(sum)) return '4대보험';
    if (/주민세/.test(sum)) return '주민세 종업원분';
    if (/인지세/.test(sum)) return '인지세';
    return '';
  }
  if (acct === '지급수수료') {
    if (/퇴직연금/.test(sum)) return '퇴직연금수수료';
    if (/CMS|카드결제/i.test(sum)) return 'CMS · 카드결제 수수료';
    if (/텍스넷/.test(sum)) return '텍스넷 사용료';
    return '';
  }
  if (acct === '소모품비' && /노트북|컴퓨터|모니터|데스크탑|PC/i.test(sum)) return '자산(노트북 등)';
  if (acct === '인력개발비' && /내일채움/.test(sum)) return '내일채움공제';
  return '';
}

/**
 * 비용 줄을 모은다. from · to(YYYY-MM-DD) 밖의 전표는 뺀다(전표번호 앞 「YY-MMDD」 = 전표일).
 * 사원명이 팀 이름(「기장24팀」)이면 팀 공통(''). 적요에 원장에 나오는 다른 사원 이름이 있으면 그 사람 몫(퇴사자 보험 정산 등).
 */
export function aggregateCosts(lines: LedgerLine[], from: string, to: string): { rows: ErpCost[]; outside: number } {
  const cost = lines.filter((x) => isCostAcct(x.acct));
  const people = new Set(cost.map((x) => x.staff ?? '').filter((s) => s && !/팀$/.test(s)));
  const m = new Map<string, ErpCost>();
  let outside = 0;
  for (const x of cost) {
    const d = /^(\d{2})-(\d{2})(\d{2})/.exec(x.slip);
    const day = d ? `20${d[1]}-${d[2]}-${d[3]}` : '';
    if (day && (day < from || day > to)) { outside++; continue; }
    const sum = x.sum ?? '';
    let staff = /팀$/.test(x.staff ?? '') ? '' : (x.staff ?? '');
    for (const p of people) if (p !== staff && sum.includes(p)) { staff = p; break; }
    const sub = costSub(x.acct, sum);
    const k = `${x.acct}|${sub}|${staff}`;
    const r = m.get(k) ?? { acct: x.acct, sub, staff, amount: 0, n: 0, lines: [] };
    const amount = x.dr - x.cr;
    r.amount += amount; r.n++; r.lines.push({ slip: x.slip, sum: sum.replace(/\s*\(거래#:[^)]*\)/, ''), amount });
    m.set(k, r);
  }
  return { rows: [...m.values()], outside };
}
