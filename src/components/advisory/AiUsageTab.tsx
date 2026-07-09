// AI(상담) 사용량 — 사용자별 '회신 초안 작성/보완' 사용 횟수 집계. 최고관리자(superuser)만 열람.
// 데이터·집계는 서버(RLS + ai_usage_by_user RPC)에서 최고관리자만 반환하므로, 화면 접근도 viewAiUsage로 게이팅.
import { useEffect, useState } from 'react';
import { listAiUsage, type AiUsageRow } from '../../lib/consultApi';
import { dtFmt } from '../../lib/format';

export default function AiUsageTab() {
  const [rows, setRows] = useState<AiUsageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      setRows(await listAiUsage());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '사용량을 불러오지 못했습니다.');
      setRows(null);
    }
  }
  useEffect(() => {
    reload();
  }, []);

  const totalAll = (rows ?? []).reduce((s, r) => s + r.total, 0);
  const totalMonth = (rows ?? []).reduce((s, r) => s + r.thisMonth, 0);

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        📊 AI 사용량
        <span style={{ fontSize: 11, fontWeight: 400, color: '#9aa0ad' }}>최고관리자 전용</span>
        <span style={{ marginLeft: 'auto' }}>
          <button className="btn-sm" onClick={reload}>↻ 새로고침</button>
        </span>
      </div>

      <div className="alert-i" style={{ fontSize: 12 }}>
        상담진행에서 <b>회신 초안 작성·보완</b>으로 AI를 사용한 횟수를 사용자별로 집계합니다. (외부인 데모 사용은 제외)
      </div>

      {error && <div className="alert-w" style={{ marginTop: 12 }}>{error}</div>}
      {rows === null && !error && <div className="alert-i" style={{ marginTop: 12 }}>불러오는 중…</div>}

      {rows && (
        <>
          <div style={{ display: 'flex', gap: 16, margin: '12px 0' }}>
            <Stat label="이번 달 사용" value={totalMonth} />
            <Stat label="누적 사용" value={totalAll} />
            <Stat label="사용자 수" value={rows.length} />
          </div>

          {rows.length === 0 ? (
            <div className="alert-i">집계된 사용 기록이 없습니다.</div>
          ) : (
            <div className="tbl-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>사용자</th>
                    <th className="r">이번 달</th>
                    <th className="r">누적</th>
                    <th>최근 사용</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.userId}>
                      <td style={{ fontWeight: 600, color: '#1f2937' }}>
                        {r.userName || '(이름 없음)'}
                        {r.userEmail && <span style={{ fontSize: 11, color: '#9aa0ad', marginLeft: 6 }}>{r.userEmail}</span>}
                      </td>
                      <td className="r" style={{ fontFamily: 'monospace' }}>{r.thisMonth}</td>
                      <td className="r" style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1A2B52' }}>{r.total}</td>
                      <td style={{ fontSize: 12, color: '#6b7280' }}>{r.lastUsed ? dtFmt(r.lastUsed) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E0DCD4', borderRadius: 8, padding: '9px 14px', minWidth: 96 }}>
      <div style={{ fontSize: 11, color: '#8a8170' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#1A2B52', fontFamily: 'monospace' }}>{value.toLocaleString()}</div>
    </div>
  );
}
