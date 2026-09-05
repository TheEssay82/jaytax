// 문서발송 › 발송요청 처리 — 권한자(최고관리자·기장팀장·기장팀원)가 발송 상태·발송일·등기번호를 처리
// 흐름: 미접수 → (처리 시작) 진행중 → 발송일 입력·완료 → 발송완료. 등기번호는 우체국 조회 딥링크.
import { useEffect, useMemo, useState } from 'react';
import { Grid, useGrid, type GridCol } from '../billing/grid';
import { ColumnSettings } from '../clients/tableKit';
import Empty from '../common/Empty';
import { todayYmd } from '../../lib/format';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/roles';
import {
  listSendRequests,
  listAttachments,
  setProcessing,
  cancelRequest,
  isCanceled,
  type SendRequest,
  type SendAttachment,
} from '../../lib/docSendApi';
import AttachmentsModal from './AttachmentsModal';
import TrackingLink from './TrackingLink';

const statusStyle = (s: string): React.CSSProperties => {
  if (s === '발송완료') return { background: '#D1FAE5', color: '#065F46' };
  if (s === '재발송완료') return { background: '#CFFAFE', color: '#155E75' };
  if (s === '반송') return { background: '#FEE2E2', color: 'var(--bad)' };
  if (s === '재발송요청') return { background: '#FEF3C7', color: 'var(--warn)' };
  if (s === '취소') return { background: '#E5E7EB', color: 'var(--ink-3)' };
  if (s === '진행중') return { background: '#DBEAFE', color: '#1E40AF' };
  return { background: '#F3F4F6', color: 'var(--ink-3)' };
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

  const [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    await load();
    setBusy(false);
  }

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(''), 2500);
  }

  const counts = useMemo(() => ({
    미접수: reqs.filter((r) => r.status === '미접수').length,
    진행중: reqs.filter((r) => r.status === '진행중').length,
    재발송요청: reqs.filter((r) => r.status === '재발송요청').length,
    발송완료: reqs.filter((r) => r.status === '발송완료').length,
    반송: reqs.filter((r) => r.status === '반송').length,
  }), [reqs]);

  const view = useMemo(() => {
    let list = reqs.filter((r) => !isCanceled(r.status));            // 취소 건은 처리 대상이 아니다
    list = list.filter((r) => (showDone ? true : !isClosed(r.status))); // 반송은 항상 표시(후속조치 필요)
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter((r) =>
        [r.companyName, r.recipientName, r.docName, r.sendKind, r.requester, r.trackingNo].some((v) => (v || '').toLowerCase().includes(s)),
      );
    }
    // 처리 우선순위: 미접수 → 진행중 → 반송(후속) → 발송완료 → 재발송완료, 긴급 먼저, 의뢰일자 순
    const order: Record<string, number> = { 미접수: 0, 재발송요청: 1, 진행중: 2, 반송: 3, 발송완료: 4, 재발송완료: 5 };
    const rank = (r: SendRequest) => order[r.status] ?? 5;
    return [...list].sort((a, b) => rank(a) - rank(b) || (a.deadline === '긴급' ? -1 : 0) - (b.deadline === '긴급' ? -1 : 0) || a.requestDate.localeCompare(b.requestDate));
  }, [reqs, q, showDone]);

  const attCount = (r: SendRequest) => (r.batchId ? (attByBatch[r.batchId]?.length ?? 0) : 0);

  // ── 일괄처리 ────────────────────────────────────────────────
  // 한 문서를 여러 수신자에게 보낸 건(같은 batch_id)을 한 번에 처리하기 위한 다중선택.
  // 등기번호는 건마다 달라서 일괄 대상이 아니고, 발송일만 공통으로 찍는다.
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkDate, setBulkDate] = useState(todayYmd());
  const [bulkBusy, setBulkBusy] = useState(false);

  const toggleSel = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  /** 같은 배치(동일 문서·동일 요청) 전체를 한 번에 선택/해제 */
  const toggleBatch = (batchId: string | null) => {
    if (!batchId) return;
    const ids = view.filter((r) => r.batchId === batchId).map((r) => r.id);
    setSel((s) => {
      const n = new Set(s);
      const allOn = ids.every((i) => n.has(i));
      ids.forEach((i) => (allOn ? n.delete(i) : n.add(i)));
      return n;
    });
  };

  const selected = useMemo(() => view.filter((r) => sel.has(r.id)), [view, sel]);
  const selStartable = selected.filter((r) => r.status === '미접수');
  const selCompletable = selected.filter((r) => r.status === '진행중' || r.status === '재발송요청');

  /** 선택 건에 같은 작업을 순차 적용. 일부 실패해도 나머지는 진행하고 결과를 요약한다. */
  /** 열 필터의 상태 후보 — 지금 자료에 있는 값에서 뽑는다. */
  const statusOpts = useMemo(
    () => [...new Set(view.map((r) => r.status).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')),
    [view],
  );

  // 표는 Grid 한 부품으로 그린다 — 정렬·열 필터·열 숨김/순서·너비가 함께 온다.
  // 처리 상자(발송일·등기번호 / 반송·재발송)는 부품의 detail 로 줄 아래에 편다.
  const cols: GridCol<SendRequest>[] = useMemo(() => [
    { key: 'status', label: '상태', width: 92, value: (r) => r.status, opts: statusOpts, wrap: true,
      cell: (r) => (
        <>
          <span className="bdg" style={{ fontSize: 'var(--fs-0)', ...statusStyle(r.status) }}>{r.status}</span>
          {r.statusNote && (
            <div style={{ fontSize: 'var(--fs-0)', color: 'var(--bad)', marginTop: 2 }} title={r.statusNote}>{r.statusNote}</div>
          )}
        </>
      ) },
    { key: 'requestDate', label: '의뢰일자', width: 84, value: (r) => r.requestDate ?? '',
      cell: (r) => r.requestDate?.replace(/-/g, '.') ?? '' },
    { key: 'requester', label: '의뢰인', width: 76, value: (r) => r.requester },
    // 발송담당자가 봉투를 쓸 수 있도록 주소·연락처를 함께 보여준다 — 이 화면의 핵심 정보다.
    { key: 'company', label: '거래처 · 수신자', width: 250, wrap: true,
      value: (r) => `${r.companyName}${r.recipientName ? ` ${r.recipientName}` : ''}`,
      cell: (r) => (
        <>
          <b style={{ color: 'var(--navy)' }}>{r.companyName}</b>
          {r.recipientName && <span style={{ color: 'var(--ink-2)' }}> · {r.recipientName} {r.recipientTitle}</span>}
          {r.address ? (
            <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink)', marginTop: 2, whiteSpace: 'pre-wrap', lineHeight: 1.35 }}>
              📮 {r.address}
              {r.phone && <span style={{ color: 'var(--ink-3)' }}>　☎ {r.phone}</span>}
            </div>
          ) : (
            r.workType === '퀵서비스' && (
              <div style={{ fontSize: 'var(--fs-0)', color: '#b45309', marginTop: 2 }}>⚠️ 주소 미입력</div>
            )
          )}
        </>
      ) },
    { key: 'workType', label: '업무구분', width: 88, value: (r) => r.workType },
    { key: 'sendKind', label: '송부종류', width: 88, value: (r) => r.sendKind },
    { key: 'docName', label: '문서명', width: 180, wrap: true, value: (r) => r.docName ?? '',
      cell: (r) => (
        <span title={r.docName || undefined}>
          {r.docName || <span style={{ color: 'var(--ink-4)' }}>—</span>}
          {r.etcRequest && (
            <div style={{ fontSize: 'var(--fs-0)', color: '#8a5a00', marginTop: 2, whiteSpace: 'pre-wrap' }} title="기타요청사항">📝 {r.etcRequest}</div>
          )}
        </span>
      ) },
    { key: 'copies', label: '부수', width: 50, num: true, value: (r) => r.copies },
    { key: 'seal', label: '날인', width: 50, value: (r) => (r.sealRequired ? '필요' : ''),
      style: { textAlign: 'center' }, cell: (r) => (r.sealRequired ? '🔖' : '—') },
    { key: 'deadline', label: '기한', width: 62, value: (r) => r.deadline ?? '',
      style: { textAlign: 'center' },
      cell: (r) => (r.deadline === '긴급' ? <b style={{ color: 'var(--bad)' }}>긴급</b> : r.deadline) },
    { key: 'att', label: '첨부', width: 54, value: (r) => attCount(r) || '',
      style: { textAlign: 'center' },
      cell: (r) => (
        <button className="btn-sm" style={{ fontSize: 'var(--fs-1)', padding: '1px 7px', color: attCount(r) ? 'var(--navy)' : 'var(--ink-4)' }}
          title="첨부파일 보기/다운로드" onClick={(e) => { e.stopPropagation(); setAttachFor(r); }}>📎 {attCount(r) || ''}</button>
      ) },
    { key: 'sentDate', label: '발송일', width: 84, value: (r) => r.sentDate ?? '',
      cell: (r) => (r.sentDate ? r.sentDate.replace(/-/g, '.') : <span style={{ color: 'var(--ink-4)' }}>—</span>) },
    { key: 'tracking', label: '등기번호', width: 130, value: (r) => r.trackingNo ?? '',
      cell: (r) => <TrackingLink no={r.trackingNo} /> },
    { key: 'act', label: '처리', width: 150, value: () => '', wrap: true,
      cell: (r) => {
        const isPost = r.status === '발송완료' || r.status === '반송' || r.status === '재발송완료';
        const isActive = r.status === '진행중' || r.status === '재발송요청';
        const open = openId === r.id;
        if (!canProcess) return <span style={{ color: 'var(--ink-4)', fontSize: 'var(--fs-1)' }}>조회전용</span>;
        return (
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {r.status === '미접수' && (
              <button className="btn-sm btn-p" style={{ fontSize: 'var(--fs-1)', padding: '2px 8px' }}
                onClick={() => void startProcessing(r)}>▶ 처리 시작</button>
            )}
            {(isActive || isPost) && (
              <button className="btn-sm btn-sm-blue" style={{ fontSize: 'var(--fs-1)' }}
                title={isPost ? '반송·재발송완료 등 후속 처리' : undefined}
                onClick={() => setOpenId((id) => (id === r.id ? null : r.id))}>
                {open ? '접기' : isPost ? '✏️ 상태' : '✏️ 처리'}
              </button>
            )}
            {r.status !== '취소' && (
              <button className="btn-sm" style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)' }}
                onClick={() => void cancel(r)}
                title="필요 없어진 요청을 취소합니다(기록은 남고 대기열에서 빠집니다)">🚫 취소</button>
            )}
          </div>
        );
      } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [statusOpts, attByBatch, canProcess, openId]);
  const grid = useGrid('docsend-process', cols, view, { key: 'requestDate', dir: 'asc' });
  const tblH = Math.max(260, Math.round(window.innerHeight * 0.52));

  async function runBulk(targets: SendRequest[], job: (r: SendRequest) => Promise<void>, label: string) {
    if (!targets.length) return;
    setBulkBusy(true);
    let ok = 0;
    const fails: string[] = [];
    for (const r of targets) {
      try {
        await job(r);
        ok++;
      } catch (e) {
        fails.push(`${r.companyName}: ${e instanceof Error ? e.message : e}`);
      }
    }
    await load();
    setSel(new Set());
    setBulkBusy(false);
    flash(fails.length ? `${label} ${ok}건 완료, ${fails.length}건 실패 — ${fails[0]}` : `${label} ${ok}건 완료`);
  }

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
      const to = r.status === '재발송요청' ? '재발송완료' : '발송완료';
      await setProcessing(r.id, { status: to, sentDate, trackingNo });
      await load();
      setOpenId(null);
      flash(r.status === '재발송요청' ? '✅ 재발송완료 처리' : '✅ 발송완료 처리');
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
  /** 요청 취소 — 처리 시작 후에도 무를 수 있다(사유 필수). 기록은 남고 대기열에서만 빠진다. */
  async function cancel(r: SendRequest) {
    const reason = prompt(`‘${r.companyName}’ 발송요청을 취소합니다.
취소 사유를 입력하세요.`, '');
    if (reason === null) return;
    if (!reason.trim()) { alert('취소 사유를 입력해야 합니다.'); return; }
    try {
      await cancelRequest(r.id, reason);
      await load();
      setOpenId(null);
      flash('🚫 취소 처리');
    } catch (e) {
      alert('취소 실패: ' + (e instanceof Error ? e.message : e));
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
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>불러오는 중…</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="chdr">
        발송요청 처리
        <span style={{ marginLeft: 10, fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
          미접수 {counts.미접수} · 진행중 {counts.진행중} · 발송완료 {counts.발송완료}
          {counts.반송 > 0 && <span style={{ color: 'var(--bad)', fontWeight: 700 }}> · 반송 {counts.반송}</span>}
          {counts.재발송요청 > 0 && <span style={{ color: 'var(--warn)', fontWeight: 700 }}> · 재발송요청 {counts.재발송요청}</span>}
        </span>
        {msg && <span style={{ marginLeft: 12, fontSize: 'var(--fs-1)', color: '#059669' }}>{msg}</span>}
      </div>

      {error && <div className="alert-w">{error}</div>}
      {canProcess ? (
        <div className="alert-i" style={{ fontSize: 'var(--fs-1)' }}>
          🖨️ 요청된 발송 건이 여기 모입니다. <b>‘처리 시작’</b>을 누르면 상태가 <b>진행중</b>으로 바뀝니다. 발송일(등기면 등기번호)을 입력하고 <b>‘완료’</b>를 누르면 <b>발송완료</b>됩니다. 발송완료 후에는 <b>반송·재발송완료</b>(사유 기재)로 후속 처리할 수 있습니다. 반송 건은 <b>요청자가 ‘재발송요청’</b>을 올리면 다시 대기열 상단에 나타나며, 발송일·등기번호를 입력해 <b>재발송완료</b>로 마감합니다. 등기번호를 클릭하면 우체국 배달조회가 새 창으로 열립니다. <b style={{ color: '#8a5a00' }}>잘못 처리한 건을 되돌리려면 아래 ‘발송완료 포함’을 켜면 나타납니다</b>(되돌리기·취소 가능).
        </div>
      ) : (
        <div className="alert-i" style={{ fontSize: 'var(--fs-1)' }}>
          👁️ <b>조회 전용</b>입니다(회계사). 발송 진행현황을 열람할 수 있으며, 상태 변경 등 처리는 최고관리자·기장팀장·기장팀원만 가능합니다.
        </div>
      )}

      <div className="sbar">
        <input placeholder="🔍 거래처·수신자·문서명·등기번호" value={q} onChange={(e) => setQ(e.target.value)} />
        <label style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          발송완료 포함 (되돌리기·취소하려면 켜세요)
        </label>
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>{view.length}건</span>
        <button className="btn-sm" style={{ fontSize: 'var(--fs-1)', padding: '2px 8px' }} onClick={() => void refresh()} disabled={busy} title="최신 내역을 다시 불러옵니다">
          {busy ? '⏳' : '🔄'} 새로고침
        </button>
      </div>

      {/* 일괄처리 바 — 선택이 있을 때만 나타난다 */}
      {canProcess && selected.length > 0 && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            background: '#EEF6FF', border: '1px solid #BFD4F2', borderRadius: 8,
            padding: '8px 12px', marginBottom: 8,
          }}
        >
          <b style={{ fontSize: 'var(--fs-2)', color: 'var(--navy)' }}>☑ {selected.length}건 선택</b>
          <button className="btn-sm" style={{ fontSize: 'var(--fs-1)' }} onClick={() => setSel(new Set())} disabled={bulkBusy}>
            선택해제
          </button>

          <span style={{ width: 1, height: 18, background: '#BFD4F2' }} />

          <button
            className="btn-sm btn-p"
            style={{ fontSize: 'var(--fs-1)' }}
            disabled={bulkBusy || selStartable.length === 0}
            title="선택한 미접수 건을 한 번에 진행중으로 바꿉니다"
            onClick={() => void runBulk(selStartable, (r) => setProcessing(r.id, { status: '진행중' }), '처리 시작')}
          >
            ▶ 처리 시작 {selStartable.length > 0 && `(${selStartable.length})`}
          </button>

          <span style={{ width: 1, height: 18, background: '#BFD4F2' }} />

          <label style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 4 }}>
            발송일
            <input type="date" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} style={{ fontSize: 'var(--fs-2)' }} />
          </label>
          <button
            className="btn-p"
            style={{ fontSize: 'var(--fs-1)' }}
            disabled={bulkBusy || selCompletable.length === 0 || !bulkDate}
            title="선택한 진행중·재발송요청 건을 이 발송일로 한 번에 완료 처리합니다 (등기번호는 건별로 입력)"
            onClick={() =>
              void runBulk(
                selCompletable,
                (r) => setProcessing(r.id, { status: r.status === '재발송요청' ? '재발송완료' : '발송완료', sentDate: bulkDate }),
                '완료',
              )
            }
          >
            ✅ 완료 {selCompletable.length > 0 && `(${selCompletable.length})`}
          </button>

          {bulkBusy && <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>처리 중…</span>}
          <span style={{ fontSize: 'var(--fs-0)', color: '#8a5a00', marginLeft: 'auto' }}>
            ⚠️ 등기번호는 건마다 달라 일괄 입력되지 않습니다 — 각 행에서 개별 입력하세요.
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginBottom: 5 }}>
        {grid.filterCount > 0 && (
          <button className="btn-sm" onClick={grid.clearFilters}>열 필터 지우기 ({grid.filterCount})</button>
        )}
        <ColumnSettings cols={grid.ordered} view={grid.view} />
      </div>

      <Grid grid={grid} rowKey={(r) => r.id} maxHeight={tblH}
        rowStyle={(r) => (sel.has(r.id) ? { background: '#F3F8FF' } : {})}
        select={canProcess ? {
          picked: sel,
          toggle: (k) => toggleSel(k),
          shiftToggle: (r) => toggleBatch(r.batchId),
          shiftHint: '일괄처리 선택 (Shift+클릭: 같은 문서의 수신자 전체)',
          selectableKeys: grid.rowsView.map((r) => r.id),
          setAll: (keys) => setSel(new Set(keys ?? [])),
        } : undefined}
        detail={{
          isOpen: (r) => openId === r.id,
          render: (r) => (
            <ProcessBox r={r}
              onSaveProgress={(d, t) => void saveProgress(r, d, t)}
              onComplete={(d, t) => void complete(r, d, t)}
              onRevert={(to) => void revert(r, to)}
              onChangeStatus={(to, note) => void changeStatus(r, to, note)} />
          ),
        }}
        empty={<Empty text="처리할 발송요청이 없습니다"
          hint={grid.filterCount > 0 ? '열 아래 칸에 넣은 값으로 걸러서 비었습니다.' : '요청이 올라오면 여기 쌓입니다.'}
          action={grid.filterCount > 0 ? { label: '열 필터 지우기', onClick: grid.clearFilters } : undefined} />} />

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
/**
 * 줄 아래에 펴는 처리 상자.
 *  · 진행중·재발송요청 → 발송일·등기번호를 넣고 마감
 *  · 발송완료·반송·재발송완료 → 사유를 남기고 후속 처리
 * 표의 열 수는 부품(Grid)이 맞추므로 여기서는 내용만 그린다.
 */
