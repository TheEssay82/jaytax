// 일반업무관리 › 📊 팀결산시스템 › 🧾 기장배분 — 기장팀 비용을 조현규·김준성·정우철에게 나눈다(사용자 2026-10-19).
//
// 조현규 결산 엑셀 「3. 기장_세무배분안(연도)」를 옮겼다. 원본의 실수 넷은 고쳐서(bkSettle.ts 머리말).
//   · 예상안은 지난해 값을 「작년값」으로 가져와 만들고, 앱에 있는 값(인건비 계획 · 경비귀속처리 기장분 · 기말 미수금)을 얹는다.
//   · 숫자마다 작년값 → 추정 → 확정. 결산시트(인덕 결산 자료)가 오면 사람이 칸마다 확정으로 바꾼다.
// 보는 사람: 경비귀속처리와 같은 네 사람(서버 expense_member_name).
import { useEffect, useMemo, useState } from 'react';
import Empty from '../common/Empty';
import MoneyInput from '../common/MoneyInput';
import { useAuth } from '../../context/AuthContext';
import { defaultFy, periodLabel } from '../../lib/expenseParse';
import {
  BK_STAFF, CPAS, COST_ITEMS, CPA_FIELDS, CPA_FIELD_LABEL, VAT_INCLUDED, STATES, computeSettle,
  type CellState, type CostCell, type CpaField, type CpaResult, type CpaRow, type SettleBundle,
} from '../../lib/bkSettle';
import { listSettleYears, loadSettle, createEstimate, refreshFromApp, updateSettle, saveCpaCell, saveCostCell, listClients, importErpFiles, updateClient, fillCpaFromClients } from '../../lib/bkSettleApi';
import { sumByCpa, type ClientRow } from '../../lib/bkLedger';
import { exportSettleXlsx } from '../../lib/bkSettleExport';

const won = (n: number) => Math.round(n).toLocaleString();
const STATE_STYLE: Record<CellState, { bg: string; fg: string }> = {
  작년값: { bg: '#F3F4F6', fg: '#6B7280' }, 추정: { bg: '#FEF3C7', fg: '#92400E' }, 확정: { bg: '#DCFCE7', fg: '#166534' },
};
type TabKey = 'income' | 'clients' | 'cost' | 'result';
const TAB_KEY = 'jaytax:bkSettleTab';

function StateChip({ state, onClick, disabled }: { state: CellState; onClick?: () => void; disabled?: boolean }) {
  const st = STATE_STYLE[state];
  return (
    <button disabled={disabled || !onClick} onClick={onClick} title={disabled ? undefined : '눌러서 작년값 → 추정 → 확정'}
      style={{ cursor: disabled || !onClick ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 'var(--fs-1)', border: 'none', borderRadius: 999, padding: '1px 7px', fontWeight: 700, background: st.bg, color: st.fg, whiteSpace: 'nowrap' }}>{state}</button>
  );
}
const nextState = (s: CellState): CellState => STATES[(STATES.indexOf(s) + 1) % STATES.length];

