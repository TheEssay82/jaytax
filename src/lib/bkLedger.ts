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

// ── 기장팀 비용(ERP, 현금주의) ─────────────────────────────────────────────────
// 부서별원장의 비용 계정을 「돈이 나간 날」 기준으로 계정 · 소분류 · 사원별로 모은다(사용자 2026-10-21: 기장비용은 현금주의, VAT 포함).
// 결산 엑셀((FY연도) 기장팀 칸)이 그렇게 셈한다 — 4대보험은 납부월(=전월분), 카드는 결제월, 거래처 청구는 지급일, 금액은 VAT 포함.
//   · 급여 · 상여 · 퇴직급여: 급여 전표 날짜 그대로(엑셀도 급여대장 지급총액).
//   · 카드: 미지급금(신용카드) 결제액(같은 결제 전표의 취소 환급 포함) → 「법인카드 결제」. 카드로 쓴 비용 줄은 결제 때 센다.
//   · 미지급금으로 잡힌 비용(4대보험 법인분 · 노트북 · CMS · 텍스넷 · 일용직 급여 …): 미지급금을 갚은 날, 갚은 금액(VAT 포함)으로.
//     갚은 줄 ↔ 청구 줄은 ① 거래# ② 같은 거래처 · 같은 금액 순으로 잇는다.
//   · 4대보험(공단 미지급금)은 계상한 다음 달에 낸 것으로 본다 — 엑셀 칸이 그렇다(8~6월 납부분 = ERP 7~5월 계상분, 사원별로 원 단위까지 같음).
//     첫 달(7월) 납부분의 계상(전년 6월) 원장이 없으면 납부액을 사원 구분 없이 넣는다.
//   · 그 밖에 본지점(현금)으로 바로 나간 비용: 그 날짜. 감가상각비처럼 돈이 안 나간 비용은 뺀다.
// 자산 · 부채 · 수입 계정과 대손상각비(② 거래처 입금의 대손으로 따로 셈)는 비용이 아니다.
const NOT_COST = /^(외상매출금|부가세|본지점|미지급금|미수금|선급|선수|예수금|가지급금|가수금|보통예금|현금|차량운반구|비품|감가상각누계액|임차보증금|잡이익|유형자산처분|대손상각비)|수입/;
export const isCostAcct = (a: string) => !NOT_COST.test(a);
const PAYROLL = /^(직원급여|상여금|퇴직급여)$/;
const NON_CASH = /^감가상각비$/;
const GONGDAN = /국민건강보험공단|국민연금|고용보험|산재보험/;
export const CARD_ACCT = '법인카드 결제';

export interface ErpCostLine { slip: string; sum: string; amount: number }
export interface ErpCost { acct: string; sub: string; staff: string; amount: number; n: number; lines: ErpCostLine[] }

/** 계정 안에서 비용 항목이 갈리는 것만 소분류로 나눈다(4대보험 / 일용직 / 주민세, 퇴직연금수수료 / CMS, 노트북 / 소모품 …). */
export function costSub(acct: string, sum: string): string {
  if (acct === '세금과공과금') {
    if (/주민세/.test(sum)) return '주민세 종업원분';
    if (/일용/.test(sum)) return '일용직 4대보험';
    if (/정산/.test(sum) && /보험|요양/.test(sum)) return '4대보험 정산';
    // 「건강보험(본인)」처럼 적요가 「본인」인 줄도 법인분이다(그 달 법인분 줄 대신 적힌 것 — 2025-11 · 2026-06).
    if (/\(법인\)|\(본인\)|산재|고용보험|국민연금|건강보험|장기요양/.test(sum)) return '4대보험';
    if (/인지세/.test(sum)) return '인지세';
    return '';
  }
  if (acct === '지급수수료') {
    if (/퇴직연금/.test(sum)) return '퇴직연금수수료';
    if (/CMS|카드결제|카드수금/i.test(sum)) return 'CMS · 카드결제 수수료';
    if (/텍스넷/.test(sum)) return '텍스넷 사용료';
    return '';
  }
  if (acct === '소모품비' && /노트북|컴퓨터|모니터|데스크탑|PC/i.test(sum)) return '자산(노트북 등)';
  if (acct === '도서인쇄비' && /실무/.test(sum)) return '실무서';
  if (acct === '인력개발비' && /내일채움/.test(sum)) return '내일채움공제';
  return '';
}