function ProcessBox({ r, onSaveProgress, onComplete, onRevert, onChangeStatus }: {
  r: SendRequest;
  onSaveProgress: (sentDate: string, trackingNo: string) => void;
  onComplete: (sentDate: string, trackingNo: string) => void;
  onRevert: (to: string) => void;
  onChangeStatus: (to: string, note: string) => void;
}) {
  const [sentDate, setSentDate] = useState(r.sentDate || todayYmd());
  const [trackingNo, setTrackingNo] = useState(r.trackingNo || '');
  const [note, setNote] = useState(r.statusNote || '');
  const isPost = r.status === '발송완료' || r.status === '반송' || r.status === '재발송완료';
  const isActive = r.status === '진행중' || r.status === '재발송요청';

  if (isActive) {
    return (
      <div style={{ background: '#EEF6FF', padding: '8px 10px' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="frow" style={{ minWidth: 170 }}>
            <span className="fl">발송일<span className="req">*</span></span>
            <input type="date" value={sentDate} onChange={(e) => setSentDate(e.target.value)} />
          </div>
          <div className="frow" style={{ minWidth: 220 }}>
            <span className="fl">등기번호 <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>(등기인 경우)</span></span>
            <input value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} placeholder="예: 1234567890123" />
          </div>
          <button className="btn-sm btn-sm-blue" onClick={() => onSaveProgress(sentDate, trackingNo)}>💾 저장(진행중 유지)</button>
          <button className="btn-p" onClick={() => onComplete(sentDate, trackingNo)}>
            {r.status === '재발송요청' ? '✅ 재발송완료' : '✅ 완료(발송완료)'}
          </button>
          <button className="btn-sm" onClick={() => onRevert('미접수')} title="요청자가 다시 수정·삭제할 수 있도록 미접수로 되돌립니다">↩ 미접수로</button>
        </div>
      </div>
    );
  }
  if (isPost) {
    return (
      <div style={{ background: '#FEF9F3', padding: '8px 10px' }}>
        <div style={{ fontSize: 'var(--fs-1)', color: '#8a5a00', marginBottom: 6 }}>
          발송완료 이후 <b>반송</b>(수취 실패 등) 또는 <b>재발송완료</b>로 후속 처리할 수 있습니다. 사유를 남겨 두면 현황에서 함께 확인됩니다.
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="frow" style={{ flex: '1 1 340px', minWidth: 240 }}>
            <span className="fl">사유 <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>(반송 시 필수)</span></span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 수취인 부재로 반송 / 주소 보완 후 재발송" />
          </div>
          <button className="btn-sm btn-sm-del" onClick={() => onChangeStatus('반송', note)}>↪ 반송</button>
          <button className="btn-p" onClick={() => onChangeStatus('재발송완료', note)}>✅ 재발송완료</button>
          <button className="btn-sm" onClick={() => onRevert('진행중')} title="진행중으로 되돌리기">↩ 진행중으로</button>
        </div>
      </div>
    );
  }
  return null;
}
