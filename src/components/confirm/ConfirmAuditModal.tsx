// 조회서 변경이력 — 감사증빙용. 누가 언제 발송·회수를 처리했는지 기록.
// 트리거가 남기므로 화면에서는 조회만 한다(수정·삭제 불가).
import { useEffect, useState } from 'react';
import { useEscape } from '../../lib/useEscape';
import { listAudit, type ConfirmAudit } from '../../lib/confirmApi';

const dt = (s: string) => {
  const d = new Date(s);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const actStyle = (a: ConfirmAudit['action']): React.CSSProperties =>
  a === 'insert'
    ? { background: '#D1FAE5', color: '#065F46' }
    : a === 'delete'
      ? { background: '#FEE2E2', color: 'var(--bad)' }
      : { background: '#DBEAFE', color: '#1E40AF' };
const actLabel = (a: ConfirmAudit['action']) => (a === 'insert' ? '등록' : a === 'delete' ? '삭제' : '수정');

export default function ConfirmAuditModal({
  confirmationId, title, onClose,
}: {
  /** 없으면 전체 이력 */
  confirmationId?: string;
  title: string;
  onClose: () => void;
}) {
  useEscape(onClose);
  const [rows, setRows] = useState<ConfirmAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setRows(await listAudit(confirmationId));
      } catch (e) {
        setErr(e instanceof Error ? e.message : '불러오지 못했습니다.');
      } finally {
        setLoading(false);
      }
    })();
  }, [confirmationId]);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, maxWidth: 860, width: '100%', maxHeight: '82vh', overflow: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--rule-2)', position: 'sticky', top: 0, background: '#fff' }}>
          <span style={{ fontWeight: 700, color: 'var(--navy)' }}>🕘 변경이력 — {title}</span>
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>{rows.length}건</span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>

        <div style={{ padding: 12 }}>
          <div className="alert-i" style={{ fontSize: 'var(--fs-1)', marginBottom: 8 }}>
            🔒 발송·회수 처리 기록은 <b>감사증빙</b>이라 자동으로 남으며 수정·삭제할 수 없습니다.
            2025년 이관분은 시스템 도입 전 기록이라 이력이 없습니다.
          </div>

          {err && <div className="alert-w" style={{ fontSize: 'var(--fs-1)' }}>{err}</div>}
          {loading ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-3)' }}>불러오는 중…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-4)', fontSize: 'var(--fs-2)' }}>기록이 없습니다.</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 132 }}>일시</th>
                  <th style={{ width: 88 }}>담당자</th>
                  <th style={{ width: 56, textAlign: 'center' }}>작업</th>
                  <th>내용</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontSize: 'var(--fs-1)', whiteSpace: 'nowrap' }}>{dt(r.at)}</td>
                    <td style={{ fontSize: 'var(--fs-2)', fontWeight: 600 }}>{r.actorName}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className="bdg" style={{ fontSize: 'var(--fs-0)', ...actStyle(r.action) }}>{actLabel(r.action)}</span>
                    </td>
                    <td style={{ fontSize: 'var(--fs-2)' }}>{r.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