const dayOf = (slip: string) => { const d = /^(\d{2})-(\d{2})(\d{2})/.exec(slip); return d ? `20${d[1]}-${d[2]}-${d[3]}` : ''; };
const ymOf = (slip: string) => dayOf(slip).slice(0, 7);
const nextYm = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
const prevYm = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const txOf = (sum: string) => /거래#\s*:?\s*(\d{2}-\d{4}-\d{4})/.exec(sum)?.[1];
const clean = (sum: string) => sum.replace(/\s*\(거래#:[^)]*\)/, '').replace(/\s*\[\s*지출결의서[^\]]*\]/, '').replace(/^품목:/, '').trim();

/**
 * 현금주의로 모은다. from · to(YYYY-MM-DD) = 돈이 나간 날의 범위.
 * 사원명이 팀 이름(「기장24팀」)이면 팀 공통(''). 적요에 원장의 다른 사원 이름이 있으면 그 사람 몫(퇴사자 보험 정산 등).
 * notes: 잇지 못한 지급 · 전기 계상분이 없어 사원을 못 가른 공단 납부 등.
 */
export function aggregateCosts(lines: LedgerLine[], from: string, to: string): { rows: ErpCost[]; outside: number; notes: string[] } {
  const people = new Set(lines.filter((x) => isCostAcct(x.acct)).map((x) => x.staff ?? '').filter((s) => s && !/팀$/.test(s)));
  const staffOf = (x: LedgerLine) => {
    let s = /팀$/.test(x.staff ?? '') ? '' : (x.staff ?? '');
    for (const p of people) if (p !== s && (x.sum ?? '').includes(p)) { s = p; break; }
    return s;
  };
  const bySlip = new Map<string, LedgerLine[]>();
  for (const x of lines) { const a = bySlip.get(x.slip) ?? []; a.push(x); bySlip.set(x.slip, a); }
  const inRange = (slip: string) => { const d = dayOf(slip); return !d || (d >= from && d <= to); };

  const m = new Map<string, ErpCost>();
  const add = (acct: string, sub: string, staff: string, amount: number, slip: string, sum: string) => {
    if (!amount) return;
    const k = `${acct}|${sub}|${staff}`;
    const r = m.get(k) ?? { acct, sub, staff, amount: 0, n: 0, lines: [] };
    r.amount += amount; r.n++; r.lines.push({ slip, sum, amount });
    m.set(k, r);
  };
  const notes: string[] = [];
  let outside = 0;

  // 청구(미지급금 대변) — 거래처 이름 · 거래#별로. parts = 그 전표에서 같은 거래처의 비용 줄(VAT 는 지급액을 나눌 때 저절로 들어간다).
  interface Bill { slip: string; name: string; tx?: string; amount: number; parts: LedgerLine[]; used: boolean; gongdan: boolean }
  const bills: Bill[] = [];
  const deferred = new Set<LedgerLine>();
  for (const [slip, ls] of bySlip) {
    const card = ls.some((x) => x.acct === '미지급금(신용카드)' && x.cr);
    const cash = ls.some((x) => x.acct === '본지점' && x.cr);
    const cost = ls.filter((x) => isCostAcct(x.acct));
    if (card) for (const x of cost) deferred.add(x);
    for (const p of ls.filter((x) => x.acct === '미지급금' && x.cr)) {
      // 같은 거래처의 비용 줄이 이 청구. 그런 줄이 없고 현금도 안 나간 전표면 그 전표의 비용 줄 전부.
      // 급여 전표처럼 같은 거래처 줄이 사원마다 있으면 같은 사원 · 같은 금액 줄과 짝짓는다.
      const same = cost.filter((x) => !PAYROLL.test(x.acct) && x.name === p.name);
      const pair = same.filter((x) => x.staff === p.staff && x.dr - x.cr === p.cr - p.dr && !deferred.has(x)).slice(0, 1);
      const own = pair.length && same.length > 1 ? pair : same;
      const parts = own.length || cash ? own : cost.filter((x) => !PAYROLL.test(x.acct));
      for (const x of parts) deferred.add(x);
      bills.push({ slip, name: p.name, tx: txOf(p.sum ?? ''), amount: p.cr - p.dr, parts, used: false, gongdan: GONGDAN.test(p.name) });
    }
  }
  const spread = (parts: LedgerLine[], amount: number, slip: string, sum: string) => {
    const base = parts.reduce((s, x) => s + x.dr - x.cr, 0);
    let left = amount;
    parts.forEach((x, i) => {
      const a = i === parts.length - 1 ? left : Math.round((amount * (x.dr - x.cr)) / (base || 1));
      left -= a;
      add(x.acct, costSub(x.acct, x.sum ?? ''), staffOf(x), a, slip, `${clean(sum)} ← ${x.slip} ${clean(x.sum ?? '')}`);
    });
  };

  for (const [slip, ls] of bySlip) {
    if (!inRange(slip)) { if (ls.some((x) => isCostAcct(x.acct) || /^미지급금/.test(x.acct))) outside++; continue; }
    // 급여 · 상여 · 퇴직급여 — 전표 날짜 그대로.
    for (const x of ls.filter((y) => PAYROLL.test(y.acct))) add(x.acct, costSub(x.acct, x.sum ?? ''), staffOf(x), x.dr - x.cr, slip, clean(x.sum ?? ''));
    // 카드 결제 — 결제액 + 같은 전표의 비용 줄(취소 환급).
    const cardPay = ls.filter((x) => x.acct === '미지급금(신용카드)' && x.dr);
    if (cardPay.length) {
      const extra = ls.filter((x) => isCostAcct(x.acct) && !deferred.has(x) && !PAYROLL.test(x.acct));
      const amt = cardPay.reduce((s, x) => s + x.dr, 0) + extra.reduce((s, x) => s + x.dr - x.cr, 0);
      add(CARD_ACCT, '', '', amt, slip, clean(cardPay[0].sum ?? ''));
    }
    // 미지급금 지급 — 청구에 잇는다.
    for (const p of ls.filter((x) => x.acct === '미지급금' && x.dr)) {
      if (GONGDAN.test(p.name)) {
        // 공단 납부는 계상분을 다음 달로 옮겨 센다(아래). 전달 계상 원장이 없을 때만 납부액을 그대로.
        if (bills.some((b) => b.gongdan && ymOf(b.slip) === prevYm(ymOf(slip)))) continue;
        add('세금과공과금', '4대보험', '', p.dr, slip, `${clean(p.sum ?? '')} — 전달 계상 원장이 없어 사원을 못 가름`);
        notes.push(`${slip} ${p.name} ${p.dr.toLocaleString('ko-KR')} — 전달(계상) 원장이 없어 사원을 가르지 못했습니다`);
        continue;
      }
      const tx = txOf(p.sum ?? '');
      let hit: Bill[] = tx ? bills.filter((b) => b.tx === tx && b.name === p.name) : [];
      if (!hit.length) { const b = bills.filter((b) => !b.used && b.name === p.name && b.amount === p.dr && b.slip <= slip).pop(); if (b) hit = [b]; }
      if (hit.length) {
        hit.forEach((b) => { b.used = true; });
        spread(hit.flatMap((b) => b.parts), p.dr, slip, p.sum ?? '');
        continue;
      }
      // 이 파일들에 청구가 없다(지난해 청구 · 지난달 공단분 등) — 같은 거래처의 다른 청구 모양을 빌려 쓴다.
      const like = bills.filter((b) => b.name === p.name && b.parts.length);
      if (like.length) { spread(like[0].parts, p.dr, slip, `${p.sum ?? ''} (지난 청구분)`); continue; }
      add('미지급금 지급', p.name, '', p.dr, slip, clean(p.sum ?? ''));
      notes.push(`${slip} ${p.name} ${p.dr.toLocaleString('ko-KR')} — 청구 전표를 찾지 못했습니다`);
    }
    // 현금으로 바로 나간 비용.
    if (!cardPay.length && ls.some((x) => x.acct === '본지점' && x.cr)) {
      const vat = ls.filter((x) => x.acct === '부가세대급금').reduce((s, x) => s + x.dr - x.cr, 0);
      const direct = ls.filter((x) => isCostAcct(x.acct) && !deferred.has(x) && !PAYROLL.test(x.acct) && !NON_CASH.test(x.acct));
      if (direct.length) {
        const base = direct.reduce((s, x) => s + x.dr - x.cr, 0);
        spread(direct, base + vat, slip, '');
      }
    }
  }
  // 4대보험 — 계상한 다음 달 납부.
  const [fromYm, toYm] = [from.slice(0, 7), to.slice(0, 7)];
  for (const b of bills.filter((x) => x.gongdan)) {
    const pay = nextYm(ymOf(b.slip));
    if (pay >= fromYm && pay <= toYm) spread(b.parts, b.amount, b.slip, `${pay} 납부`);
  }
  return { rows: [...m.values()], outside, notes };
}
