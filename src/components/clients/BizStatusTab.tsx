// 거래처관리 › 거래처현황조회 (거래처관리 2.0.0 · step 4)
// 거래처·사업장·매출계약·담당자를 통합해 현황 목록 + 통계(팀별·CPA별·유형별 연환산 매출 집계).
import { useEffect, useMemo, useState } from 'react';
import { listBizEntities, corpDisplayName, type BizEntityFull } from '../../lib/bizRegistryApi';
import { listSalesContracts, type SalesContract, type BillingCycle } from '../../lib/salesContractApi';
import { listBizContacts, type BizContact } from '../../lib/bizContactApi';
import { findNode } from '../../lib/salesContractTaxonomy';
import { scrollBox, stickyTop, useColWidths, ResizeHandle, clip } from './tableKit';

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
      const cpas = [...new Set(cons.map((c) => c.cpa).filter(Boolean))];
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
    const byCpa = agg(contracts.filter((c) => c.cpa), (c) => c.cpa);
    const byType = agg(contracts, (c) => `${c.team.replace('team', '')}·${topLabel(c.categoryCode)}`);
    return { corp, person, places, salesPlaces, contracts: contracts.length, totalAnnual, contacts: contacts.length, byTeam, byCpa, byType };
  }, [entities, contracts, contacts]);

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
