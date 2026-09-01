// 기장등청구관리 › 담당별 매출
//
// 청구 한 건마다 그 시점의 담당(회계사·직원)이 굳어 있고(biz_invoice_request.cpa/staff),
// 배분 비율(biz_invoice_staff)로 나눈 금액을 담당직원별로 더한다.
// 계약을 지금 읽는 것이 아니라 **청구 시점 기록**을 더하므로, 담당이 바뀌어도 과거 실적은 변하지 않는다.
//
// 축이 둘이다.
//  · 담당직원 — taxteam 기장 실무. 배분 비율을 반영해 나눈다.
//  · 담당회계사 — 감사팀은 **회계사 단위로만** 본다. 한 건은 한 회계사 몫이라 나누지 않는다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { todayYmd } from '../../lib/format';
import { listStaffChangeLog, staffRevenue, type StaffChangeLog } from '../../lib/invoiceStaffApi';

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export default function StaffRevenueTab() {
  const thisMonth = todayYmd().slice(0, 7);
  const [from, setFrom] = useState(() => shiftMonth(thisMonth, -5));
  const [to, setTo] = useState(thisMonth);
  const [team, setTeam] = useState('');
  const [axis, setAxis] = useState<'staff' | 'cpa'>('staff');
  const [data, setData] = useState<Awaited<ReturnType<typeof staffRevenue>> | null>(null);
  const [logs, setLogs] = useState<StaffChangeLog[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setErr(null);
      const [d, l] = await Promise.all([staffRevenue(from, to, team || undefined), listStaffChangeLog(100)]);
      setData(d); setLogs(l);
    } catch (e) { setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, [from, to, team]);
  useEffect(() => { void load(); }, [load]);

  const monthOpts = useMemo(() => {
    const [y, m] = thisMonth.split('-').map(Number);
    return Array.from({ length: 24 }, (_, i) => {
      const d = new Date(Date.UTC(y, m - 1 - i + 1, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    });
  }, [thisMonth]);

  if (loading) return <div className="card">불러오는 중…</div>;
  const d = data!;
  const rowsView = axis === 'staff' ? d.totals : d.cpaTotals;
  const missing = axis === 'staff' ? d.unassigned : d.cpaUnassigned;
  const axisName = axis === 'staff' ? '담당직원' : '담당회계사';
  const max = Math.max(1, ...rowsView.map((t) => t.supply));

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        📊 담당별 매출
        <select value={from} onChange={(e) => setFrom(e.target.value)} style={{ fontWeight: 700 }}>
          {monthOpts.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <span style={{ color: '#999' }}>~</span>
        <select value={to} onChange={(e) => setTo(e.target.value)} style={{ fontWeight: 700 }}>
          {monthOpts.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">전체 팀</option>
          <option value="taxteam">taxteam</option>
          <option value="감사team">감사팀</option>
        </select>
        <select value={axis} onChange={(e) => setAxis(e.target.value as 'staff' | 'cpa')} style={{ fontWeight: 700 }}>
          <option value="staff">담당직원 기준</option>
          <option value="cpa">담당회계사 기준</option>
        </select>
        <span style={{ fontSize: 11, fontWeight: 400, color: '#888' }}>
          합계 공급가액 {won(d.grand)}
        </span>
      </div>
      {err && <div className="alert-w">{err}</div>}

      <div className="alert-i" style={{ fontSize: 11 }}>
        청구할 때 굳혀 둔 <b>그 시점의 담당</b>을 더한 것입니다. 계약의 담당이 나중에 바뀌어도
        지난 실적은 변하지 않습니다.
        <br />· <b>담당직원 기준</b> — 담당이 여럿이면 주담당이 전액이고, 발행요청 화면의 담당직원 칸을 눌러 비율을 나눌 수 있습니다.
        <br />· <b>담당회계사 기준</b> — 감사팀은 회계사 단위로만 봅니다. 한 건은 한 회계사 몫이라 나누지 않습니다.
        <br />취소된 건은 빼고, <b>공급가액(부가세 별도)</b> 기준입니다.
      </div>

      {missing > 0 && (
        <div className="alert-w" style={{ fontSize: 11.5 }}>
          {axisName}이 지정되지 않은 청구가 <b>{won(missing)}</b> 있습니다 — 아래 합계에서 빠져 있습니다.
          발행요청 화면에서 채워 주세요.
          {axis === 'staff' && !team && ' (감사팀 건은 회계사 단위로만 보므로 대개 여기 남습니다 — 팀을 taxteam으로 좁혀 보세요.)'}
        </div>
      )}

      <div className="tbl-scroll" style={{ maxHeight: '60vh' }}>
        <table className="tbl" style={{ fontSize: 11.5 }}>
          <thead>
            <tr>
              <th>{axisName}</th><th className="r">건수</th><th className="r">공급가액</th><th style={{ width: '26%' }}></th>
              {d.months.map((m) => <th key={m} className="r">{m.slice(2)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rowsView.length === 0 && (
              <tr><td colSpan={4 + d.months.length} style={{ textAlign: 'center', padding: 20, color: '#BBB' }}>
                기간에 해당하는 청구가 없습니다.
              </td></tr>
            )}
            {rowsView.map((t) => (
              <tr key={t.staffName}>
                <td style={{ fontWeight: 700, color: '#1A2B52' }}>{t.staffName}</td>
                <td className="r">{t.count}</td>
                <td className="r" style={{ fontWeight: 700 }}>{won(t.supply)}</td>
                <td>
                  <span style={{
                    display: 'block', height: 10, borderRadius: 5,
                    width: `${Math.max(2, (t.supply / max) * 100)}%`, background: '#1A2B52', opacity: 0.75,
                  }} />
                </td>
                {d.months.map((m) => (
                  <td key={m} className="r" style={{ color: '#666' }}>
                    {t.byMonth.get(m) ? won(t.byMonth.get(m)!) : <span style={{ color: '#DDD' }}>—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: '#f5efdd', fontWeight: 700 }}>
              <td>합계 {rowsView.length === 0 ? '' : `(${axisName})`}</td>
              <td className="r">{rowsView.reduce((s, t) => s + t.count, 0)}</td>
              <td className="r">{won(rowsView.reduce((s, t) => s + t.supply, 0))}</td>
              <td></td>
              {d.months.map((m) => (
                <td key={m} className="r">
                  {won(rowsView.reduce((s, t) => s + (t.byMonth.get(m) ?? 0), 0))}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <div style={{ marginTop: 14 }}>
        <button className="btn-sm" onClick={() => setShowLog((v) => !v)}>
          {showLog ? '▾' : '▸'} 담당직원 변경 이력 ({logs.length})
        </button>
        {showLog && (
          <>
            <div className="alert-i" style={{ fontSize: 11, marginTop: 8 }}>
              발행요청 화면에서 담당직원을 바꾼 기록입니다. <b>계약반영</b>이 <b>예</b>이면 매출계약의 담당직원도
              그 달부터 함께 바뀐 것이고, <b>아니오</b>면 그 달 청구 한 건만 바뀐 것입니다.
            </div>
            <div className="tbl-scroll" style={{ maxHeight: '40vh', marginTop: 6 }}>
              <table className="tbl" style={{ fontSize: 11.5 }}>
                <thead>
                  <tr>
                    <th>적용월</th><th>거래처</th><th>이전</th><th>이후</th>
                    <th>계약반영</th><th>바꾼 사람</th><th>바꾼 시각</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: 'center', padding: 16, color: '#BBB' }}>
                      아직 변경 이력이 없습니다.
                    </td></tr>
                  )}
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td style={{ fontWeight: 700 }}>{l.ym || '—'}</td>
                      <td>{l.company || '—'}</td>
                      <td style={{ color: '#888' }}>{l.before || '(없음)'}</td>
                      <td style={{ fontWeight: 700, color: '#1A2B52' }}>{l.after || '(없음)'}</td>
                      <td style={{ color: l.propagated ? '#2a7' : '#999', fontWeight: l.propagated ? 700 : 400 }}>
                        {l.propagated ? '예' : '아니오'}
                      </td>
                      <td>{l.changedBy || '—'}</td>
                      <td style={{ color: '#888' }}>{l.changedAt.slice(0, 16).replace('T', ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
