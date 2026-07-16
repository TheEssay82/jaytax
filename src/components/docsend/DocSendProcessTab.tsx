// 문서발송 › 발송요청 처리 — 권한자(최고관리자·기장팀장·기장팀원)가 발송 상태·발송일·등기번호를 처리
// 흐름: 미접수 → (처리 시작) 진행중 → 발송일 입력·완료 → 발송완료. 등기번호는 우체국 조회 딥링크.
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/roles';
import {
  listSendRequests,
  listAttachments,
  setProcessing,
  epostTrackingUrl,
  type SendRequest,
  type SendAttachment,
} from '../../lib/docSendApi';
import AttachmentsModal from './AttachmentsModal';

const today = () => new Date().toISOString().slice(0, 10);
const statusStyle = (s: string): React.CSSProperties => {
  if (s === '발송완료') return { background: '#D1FAE5', color: '#065F46' };
  if (s === '재발송완료') return { background: '#CFFAFE', color: '#155E75' };
  if (s === '반송') return { background: '#FEE2E2', color: '#B91C1C' };
  if (s === '진행중') return { background: '#DBEAFE', color: '#1E40AF' };
  return { background: '#F3F4F6', color: '#6B7280' };
};
const isClosed = (s: string) => s === '발송완료' || s === '재발송완료'; // 완결계열(반송은 후속조치 필요라 제외)