export default function BkSettleTab() {
  const { profileName, readonly } = useAuth();
  const [fy, setFy] = useState(defaultFy());
  const [years, setYears] = useState<number[]>([]);
  const [b, setB] = useState<SettleBundle | null>(null);
  const [prev, setPrev] = useState<SettleBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [cf, setCf] = useState<{ dept: string; cpa: string; q: string }>({ dept: '', cpa: '', q: '' });
  const [tab, setTabState] = useState<TabKey>(() => {
    try { const v = localStorage.getItem(TAB_KEY); if (v === 'income' || v === 'clients' || v === 'cost' || v === 'result') return v; } catch { /* 저장소 없음 */ }
    return 'result';
  });
  const setTab = (t: TabKey) => { setTabState(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* 저장소 없음 */ } };

  async function reload(y = fy) {
    setErr(null);
    try {
      const [ys, cur, p, cl] = await Promise.all([listSettleYears(), loadSettle(y), loadSettle(y - 1), listClients(y)]);
      setYears(ys); setB(cur); setPrev(p); setClients(cl);
    } catch (e) { setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'); } finally { setLoading(false); }
  }
  useEffect(() => { void reload(fy); }, [fy]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 6000); };
  const locked = readonly || b?.settle.status === '확정';
  const res = useMemo(() => (b ? computeSettle(b.settle, b.cpas, b.costs) : null), [b]);
  const prevRes = useMemo(() => (prev ? computeSettle(prev.settle, prev.cpas, prev.costs) : null), [prev]);

  async function run(f: () => Promise<string[] | void>, done?: string) {
    setBusy(true); setErr(null);
    try { const notes = await f(); await reload(); if (done || notes) flash([done, ...(notes ?? [])].filter(Boolean).join(' · ')); }
    catch (e) { setErr(e instanceof Error ? e.message : '실패했습니다.'); } finally { setBusy(false); }
  }

  // 칸 고치기 — 화면을 먼저 바꾸고 저장. 값을 손으로 고치면 「작년값」은 「추정」이 되고 출처는 「직접 입력」.
  async function setCpa(row: CpaRow, k: CpaField, value: number, state: CellState, source: string | null) {
    if (!b) return;
    const nb = { ...b, cpas: b.cpas.map((r) => (r.cpa === row.cpa ? { ...r, [k]: value, states: { ...r.states, [k]: state }, sources: { ...r.sources, [k]: source ?? undefined } } : r)) };
    setB(nb);
    try { await saveCpaCell(b.settle.fy, row, k, value, state, source, profileName); } catch (e) { setErr(e instanceof Error ? e.message : '저장하지 못했습니다.'); await reload(); }
  }
  async function setClient(r: ClientRow, patch: { cpa?: string | null; tax_mode?: '기장수행' | '자가'; memo?: string | null }) {
    if (!b) return;
    setClients((cs) => cs.map((x) => (x.dept === r.dept && x.code === r.code ? { ...x, ...patch, ...('cpa' in patch ? { cpa_by_hand: true } : {}), ...('tax_mode' in patch ? { mode_by_hand: true } : {}) } : x)));
    try { await updateClient(b.settle.fy, r.dept, r.code, patch, profileName); } catch (e) { setErr(e instanceof Error ? e.message : '저장하지 못했습니다.'); await reload(); }
  }
  async function onLedgerFiles(fs: File[]) {
    if (!b) return;
    const notes: string[] = [];
    setBusy(true); setErr(null);
    try {
      for (const r of await importErpFiles(b.settle.fy, fs, profileName)) {
        notes.push(`${r.dept} ${r.source} 파일 ${r.files}개 — 거래처 ${r.saved}곳 저장${r.noCpa ? `(담당 없음 ${r.noCpa}곳)` : ''}`);
      }
      await reload(); flash(notes.join(' · '));
    } catch (e) { setErr(e instanceof Error ? e.message : '읽지 못했습니다.'); } finally { setBusy(false); }
  }
  async function setCost(cell: CostCell) {
    if (!b) return;
    const i = b.costs.findIndex((c) => c.item === cell.item && c.staff === cell.staff);
    const costs = i >= 0 ? b.costs.map((c, j) => (j === i ? cell : c)) : [...b.costs, cell];
    setB({ ...b, costs });
    try { await saveCostCell(b.settle.fy, cell, profileName); } catch (e) { setErr(e instanceof Error ? e.message : '저장하지 못했습니다.'); await reload(); }
  }

  if (loading) return <div className="card">불러오는 중…</div>;
  const yearsShown = [...new Set([defaultFy() + 1, defaultFy(), ...years])].sort((x, y) => y - x);
  const chip = (on: boolean) => ({ cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--fs-2)', fontWeight: on ? 700 : 500, padding: '7px 16px', border: '1px solid var(--rule)', borderBottom: 'none', borderRadius: '6px 6px 0 0', background: on ? 'var(--navy)' : '#fff', color: on ? '#fff' : 'var(--ink-2)' } as const);
  const th = { padding: '6px 8px', textAlign: 'left' as const, whiteSpace: 'nowrap' as const, fontWeight: 600, background: 'var(--surface-3)', borderBottom: '1px solid var(--rule)' };
  const td = { padding: '5px 8px', borderTop: '1px solid var(--rule)', verticalAlign: 'middle' as const };
  const tdr = { ...td, textAlign: 'right' as const, whiteSpace: 'nowrap' as const };
  const stateCount = (states: CellState[]) => STATES.map((s) => `${s} ${states.filter((x) => x === s).length}`).join(' · ');

  return (
    <div>
      <div className="card" style={{ padding: '10px 14px' }}>
        <div className="chdr" style={{ marginBottom: 6 }}>🧾 기장배분
          <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>팀결산시스템 · 기장팀 비용을 조현규 · 김준성 · 정우철에게</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>기간</span>
          <select value={fy} onChange={(e) => setFy(Number(e.target.value))} style={{ width: 'auto', fontFamily: 'inherit', fontSize: 'var(--fs-2)', fontWeight: 700, padding: '2px 6px', border: '1px solid var(--rule)', borderRadius: 4 }}>
            {yearsShown.map((y) => <option key={y} value={y}>{periodLabel(y)}{years.includes(y) ? '' : ' (아직 없음)'}</option>)}
          </select>
          {b && <>
            <span style={{ background: b.settle.status === '확정' ? '#DCFCE7' : '#FEF3C7', color: b.settle.status === '확정' ? '#166534' : '#92400E', borderRadius: 999, padding: '2px 10px', fontWeight: 700, fontSize: 'var(--fs-1)' }}>{b.settle.status}</span>
            {!readonly && <button className="btn-sm" disabled={busy} onClick={() => void run(() => updateSettle(b.settle.fy, { status: b.settle.status === '확정' ? '예상' : '확정' }, profileName), b.settle.status === '확정' ? '예상으로 되돌렸습니다 — 다시 고칠 수 있습니다' : '확정했습니다 — 고치려면 「예상으로」를 누르세요')}>{b.settle.status === '확정' ? '예상으로 되돌리기' : '이 해 확정'}</button>}
            {!locked && <button className="btn-sm" disabled={busy} onClick={() => void run(() => refreshFromApp(b.settle.fy, profileName), '앱 자료를 다시 가져왔습니다')} title="인건비 계획 · 경비귀속처리 기장분 · 기말 미수금. 사람이 확정한 칸은 그대로 둡니다">앱 자료 다시 가져오기</button>}
            <button className="btn-sm btn-sm-navy" disabled={busy} onClick={() => void exportSettleXlsx(b, clients).catch((e) => setErr(e instanceof Error ? e.message : '내려받지 못했습니다.'))}>엑셀로 내려받기</button>
          </>}
        </div>
      </div>

      {err && <div className="alert-w">{err}</div>}
      {msg && <div className="card" style={{ color: 'var(--good)', padding: '8px 14px' }}>{msg}</div>}

      {!b ? (
        <div className="card">
          <Empty text={`${periodLabel(fy)} 기장배분이 아직 없습니다`}
            hint={prev ? `지난해(${periodLabel(fy - 1)}) 값을 「작년값」으로 가져오고, 인건비 계획 · 경비귀속처리 기장분 · 기말 미수금을 얹어 예상안을 만듭니다.` : '지난해 기장배분도 없어 예상안을 만들 수 없습니다.'}
            action={prev && !readonly ? { label: busy ? '만드는 중…' : '지난해 값으로 예상안 만들기', onClick: () => void run(() => createEstimate(fy, profileName), '예상안을 만들었습니다') } : undefined} />
        </div>
      ) : (<>
        <div style={{ display: 'flex', gap: 2, borderBottom: '2px solid var(--navy)', margin: '0 0 10px' }}>
          {([['income', '① 변수 · 수임료'], ['clients', `② 거래처 입금 (${clients.length})`], ['cost', `③ 비용 (${won(res?.costTotal ?? 0)})`], ['result', '④ 배분 · 정산']] as [TabKey, string][]).map(([k, l]) => <button key={k} style={chip(tab === k)} onClick={() => setTab(k)}>{l}</button>)}
        </div>

        {tab === 'income' && (<>
          <div className="card" style={{ padding: '10px 14px' }}>
            <b style={{ fontSize: 'var(--fs-2)', color: 'var(--navy)' }}>변수</b>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginTop: 6, fontSize: 'var(--fs-2)' }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>정액부담금(1인, 개인 업무 보조비)
                <MoneyInput value={b.settle.fixed_share} disabled={locked} width={110} onCommit={(v) => void run(() => updateSettle(b.settle.fy, { fixed_share: v ?? 0 }, profileName))} /></label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>공통비율
                <input type="number" step="0.1" disabled={locked} defaultValue={Math.round(b.settle.common_rate * 1000) / 10} key={`r${b.settle.common_rate}`} onBlur={(e) => { const v = Number(e.target.value) / 100; if (v !== b.settle.common_rate) void run(() => updateSettle(b.settle.fy, { common_rate: v }, profileName)); }} style={{ width: 70, textAlign: 'right', fontFamily: 'inherit' }} /> %</label>
            </div>
          </div>
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <b style={{ fontSize: 'var(--fs-2)', color: 'var(--navy)' }}>담당 회계사별 수임료 · 미수금</b>
              <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>입금은 VAT 포함, 미수금·대손은 VAT 제외. 상태 칩을 누르면 작년값 → 추정 → 확정.</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-1)', minWidth: 760 }}>
                <thead><tr><th style={th}>항목</th>{CPAS.map((c) => <th key={c} style={{ ...th, textAlign: 'right' }}>{c}</th>)}</tr></thead>
                <tbody>
                  {CPA_FIELDS.map((k) => (
                    <tr key={k}>
                      <td style={td}>{CPA_FIELD_LABEL[k]} <span style={{ color: 'var(--ink-4)' }}>{VAT_INCLUDED[k] ? 'VAT 포함' : 'VAT 제외'}</span>
                        {k === 'tax_self' && <div style={{ color: 'var(--ink-4)' }}>비율에는 안 들고 정산(회수금액)에만</div>}</td>
                      {CPAS.map((c) => {
                        const row = b.cpas.find((r) => r.cpa === c);
                        if (!row) return <td key={c} style={tdr}>—</td>;
                        const st = (row.states[k] ?? '작년값') as CellState;
                        return (
                          <td key={c} style={tdr} title={row.sources[k] ?? ''}>
                            <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                              <MoneyInput value={row[k]} disabled={locked} width={110} onCommit={(v) => void setCpa(row, k, v ?? 0, st === '작년값' ? '추정' : st, '직접 입력')} />
                              <StateChip state={st} disabled={locked} onClick={() => void setCpa(row, k, row[k], nextState(st), row.sources[k] ?? null)} />
                            </div>
                            {row.sources[k] && <div style={{ color: 'var(--ink-4)', fontSize: 11, marginTop: 1 }}>{row.sources[k]}</div>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {res && (<>
                    <tr style={{ background: 'var(--surface-3)' }}><td style={td}>미수금 변동 <span style={{ color: 'var(--ink-4)' }}>기말 − 기초 + 대손</span></td>{res.rows.map((r) => <td key={r.cpa} style={tdr}>{won(r.arChange)}</td>)}</tr>
                    <tr style={{ background: 'var(--surface-3)' }}><td style={td}><b>비율 바탕</b> <span style={{ color: 'var(--ink-4)' }}>(기장료 + 기장수행 − 자문) ÷ 1.1 + 미수금 변동</span></td>{res.rows.map((r) => <td key={r.cpa} style={{ ...tdr, fontWeight: 700 }}>{won(r.base)}</td>)}</tr>
                    <tr style={{ background: 'var(--surface-3)' }}><td style={td}><b>비율</b>{prevRes && <span style={{ color: 'var(--ink-4)' }}> (지난해)</span>}</td>{res.rows.map((r, i) => <td key={r.cpa} style={{ ...tdr, fontWeight: 700 }}>{(r.ratio * 100).toFixed(3)}%{prevRes && <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}> ({(prevRes.rows[i].ratio * 100).toFixed(3)}%)</span>}</td>)}</tr>
                  </>)}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginTop: 6 }}>
              {stateCount(b.cpas.flatMap((r) => CPA_FIELDS.map((k) => (r.states[k] ?? '작년값') as CellState)))}
              {' · '}기장료·세무조정·자문·대손은 「② 거래처 입금」에서 ERP 원장으로 채웁니다.
            </div>
          </div>
        </>)}

        {tab === 'clients' && (() => {
          const sums = sumByCpa(clients);
          const shown = clients.filter((r) => (!cf.dept || r.dept === cf.dept) && (!cf.cpa || (cf.cpa === '(없음)' ? !r.cpa : r.cpa === cf.cpa)) && (!cf.q || r.name.includes(cf.q) || r.code.includes(cf.q)));
          const noCpa = clients.filter((r) => !r.cpa && (r.cash_bk || r.cash_tax || r.writeoff)).length;
          const sel = { width: 'auto', fontFamily: 'inherit', fontSize: 'var(--fs-1)', padding: '2px 4px', border: '1px solid var(--rule)', borderRadius: 4 } as const;
          return (<>
            <div className="card" style={{ padding: '10px 14px' }}>
              <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7 }}>
                <b>ERP 기간 미수금대장</b>(부서별 미수금현황, {periodLabel(b.settle.fy)})을 기장24팀 · 2본부5팀 것 둘 다 올리세요 — 청구서마다 계약구분(기장 / 세무조정 / 감사)이 있어
                거래처별 입금 · 기초 · 기말 미수금이 그대로 나옵니다. <b>부서별원장</b>도 함께 놓으면 6/30 대손 처리분을 입금에서 뺍니다(미수금대장은 대손을 입금으로 적음).
                감사팀 거래처의 담당은 미수금대장의 「회계사」 칸으로 정합니다(우리 셋이 아니면 배분 제외). 자문(컨설팅)은 앱 매출 실적 비율로 기장에서 뗍니다.
                세무조정은 기장 계약이 있는 거래처면 <b>기장수행</b>, 아니면 <b>자가</b>가 기본값 — 거래처마다 바꿀 수 있고, 사람이 고른 구분·담당은 <b>다음 해에도 이어집니다</b>.
              </div>
              {!locked && (
                <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) void onLedgerFiles([...e.dataTransfer.files]); }}
                  style={{ display: 'block', border: '2px dashed #c9b98a', borderRadius: 8, background: '#fdfaf3', padding: '10px 14px', textAlign: 'center', cursor: 'pointer', marginTop: 8 }}>
                  <b style={{ color: 'var(--navy)' }}>{busy ? '읽는 중…' : 'ERP 미수금대장 · 부서별원장 엑셀을 끌어다 놓으세요 — 기장팀 · 감사팀 한꺼번에 가능'}</b>
                  <div style={{ fontSize: 'var(--fs-1)', color: '#777', marginTop: 2 }}>한 부서의 파일은 <b>한꺼번에</b>(달마다 따로 받은 파일도 함께) 놓으세요 — 부서마다 새로 계산합니다. 사람이 고친 담당·구분·메모는 그대로 둡니다.</div>
                  <input type="file" multiple accept=".xls,.xlsx" style={{ display: 'none' }} disabled={busy} onChange={(e) => { const fs = e.target.files ? [...e.target.files] : []; e.target.value = ''; if (fs.length) void onLedgerFiles(fs); }} />
                </label>
              )}
            </div>
            {clients.length > 0 && (
              <div className="card">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, marginBottom: 8 }}>
                  {CPAS.map((c) => {
                    const v = sums.byCpa[c];
                    return (
                      <div key={c} style={{ border: '1px solid var(--rule)', borderRadius: 6, padding: '6px 10px', fontSize: 'var(--fs-1)', lineHeight: 1.6 }}>
                        <b style={{ fontSize: 'var(--fs-2)' }}>{c}</b> <span style={{ color: 'var(--ink-3)' }}>{v.clients}곳</span><br />
                        기장료 {won(v.bk_fee)} <span style={{ color: 'var(--ink-4)' }}>(자문 {won(v.advisory_excl)})</span><br />
                        기장수행 {won(v.tax_bk)} · 자가 {won(v.tax_self)}<br />대손(VAT 제외) {won(v.writeoff)}<br />미수금 기초 {won(v.ar_open)} → 기말 {won(v.ar_close)}
                      </div>
                    );
                  })}
                  <div style={{ border: `1px solid ${noCpa ? '#FCA5A5' : 'var(--rule)'}`, borderRadius: 6, padding: '6px 10px', fontSize: 'var(--fs-1)', lineHeight: 1.6 }}>
                    <b style={{ fontSize: 'var(--fs-2)', color: noCpa ? 'var(--bad)' : undefined }}>담당 없음</b> <span style={{ color: 'var(--ink-3)' }}>{sums.loose.clients}곳</span><br />
                    입금 {won(sums.loose.cash)} · 대손 {won(sums.loose.writeoff)}<br /><span style={{ color: 'var(--ink-3)' }}>배분에서 빠집니다 — 담당을 골라 주세요</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                  <select value={cf.dept} onChange={(e) => setCf({ ...cf, dept: e.target.value })} style={sel}><option value="">부서 전체</option><option>기장팀</option><option>감사팀</option></select>
                  <select value={cf.cpa} onChange={(e) => setCf({ ...cf, cpa: e.target.value })} style={sel}><option value="">담당 전체</option>{CPAS.map((c) => <option key={c}>{c}</option>)}<option>(없음)</option></select>
                  <input placeholder="🔍 거래처·코드" value={cf.q} onChange={(e) => setCf({ ...cf, q: e.target.value })} style={{ ...sel, width: 160 }} />
                  <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>{shown.length}곳 · 입금 {won(shown.reduce((s, r) => s + r.cash, 0))}</span>
                  {!locked && <button className="btn-sm btn-sm-navy" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => void run(() => fillCpaFromClients(b.settle.fy, profileName))} title="기장료·기장수행·자가·자문·대손 칸을 「확정」으로 바꿉니다. 미수금 칸은 그대로">「① 수임료」 칸에 반영</button>}
                </div>
                <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 330px)', minHeight: 240, border: '1px solid var(--rule)', borderRadius: 4 }}>
                  <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 'var(--fs-1)', minWidth: 1100 }}>
                    <thead><tr>{['부서', '거래처', '담당', '입금(VAT 포함)', '기장', '자문', '세무조정', '구분', '감사·용역', '기초 미수금', '기말 미수금', '대손', '메모'].map((h) => <th key={h} style={{ ...th, position: 'sticky', top: 0, zIndex: 1, textAlign: /입금|^기장$|자문|^세무조정$|감사|대손|미수금/.test(h) ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
                    <tbody>
                      {shown.map((r) => (
                        <tr key={`${r.dept}|${r.code}`} style={{ background: !r.cpa && (r.cash_bk || r.cash_tax || r.writeoff) ? '#FEF2F2' : undefined }}>
                          <td style={td}>{r.dept}</td>
                          <td style={td} title={`청구(VAT 제외) 기장 ${won(r.billed_bk)} · 세무조정 ${won(r.billed_tax)} · 기타 ${won(r.billed_other)}`}>{r.name}<div style={{ color: 'var(--ink-4)' }}>{r.code.startsWith('N:') ? '' : r.code}{r.erp_cpa ? ` · ERP ${r.erp_cpa}` : ''}{r.source === '원장' ? ' · 원장 추정' : ''}</div></td>
                          <td style={td}><select value={r.cpa ?? ''} disabled={locked} onChange={(e) => void setClient(r, { cpa: e.target.value || null })} style={{ ...sel, fontWeight: r.cpa_by_hand ? 700 : 400 }} title={r.cpa_by_hand ? '사람이 고른 담당' : '자동으로 찾은 담당'}><option value="">(없음)</option>{CPAS.map((c) => <option key={c}>{c}</option>)}</select></td>
                          <td style={tdr}>{won(r.cash)}</td>
                          <td style={tdr}>{r.cash_bk ? won(r.cash_bk) : ''}</td>
                          <td style={tdr}>{r.cash_adv ? won(r.cash_adv) : ''}</td>
                          <td style={tdr}>{r.cash_tax ? won(r.cash_tax) : ''}</td>
                          <td style={td}>{r.cash_tax || r.billed_tax ? <select value={r.tax_mode} disabled={locked} onChange={(e) => void setClient(r, { tax_mode: e.target.value as '기장수행' | '자가' })} style={{ ...sel, fontWeight: r.mode_by_hand ? 700 : 400 }}><option>기장수행</option><option>자가</option></select> : ''}</td>
                          <td style={{ ...tdr, color: 'var(--ink-3)' }}>{r.cash_other ? won(r.cash_other) : ''}</td>
                          <td style={tdr}>{r.ar_open ? won(r.ar_open) : ''}</td>
                          <td style={tdr}>{r.ar_close ? won(r.ar_close) : ''}</td>
                          <td style={tdr}>{r.writeoff ? won(r.writeoff) : ''}</td>
                          <td style={td}>{locked ? (r.memo ?? '') : <input defaultValue={r.memo ?? ''} key={`m${r.code}${r.memo}`} onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (r.memo ?? null)) void setClient(r, { memo: v }); }} style={{ width: 140, fontFamily: 'inherit', fontSize: 'var(--fs-1)', padding: '2px 4px', border: '1px solid var(--rule)', borderRadius: 3 }} />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginTop: 6 }}>담당·구분이 굵게 보이면 사람이 고른 것입니다. 빨간 줄은 담당이 없어 배분에서 빠지는 거래처입니다.</div>
              </div>
            )}
          </>);
        })()}

        {tab === 'cost' && (
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 'var(--fs-2)', color: 'var(--navy)' }}>기장팀 비용 (현금주의)</b>
              <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>{stateCount(b.costs.map((c) => c.state))} · 결산시트가 오면 칸마다 확정으로</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-1)', minWidth: 820 }}>
                <thead><tr>{['항목', '직원', '금액', '상태', '출처', '메모', ...(prev ? ['지난해'] : [])].map((h) => <th key={h} style={{ ...th, textAlign: h === '금액' || h === '지난해' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {COST_ITEMS.flatMap((it) => {
                    const staffs = it.perStaff ? [...new Set([...BK_STAFF, ...b.costs.filter((c) => c.item === it.key && c.staff).map((c) => c.staff)])] : [''];
                    return staffs.map((sf, i) => {
                      const c = b.costs.find((x) => x.item === it.key && x.staff === sf) ?? { item: it.key, staff: sf, amount: 0, state: '추정' as const, source: null, memo: null };
                      const exists = b.costs.some((x) => x.item === it.key && x.staff === sf);
                      const p = prev?.costs.filter((x) => x.item === it.key && (it.perStaff ? x.staff === sf : true)).reduce((s, x) => s + x.amount, 0);
                      return (
                        <tr key={`${it.key}|${sf}`} style={{ opacity: exists || c.amount ? 1 : 0.55 }}>
                          <td style={{ ...td, borderTop: i ? 'none' : td.borderTop }}>{i === 0 ? <>{it.key}{it.hint && <div style={{ color: 'var(--ink-4)' }}>{it.hint}</div>}</> : ''}</td>
                          <td style={td}>{sf}</td>
                          <td style={tdr}><MoneyInput value={c.amount} disabled={locked} width={120} onCommit={(v) => void setCost({ ...c, amount: v ?? 0, state: c.state === '작년값' ? '추정' : c.state, source: '직접 입력' })} /></td>
                          <td style={td}>{exists ? <StateChip state={c.state} disabled={locked} onClick={() => void setCost({ ...c, state: nextState(c.state) })} /> : <span style={{ color: 'var(--ink-4)' }}>—</span>}</td>
                          <td style={{ ...td, color: 'var(--ink-3)' }}>{c.source ?? ''}</td>
                          <td style={td}>{locked ? (c.memo ?? '') : <input defaultValue={c.memo ?? ''} key={`m${it.key}${sf}${c.memo}`} onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== c.memo) void setCost({ ...c, memo: v }); }} style={{ width: 180, fontFamily: 'inherit', fontSize: 'var(--fs-1)', padding: '2px 4px', border: '1px solid var(--rule)', borderRadius: 3 }} />}</td>
                          {prev && <td style={{ ...tdr, color: 'var(--ink-3)' }}>{p ? won(p) : ''}</td>}
                        </tr>
                      );
                    });
                  })}
                  <tr style={{ background: 'var(--surface-3)', fontWeight: 700 }}>
                    <td style={td} colSpan={2}>합계</td><td style={tdr}>{won(res?.costTotal ?? 0)}</td><td style={td} colSpan={3} />
                    {prev && <td style={tdr}>{won(prevRes?.costTotal ?? 0)}</td>}
                  </tr>
                </tbody>
              </table>
            </div>
            {prev && prev.costs.some((c) => c.staff && !BK_STAFF.includes(c.staff)) && (
              <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginTop: 6 }}>
                지난해 칸에는 퇴사자 비용이 빠져 있습니다: {[...new Set(prev.costs.filter((c) => c.staff && !BK_STAFF.includes(c.staff)).map((c) => c.staff))].map((s) => `${s} ${won(prev.costs.filter((c) => c.staff === s).reduce((a, c) => a + c.amount, 0))}`).join(', ')} (합계에는 들어 있음).
              </div>
            )}
          </div>
        )}

        {tab === 'result' && res && (
          <div className="card">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 10 }}>
              {([['기장 부담금(비용 합계)', res.costTotal], ['정액부담금 합계', res.fixedTotal], ['비율로 나눌 금액', res.allocTarget], ['받을 금액 합계', res.rows.reduce((s, r) => s + r.receive, 0)]] as const).map(([k, v]) => (
                <div key={k} style={{ border: '1px solid var(--rule)', borderRadius: 6, padding: '6px 10px' }}>
                  <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>{k}</div>
                  <div style={{ fontSize: 'var(--fs-3)', fontWeight: 700 }}>{won(v)}</div>
                </div>
              ))}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-1)', minWidth: 720 }}>
                <thead><tr><th style={th}>구분</th>{CPAS.map((c) => <th key={c} style={{ ...th, textAlign: 'right' }}>{c}</th>)}<th style={{ ...th, textAlign: 'right' }}>합계</th></tr></thead>
                <tbody>
                  {([
                    ['비율', (r) => r.ratio, 'pct'],
                    ['정액부담금', (r) => r.fixed],
                    ['비율부담금', (r) => r.share],
                    ['기장 관련 비용 계', (r) => r.fixed + r.share, 'bold'],
                    ['회수금액 (기장 + 세무조정, VAT 포함)', (r) => r.collected],
                    ['− 부가세', (r) => r.vat],
                    ['= 매출금액', (r) => r.sales],
                    ['− 공통비', (r) => r.common],
                    ['= 배분대상', (r) => r.target],
                    ['받을 금액 (배분대상 − 정액 − 비율부담)', (r) => r.receive, 'key'],
                    ['기장 관련 수익 (비율 바탕)', (r) => r.base],
                    ['최종수익 (수익 − 비용 − 공통비)', (r) => r.profit, 'key'],
                  ] as [string, (r: CpaResult) => number, string?][]).map(([label, get, kind]) => (
                    <tr key={label} style={{ background: kind === 'key' ? 'var(--navy-bg)' : undefined }}>
                      <td style={{ ...td, fontWeight: kind ? 700 : 400 }}>{label}</td>
                      {res.rows.map((r, i) => (
                        <td key={r.cpa} style={{ ...tdr, fontWeight: kind ? 700 : 400 }}>
                          {kind === 'pct' ? `${(get(r) * 100).toFixed(3)}%` : won(get(r))}
                          {kind === 'key' && prevRes && <div style={{ color: 'var(--ink-4)', fontWeight: 400 }}>지난해 {won(get(prevRes.rows[i]))}</div>}
                        </td>
                      ))}
                      <td style={{ ...tdr, fontWeight: kind ? 700 : 400 }}>{kind === 'pct' ? '100%' : won(res.rows.reduce((s, r) => s + get(r), 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.7 }}>
              비율 = (기장료 + 기장수행 세무조정 − 안분미대상 자문) ÷ 1.1 + 미수금 변동(기말 − 기초 + 대손, VAT 제외).
              정산의 부가세·공통비 반올림은 원본 엑셀과 같습니다(부가세 = 반올림, 공통비 = 버림).
              {b.settle.status === '예상' && <><br /><span style={{ color: '#B45309' }}>예상안입니다 — 작년값·추정 칸이 남아 있습니다. 결산시트가 오면 칸마다 확정으로 바꾼 뒤 「이 해 확정」을 누르세요.</span></>}
              {b.settle.note && <><br />{b.settle.note}</>}
            </div>
          </div>
        )}
      </>)}
    </div>
  );
}
