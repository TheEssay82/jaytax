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
import { listSettleYears, loadSettle, createEstimate, refreshFromApp, updateSettle, saveCpaCell, saveCostCell } from '../../lib/bkSettleApi';
import { exportSettleXlsx } from '../../lib/bkSettleExport';

const won = (n: number) => Math.round(n).toLocaleString();
const STATE_STYLE: Record<CellState, { bg: string; fg: string }> = {
  작년값: { bg: '#F3F4F6', fg: '#6B7280' }, 추정: { bg: '#FEF3C7', fg: '#92400E' }, 확정: { bg: '#DCFCE7', fg: '#166534' },
};
type TabKey = 'income' | 'cost' | 'result';
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
  const [tab, setTabState] = useState<TabKey>(() => {
    try { const v = localStorage.getItem(TAB_KEY); if (v === 'income' || v === 'cost' || v === 'result') return v; } catch { /* 저장소 없음 */ }
    return 'result';
  });
  const setTab = (t: TabKey) => { setTabState(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* 저장소 없음 */ } };

  async function reload(y = fy) {
    setErr(null);
    try {
      const [ys, cur, p] = await Promise.all([listSettleYears(), loadSettle(y), loadSettle(y - 1)]);
      setYears(ys); setB(cur); setPrev(p);
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
            <button className="btn-sm btn-sm-navy" disabled={busy} onClick={() => void exportSettleXlsx(b).catch((e) => setErr(e instanceof Error ? e.message : '내려받지 못했습니다.'))}>엑셀로 내려받기</button>
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
          {([['income', '① 변수 · 수임료'], ['cost', `② 비용 (${won(res?.costTotal ?? 0)})`], ['result', '③ 배분 · 정산']] as [TabKey, string][]).map(([k, l]) => <button key={k} style={chip(tab === k)} onClick={() => setTab(k)}>{l}</button>)}
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
              {' · '}세무조정은 기장하는 업체면 기장수행, 아니면 자가입니다 — 거래처별 구분은 입금 자료를 올리는 다음 단계에서 붙입니다.
            </div>
          </div>
        </>)}

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
