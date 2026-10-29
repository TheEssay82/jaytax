// 매출통계 › 예측·성장
//
// 사용자 요구(2026-10-29):
//   「기장매출예측치가 보기 너무 불편해 … 특히 조정수수료에 대한 매출예측이 필요해. 적어도 전년 동액으로」
//   「기장팀 및 감사팀의 연도별 성장그래프도 보고싶어」
//
// 한 해의 예측 = 지난 달까지 실적 + 이번 달부터 계약 예상 + **조정수수료 전년 동액**.
// 전년 동액은 「계약 우선, 없으면 전년 실적」(revenueForecast.ts). 예산 탭과 같은 자료를 쓰되,
// 예산 탭은 인건비와 견주는 자리이고 여기는 **매출만** 앞 해와 견주는 자리다.
import { useEffect, useMemo, useState } from 'react';
import Loading from '../common/Loading';
import { fyOf, kstYm, fyRange } from '../../lib/revenueStatsApi';
import { loadForecast, type ForecastData, type YearBar } from '../../lib/revenueHistoryApi';
import { GROUPS, groupOf, partyRows, sumByGroup } from '../../lib/revenueForecast';
import { teamLabel } from '../../lib/teams';

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const eok = (n: number) => `${(n / 1e8).toFixed(n >= 1e9 ? 1 : 2)}억`;
const pct = (a: number, b: number) => (b ? `${a >= b ? '+' : ''}${(((a - b) / b) * 100).toFixed(1)}%` : '');
const TEAMS = ['taxteam', '감사team'] as const;
const COLORS = ['#2f5d8a', '#3f9a8f', '#c99a3a'];

