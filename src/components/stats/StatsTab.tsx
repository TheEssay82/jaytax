// 통계 탭 — 원본 rStats 포팅 (담당자별 재무·업무량 집계)
import { useMemo, useState } from 'react';
import { useClients } from '../../hooks/useClients';
import { useBillingData } from '../../hooks/useBillingData';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/roles';
import { getManagerForYear } from '../../lib/wizardHelpers';
import { fm } from '../../lib/format';

interface MgrAgg {
  cnt: number; law: number; per: number; rev: number; A: number; C: number; disc: number; grand: number;
  model: number; visit: number; phone: number; jangbu: number; gyeolsan: number; jojung: number; wonka: number; ev: number;
}
const emptyAgg = (): MgrAgg => ({
  cnt: 0, law: 0, per: 0, rev: 0, A: 0, C: 0, disc: 0, grand: 0,
  model: 0, visit: 0, phone: 0, jangbu: 0, gyeolsan: 0, jojung: 0, wonka: 0, ev: 0,
});

export default function StatsTab() {
  const { clients, loading: clLoading } = useClients();
  const { records, loading: bdLoading } = useBillingData();
  const { role, profileName } = useAuth();
  const ownOnly = !can(role, 'viewAllStats');
  const loading = clLoading || bdLoading;

  const years = useMemo(
    () => [...new Set(records.map((r) => r.fiscalYear))].sort((a, b) => b - a),
    [records],
  );
  const [statYear, setStatYear] = useState<number | null>(null);
  const year = statYear ?? years[0] ?? null;

  const recs = useMemo(() => {
    if (year == null) return [];
    let list = records.filter((r) => String(r.fiscalYear) === String(year));
    if (ownOnly) {
      list = list.filter((r) => {
        const cl = clients.find((c) => c.id === r.selClientId);
        const m = cl ? getManagerForYear(cl, r.fiscalYear) : r.manager || '';
        return m === profileName;
      });
    }
    return list;
  }, [records, year, ownOnly, clients, profileName]);

  const { mgrs, tot } = useMemo(() => {
    const byMgr: Record<string, MgrAgg> = {};
    for (const r of recs) {
      const cl = clients.find((c) => c.id === r.selClientId);
      const m = cl ? getManagerForYear(cl, r.fiscalYear) : r.manager || '(미지정)';
      const g = (byMgr[m] ??= emptyAgg());
      g.cnt++;
      if (r.bizType === '법인') g.law++;
      else g.per++;
      g.rev += r.rev || 0;
      g.A += r.A || 0;
      g.C += r.C || 0;
      g.disc += r.disc || 0;
      g.grand += r.grand || 0;
      if (r.isModel) g.model++;
      if (r.visitCount && r.visitCount !== '없음') g.visit++;
      if (r.phoneCount && r.phoneCount !== '없음') g.phone++;
      if (r.장부P === 'O') g.jangbu++;
      if (r.결산P === 'O') g.gyeolsan++;
      if (r.조정P === 'O') g.jojung++;
      if (r.원가P === 'O') g.wonka++;
      if (r.evCount && r.evCount !== '없음') g.ev++;
    }
    return {
      mgrs: Object.entries(byMgr).sort((a, b) => b[1].grand - a[1].grand),
      tot: {
        rev: recs.reduce((s, r) => s + (r.rev || 0), 0),
        C: recs.reduce((s, r) => s + (r.C || 0), 0),
        disc: recs.reduce((s, r) => s + (r.disc || 0), 0),
        grand: recs.reduce((s, r) => s + (r.grand || 0), 0),
        law: recs.filter((r) => r.bizType === '법인').length,
        per: recs.filter((r) => r.bizType === '개인').length,
      },
    };
  }, [recs, clients]);

  if (loading) {
    return (
      <div className="card">
        <div className="chdr">📊 통계</div>
        <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>불러오는 중…</div>
      </div>
    );
  }

  const yearSelect = (
    <select
      style={{ marginLeft: 6, padding: '3px 7px', fontSize: 12 }}
      value={year ?? ''}
      onChange={(e) => setStatYear(parseInt(e.target.value))}
    >
      {years.map((y) => (
        <option key={y} value={y}>
          {y}년
        </option>
      ))}
    </select>
  );

  if (!recs.length) {
    return (
      <div className="card">
        <div className="chdr">통계 — {years.length > 0 && yearSelect}</div>
        <div className="alert-w">{year ? `${year}년 청구 기록이 없습니다.` : '청구 기록이 없습니다.'}</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="chdr">담당자별 통계 — {yearSelect}</div>

      {ownOnly && (
        <div className="alert-i" style={{ fontSize: 11 }}>
          🔒 본인(담당자: {profileName || '미지정'}) 청구건만 표시됩니다.
        </div>
      )}

      <div className="stat-cards">
        <div className="stat-card">
          <div className="label">총 거래처</div>
          <div className="value">{recs.length}</div>
          <div className="sub">법인 {tot.law} / 개인 {tot.per}</div>
        </div>
        <div className="stat-card">
          <div className="label">총 매출액</div>
          <div className="value" style={{ fontSize: 13 }}>{(tot.rev / 1e8).toFixed(1)}억</div>
        </div>
        <div className="stat-card">
          <div className="label">보수총계(C)</div>
          <div className="value" style={{ fontSize: 13 }}>{(tot.C / 1e6).toFixed(0)}백만</div>
        </div>
        <div className="stat-card">
          <div className="label">할인 합계</div>
          <div className="value" style={{ fontSize: 13, color: '#DC2626' }}>-{(tot.disc / 1e6).toFixed(0)}백만</div>
        </div>
        <div className="stat-card">
          <div className="label">총 청구금액</div>
          <div className="value" style={{ fontSize: 13, color: '#1A2B52' }}>{(tot.grand / 1e6).toFixed(0)}백만</div>
        </div>
      </div>

      <div style={{ overflowX: 'auto', marginBottom: 12 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>담당자</th>
              <th className="r">건수</th>
              <th className="r">법인</th>
              <th className="r">개인</th>
              <th className="r">총매출액</th>
              <th className="r">보수총계C)</th>
              <th className="r">할인</th>
              <th className="r">최종청구금액</th>
              <th className="r">평균</th>
            </tr>
          </thead>
          <tbody>
            {mgrs.map(([m, g]) => (
              <tr key={m}>
                <td style={{ fontWeight: 700 }}>{m}</td>
                <td className="r">{g.cnt}</td>
                <td className="r">{g.law}</td>
                <td className="r">{g.per}</td>
                <td className="r" style={{ fontFamily: 'monospace' }}>{(g.rev / 1e8).toFixed(2)}억</td>
                <td className="r" style={{ fontFamily: 'monospace' }}>{fm(g.C)}</td>
                <td className="r" style={{ fontFamily: 'monospace', color: '#DC2626' }}>{g.disc ? '-' + fm(g.disc) : '-'}</td>
                <td className="r" style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1A2B52' }}>{fm(g.grand)}</td>
                <td className="r" style={{ fontFamily: 'monospace' }}>{fm(Math.round(g.grand / g.cnt))}</td>
              </tr>
            ))}
            <tr className="tot">
              <td>합계</td>
              <td className="r">{recs.length}</td>
              <td className="r">{tot.law}</td>
              <td className="r">{tot.per}</td>
              <td className="r" style={{ fontFamily: 'monospace' }}>{(tot.rev / 1e8).toFixed(2)}억</td>
              <td className="r" style={{ fontFamily: 'monospace' }}>{fm(tot.C)}</td>
              <td className="r" style={{ fontFamily: 'monospace', color: '#DC2626' }}>-{fm(tot.disc)}</td>
              <td className="r" style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1A2B52' }}>{fm(tot.grand)}</td>
              <td className="r" style={{ fontFamily: 'monospace' }}>{fm(Math.round(tot.grand / recs.length))}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 7 }}>업무량 현황 (담당자별)</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>담당자</th>
              <th className="r">건수</th>
              <th className="r">성실</th>
              <th className="r">방문</th>
              <th className="r">전화</th>
              <th className="r">기장</th>
              <th className="r">결산</th>
              <th className="r">조정</th>
              <th className="r">원가</th>
              <th className="r">증빙</th>
            </tr>
          </thead>
          <tbody>
            {mgrs.map(([m, g]) => (
              <tr key={m}>
                <td style={{ fontWeight: 700 }}>{m}</td>
                <td className="r">{g.cnt}</td>
                <td className="r">{g.model || '-'}</td>
                <td className="r">{g.visit || '-'}</td>
                <td className="r">{g.phone || '-'}</td>
                <td className="r">{g.jangbu || '-'}</td>
                <td className="r">{g.gyeolsan || '-'}</td>
                <td className="r">{g.jojung || '-'}</td>
                <td className="r">{g.wonka || '-'}</td>
                <td className="r">{g.ev || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
