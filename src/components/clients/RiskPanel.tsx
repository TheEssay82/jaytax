// 현황및예산조회 › 이탈 위험 · 신규 유입.
//
// 예산은 '지금 계약이 이대로 굴러간다'는 가정 위에 선다. 그 가정이 흔들리는 곳이 두 군데다 —
//   ① 곧 끝나거나 이미 청구가 끊긴 계약(예산에서 빼야 할 것)
//   ② 새로 들어온 계약(예산에 더할 것)
// 그래서 두 패널을 나란히 둔다. 합계는 **연환산**이라 서로 견줄 수 있다.
import { useMemo, useState } from 'react';
import type { SalesContract, BillingCycle } from '../../lib/salesContractApi';
import type { BizEntityFull } from '../../lib/bizRegistryApi';
import { corpDisplayName } from '../../lib/bizRegistryApi';

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const CYCLE_MULT: Record<BillingCycle, number> = { 월: 12, 분기: 4, 반기: 2, 연: 1, 발생시: 1, 건: 1 };
const annualize = (c: SalesContract) => (c.amount || 0) * (CYCLE_MULT[c.billingCycle] ?? 1);

const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

export type RiskKind = '종료 임박' | '종료됨' | '청구 끊김';

interface RiskRow {
  id: string; kind: RiskKind; company: string; place: string; code: string;
  cpa: string; staff: string; annual: number;
  /** 종료일 또는 마지막 청구월. */ when: string;
  detail: string;
}

/**
 * 이탈 위험 — 예산에서 덜어 내야 할 계약.
 *
 * · 종료 임박 = 종료일이 `withinDays` 안. 재계약이 되면 날짜를 미루면 된다.
 * · 종료됨   = 종료일이 이미 지났는데 계약이 살아 있다. 정리하거나 연장해야 한다.
 * · 청구 끊김 = 매달 청구하는 계약인데 최근 몇 달 청구가 없다. 조용히 빠져나간 경우가 여기 잡힌다.
 */