export default function ForecastGrowthTab() {
  const curFy = fyOf(kstYm());
  const [fy, setFy] = useState(curFy);
  const [team, setTeam] = useState<string>('taxteam');
  const [data, setData] = useState<ForecastData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [onlyCarry, setOnlyCarry] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null); setErr(null);
    loadForecast(fy).then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'); });
    return () => { alive = false; };
  }, [fy]);

  const groups = GROUPS[team];
  const thisYm = kstYm();

  const view = useMemo(() => {
    if (!data) return null;
    const prevSum = sumByGroup(data.prev, team);
    const curSum = sumByGroup(data.cur, team);
    // 올해 예측이 어디서 왔나 — 실적 · 계약 예상 · 전년 동액
    const src = { 실적: 0, 계약: 0, 전년동액: 0 };
    for (const f of data.cur) {
      if (f.team !== team) continue;
      if (f.status === '전년동액') src.전년동액 += f.supply;
      else if (f.origin === '예상') src.계약 += f.supply;
      else src.실적 += f.supply;
    }
    const { from } = fyRange(fy);
    const base = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7)) - 1;
    const months = Array.from({ length: 12 }, (_, i) => {
      const n = base + i; return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
    });
    const monthly = new Map<string, Map<string, number>>();   // group → ym → 금액
    const carryM = new Map<string, number>();
    for (const g of groups) monthly.set(g, new Map());
    for (const f of data.cur) {
      if (f.team !== team) continue;
      const mm = monthly.get(groupOf(f))!;
      mm.set(f.ym, (mm.get(f.ym) ?? 0) + f.supply);
      if (f.status === '전년동액') carryM.set(f.ym, (carryM.get(f.ym) ?? 0) + f.supply);
    }
    let rows = partyRows(data.prev, data.cur, team);
    if (onlyCarry) rows = rows.filter((r) => r.adjSource.includes('전년동액'));
    if (q.trim()) { const s = q.trim().toLowerCase(); rows = rows.filter((r) => r.company.toLowerCase().includes(s)); }
    rows.sort((a, b) => b.curTotal - a.curTotal || b.prevTotal - a.prevTotal);
    const carryCount = partyRows(data.prev, data.cur, team).filter((r) => r.adjSource.includes('전년동액')).length;
    return { prevSum, curSum, src, months, monthly, carryM, rows, carryCount };
  }, [data, team, groups, fy, q, onlyCarry]);

  function copyTsv() {
    if (!view) return;
    const head = ['거래처', ...groups.map((g) => `FY${fy - 1} ${g}`), ...groups.map((g) => `FY${fy} ${g}`), `FY${fy - 1} 합계`, `FY${fy} 합계`, '조정 출처'];
    const lines = view.rows.map((r) => [r.company, ...groups.map((g) => Math.round(r.prev[g])), ...groups.map((g) => Math.round(r.cur[g])),
      Math.round(r.prevTotal), Math.round(r.curTotal), r.adjSource].join('\t'));
    void navigator.clipboard.writeText([head.join('\t'), ...lines].join('\n'));
  }

  return (
    <div>
      <div className="rep-title">📈 예측 · 성장 <span className="sub">앞 해와 견준 올해 매출 예측</span></div>
      <div className="rep-hint">
        💡 올해 예측 = <b>지난 달까지 실적</b> + <b>이번 달부터 계약 예상</b>(미계약 포함) + <b>조정수수료 전년 동액</b>.
        조정수수료는 그 해 계약(또는 청구)이 있으면 그 금액을, 없으면 <b>앞 해 실제 금액</b>을 1년 뒤 같은 달에 넣습니다
        (지난 달이면 이번 달로). 폐업 · 이관 · 종료한 거래처는 넣지 않습니다. 공급가액(부가세 별도).
      </div>
      {err && <div style={{ color: 'var(--bad)', margin: '6px 0' }}>{err}</div>}

      {/* 연도별 성장 — 두 팀 */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '10px 0 14px' }}>
        {TEAMS.map((t) => <GrowthChart key={t} team={t} bars={data?.bars.filter((b) => b.team === t) ?? []} loading={!data} />)}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <select value={fy} onChange={(e) => setFy(Number(e.target.value))} style={{ padding: '4px 7px', width: 'auto', flex: '0 0 auto' }}>
          {[curFy + 1, curFy, curFy - 1].map((y) => <option key={y} value={y}>FY{y} ({y}-07~{y + 1}-06)</option>)}
        </select>
        {TEAMS.map((t) => (
          <button key={t} className={team === t ? 'btn-p' : 'btn-sm'} onClick={() => setTeam(t)}>{teamLabel(t)}</button>
        ))}
      </div>

      {team === '감사team' && (
        <div style={{ fontSize: 'var(--fs-1)', color: '#a06b00', margin: '0 0 8px' }}>
          ※ 감사팀 예측은 <b>매출계약등록에 들어간 계약</b>만 셉니다(세무조정만 전년 동액). 용역처럼 아직 등록 안 된 계약은 빠져 있어
          앞 해보다 낮게 보일 수 있습니다.
        </div>
      )}
      {!view ? <Loading title="📈 예측 · 성장" rows={6} rep /> : (<>
        {/* 칸별 요약 */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {[...groups, '합계'].map((g, i) => {
            const p = g === '합계' ? Object.values(view.prevSum).reduce((s, v) => s + v, 0) : view.prevSum[g];
            const c = g === '합계' ? Object.values(view.curSum).reduce((s, v) => s + v, 0) : view.curSum[g];
            return (
              <div key={g} style={{ border: '1px solid var(--rule)', borderRadius: 8, padding: '8px 14px', minWidth: 170, background: g === '합계' ? '#eef4fb' : '#fff', borderTop: g === '합계' ? undefined : `3px solid ${COLORS[i]}` }}>
                <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)' }}>{g}</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: '#245' }}>{won(c)}</div>
                <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)' }}>
                  FY{fy - 1} {won(p)} · <b style={{ color: c >= p ? 'var(--good)' : 'var(--bad)' }}>{pct(c, p)}</b>
                </div>
              </div>
            );
          })}
          <div style={{ border: '1px dashed var(--rule)', borderRadius: 8, padding: '8px 14px', minWidth: 200, fontSize: 'var(--fs-1)', color: 'var(--ink-2)' }}>
            <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)', marginBottom: 2 }}>FY{fy} 예측은 어디서</div>
            실적 {won(view.src.실적)}<br />계약 예상 {won(view.src.계약)}<br />
            <span style={{ color: '#a06b00' }}>조정 전년 동액 {won(view.src.전년동액)} ({view.carryCount}곳)</span>
          </div>
        </div>

        {/* 월별 */}
        <div style={{ overflowX: 'auto', marginBottom: 12 }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 'var(--fs-1)', minWidth: 900 }}>
            <thead><tr style={{ background: '#E9EFF7' }}>
              <th style={{ ...th, textAlign: 'left' }}>FY{fy} 월별</th>
              {view.months.map((m) => <th key={m} style={{ ...th, color: m >= thisYm ? '#99a' : '#456' }}>{m.slice(2)}</th>)}
              <th style={{ ...th, borderLeft: '2px solid #C3CEDC' }}>합계</th>
            </tr></thead>
            <tbody>
              {groups.map((g, i) => {
                const mm = view.monthly.get(g)!;
                return (
                  <tr key={g} style={{ borderTop: '1px solid #E7ECF3' }}>
                    <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}><span style={{ color: COLORS[i] }}>■</span> {g}</td>
                    {view.months.map((m) => { const v = mm.get(m) ?? 0; return <td key={m} style={{ ...td, color: !v ? '#ccc' : m >= thisYm ? '#789' : '#234' }}>{v ? won(v) : '·'}</td>; })}
                    <td style={{ ...td, fontWeight: 700, borderLeft: '2px solid #C3CEDC' }}>{won(view.curSum[g])}</td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: '1px solid #E7ECF3', color: '#a06b00' }}>
                <td style={{ ...td, textAlign: 'left' }}>└ 그중 조정 전년 동액</td>
                {view.months.map((m) => { const v = view.carryM.get(m) ?? 0; return <td key={m} style={td}>{v ? won(v) : ''}</td>; })}
                <td style={{ ...td, borderLeft: '2px solid #C3CEDC' }}>{won(view.src.전년동액)}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)', marginTop: 3 }}>
            ※ 진한 달 = 실적, 옅은 달 = 예상(계약은 인식되는 달마다 · 감사는 회계연도 월할).
          </div>
        </div>

        {/* 거래처별 */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
          <b style={{ color: 'var(--navy)' }}>거래처별</b>
          <input placeholder="🔍 거래처" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 180 }} />
          <label style={{ fontSize: 'var(--fs-1)' }}><input type="checkbox" checked={onlyCarry} onChange={(e) => setOnlyCarry(e.target.checked)} /> 전년 동액으로 채운 곳만</label>
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>{view.rows.length}곳</span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={copyTsv} title="엑셀에 붙여넣을 수 있게 복사합니다">📋 표 복사</button>
        </div>
        <div style={{ maxHeight: 560, overflow: 'auto', border: '1px solid var(--rule-2)', borderRadius: 6 }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 'var(--fs-1)', minWidth: 980 }}>
            <thead>
              <tr>
                <th rowSpan={2} style={{ ...th, ...sticky, textAlign: 'left', minWidth: 170 }}>거래처</th>
                <th colSpan={groups.length + 1} style={{ ...th, ...sticky, color: '#678' }}>FY{fy - 1} 실적</th>
                <th colSpan={groups.length + 1} style={{ ...th, ...sticky }}>FY{fy} 예측</th>
                <th rowSpan={2} style={{ ...th, ...sticky }}>증감</th>
                <th rowSpan={2} style={{ ...th, ...sticky }}>조정 출처</th>
              </tr>
              <tr>
                {[...groups, '합계'].map((g) => <th key={`p${g}`} style={{ ...th, ...sticky2, color: '#678' }}>{g}</th>)}
                {[...groups, '합계'].map((g) => <th key={`c${g}`} style={{ ...th, ...sticky2 }}>{g}</th>)}
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => {
                const d = r.curTotal - r.prevTotal;
                return (
                  <tr key={r.key}>
                    <td style={{ ...td, ...bt, textAlign: 'left', fontWeight: 600 }}>{r.company}</td>
                    {groups.map((g) => <td key={`p${g}`} style={{ ...td, ...bt, color: '#789' }}>{r.prev[g] ? won(r.prev[g]) : ''}</td>)}
                    <td style={{ ...td, ...bt, color: '#678', fontWeight: 600 }}>{won(r.prevTotal)}</td>
                    {groups.map((g) => (
                      <td key={`c${g}`} style={{ ...td, ...bt, background: (g === '조정수수료' || g === '세무조정') && r.adjSource.includes('전년동액') ? '#fff6e0' : undefined }}>
                        {r.cur[g] ? won(r.cur[g]) : ''}
                      </td>
                    ))}
                    <td style={{ ...td, ...bt, fontWeight: 700 }}>{won(r.curTotal)}</td>
                    <td style={{ ...td, ...bt, color: d > 0 ? 'var(--good)' : d < 0 ? 'var(--bad)' : '#bbb' }}>{d ? `${d > 0 ? '+' : ''}${won(d)}` : '·'}</td>
                    <td style={{ ...td, ...bt, textAlign: 'center', color: r.adjSource.includes('전년동액') ? '#a06b00' : 'var(--ink-3)' }}>{r.adjSource}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>)}
    </div>
  );
}

