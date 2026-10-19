// 기장배분 — ERP 부서별원장(여러 달 한 파일)을 거래처별 입금·청구·대손으로 모은다. supabase 를 물지 않는다.
//
//   · 입금 = 외상매출금 대변(정정 음수 줄 포함). 대손 전표(대손상각비가 있는 전표)의 외상매출금 대변은 입금이 아니다.
//   · 청구 = 수입 계정 대변 − 차변(VAT 제외). 기장대리수입 → 기장, 세무조정수입(법인·소득) → 세무조정, 그 밖의 「…수입」 → 기타(감사·용역).
//   · 입금의 성격(기장 / 세무조정 / 기타)은 선입선출로 그 해 청구서에 맞춘다(아래 aggregateLedger).
//   · 자문(컨설팅)은 ERP 에 따로 계정이 없어 기장대리수입에 섞여 있다 → 앱 매출 실적의 비율(advRatio)로 기장 입금에서 뗀다.
//   · 세무조정 구분 기본값: 기장팀 원장에 기장 청구가 있으면 기장수행, 아니면 자가(감사팀 원장은 늘 자가).
// 원본 엑셀은 이 일을 입금 줄마다 손으로 했다(기장24 시트 F~J열·A열).

export type Dept = '기장팀' | '감사팀';
export interface LedgerLine { acct: string; slip: string; code: string; name: string; dr: number; cr: number }
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
      out.push({ acct, slip, code: t(r[at('거래처코드')]), name: t(r[at('거래처')]), dr, cr });
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

export interface ClientRow extends ClientAgg { cpa: string | null; mode_by_hand?: boolean; cpa_by_hand?: boolean; memo?: string | null }

/** 회계사별 합계 → bk_settle_cpa 칸. 대손은 VAT 제외로(미수금이 VAT 제외라서) ÷ 1.1. */
export function sumByCpa(rows: ClientRow[]) {
  const z = () => ({ bk_fee: 0, tax_bk: 0, tax_self: 0, advisory_excl: 0, writeoff: 0, clients: 0 });
  const out: Record<string, ReturnType<typeof z>> = { 조현규: z(), 김준성: z(), 정우철: z() };
  const loose = { cash: 0, writeoff: 0, clients: 0 };
  for (const r of rows) {
    const o = r.cpa ? out[r.cpa] : undefined;
    if (!o) { loose.cash += r.cash_bk + r.cash_tax; loose.writeoff += r.writeoff; loose.clients++; continue; }
    o.clients++;
    o.bk_fee += r.cash_bk;
    o.advisory_excl += r.cash_adv;
    if (r.tax_mode === '기장수행') o.tax_bk += r.cash_tax; else o.tax_self += r.cash_tax;
    o.writeoff += Math.round(r.writeoff / 1.1);
  }
  return { byCpa: out, loose };
}