export function ChurnRiskPanel({ contracts, entMap, lastBilled, today }: {
  contracts: SalesContract[];
  entMap: Map<string, BizEntityFull>;
  /** contractId → 마지막으로 청구한 귀속월. */
  lastBilled: Map<string, string>;
  today: string;
}) {
  const [withinDays, setWithinDays] = useState(180);
  const [gapMonths, setGapMonths] = useState(3);
  const [kindF, setKindF] = useState<'' | RiskKind>('');

  const rows = useMemo<RiskRow[]>(() => {
    const thisMonth = today.slice(0, 7);
    const out: RiskRow[] = [];
    for (const c of contracts) {
      if (!c.confirmed) continue;                     // 미계약(예정)은 이탈 판단 대상이 아니다
      const e = entMap.get(c.entityId);
      const company = e ? corpDisplayName(e.name, e.corpForm, e.corpFormPosition) : '';
      const place = e?.places.find((p) => p.id === c.placeId)?.placeName ?? '';
      const base = {
        id: c.id, company, place, code: c.contractCode,
        cpa: c.effectiveCpa, staff: c.effectiveStaff.map((s) => s.staffName).join(','),
        annual: annualize(c),
      };
      if (c.endDate) {
        const d = daysBetween(today, c.endDate);
        if (d < 0) {
          out.push({ ...base, kind: '종료됨', when: c.endDate, detail: `${-d}일 지남` });
          continue;
        }
        if (d <= withinDays) {
          out.push({ ...base, kind: '종료 임박', when: c.endDate, detail: `D-${d}` });
          continue;
        }
      }
      // 매달 청구하는 계약만 '끊김'을 판단할 수 있다.
      if (c.billingCycle === '월') {
        const last = lastBilled.get(c.id);
        const cut = shiftMonth(thisMonth, -gapMonths);
        if (!last) {
          out.push({ ...base, kind: '청구 끊김', when: '—', detail: '청구 기록 없음' });
        } else if (last < cut) {
          const gap = monthsBetween(last, thisMonth);
          out.push({ ...base, kind: '청구 끊김', when: last, detail: `${gap}개월째 없음` });
        }
      }
    }
    const order: Record<RiskKind, number> = { '종료됨': 0, '청구 끊김': 1, '종료 임박': 2 };
    return out.sort((a, b) => order[a.kind] - order[b.kind] || b.annual - a.annual);
  }, [contracts, entMap, lastBilled, today, withinDays, gapMonths]);

  const view = kindF ? rows.filter((r) => r.kind === kindF) : rows;
  const total = view.reduce((s, r) => s + r.annual, 0);
  const count = (k: RiskKind) => rows.filter((r) => r.kind === k).length;

  return (
    <div style={{ border: '1px solid #e6c9c9', borderRadius: 8, background: '#fffaf9', padding: '8px 10px', marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <b style={{ fontSize: 12.5, color: '#8a3d3d' }}>⚠️ 이탈 위험</b>
        <span style={{ fontSize: 11.5, color: '#666' }}>
          {view.length}건 · 연환산 <b style={{ color: '#c33' }}>{won(total)}</b>
        </span>
        <select value={kindF} onChange={(e) => setKindF(e.target.value as '' | RiskKind)}>
          <option value="">전체</option>
          <option value="종료됨">종료됨 ({count('종료됨')})</option>
          <option value="청구 끊김">청구 끊김 ({count('청구 끊김')})</option>
          <option value="종료 임박">종료 임박 ({count('종료 임박')})</option>
        </select>
        <label style={{ fontSize: 11.5 }}>
          종료 임박 기준{' '}
          <select value={withinDays} onChange={(e) => setWithinDays(Number(e.target.value))}>
            <option value={90}>90일</option><option value={180}>180일</option><option value={365}>1년</option>
          </select>
        </label>
        <label style={{ fontSize: 11.5 }}>
          청구 끊김 기준{' '}
          <select value={gapMonths} onChange={(e) => setGapMonths(Number(e.target.value))}>
            <option value={2}>2개월</option><option value={3}>3개월</option><option value={6}>6개월</option>
          </select>
        </label>
      </div>
      <div style={{ fontSize: 10.5, color: '#a88', marginBottom: 5 }}>
        예산에서 덜어 낼 후보입니다. <b>종료됨</b>은 정리하거나 연장하고, <b>청구 끊김</b>은 매달 청구하는 계약인데
        최근 청구가 없는 것입니다(조용히 빠져나간 곳이 여기 잡힙니다). 재계약이 되면 매출계약의 종료일만 미루면 됩니다.
      </div>
      <div style={{ maxHeight: 260, overflow: 'auto' }}>
        <table className="tbl" style={{ fontSize: 11.5 }}>
          <thead>
            <tr><th>구분</th><th>거래처</th><th>사업장</th><th>계약코드</th>
              <th>담당회계사</th><th>담당직원</th><th>기준일</th><th>상태</th><th className="r">연환산</th></tr>
          </thead>
          <tbody>
            {view.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 16, color: '#BBB' }}>
                해당하는 계약이 없습니다.
              </td></tr>
            )}
            {view.map((r) => (
              <tr key={r.id + r.kind}>
                <td style={{ whiteSpace: 'nowrap', fontWeight: 700, color: r.kind === '종료 임박' ? '#92400E' : '#991B1B' }}>
                  {r.kind}
                </td>
                <td style={{ fontWeight: 700, color: '#1A2B52' }}>{r.company}</td>
                <td>{r.place}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 10.5 }}>{r.code}</td>
                <td style={{ fontSize: 11 }}>{r.cpa}</td>
                <td style={{ fontSize: 11 }}>{r.staff}</td>
                <td>{r.when}</td>
                <td style={{ color: '#888' }}>{r.detail}</td>
                <td className="r" style={{ fontWeight: 700 }}>{won(r.annual)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: '#f7ecec', fontWeight: 700 }}>
              <td colSpan={8}>합계 {view.length}건</td>
              <td className="r">{won(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** 신규 유입 추이 — 계약 시작월 기준. 종료를 함께 놓아 **순증**을 본다. */
export function InflowPanel({ contracts, today }: { contracts: SalesContract[]; today: string }) {
  const [span, setSpan] = useState(24);
  const data = useMemo(() => {
    const thisMonth = today.slice(0, 7);
    const months = Array.from({ length: span }, (_, i) => shiftMonth(thisMonth, -(span - 1 - i)));
    const inN = new Map<string, number>(), inA = new Map<string, number>();
    const outN = new Map<string, number>(), outA = new Map<string, number>();
    for (const c of contracts) {
      const a = annualize(c);
      if (c.startDate) {
        const m = c.startDate.slice(0, 7);
        inN.set(m, (inN.get(m) ?? 0) + 1); inA.set(m, (inA.get(m) ?? 0) + a);
      }
      if (c.endDate) {
        const m = c.endDate.slice(0, 7);
        outN.set(m, (outN.get(m) ?? 0) + 1); outA.set(m, (outA.get(m) ?? 0) + a);
      }
    }
    const peak = Math.max(1, ...months.map((m) => inA.get(m) ?? 0));
    return { months, inN, inA, outN, outA, peak };
  }, [contracts, today, span]);

  const sum = (m: Map<string, number>) => data.months.reduce((s, x) => s + (m.get(x) ?? 0), 0);
  const net = sum(data.inA) - sum(data.outA);

  return (
    <div style={{ border: '1px solid #c9dfc9', borderRadius: 8, background: '#f9fdf9', padding: '8px 10px', marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <b style={{ fontSize: 12.5, color: '#2f6b3f' }}>🌱 신규 유입 추이</b>
        <select value={span} onChange={(e) => setSpan(Number(e.target.value))}>
          <option value={12}>최근 12개월</option><option value={24}>최근 24개월</option><option value={36}>최근 36개월</option>
        </select>
        <span style={{ fontSize: 11.5, color: '#666' }}>
          신규 {sum(data.inN)}건 {won(sum(data.inA))} · 종료 {sum(data.outN)}건 {won(sum(data.outA))} ·{' '}
          <b style={{ color: net >= 0 ? '#2a7' : '#c33' }}>순증 {net >= 0 ? '+' : ''}{won(net)}</b>
        </span>
      </div>
      <div style={{ fontSize: 10.5, color: '#8a8', marginBottom: 5 }}>
        계약의 <b>시작월·종료월</b> 기준이고 금액은 <b>연환산</b>입니다 — 몇 건이 아니라 얼마가 늘고 줄었는지를 봅니다.
        순증이 계속 (−)이면 예산을 낮춰 잡아야 한다는 신호입니다.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl" style={{ fontSize: 11.5, minWidth: 700 }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0, background: '#eef6ee' }}>구분 \ 월</th>
              {data.months.map((m) => <th key={m} className="r">{m.slice(2)}</th>)}
              <th className="r">합계</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ position: 'sticky', left: 0, background: '#f9fdf9', fontWeight: 600 }}>신규(건)</td>
              {data.months.map((m) => <td key={m} className="r" style={{ color: '#666' }}>{data.inN.get(m) || '·'}</td>)}
              <td className="r" style={{ fontWeight: 700 }}>{sum(data.inN)}</td>
            </tr>
            <tr>
              <td style={{ position: 'sticky', left: 0, background: '#f9fdf9', fontWeight: 600, color: '#2f6b3f' }}>신규(연환산)</td>
              {data.months.map((m) => {
                const v = data.inA.get(m) ?? 0;
                const pct = Math.round((v / data.peak) * 100);
                return (
                  <td key={m} className="r" style={{
                    color: v ? '#274' : '#ccc',
                    background: v ? `linear-gradient(to top, rgba(40,120,70,.16) ${pct}%, transparent ${pct}%)` : undefined,
                  }}>{v ? won(v) : '·'}</td>
                );
              })}
              <td className="r" style={{ fontWeight: 700 }}>{won(sum(data.inA))}</td>
            </tr>
            <tr>
              <td style={{ position: 'sticky', left: 0, background: '#f9fdf9', fontWeight: 600, color: '#a33' }}>종료(연환산)</td>
              {data.months.map((m) => {
                const v = data.outA.get(m) ?? 0;
                return <td key={m} className="r" style={{ color: v ? '#c33' : '#ccc' }}>{v ? `−${won(v)}` : '·'}</td>;
              })}
              <td className="r" style={{ fontWeight: 700, color: '#c33' }}>{won(sum(data.outA))}</td>
            </tr>
            <tr style={{ background: '#eef6ee', fontWeight: 700 }}>
              <td style={{ position: 'sticky', left: 0, background: '#eef6ee' }}>순증</td>
              {data.months.map((m) => {
                const v = (data.inA.get(m) ?? 0) - (data.outA.get(m) ?? 0);
                return <td key={m} className="r" style={{ color: v > 0 ? '#274' : v < 0 ? '#c33' : '#ccc' }}>
                  {v ? `${v > 0 ? '+' : ''}${won(v)}` : '·'}
                </td>;
              })}
              <td className="r" style={{ color: net >= 0 ? '#274' : '#c33' }}>{net >= 0 ? '+' : ''}{won(net)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function monthsBetween(a: string, b: string): number {
  const [y1, m1] = a.split('-').map(Number);
  const [y2, m2] = b.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}
