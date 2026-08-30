// 거래처관리 › 거래처현황조회 (거래처관리 2.0.0 · step 4)
// 거래처·사업장·매출계약·담당자를 통합해 현황 목록 + 통계(팀별·CPA별·유형별 연환산 매출 집계).
import { useEffect, useMemo, useState } from 'react';
import { listBizEntities, corpDisplayName, type BizEntityFull } from '../../lib/bizRegistryApi';
import { listSalesContracts, type SalesContract, type BillingCycle } from '../../lib/salesContractApi';
import { listBizContacts, type BizContact } from '../../lib/bizContactApi';
import { findNode } from '../../lib/salesContractTaxonomy';
import { scrollBox, stickyTop, useColWidths, ResizeHandle, clip } from './tableKit';
import { monthlyTotals, monthIndex, indexToMonth, type Basis } from '../../lib/billingSchedule';
import BudgetPanel from './BudgetPanel';
import { listActualsForYear, type MonthlyActual } from '../../lib/revenueActualApi';

const TEAMS = ['감사team', 'taxteam'] as const;

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
// 연환산 계수 — 주기별로 1년치로 환산해 비교 가능하게
const CYCLE_MULT: Record<BillingCycle, number> = { 월: 12, 분기: 4, 반기: 2, 연: 1, 발생시: 1, 건: 1 };
const annualize = (c: SalesContract) => (c.amount || 0) * (CYCLE_MULT[c.billingCycle] ?? 1);
// 매출유형 대분류(팀 아래 첫 레벨) 라벨
const topLabel = (code: string) => findNode(code)?.path[0]?.label ?? '기타';