export default function DocSendProcessTab() {
  const { role } = useAuth();
  const canView = can(role, 'viewDispatch');
  const canProcess = can(role, 'processDispatch');

  const [reqs, setReqs] = useState<SendRequest[]>([]);
  const [attByBatch, setAttByBatch] = useState<Record<string, SendAttachment[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const [q, setQ] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [attachFor, setAttachFor] = useState<SendRequest | null>(null);

  async function load() {
    try {
      setError(null);
      const [r, atts] = await Promise.all([listSendRequests(), listAttachments()]);
      setReqs(r);
      const map: Record<string, SendAttachment[]> = {};
      for (const a of atts) (map[a.batchId] ||= []).push(a);
      setAttByBatch(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(''), 2500);
  }

  const counts = useMemo(() => ({
    미접수: reqs.filter((r) => r.status === '미접수').length,
    진행중: reqs.filter((r) => r.status === '진행중').length,
    발송완료: reqs.filter((r) => r.status === '발송완료').length,
    반송: reqs.filter((r) => r.status === '반송').length,
  }), [reqs]);

  const view = useMemo(() => {
    let list = reqs.filter((r) => (showDone ? true : !isClosed(r.status))); // 반송은 항상 표시(후속조치 필요)
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter((r) =>
        [r.companyName, r.recipientName, r.docName, r.sendKind, r.requester, r.trackingNo].some((v) => (v || '').toLowerCase().includes(s)),
      );
    }
    // 처리 우선순위: 미접수 → 진행중 → 반송(후속) → 발송완료 → 재발송완료, 긴급 먼저, 의뢰일자 순
    const order: Record<string, number> = { 미접수: 0, 진행중: 1, 반송: 2, 발송완료: 3, 재발송완료: 4 };
    const rank = (r: SendRequest) => order[r.status] ?? 5;
    return [...list].sort((a, b) => rank(a) - rank(b) || (a.deadline === '긴급' ? -1 : 0) - (b.deadline === '긴급' ? -1 : 0) || a.requestDate.localeCompare(b.requestDate));
  }, [reqs, q, showDone]);

  const attCount = (r: SendRequest) => (r.batchId ? (attByBatch[r.batchId]?.length ?? 0) : 0);

  async function startProcessing(r: SendRequest) {
    try {
      await setProcessing(r.id, { status: '진행중' });
      await load();
      setOpenId(r.id);
      flash('▶ 진행중으로 전환');
    } catch (e) {
      alert('처리 시작 실패: ' + (e instanceof Error ? e.message : e));
    }
  }
  async function saveProgress(r: SendRequest, sentDate: string, trackingNo: string) {
    try {
      await setProcessing(r.id, { sentDate: sentDate || null, trackingNo });
      await load();
      flash('✓ 저장됨');
    } catch (e) {
      alert('저장 실패: ' + (e instanceof Error ? e.message : e));
    }
  }
  async function complete(r: SendRequest, sentDate: string, trackingNo: string) {
    if (!sentDate) {
      alert('완료하려면 발송일을 입력하세요.');
      return;
    }
    try {
      await setProcessing(r.id, { status: '발송완료', sentDate, trackingNo });
      await load();
      setOpenId(null);
      flash('✅ 발송완료 처리');
    } catch (e) {
      alert('완료 처리 실패: ' + (e instanceof Error ? e.message : e));
    }
  }
  async function revert(r: SendRequest, to: string) {
    const label = to === '미접수' ? '미접수(요청자 수정 가능)로 되돌리기' : '진행중으로 되돌리기';
    if (!confirm(`이 건을 ${label} 하시겠습니까?`)) return;
    try {
      await setProcessing(r.id, { status: to, statusNote: '' });
      await load();
      setOpenId(null);
      flash('↩ 되돌림');
    } catch (e) {
      alert('되돌리기 실패: ' + (e instanceof Error ? e.message : e));
    }
  }
  // 발송완료 이후 후속 상태(반송/재발송완료) + 사유
  async function changeStatus(r: SendRequest, to: string, note: string) {
    if (to === '반송' && !note.trim()) {
      alert('반송 사유를 입력하세요.');
      return;
    }
    try {
      await setProcessing(r.id, { status: to, statusNote: note });
      await load();
      setOpenId(null);
      flash(to === '반송' ? '↪ 반송 처리' : '✅ 재발송완료 처리');
    } catch (e) {
      alert('상태 변경 실패: ' + (e instanceof Error ? e.message : e));
    }
  }

  if (!canView) {
    return (
      <div className="card">
        <div className="chdr">🖨️ 발송요청 처리</div>
        <div className="alert-w">접근 권한이 없습니다.</div>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="card">
        <div className="chdr">🖨️ 발송요청 처리</div>
        <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>불러오는 중…</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="chdr">
        발송요청 처리
        <span style={{ marginLeft: 10, fontSize: 11, color: '#888' }}>
          미접수 {counts.미접수} · 진행중 {counts.진행중} · 발송완료 {counts.발송완료}
          {counts.반송 > 0 && <span style={{ color: '#B91C1C', fontWeight: 700 }}> · 반송 {counts.반송}</span>}
        </span>
        {msg && <span style={{ marginLeft: 12, fontSize: 11, color: '#059669' }}>{msg}</span>}
      </div>

      {error && <div className="alert-w">{error}</div>}
      {canProcess ? (
        <div className="alert-i" style={{ fontSize: 11 }}>
          🖨️ 요청된 발송 건이 여기 모입니다. <b>‘처리 시작’</b>을 누르면 상태가 <b>진행중</b>으로 바뀝니다. 발송일(등기면 등기번호)을 입력하고 <b>‘완료’</b>를 누르면 <b>발송완료</b>됩니다. 발송완료 후에는 <b>반송·재발송완료</b>(사유 기재)로 후속 처리할 수 있습니다. 등기번호를 클릭하면 우체국 배달조회가 새 창으로 열립니다.
        </div>
      ) : (
        <div className="alert-i" style={{ fontSize: 11 }}>
          👁️ <b>조회 전용</b>입니다(회계사). 발송 진행현황을 열람할 수 있으며, 상태 변경 등 처리는 최고관리자·기장팀장·기장팀원만 가능합니다.
        </div>
      )}

      <div className="sbar">
        <input placeholder="🔍 거래처·수신자·문서명·등기번호" value={q} onChange={(e) => setQ(e.target.value)} />
        <label style={{ fontSize: 12, color: '#555', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          발송완료 포함
        </label>
        <span style={{ fontSize: 11, color: '#888' }}>{view.length}건</span>
      </div>

      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ textAlign: 'center' }}>상태</th>
              <th>의뢰일자</th>
              <th>의뢰인</th>
              <th>거래처 · 수신자</th>
              <th>업무구분</th>
              <th>송부종류</th>
              <th>문서명</th>
              <th style={{ textAlign: 'center' }}>부수</th>
              <th style={{ textAlign: 'center' }}>날인</th>
              <th style={{ textAlign: 'center' }}>기한</th>
              <th style={{ textAlign: 'center' }}>첨부</th>
              <th>발송일</th>
              <th>등기번호</th>
              <th style={{ width: 130 }}>처리</th>
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && (
              <tr><td colSpan={14} style={{ textAlign: 'center', color: '#BBB', padding: 24 }}>처리할 발송요청이 없습니다.</td></tr>
            )}
            {view.map((r) => (
              <ProcessRow
                key={r.id}
                r={r}
                canProcess={canProcess}
                attCount={attCount(r)}
                open={openId === r.id}
                onOpenAttach={() => setAttachFor(r)}
                onStart={() => startProcessing(r)}
                onToggle={() => setOpenId((id) => (id === r.id ? null : r.id))}
                onSaveProgress={(d, t) => saveProgress(r, d, t)}
                onComplete={(d, t) => complete(r, d, t)}
                onRevert={(to) => revert(r, to)}
                onChangeStatus={(to, note) => changeStatus(r, to, note)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {attachFor && (
        <AttachmentsModal
          req={attachFor}
          attachments={attachFor.batchId ? attByBatch[attachFor.batchId] ?? [] : []}
          shared={false}
          canWrite={false}
          onClose={() => setAttachFor(null)}
          onChanged={async () => { await load(); }}
        />
      )}
    </div>
  );
}

// 등기번호 → 우체국 조회(새 창)
function TrackingLink({ no }: { no: string }) {
  if (!no) return <span style={{ color: '#CCC' }}>—</span>;
  return (
    <button
      className="btn-sm btn-sm-blue"
      style={{ fontSize: 11, padding: '1px 6px' }}
      title="우체국 배달조회 (새 창)"
      onClick={() => window.open(epostTrackingUrl(no), '_blank', 'noopener')}
    >
      🔎 {no}
    </button>
  );
}

function ProcessRow({
  r,
  canProcess,
  attCount,
  open,
  onOpenAttach,
  onStart,
  onToggle,
  onSaveProgress,
  onComplete,
  onRevert,
  onChangeStatus,
}: {
  r: SendRequest;
  canProcess: boolean;
  attCount: number;
  open: boolean;
  onOpenAttach: () => void;
  onStart: () => void;
  onToggle: () => void;
  onSaveProgress: (sentDate: string, trackingNo: string) => void;
  onComplete: (sentDate: string, trackingNo: string) => void;
  onRevert: (to: string) => void;
  onChangeStatus: (to: string, note: string) => void;
}) {
  const [sentDate, setSentDate] = useState(r.sentDate || today());
  const [trackingNo, setTrackingNo] = useState(r.trackingNo || '');
  const [note, setNote] = useState(r.statusNote || '');
  const isPost = r.status === '발송완료' || r.status === '반송' || r.status === '재발송완료';

  return (
    <>
      <tr>
        <td style={{ textAlign: 'center' }}>
          <span className="bdg" style={{ fontSize: 10, ...statusStyle(r.status) }}>{r.status}</span>
          {r.statusNote && (
            <div style={{ fontSize: 10, color: '#B91C1C', marginTop: 2, maxWidth: 96, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.statusNote}>
              {r.statusNote}
            </div>
          )}
        </td>
        <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{r.requestDate?.replace(/-/g, '.')}</td>
        <td style={{ fontSize: 12 }}>{r.requester}</td>
        <td style={{ fontSize: 12 }}>
          <b style={{ color: '#1A2B52' }}>{r.companyName}</b>
          {r.recipientName && <span style={{ color: '#555' }}> · {r.recipientName} {r.recipientTitle}</span>}
        </td>
        <td style={{ fontSize: 12 }}>{r.workType}</td>
        <td style={{ fontSize: 12 }}>{r.sendKind}</td>
        <td style={{ fontSize: 12 }}>
          {r.docName || <span style={{ color: '#CCC' }}>—</span>}
          {r.etcRequest && (
            <div style={{ fontSize: 10.5, color: '#8a5a00', marginTop: 2, whiteSpace: 'pre-wrap' }} title="기타요청사항">📝 {r.etcRequest}</div>
          )}
        </td>
        <td style={{ textAlign: 'center', fontSize: 12 }}>{r.copies}</td>
        <td style={{ textAlign: 'center', fontSize: 11 }}>{r.sealRequired ? '🔖' : '—'}</td>
        <td style={{ textAlign: 'center', fontSize: 11 }}>{r.deadline === '긴급' ? <b style={{ color: '#dc2626' }}>긴급</b> : r.deadline}</td>
        <td style={{ textAlign: 'center' }}>
          <button className="btn-sm" style={{ fontSize: 11, padding: '1px 7px', color: attCount ? '#1A2B52' : '#bbb' }} title="첨부파일 보기/다운로드" onClick={onOpenAttach}>📎 {attCount || ''}</button>
        </td>
        <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{r.sentDate ? r.sentDate.replace(/-/g, '.') : <span style={{ color: '#CCC' }}>—</span>}</td>
        <td><TrackingLink no={r.trackingNo} /></td>
        <td>
          {!canProcess ? (
            <span style={{ color: '#bbb', fontSize: 11 }}>조회전용</span>
          ) : (
            <>
              {r.status === '미접수' && (
                <button className="btn-sm btn-p" style={{ fontSize: 11, padding: '2px 8px' }} onClick={onStart}>▶ 처리 시작</button>
              )}
              {r.status === '진행중' && (
                <button className="btn-sm btn-sm-blue" style={{ fontSize: 11 }} onClick={onToggle}>{open ? '접기' : '✏️ 처리'}</button>
              )}
              {isPost && (
                <button className="btn-sm btn-sm-blue" style={{ fontSize: 11 }} onClick={onToggle} title="반송·재발송완료 등 후속 처리">{open ? '접기' : '✏️ 상태'}</button>
              )}
            </>
          )}
        </td>
      </tr>
      {open && canProcess && r.status === '진행중' && (
        <tr>
          <td colSpan={14} style={{ background: '#EEF6FF' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', padding: '4px 2px' }}>
              <div className="frow" style={{ minWidth: 170 }}>
                <span className="fl">발송일<span className="req">*</span></span>
                <input type="date" value={sentDate} onChange={(e) => setSentDate(e.target.value)} />
              </div>
              <div className="frow" style={{ minWidth: 220 }}>
                <span className="fl">등기번호 <span style={{ color: '#888', fontWeight: 400 }}>(등기인 경우)</span></span>
                <input value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} placeholder="예: 1234567890123" />
              </div>
              <button className="btn-sm btn-sm-blue" onClick={() => onSaveProgress(sentDate, trackingNo)}>💾 저장(진행중 유지)</button>
              <button className="btn-p" onClick={() => onComplete(sentDate, trackingNo)}>✅ 완료(발송완료)</button>
              <button className="btn-sm" onClick={() => onRevert('미접수')} title="요청자가 다시 수정·삭제할 수 있도록 미접수로 되돌립니다">↩ 미접수로</button>
            </div>
          </td>
        </tr>
      )}
      {open && canProcess && isPost && (
        <tr>
          <td colSpan={14} style={{ background: '#FEF9F3' }}>
            <div style={{ padding: '4px 2px' }}>
              <div style={{ fontSize: 11, color: '#8a5a00', marginBottom: 6 }}>
                발송완료 이후 <b>반송</b>(수취 실패 등) 또는 <b>재발송완료</b>로 후속 처리할 수 있습니다. 사유를 남겨 두면 현황에서 함께 확인됩니다.
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="frow" style={{ flex: '1 1 340px', minWidth: 240 }}>
                  <span className="fl">사유 <span style={{ color: '#888', fontWeight: 400 }}>(반송 시 필수)</span></span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 수취인 부재로 반송 / 주소 보완 후 재발송" />
                </div>
                <button className="btn-sm btn-sm-del" onClick={() => onChangeStatus('반송', note)}>↪ 반송</button>
                <button className="btn-p" onClick={() => onChangeStatus('재발송완료', note)}>✅ 재발송완료</button>
                <button className="btn-sm" onClick={() => onRevert('진행중')} title="진행중으로 되돌리기">↩ 진행중으로</button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