/** 연도별 막대 — 칸별로 쌓고, 마지막 해(예측)는 옅게. 위에 앞 해 대비 성장률. */
function GrowthChart({ team, bars, loading }: { team: string; bars: YearBar[]; loading: boolean }) {
  const groups = GROUPS[team];
  const W = 520, H = 230, padL = 46, padB = 34, padT = 26;
  const max = Math.max(1, ...bars.map((b) => b.total));
  const step = (W - padL - 10) / Math.max(1, bars.length);
  const bw = Math.min(46, step * 0.6);
  const y = (v: number) => H - padB - (v / max) * (H - padB - padT);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  return (
    <div style={{ flex: '1 1 480px', border: '1px solid var(--rule-2)', borderRadius: 8, padding: '8px 10px', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 2 }}>
        <b style={{ color: 'var(--navy)' }}>{teamLabel(team)} 연도별 매출</b>
        <span style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)' }}>
          {groups.map((g, i) => <span key={g} style={{ marginRight: 8 }}><span style={{ color: COLORS[i] }}>■</span> {g}</span>)}
          옅은 막대 = 예측
        </span>
      </div>
      {loading ? <div style={{ height: H, color: 'var(--ink-4)', fontSize: 'var(--fs-1)', padding: 20 }}>불러오는 중…</div> : (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label={`${teamLabel(team)} 연도별 매출`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - 6} y1={y(t)} y2={y(t)} stroke="#eef1f5" />
              <text x={padL - 6} y={y(t) + 3} fontSize="10" textAnchor="end" fill="#99a">{t ? eok(t) : '0'}</text>
            </g>
          ))}
          {bars.map((b, i) => {
            const cx = padL + step * i + step / 2;
            let acc = 0;
            const prev = bars[i - 1];
            const fc = b.kind === 'forecast';
            return (
              <g key={b.fy}>
                {groups.map((g, gi) => {
                  const v = b.groups[g] ?? 0; const y0 = y(acc); acc += v; const y1 = y(acc);
                  return <rect key={g} x={cx - bw / 2} y={y1} width={bw} height={Math.max(0, y0 - y1)} fill={COLORS[gi]} opacity={fc ? 0.42 : 0.92}>
                    <title>{`FY${b.fy} ${g} ${won(v)}`}</title>
                  </rect>;
                })}
                {fc && <rect x={cx - bw / 2} y={y(b.total)} width={bw} height={Math.max(0, y(0) - y(b.total))} fill="none" stroke="#2f5d8a" strokeDasharray="3 2" />}
                <text x={cx} y={y(b.total) - 13} fontSize="10.5" textAnchor="middle" fill="#234" fontWeight={600}>{eok(b.total)}</text>
                {prev && prev.total > 0 && (
                  <text x={cx} y={y(b.total) - 3} fontSize="9.5" textAnchor="middle" fill={b.total >= prev.total ? '#2a7a4a' : '#c33'}>{pct(b.total, prev.total)}</text>
                )}
                <text x={cx} y={H - padB + 14} fontSize="10.5" textAnchor="middle" fill="#456">FY{String(b.fy).slice(2)}</text>
                <text x={cx} y={H - padB + 26} fontSize="9" textAnchor="middle" fill={b.note?.startsWith('15개월') ? '#c33' : '#99a'}>
                  {fc ? '예측' : b.kind === 'history' ? (b.note?.startsWith('15개월') ? '15개월' : '엑셀') : '실적'}
                  {b.note && <title>{b.note}</title>}
                </text>
              </g>
            );
          })}
          {!bars.length && <text x={W / 2} y={H / 2} textAnchor="middle" fill="#aab" fontSize="12">자료 없음</text>}
        </svg>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: '5px 7px', fontWeight: 700, color: 'var(--ink-2)', whiteSpace: 'nowrap', textAlign: 'right', background: '#E9EFF7' };
const td: React.CSSProperties = { padding: '4px 7px', whiteSpace: 'nowrap', textAlign: 'right' };
const bt: React.CSSProperties = { borderTop: '1px solid var(--rule-2)' };
const sticky: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 2, textAlign: 'center' };
const sticky2: React.CSSProperties = { position: 'sticky', top: 27, zIndex: 2 };

