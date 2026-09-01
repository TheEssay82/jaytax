// 기장등청구관리 › 직원별 매출
//
// 청구 한 건마다 그 시점의 담당직원이 굳어 있고(biz_invoice_request.staff),
// 배분 비율(biz_invoice_staff)로 나눈 금액을 직원별로 더한다.
// 계약을 지금 읽는 것이 아니라 **청구 시점 기록**을 더하므로, 담당이 바뀌어도 과거 실적은 변하지 않는다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { todayYmd } from '../../lib/format';
import { staffRevenue, type StaffTotal } from '../../lib/invoiceStaffApi';

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
  const [data, setData] = useState<{ totals: StaffTotal[]; months: string[]; grand: number; unassigned: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setErr(null);
      setData(await staffRevenue(from, to, team || undefined));
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
  const max = Math.max(1, ...d.totals.map((t) => t.supply));

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        📊 직원별 매출
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
        <span style={{ fontSize: 11, fontWeight: 400, color: '#888' }}>
          합계 공급가액 {won(d.grand)}
        </span>
      </div>
      {err && <div className="alert-w">{err}</div>}

      <div className="alert-i" style={{ fontSize: 11 }}>
        청구할 때 굳혀 둔 <b>그 시점의 담당직원</b>을 더한 것입니다. 계약의 담당이 나중에 바뀌어도
        지난 실적은 변하지 않습니다. 담당이 여럿이면 <b>주담당이 전액</b>이고, 청구 화면에서 비율을 나눌 수 있습니다.
        <br />취소된 건은 빼고, <b>공급가액(부가세 별도)</b> 기준입니다.
      </div>

      {d.unassigned > 0 && (
        <div className="alert-w" style={{ fontSize: 11.5 }}>
          담당직원이 지정되지 않은 청구가 <b>{won(d.unassigned)}</b> 있습니다 — 아래 합계에서 빠져 있습니다.
          발행요청 화면에서 담당직원을 채워 주세요.
        </div>
      )}

      <div className="tbl-scroll" style={{ maxHeight: '60vh' }}>
        <table className="tbl" style={{ fontSize: 11.5 }}>
          <thead>
            <tr>
              <th>담당직원</th><th className="r">건수</th><th className="r">공급가액</th><th style={{ width: '26%' }}></th>
              {d.months.map((m) => <th key={m} className="r">{m.slice(2)}</th>)}
            </tr>
          </thead>
          <tbody>
            {d.totals.length === 0 && (
              <tr><td colSpan={4 + d.months.length} style={{ textAlign: 'center', padding: 20, color: '#BBB' }}>
                기간에 해당하는 청구가 없습니다.
              </td></tr>
            )}
            {d.totals.map((t) => (
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
              <td>합계</td>
              <td className="r">{d.totals.reduce((s, t) => s + t.count, 0)}</td>
              <td className="r">{won(d.totals.reduce((s, t) => s + t.supply, 0))}</td>
              <td></td>
              {d.months.map((m) => (
                <td key={m} className="r">
                  {won(d.totals.reduce((s, t) => s + (t.byMonth.get(m) ?? 0), 0))}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