export default function BizStatusTab() {
  const [entities, setEntities] = useState<BizEntityFull[]>([]);
  const [contracts, setContracts] = useState<SalesContract[]>([]);
  const [contacts, setContacts] = useState<BizContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [kindF, setKindF] = useState<'' | '법인' | '개인'>('');
  const [natF, setNatF] = useState<'' | '매출' | '일반'>('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'annual', dir: 'desc' });
  const { widthOf, startResize } = useColWidths();
  // 월별 매출추이 컨트롤
  const todayMonth = useMemo(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }, []);
  const curSettlementYear = useMemo(() => { const m = Number(todayMonth.slice(5, 7)), y = Number(todayMonth.slice(0, 4)); return m >= 7 ? y : y - 1; }, [todayMonth]);
  const [trendYear, setTrendYear] = useState<number>(0);          // 0 = 미설정 → curSettlementYear 사용
  const [trendBasis, setTrendBasis] = useState<Basis>('accrual'); // 매출(발생) 기본
  const [actuals, setActuals] = useState<MonthlyActual[]>([]);    // 선택 정산연도 월별 실적

  useEffect(() => {
    (async () => {
      try {
        const [e, c, ct] = await Promise.all([listBizEntities(), listSalesContracts(), listBizContacts()]);
        setEntities(e); setContracts(c); setContacts(ct);
      } catch (er) { setError(er instanceof Error ? er.message : '불러오지 못했습니다.'); }
      finally { setLoading(false); }
    })();
  }, []);

  // 거래처별 롤업
  const rows = useMemo(() => {
    const conByEnt = new Map<string, SalesContract[]>();
    for (const c of contracts) (conByEnt.get(c.entityId) ?? conByEnt.set(c.entityId, []).get(c.entityId)!).push(c);
    const ctByEnt = new Map<string, number>();
    for (const c of contacts) ctByEnt.set(c.entityId, (ctByEnt.get(c.entityId) ?? 0) + 1);
    return entities.map((e) => {
      const cons = conByEnt.get(e.id) ?? [];
      const annual = cons.reduce((s, c) => s + annualize(c), 0);
      const cpas = [...new Set(cons.map((c) => c.effectiveCpa).filter(Boolean))];
      const staff = [...new Set(cons.flatMap((c) => c.staff.map((s) => s.staffName)).filter(Boolean))];
      const isSales = e.places.some((p) => p.nature === '매출');
      return {
        e, code: e.code, kind: e.kind, name: corpDisplayName(e.name, e.corpForm, e.corpFormPosition),
        places: e.places.length, nature: isSales ? '매출' : '일반', contracts: cons.length, annual,
        cpa: cpas.join(','), staff: staff.join(','), contacts: ctByEnt.get(e.id) ?? 0,
      };
    });
  }, [entities, contracts, contacts]);

  const view = useMemo(() => {
    let list = rows;
    if (kindF) list = list.filter((r) => r.kind === kindF);
    if (natF) list = list.filter((r) => r.nature === natF);
    if (q.trim()) { const s = q.trim().toLowerCase(); list = list.filter((r) => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) || r.cpa.toLowerCase().includes(s) || r.staff.toLowerCase().includes(s)); }
    const dir = sort.dir === 'asc' ? 1 : -1;
    const num = (r: typeof rows[number]) => (sort.key === 'annual' ? r.annual : sort.key === 'contracts' ? r.contracts : sort.key === 'places' ? r.places : sort.key === 'contacts' ? r.contacts : NaN);
    return [...list].sort((a, b) => {
      if (['annual', 'contracts', 'places', 'contacts'].includes(sort.key)) return (num(a) - num(b)) * dir;
      const va = (a as any)[sort.key] ?? '', vb = (b as any)[sort.key] ?? ''; // eslint-disable-line @typescript-eslint/no-explicit-any
      return String(va).localeCompare(String(vb), 'ko') * dir;
    });
  }, [rows, kindF, natF, q, sort]);

  // 통계
  const stat = useMemo(() => {
    const corp = entities.filter((e) => e.kind === '법인').length;
    const person = entities.filter((e) => e.kind === '개인').length;
    const places = entities.reduce((s, e) => s + e.places.length, 0);
    const salesPlaces = entities.reduce((s, e) => s + e.places.filter((p) => p.nature === '매출').length, 0);
    const totalAnnual = contracts.reduce((s, c) => s + annualize(c), 0);
    const byTeam = agg(contracts, (c) => c.team);
    const byCpa = agg(contracts.filter((c) => c.effectiveCpa), (c) => c.effectiveCpa);
    const byType = agg(contracts, (c) => `${c.team.replace('team', '')}·${topLabel(c.categoryCode)}`);
    return { corp, person, places, salesPlaces, contracts: contracts.length, totalAnnual, contacts: contacts.length, byTeam, byCpa, byType };
  }, [entities, contracts, contacts]);

  // 정산연도 후보(추이 드롭다운)
  const trendYearOpts = useMemo(() => {
    const ys = new Set<number>([curSettlementYear]);
    for (const c of contracts) { const fy = c.fiscalYear; if (fy != null) ys.add(fy); }
    return [...ys].sort((a, b) => b - a);
  }, [contracts, curSettlementYear]);

  // 월별 매출추이 — 정산연도(Y-07~Y+1-06) 12개월 × 팀, 엔진(발생/청구·감사 회계연도 인식) 기반 공급가액(순액)
  const trend = useMemo(() => {
    const year = trendYear || curSettlementYear;
    const base = monthIndex(`${year}-07`)!;
    const months = Array.from({ length: 12 }, (_, i) => indexToMonth(base + i));
    const from = months[0], to = months[11];
    const byTeam = new Map<string, Map<string, number>>();
    for (const t of TEAMS) byTeam.set(t, monthlyTotals(contracts.filter((c) => c.team === t), trendBasis, from, to));
    const teamTotal = (t: string) => months.reduce((s, m) => s + (byTeam.get(t)!.get(m) ?? 0), 0);
    const monthTotal = (m: string) => TEAMS.reduce((s, t) => s + (byTeam.get(t)!.get(m) ?? 0), 0);
    const totals = months.map(monthTotal);
    const grand = totals.reduce((s, v) => s + v, 0);
    const peak = Math.max(1, ...totals);
    let cum = 0; const cumTotals = totals.map((v) => (cum += v));
    return { year, months, byTeam, teamTotal, totals, cumTotals, grand, peak };
  }, [contracts, trendYear, trendBasis, curSettlementYear]);

  // 선택 정산연도의 월별 실적 로드(biz_revenue_actual)
  useEffect(() => { (async () => {
    try { setActuals(await listActualsForYear(trend.year)); } catch { setActuals([]); }
  })(); }, [trend.year]);
  // 실적 월별 합계(전 팀)·누계 — 추이 창구 월과 정렬
  const actualTrend = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const a of actuals) byMonth.set(a.ym, (byMonth.get(a.ym) ?? 0) + a.amount);
    const totals = trend.months.map((m) => byMonth.get(m) ?? 0);
    const has = actuals.length > 0;
    let cum = 0; const cumTotals = totals.map((v) => (cum += v));
    return { totals, cumTotals, has, grand: totals.reduce((s, v) => s + v, 0) };
  }, [actuals, trend.months]);

  const entMap = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);

  if (loading) return <div className="card">불러오는 중…</div>;

  return (
    <div className="card">
      <div className="chdr">📊 거래처현황조회</div>
      {error && <div style={{ color: '#c33', fontSize: 12, marginBottom: 8 }}>{error}</div>}

      {/* 요약 카드 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <Stat label="거래처" value={`${stat.corp + stat.person}`} sub={`법인 ${stat.corp} · 개인 ${stat.person}`} />
        <Stat label="사업장" value={`${stat.places}`} sub={`매출 ${stat.salesPlaces}`} />
        <Stat label="매출계약" value={`${stat.contracts}`} />
        <Stat label="연환산 매출(VAT별도)" value={`${won(stat.totalAnnual)}`} sub="주기별 1년 환산 합계" accent />
        <Stat label="거래처담당자" value={`${stat.contacts}`} />
      </div>

      {/* 집계 미니테이블 */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <MiniTable title="팀별 매출(연환산)" rows={stat.byTeam} />
        <MiniTable title="담당CPA별 매출(연환산)" rows={stat.byCpa} />
        <MiniTable title="유형별 매출(연환산)" rows={stat.byType} />
      </div>
      <div style={{ fontSize: 10.5, color: '#999', marginBottom: 10 }}>※ 연환산 = 월×12·분기×4·반기×2·연×1·건/발생시×1. 종속계약(청구금액 0)은 합계에 영향 없음. CPA집계는 계약의 담당CPA 기준.</div>

      {/* 월별 매출추이 */}
      <div style={{ border: '1px solid #d8cfa0', borderRadius: 8, background: '#fbf8ef', padding: '8px 10px', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
          <b style={{ fontSize: 12.5, color: '#654' }}>📈 월별 매출추이</b>
          <select value={trendYear || curSettlementYear} onChange={(e) => setTrendYear(Number(e.target.value))} style={selStyle} title="정산연도(회계연도 7/1~익6/30)">
            {trendYearOpts.map((y) => <option key={y} value={y}>{y} 귀속(정산 {y}-07~{y + 1}-06)</option>)}
          </select>
          <span style={{ display: 'flex', gap: 2 }}>
            <button className={trendBasis === 'accrual' ? 'btn-p' : 'btn-sm'} onClick={() => setTrendBasis('accrual')}>매출(발생)</button>
            <button className={trendBasis === 'billing' ? 'btn-p' : 'btn-sm'} onClick={() => setTrendBasis('billing')}>청구</button>
          </span>
          <span style={{ fontSize: 10.5, color: '#a98' }}>공급가액(순액) · 회계감사 매출은 회계연도 월할 · 옅은 월 = 미경과(예정)</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11.5, minWidth: 900 }}>
            <thead><tr style={{ background: '#f0e9d2' }}>
              <th style={{ ...thc, textAlign: 'left', position: 'sticky', left: 0, background: '#f0e9d2' }}>팀 \ 월</th>
              {trend.months.map((m) => <th key={m} style={{ ...thc, textAlign: 'right', color: m > todayMonth ? '#bbb' : '#555' }}>{m.slice(2)}</th>)}
              <th style={{ ...thc, textAlign: 'right', borderLeft: '2px solid #c9a54a' }}>합계</th>
            </tr></thead>
            <tbody>
              {TEAMS.map((t) => (
                <tr key={t} style={{ borderTop: '1px solid #eadfbf' }}>
                  <td style={{ ...tdc, fontWeight: 600, position: 'sticky', left: 0, background: '#fbf8ef' }}>{t}</td>
                  {trend.months.map((m) => { const v = trend.byTeam.get(t)!.get(m) ?? 0; return <td key={m} style={{ ...tdc, textAlign: 'right', color: v ? (m > todayMonth ? '#9bb' : '#245') : '#ccc' }}>{v ? won(v) : '·'}</td>; })}
                  <td style={{ ...tdc, textAlign: 'right', fontWeight: 700, borderLeft: '2px solid #c9a54a' }}>{won(trend.teamTotal(t))}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid #c9a54a', background: '#f5efdd', fontWeight: 700 }}>
                <td style={{ ...tdc, position: 'sticky', left: 0, background: '#f5efdd' }}>합계</td>
                {trend.months.map((m, i) => { const v = trend.totals[i]; const pct = Math.round((v / trend.peak) * 100); return (
                  <td key={m} style={{ ...tdc, textAlign: 'right', color: m > todayMonth ? '#9ab' : '#134', background: `linear-gradient(to top, rgba(36,85,120,.16) ${pct}%, transparent ${pct}%)` }}>{v ? won(v) : '·'}</td>
                ); })}
                <td style={{ ...tdc, textAlign: 'right', borderLeft: '2px solid #c9a54a' }}>{won(trend.grand)}</td>
              </tr>
              <tr style={{ borderTop: '1px solid #eadfbf', color: '#888' }}>
                <td style={{ ...tdc, position: 'sticky', left: 0, background: '#fbf8ef' }}>누계</td>
                {trend.months.map((m, i) => <td key={m} style={{ ...tdc, textAlign: 'right', color: m > todayMonth ? '#ccc' : '#889' }}>{won(trend.cumTotals[i])}</td>)}
                <td style={{ ...tdc, textAlign: 'right', borderLeft: '2px solid #c9a54a' }}></td>
              </tr>
              {actualTrend.has && (<>
                <tr style={{ borderTop: '2px solid #7a9', background: '#eef6ee', fontWeight: 700, color: '#274' }}>
                  <td style={{ ...tdc, position: 'sticky', left: 0, background: '#eef6ee' }}>실적(청구)</td>
                  {trend.months.map((m, i) => { const v = actualTrend.totals[i]; const pct = Math.round((v / trend.peak) * 100); return (
                    <td key={m} style={{ ...tdc, textAlign: 'right', color: '#274', background: `linear-gradient(to top, rgba(40,120,70,.16) ${pct}%, transparent ${pct}%)` }}>{v ? won(v) : '·'}</td>
                  ); })}
                  <td style={{ ...tdc, textAlign: 'right', borderLeft: '2px solid #c9a54a' }}>{won(actualTrend.grand)}</td>
                </tr>
                <tr style={{ borderTop: '1px solid #d4e4d4', color: '#6a8' }}>
                  <td style={{ ...tdc, position: 'sticky', left: 0, background: '#fbf8ef' }}>실적 누계</td>
                  {trend.months.map((m, i) => <td key={m} style={{ ...tdc, textAlign: 'right' }}>{won(actualTrend.cumTotals[i])}</td>)}
                  <td style={{ ...tdc, textAlign: 'right', borderLeft: '2px solid #c9a54a' }}></td>
                </tr>
              </>)}
            </tbody>
          </table>
        </div>
        {actualTrend.has && <div style={{ fontSize: 10.5, color: '#798', marginTop: 4 }}>※ 위 3행(팀별·합계·누계)=계약 기준 {trendBasis === 'accrual' ? '매출(발생)' : '청구'} projection · 아래 <b style={{ color: '#274' }}>실적(청구)</b>=실제 청구실적(biz_revenue_actual). 계약 vs 실적 비교.</div>}
      </div>

      {/* 예산 */}
      <BudgetPanel contracts={contracts} entMap={entMap} />

      {/* 거래처 현황 표 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <select value={kindF} onChange={(e) => setKindF(e.target.value as '' | '법인' | '개인')} style={selStyle}><option value="">구분 전체</option><option value="법인">법인</option><option value="개인">개인</option></select>
        <select value={natF} onChange={(e) => setNatF(e.target.value as '' | '매출' | '일반')} style={selStyle}><option value="">성격 전체</option><option value="매출">매출</option><option value="일반">일반</option></select>
        <input placeholder="🔍 거래처·CPA·담당직원" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <span style={{ fontSize: 11, color: '#888' }}>{view.length}건</span>
      </div>
      <div style={scrollBox()}>
        <table style={{ tableLayout: 'fixed', width: COLS.reduce((s, c) => s + widthOf(c.key, c.w), 0), borderCollapse: 'separate', borderSpacing: 0, fontSize: 11.5 }}>
          <colgroup>{COLS.map((c) => <col key={c.key} style={{ width: widthOf(c.key, c.w) }} />)}</colgroup>
          <thead><tr>
            {COLS.map((c) => <th key={c.key} style={{ ...thc, ...clip, height: 26, cursor: 'pointer', textAlign: c.num ? 'right' : 'left', position: 'sticky', ...stickyTop(0, '#f4efe4') }} onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === 'desc' ? 'asc' : 'desc' }))} title="클릭: 정렬 · 우측 끝 드래그: 너비 조절">{c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}<ResizeHandle onMouseDown={startResize(c.key, widthOf(c.key, c.w))} /></th>)}
          </tr></thead>
          <tbody>
            {view.length === 0 && <tr><td colSpan={COLS.length} style={{ ...tdc, color: '#999', padding: 12 }}>거래처가 없습니다.</td></tr>}
            {view.map((r) => {
              const bt: React.CSSProperties = { borderTop: '1px solid #eee', ...clip };
              return (
              <tr key={r.e.id}>
                <td style={{ ...tdc, ...bt }}>{r.code}</td>
                <td style={{ ...tdc, ...bt }}>{r.kind}</td>
                <td style={{ ...tdc, fontWeight: 600, ...bt }}>{r.name}</td>
                <td style={{ ...tdc, textAlign: 'right', ...bt }}>{r.places}</td>
                <td style={{ ...tdc, ...bt }}>{r.nature}</td>
                <td style={{ ...tdc, textAlign: 'right', ...bt }}>{r.contracts}</td>
                <td style={{ ...tdc, textAlign: 'right', fontWeight: 700, color: '#245', ...bt }}>{r.annual ? won(r.annual) : '-'}</td>
                <td style={{ ...tdc, ...bt }}>{r.cpa}</td>
                <td style={{ ...tdc, ...bt }}>{r.staff}</td>
                <td style={{ ...tdc, textAlign: 'right', ...bt }}>{r.contacts}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function agg(cons: SalesContract[], keyOf: (c: SalesContract) => string): { label: string; amount: number; count: number }[] {
  const m = new Map<string, { amount: number; count: number }>();
  for (const c of cons) { const k = keyOf(c) || '(미지정)'; const e = m.get(k) ?? { amount: 0, count: 0 }; e.amount += annualize(c); e.count++; m.set(k, e); }
  return [...m.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.amount - a.amount);
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div style={{ border: '1px solid #e6e0d8', borderRadius: 8, padding: '8px 14px', minWidth: 120, background: accent ? '#eef4fb' : '#fff' }}>
      <div style={{ fontSize: 10.5, color: '#888' }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: accent ? '#245' : '#333' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#aaa' }}>{sub}</div>}
    </div>
  );
}
function MiniTable({ title, rows }: { title: string; rows: { label: string; amount: number; count: number }[] }) {
  return (
    <div style={{ flex: 1, minWidth: 240, border: '1px solid #eee', borderRadius: 6, padding: 8 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#456', marginBottom: 4 }}>{title}</div>
      {rows.length === 0 && <div style={{ fontSize: 11, color: '#aaa' }}>데이터 없음</div>}
      <table style={{ width: '100%', fontSize: 11 }}>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}><td style={{ padding: '1px 2px' }}>{r.label}</td><td style={{ padding: '1px 2px', color: '#888', textAlign: 'right' }}>{r.count}건</td><td style={{ padding: '1px 2px', textAlign: 'right', fontWeight: 600 }}>{won(r.amount)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const COLS: { key: string; label: string; num?: boolean; w: number }[] = [
  { key: 'code', label: '코드', w: 60 }, { key: 'kind', label: '구분', w: 46 }, { key: 'name', label: '거래처', w: 160 },
  { key: 'places', label: '사업장', num: true, w: 56 }, { key: 'nature', label: '성격', w: 50 },
  { key: 'contracts', label: '매출계약', num: true, w: 66 }, { key: 'annual', label: '연환산매출', num: true, w: 104 },
  { key: 'cpa', label: '담당CPA', w: 70 }, { key: 'staff', label: '담당직원', w: 96 }, { key: 'contacts', label: '담당자', num: true, w: 56 },
];
const selStyle: React.CSSProperties = { padding: '4px 7px', fontSize: 12 };
const thc: React.CSSProperties = { padding: '5px 6px', fontWeight: 700, color: '#555', whiteSpace: 'nowrap', userSelect: 'none' };
const tdc: React.CSSProperties = { padding: '4px 6px', whiteSpace: 'nowrap' };
