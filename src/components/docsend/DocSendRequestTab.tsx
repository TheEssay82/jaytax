// 문서발송 › 발송요청 — 공통 문서정보 + 수신자 다중선택(거래처관리 › 거래처담당자등록 연동, 스냅샷) 요청 등록/목록/수정
import { useEffect, useMemo, useRef, useState } from 'react';
import { Grid, useGrid, type GridCol } from '../billing/grid';
import { ColumnSettings } from '../clients/tableKit';
import Empty from '../common/Empty';
import { useEscape } from '../../lib/useEscape';
import { todayYmd } from '../../lib/format';
import { useAuth } from '../../context/AuthContext';
import { listDocClients, type DocClient, type DocContact } from '../../lib/docClientsApi';
import {
  listSendRequests,
  createSendRequests,
  updateSendRequest,
  deleteSendRequest,
  listTrashedSendRequests,
  restoreSendRequest,
  hardDeleteSendRequest,
  listAttachments,
  uploadSendFile,
  addAttachmentRecords,
  ATTACH_ACCEPT,
  WORK_TYPES,
  SEND_KINDS,
  DEADLINES,
  SEND_STATUS,
  POST_SEND_STATUS,
  DOC_REQUESTERS,
  requestResend,
  cancelRequest,
  type SendRequest,
  type SendCommon,
  type SendRecipient,
  type SendAttachment,
} from '../../lib/docSendApi';
import { listAuditLog, auditChanges, type DocAudit } from '../../lib/docClientsApi';
import AttachmentsModal, { fmtSize } from './AttachmentsModal';
import TrackingLink from './TrackingLink';

const dtTime = (s?: string): string => {
  if (!s) return '';
  const d = new Date(s);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const statusStyle = (s: string): React.CSSProperties => {
  if (s === '발송완료') return { background: '#D1FAE5', color: '#065F46' };
  if (s === '재발송완료') return { background: '#CFFAFE', color: '#155E75' };
  if (s === '반송') return { background: '#FEE2E2', color: 'var(--bad)' };
  if (s === '재발송요청') return { background: '#FEF3C7', color: 'var(--warn)' };
  if (s === '취소') return { background: '#E5E7EB', color: 'var(--ink-3)' };
  if (s === '진행중') return { background: '#DBEAFE', color: '#1E40AF' };
  return { background: '#F3F4F6', color: 'var(--ink-3)' }; // 미접수
};

const emptyCommon = (requester: string): SendCommon => ({
  requestDate: todayYmd(),
  requester,
  workType: WORK_TYPES[0],
  sendKind: SEND_KINDS[0],
  docName: '',
  copies: 1,
  sealRequired: false,
  deadline: '보통',
  etcRequest: '',
});

export default function DocSendRequestTab() {
  const { readonly, profileName, user, role } = useAuth();
  const isSuper = role === 'superuser';   // 테스트·오등록 정리용 삭제 권한
  const canWrite = !readonly;
  const defaultRequester = (DOC_REQUESTERS as readonly string[]).includes(profileName) ? profileName : DOC_REQUESTERS[0];

  const [reqs, setReqs] = useState<SendRequest[]>([]);
  const [clients, setClients] = useState<DocClient[]>([]);
  const [attByBatch, setAttByBatch] = useState<Record<string, SendAttachment[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const [q, setQ] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [logRows, setLogRows] = useState<DocAudit[]>([]);
  const [attachFor, setAttachFor] = useState<SendRequest | null>(null);
  const [resendFor, setResendFor] = useState<SendRequest | null>(null);

  /** 재발송요청은 원 요청자만 가능(서버 가드와 동일 기준) */
  const isMine = (r: SendRequest) => !!user?.id && (r.requesterId === user.id || r.createdBy === user.id);

  async function load() {
    try {
      setError(null);
      const [r, c, atts] = await Promise.all([listSendRequests(), listDocClients(), listAttachments()]);
      setReqs(r);
      setClients(c);
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

  // 기본은 최근 10건만(전체 현황은 '발송업무 현황'에서). 검색 시엔 편집·삭제를 위해 전체에서 찾는다.
  const searching = q.trim().length > 0;
  const view = useMemo(() => {
    if (searching) {
      const s = q.trim().toLowerCase();
      return reqs.filter((r) =>
        [r.companyName, r.recipientName, r.docName, r.sendKind, r.requester].some((v) => (v || '').toLowerCase().includes(s)),
      );
    }
    return reqs.slice(0, 10);
  }, [reqs, q, searching]);

  async function handleAdd(common: SendCommon, recipients: SendRecipient[], files: File[]) {
    try {
      const batchId = crypto.randomUUID();
      // 파일 먼저 업로드(실패 시 요청 미생성) → 요청 생성 → 첨부 메타 기록
      const metas = [];
      for (const f of files) metas.push(await uploadSendFile(batchId, f));
      const n = await createSendRequests(common, recipients, batchId);
      if (metas.length) await addAttachmentRecords(batchId, metas);
      setShowAdd(false);
      await load();
      flash(`✓ 발송요청 ${n}건 등록됨${metas.length ? ` · 첨부 ${metas.length}개` : ''}`);
    } catch (e) {
      alert('등록 실패: ' + (e instanceof Error ? e.message : e));
    }
  }
  async function handleSaveEdit(id: string, common: SendCommon, recipient: SendRecipient) {
    try {
      await updateSendRequest(id, { ...common, ...recipient });
      setEditId(null);
      await load();
      flash('✓ 수정됨');
    } catch (e) {
      alert('수정 실패: ' + (e instanceof Error ? e.message : e));
    }
  }
  /**
   * 요청 취소 — 처리가 시작된 뒤 잘못 처리했음을 알게 된 경우 여기서 바로 되돌린다.
   * (처리 화면은 완결건을 기본으로 숨겨서, 요청자가 취소하러 갈 곳이 없었다)
   */
  async function handleCancel(r: SendRequest) {
    const reason = prompt(
      `‘${r.companyName} · ${r.sendKind}’ 발송요청을 취소합니다.
` +
        `현재 상태: ${r.status}${r.trackingNo ? ` (등기 ${r.trackingNo})` : ''}

` +
        `취소 사유를 입력하세요.`,
      '',
    );
    if (reason === null) return;
    if (!reason.trim()) { alert('취소 사유를 입력해야 합니다.'); return; }
    try {
      await cancelRequest(r.id, reason);
      await load();
      flash('🚫 취소했습니다. 처리 대기열과 현황 집계에서 빠집니다.');
    } catch (e) {
      alert('취소 실패: ' + (e instanceof Error ? e.message : e));
    }
  }

  async function handleDelete(r: SendRequest) {
    const warn = `발송요청(${r.companyName} · ${r.sendKind})을 휴지통으로 옮기시겠습니까?\n\n`
      + `삭제해도 휴지통에서 복원할 수 있습니다.${r.status !== '미접수' ? `\n(상태: ${r.status}${r.trackingNo ? `, 등기 ${r.trackingNo}` : ''} — 실물 발송과 대응하는 기록일 수 있습니다.)` : ''}`;
    if (!confirm(warn)) return;
    try {
      await deleteSendRequest(r.id);
      await load();
      flash('✓ 휴지통으로 이동됨');
    } catch (e) {
      alert('삭제 실패: ' + (e instanceof Error ? e.message : e));
    }
  }

  // ── 휴지통 ──────────────────────────────────────────────
  const [showTrash, setShowTrash] = useState(false);
  const [trashRows, setTrashRows] = useState<SendRequest[]>([]);
  const [trashBusy, setTrashBusy] = useState(false);
  async function openTrash() {
    setShowTrash(true);
    try { setTrashRows(await listTrashedSendRequests()); }
    catch { setTrashRows([]); }
  }
  async function handleRestore(r: SendRequest) {
    setTrashBusy(true);
    try {
      await restoreSendRequest(r.id);
      setTrashRows((rows) => rows.filter((x) => x.id !== r.id));
      await load();
      flash('✓ 복원됨');
    } catch (e) { alert('복원 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setTrashBusy(false); }
  }
  async function handleHardDelete(r: SendRequest) {
    if (!confirm(`"${r.companyName} · ${r.docName || r.sendKind}"을(를) 영구삭제할까요?\n\n⚠️ 되돌릴 수 없습니다(첨부파일도 함께 삭제). 변경 로그에는 원본이 남습니다.`)) return;
    setTrashBusy(true);
    try {
      await hardDeleteSendRequest(r.id);
      setTrashRows((rows) => rows.filter((x) => x.id !== r.id));
      flash('✓ 영구삭제됨');
    } catch (e) { alert('영구삭제 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setTrashBusy(false); }
  }
  async function openLog() {
    setShowLog(true);
    try {
      const all = await listAuditLog(300);
      setLogRows(all.filter((l) => l.entity === 'send_request'));
    } catch {
      setLogRows([]);
    }
  }

  // 기본 3단계는 항상, 후속상태(반송·재발송완료)는 건이 있을 때만 표시
  const counts = [...SEND_STATUS, ...POST_SEND_STATUS]
    .map((s) => ({ s, n: reqs.filter((r) => r.status === s).length }))
    .filter((c) => (SEND_STATUS as readonly string[]).includes(c.s) || c.n > 0);
  // batch_id 별 요청 수(묶음 배지는 2건 이상일 때만)
  const batchCounts: Record<string, number> = {};
  for (const r of reqs) if (r.batchId) batchCounts[r.batchId] = (batchCounts[r.batchId] || 0) + 1;
  const attCount = (r: SendRequest) => (r.batchId ? (attByBatch[r.batchId]?.length ?? 0) : 0);

  /** 열 필터의 상태 후보 — 지금 자료에 있는 값에서 뽑는다. */
  const statusOpts = useMemo(
    () => [...new Set(view.map((r) => r.status).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')),
    [view],
  );

  // 표는 Grid 한 부품으로 그린다 — 정렬·열 필터·열 숨김/순서·너비가 함께 온다.
  // 「수정」을 누르면 그 줄이 통째로 폼으로 바뀐다(부품의 replace).
  const cols: GridCol<SendRequest>[] = useMemo(() => [
    { key: 'requestDate', label: '의뢰일자', width: 84, value: (r) => r.requestDate ?? '',
      cell: (r) => r.requestDate?.replace(/-/g, '.') ?? '' },
    { key: 'requester', label: '의뢰인', width: 76, value: (r) => r.requester },
    { key: 'company', label: '거래처 · 수신자', width: 210, wrap: true,
      value: (r) => `${r.companyName}${r.recipientName ? ` ${r.recipientName}` : ''}`,
      cell: (r) => (
        <>
          <b style={{ color: 'var(--navy)' }}>{r.companyName}</b>
          {r.recipientName && <span style={{ color: 'var(--ink-2)' }}> · {r.recipientName} {r.recipientTitle}</span>}
          {r.batchId && batchCounts[r.batchId] > 1 && (
            <span className="bdg b-on" style={{ marginLeft: 5, fontSize: 9 }} title="여러 수신자 묶음">묶음 {batchCounts[r.batchId]}</span>
          )}
        </>
      ) },
    { key: 'workType', label: '업무구분', width: 88, value: (r) => r.workType },
    { key: 'sendKind', label: '송부종류', width: 88, value: (r) => r.sendKind },
    { key: 'docName', label: '문서명', width: 180, value: (r) => r.docName ?? '',
      cell: (r) => <span title={r.docName || undefined}>{r.docName || <span style={{ color: 'var(--ink-4)' }}>—</span>}</span> },
    { key: 'copies', label: '부수', width: 50, num: true, value: (r) => r.copies },
    { key: 'seal', label: '날인', width: 66, value: (r) => (r.sealRequired ? '날인요' : ''),
      style: { textAlign: 'center' }, cell: (r) => (r.sealRequired ? '🔖 날인요' : '—') },
    { key: 'deadline', label: '기한', width: 62, value: (r) => r.deadline ?? '',
      style: { textAlign: 'center' },
      cell: (r) => (r.deadline === '긴급' ? <b style={{ color: 'var(--bad)' }}>긴급</b> : r.deadline) },
    { key: 'att', label: '첨부', width: 54, value: (r) => attCount(r) || '',
      style: { textAlign: 'center' },
      cell: (r) => (
        <button className="btn-sm" style={{ fontSize: 'var(--fs-1)', padding: '1px 7px', color: attCount(r) ? 'var(--navy)' : 'var(--ink-4)' }}
          title={attCount(r) ? '첨부파일 보기/다운로드' : '첨부 없음 (클릭해 추가)'}
          onClick={() => setAttachFor(r)}>📎 {attCount(r) || ''}</button>
      ) },
    { key: 'sentDate', label: '발송일', width: 84, value: (r) => r.sentDate ?? '',
      style: { textAlign: 'center' },
      cell: (r) => (r.sentDate ? r.sentDate.replace(/-/g, '.') : <span style={{ color: 'var(--ink-4)' }}>—</span>) },
    { key: 'tracking', label: '등기번호', width: 130, value: (r) => r.trackingNo ?? '',
      style: { textAlign: 'center' }, cell: (r) => <TrackingLink no={r.trackingNo} /> },
    { key: 'status', label: '상태', width: 96, value: (r) => r.status, opts: statusOpts, wrap: true,
      style: { textAlign: 'center' },
      cell: (r) => (
        <>
          <span className="bdg" style={{ fontSize: 'var(--fs-0)', ...statusStyle(r.status) }}>{r.status}</span>
          {r.statusNote && (
            <div style={{ fontSize: 'var(--fs-0)', color: 'var(--bad)', marginTop: 2 }} title={`사유: ${r.statusNote}`}>{r.statusNote}</div>
          )}
        </>
      ) },
    ...(canWrite ? [{
      key: 'act', label: '관리', width: 86, value: () => '', wrap: true,
      cell: (r: SendRequest) => {
        if (r.status === '미접수') {
          return (
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn-sm btn-sm-blue" title="수정" onClick={() => { setEditId(r.id); setShowAdd(false); }}>✏️</button>
              <button className="btn-sm btn-sm-del" title="삭제" onClick={() => handleDelete(r)}>🗑</button>
            </div>
          );
        }
        if (r.status === '반송' && isMine(r)) {
          return (
            <button className="btn-sm"
              style={{ fontSize: 'var(--fs-0)', padding: '2px 6px', background: '#FEF3C7', color: 'var(--warn)', fontWeight: 700 }}
              title="주소 등을 확인한 뒤 재발송을 요청합니다"
              onClick={() => setResendFor(r)}>🔄 재발송요청</button>
          );
        }
        if (r.status !== '취소') {
          return (
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn-sm" style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)' }}
                title="필요 없어졌거나 잘못 처리된 요청을 취소합니다(기록은 남습니다)"
                onClick={() => void handleCancel(r)}>🚫</button>
              {isSuper && (
                <button className="btn-sm btn-sm-del"
                  title="최고관리자 삭제 — 처리 이력이 있는 건입니다(이력에는 원본이 남습니다)"
                  onClick={() => handleDelete(r)}>🗑</button>
              )}
            </div>
          );
        }
        // 취소된 건 — 최고관리자만 완전 삭제 가능
        return (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-4)' }}>취소됨</span>
            {isSuper && (
              <button className="btn-sm btn-sm-del" title="최고관리자 삭제 (이력에는 원본이 남습니다)"
                onClick={() => handleDelete(r)}>🗑</button>
            )}
          </div>
        );
      },
    } as GridCol<SendRequest>] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [statusOpts, attByBatch, canWrite, isSuper, batchCounts]);
  // 고치는 중에는 정렬·필터를 잠근다 — 바꾸면 고치던 줄이 화면 밖으로 밀려난다.
  const grid = useGrid('docsend-request', cols, view, { key: 'requestDate', dir: 'desc' }, !!editId);
  const tblH = Math.max(260, Math.round(window.innerHeight * 0.52));

  if (loading) {
    return (
      <div className="card">
        <div className="chdr">✉️ 발송요청</div>
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>불러오는 중…</div>
      </div>
    );
  }



  return (
    <div className="card">
      <div className="chdr">
        발송요청 (총 {reqs.length}건)
        <span style={{ marginLeft: 10, fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
          {counts.map((c) => `${c.s} ${c.n}`).join(' · ')}
        </span>
        {msg && <span style={{ marginLeft: 12, fontSize: 'var(--fs-1)', color: '#059669' }}>{msg}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 5, alignItems: 'center' }}>
          <button className="btn-sm btn-sm-blue" onClick={openLog}>📜 변경 로그</button>
          {isSuper && <button className="btn-sm" onClick={openTrash} title="삭제된(휴지통) 발송요청 복원">🗑 휴지통</button>}
          <button className="btn-sm" style={{ fontSize: 'var(--fs-1)', padding: '2px 8px' }} onClick={() => void refresh()} disabled={busy} title="최신 내역을 다시 불러옵니다">{busy ? '⏳' : '🔄'} 새로고침</button>
          {canWrite && (
            <button className="btn-sm" onClick={() => { setShowAdd((v) => !v); setEditId(null); }}>
              + 새 발송요청
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert-w">{error}</div>}
      <div className="alert-i" style={{ fontSize: 'var(--fs-1)' }}>
        ✉️ 거래처 담당자를 선택하면 회사명·주소·연락처가 <b>그 시점 값으로 저장(스냅샷)</b>되어, 이후 담당자 정보가 바뀌어도 과거 요청은 유지됩니다. 한 문서를 <b>여러 수신자</b>에게 한 번에 요청할 수 있습니다. 처리 전 <b>‘미접수’</b> 건만 수정·삭제할 수 있습니다. <b style={{ color: '#b45309' }}>⚡ 업무구분이 ‘퀵서비스’면 수신자 연락처가 필수</b>입니다.
        {!canWrite && <span style={{ color: '#8a5a00' }}> · 🔒 읽기전용 계정은 조회만 가능합니다.</span>}
      </div>

      {showAdd && canWrite && (
        <AddRequestForm clients={clients} defaultRequester={defaultRequester} onSubmit={handleAdd} onCancel={() => setShowAdd(false)} />
      )}

      <div className="sbar">
        <input placeholder="🔍 거래처·수신자·문서명·송부종류·의뢰인 (전체에서 검색)" value={q} onChange={(e) => setQ(e.target.value)} />
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
          {searching ? `${view.length}건 검색됨` : `최근 ${view.length}건 표시`}
        </span>
        {!searching && (
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>· 전체 내역·처리현황은 ‘발송업무 현황’에서</span>
        )}
        <span style={{ display: 'inline-flex', gap: 4, marginLeft: 'auto' }}>
          {grid.filterCount > 0 && (
            <button className="btn-sm" onClick={grid.clearFilters} disabled={!!editId}>열 필터 지우기 ({grid.filterCount})</button>
          )}
          <ColumnSettings cols={grid.ordered} view={grid.view} onMessage={flash} />
        </span>
      </div>

      {editId && (
        // 고치는 중에는 줄이 밀려나면 안 된다 — 정렬·필터를 바꾸면 그 줄이 화면 밖으로
        // 사라져 어디를 고치고 있었는지 잃는다. 그래서 잠그고 그 사실을 알린다.
        <div className="alert-w" style={{ fontSize: 'var(--fs-1)' }}>
          ✏️ <b>고치는 중입니다</b> — 저장하거나 취소할 때까지 정렬·열 필터는 잠깁니다.
        </div>
      )}

      <Grid grid={grid} rowKey={(r) => r.id} maxHeight={tblH}
        detail={{
          isOpen: () => false,
          render: () => null,
          replace: (r) => (editId === r.id ? (
            <div style={{ background: '#EEF6FF', padding: '6px 8px' }}>
              <EditRequestForm req={r} clients={clients}
                onSave={(c, rc) => handleSaveEdit(r.id, c, rc)} onCancel={() => setEditId(null)} />
            </div>
          ) : null),
        }}
        empty={<Empty text="발송요청이 없습니다"
          hint={grid.filterCount > 0 ? '열 아래 칸에 넣은 값으로 걸러서 비었습니다.' : '＋ 새 발송요청으로 올립니다.'}
          action={grid.filterCount > 0 ? { label: '열 필터 지우기', onClick: grid.clearFilters } : undefined} />} />

      {resendFor && (
        <ResendModal
          req={resendFor}
          onClose={() => setResendFor(null)}
          onDone={async () => {
            setResendFor(null);
            await load();
            flash('재발송을 요청했습니다. 처리 담당자가 확인 후 재발송합니다.');
          }}
        />
      )}
      {showLog && <LogModal rows={logRows} onClose={() => setShowLog(false)} />}
      {showTrash && (
        <TrashModal rows={trashRows} busy={trashBusy} onRestore={handleRestore} onHardDelete={handleHardDelete} onClose={() => setShowTrash(false)} />
      )}
      {attachFor && (
        <AttachmentsModal
          req={attachFor}
          attachments={attachFor.batchId ? attByBatch[attachFor.batchId] ?? [] : []}
          shared={!!attachFor.batchId && batchCounts[attachFor.batchId] > 1}
          canWrite={canWrite}
          onClose={() => setAttachFor(null)}
          onChanged={async () => { await load(); }}
        />
      )}
    </div>
  );
}

// ── 공통 문서정보 입력 필드 ─────────────────────────────────
function CommonFields({ c, setC }: { c: SendCommon; setC: (patch: Partial<SendCommon>) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 14px' }}>
      <div className="frow">
        <span className="fl">의뢰일자<span className="req">*</span></span>
        <input type="date" value={c.requestDate} onChange={(e) => setC({ requestDate: e.target.value })} />
      </div>
      <div className="frow">
        <span className="fl">의뢰인<span className="req">*</span></span>
        <select value={c.requester} onChange={(e) => setC({ requester: e.target.value })} style={{ padding: '4px 7px', fontSize: 'var(--fs-2)' }}>
          {DOC_REQUESTERS.map((r) => <option key={r} value={r}>{r}</option>)}
          {!(DOC_REQUESTERS as readonly string[]).includes(c.requester) && <option value={c.requester}>{c.requester}</option>}
        </select>
      </div>
      <div className="frow">
        <span className="fl">업무구분<span className="req">*</span></span>
        <select value={c.workType} onChange={(e) => setC({ workType: e.target.value })} style={{ padding: '4px 7px', fontSize: 'var(--fs-2)' }}>
          {WORK_TYPES.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
      </div>
      <div className="frow">
        <span className="fl">송부종류<span className="req">*</span></span>
        <select value={c.sendKind} onChange={(e) => setC({ sendKind: e.target.value })} style={{ padding: '4px 7px', fontSize: 'var(--fs-2)' }}>
          {SEND_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>
      <div className="frow">
        <span className="fl">문서명</span>
        <input value={c.docName} onChange={(e) => setC({ docName: e.target.value })} placeholder="(선택) 예: PEF1호감사계약서" />
      </div>
      <div className="frow">
        <span className="fl">발송부수</span>
        <input type="number" min={1} value={c.copies} onChange={(e) => setC({ copies: Math.max(1, parseInt(e.target.value) || 1) })} />
      </div>
      <div className="frow">
        <span className="fl">날인필요</span>
        <select value={c.sealRequired ? 'Y' : 'N'} onChange={(e) => setC({ sealRequired: e.target.value === 'Y' })} style={{ padding: '4px 7px', fontSize: 'var(--fs-2)' }}>
          <option value="N">X (불필요)</option>
          <option value="Y">🔖 날인요</option>
        </select>
      </div>
      <div className="frow">
        <span className="fl">발송기한</span>
        <select value={c.deadline} onChange={(e) => setC({ deadline: e.target.value })} style={{ padding: '4px 7px', fontSize: 'var(--fs-2)' }}>
          {DEADLINES.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <div className="frow">
        <span className="fl">기타요청사항</span>
        <input value={c.etcRequest} onChange={(e) => setC({ etcRequest: e.target.value })} placeholder="(선택)" />
      </div>
    </div>
  );
}

// 거래처/담당자 → 수신자 스냅샷 헬퍼
function toRecipient(client: DocClient, contactId: string): SendRecipient | null {
  const ct = client.contacts.find((x) => x.id === contactId);
  if (!ct) return null;
  return {
    clientId: client.id,
    contactId: ct.id,
    companyName: client.companyName,
    recipientName: ct.contactName,
    recipientTitle: ct.honorific,
    address: ct.address,
    phone: ct.phone,
  };
}

// ── 담당자 검색(타입어헤드) — 담당자명/거래처명으로 필터, 클릭하면 선택 ─────
function ContactSearch({
  clients,
  excludeIds,
  onPick,
  onPickAll,
  placeholder,
}: {
  clients: DocClient[];
  excludeIds?: string[];
  onPick: (client: DocClient, contact: DocContact) => void;
  onPickAll?: (client: DocClient) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const ex = new Set(excludeIds || []);
    const out: { cl: DocClient; ct: DocContact }[] = [];
    for (const cl of clients) {
      for (const ct of cl.contacts) {
        if (ex.has(ct.id)) continue;
        if (ct.contactName.toLowerCase().includes(s) || cl.companyName.toLowerCase().includes(s)) {
          out.push({ cl, ct });
          if (out.length >= 50) return out;
        }
      }
    }
    return out;
  }, [q, clients, excludeIds]);
  // 검색 결과가 한 거래처로만 좁혀지면 '전체 담당자 추가' 제안
  const soleCompany = useMemo(() => {
    if (!onPickAll || matches.length < 2) return null;
    const ids = new Set(matches.map((m) => m.cl.id));
    return ids.size === 1 ? matches[0].cl : null;
  }, [matches, onPickAll]);

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 300, maxWidth: 560 }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder || '🔍 담당자명 또는 거래처명 입력…'} style={{ width: '100%' }} />
      {q.trim() && (
        <div style={{ position: 'absolute', zIndex: 50, top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--rule)', borderRadius: 6, maxHeight: 260, overflowY: 'auto', boxShadow: '0 6px 18px rgba(0,0,0,0.15)' }}>
          {matches.length === 0 && <div style={{ padding: 8, color: 'var(--ink-3)', fontSize: 'var(--fs-2)' }}>일치하는 담당자가 없습니다. 거래처관리 › 거래처담당자등록에서 먼저 등록해 주세요.</div>}
          {soleCompany && (
            <button
              type="button"
              onClick={() => { onPickAll!(soleCompany); setQ(''); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', border: 'none', borderBottom: '1px solid var(--rule)', background: '#F5F1EB', cursor: 'pointer', fontSize: 'var(--fs-2)', fontWeight: 700, color: '#345' }}
            >
              ＋ {soleCompany.companyName} 전체 담당자 추가 ({matches.length}명)
            </button>
          )}
          {matches.map(({ cl, ct }) => (
            <button
              key={ct.id}
              type="button"
              onClick={() => { onPick(cl, ct); setQ(''); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', border: 'none', borderBottom: '1px solid #F0ECE4', background: '#fff', cursor: 'pointer', fontSize: 'var(--fs-2)' }}
            >
              <b>{ct.contactName}</b> <span style={{ color: 'var(--ink-3)' }}>{ct.honorific}</span> · <span style={{ color: 'var(--navy)' }}>{cl.companyName}</span> <span style={{ color: 'var(--ink-4)', fontSize: 'var(--fs-1)' }}>({cl.accountant})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 새 발송요청 폼 (공통 + 수신자 다중) ─────────────────────
function AddRequestForm({
  clients,
  defaultRequester,
  onSubmit,
  onCancel,
}: {
  clients: DocClient[];
  defaultRequester: string;
  onSubmit: (common: SendCommon, recipients: SendRecipient[], files: File[]) => void;
  onCancel: () => void;
}) {
  const [c, setCState] = useState<SendCommon>(emptyCommon(defaultRequester));
  const docNameEdited = useRef(false);
  const setC = (patch: Partial<SendCommon>) => {
    if ('docName' in patch) docNameEdited.current = true; // 사용자가 문서명을 직접 손대면 자동채움 중단
    setCState((p) => ({ ...p, ...patch }));
  };
  const [recipients, setRecipients] = useState<SendRecipient[]>([]);
  const [files, setFiles] = useState<File[]>([]);

  // 문서명 자동 채움: (첫 수신자 거래처명) + (송부종류). 직접 수정 전까지만 자동 갱신.
  useEffect(() => {
    if (docNameEdited.current) return;
    const company = recipients[0]?.companyName;
    if (!company) return;
    setCState((p) => ({ ...p, docName: `${company} ${p.sendKind}` }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipients, c.sendKind]);

  function addContact(client: DocClient, contact: DocContact) {
    if (recipients.some((x) => x.contactId === contact.id)) return;
    const rc = toRecipient(client, contact.id);
    if (rc) setRecipients((p) => [...p, rc]);
  }
  function addAllContacts(client: DocClient) {
    const adds = client.contacts
      .map((ct) => toRecipient(client, ct.id))
      .filter((x): x is SendRecipient => !!x && !recipients.some((r) => r.contactId === x.contactId));
    setRecipients((p) => [...p, ...adds]);
  }
  function updateRecipientPhone(contactId: string | null, phone: string) {
    setRecipients((p) => p.map((r) => (r.contactId === contactId ? { ...r, phone } : r)));
  }

  const isQuick = c.workType === '퀵서비스';

  function submit() {
    if (!c.requestDate || !c.requester || !c.workType || !c.sendKind) {
      alert('의뢰일자·의뢰인·업무구분·송부종류는 필수입니다.');
      return;
    }
    if (!recipients.length) {
      alert('수신자를 1명 이상 추가하세요.');
      return;
    }
    if (isQuick) {
      const missing = recipients.filter((r) => !r.phone?.trim());
      if (missing.length) {
        alert(`퀵서비스는 수신자 연락처가 필수입니다.\n연락처 미기재: ${missing.map((m) => `${m.companyName} ${m.recipientName}`).join(', ')}`);
        return;
      }
    }
    onSubmit(c, recipients, files);
  }

  return (
    <div className="card" style={{ background: '#F5F1EB' }}>
      <div style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--ink-2)', marginBottom: 8 }}>＋ 새 발송요청</div>
      <CommonFields c={c} setC={setC} />

      <div style={{ fontSize: 'var(--fs-1)', fontWeight: 700, color: '#345', margin: '10px 0 6px' }}>
        · 수신자 <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>— 담당자명 또는 거래처명을 입력해 검색 후 클릭하면 추가됩니다.</span>
      </div>
      <ContactSearch
        clients={clients}
        excludeIds={recipients.map((r) => r.contactId || '')}
        onPick={addContact}
        onPickAll={addAllContacts}
      />

      {recipients.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {isQuick && (
            <div style={{ fontSize: 'var(--fs-1)', color: '#b45309', fontWeight: 600 }}>⚡ 퀵서비스는 수신자 연락처가 필수입니다.</div>
          )}
          {recipients.map((r) => {
            const missing = isQuick && !r.phone?.trim();
            return (
              <div key={r.contactId} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: `1px solid ${missing ? '#e11d48' : '#D0CCC4'}`, borderRadius: 8, padding: '4px 10px', fontSize: 'var(--fs-1)', flexWrap: 'wrap' }}>
                <span><b>{r.companyName}</b> · {r.recipientName} {r.recipientTitle}</span>
                {isQuick ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    📞
                    <input
                      value={r.phone}
                      onChange={(e) => updateRecipientPhone(r.contactId, e.target.value)}
                      placeholder="연락처 필수"
                      style={{ width: 150, fontSize: 'var(--fs-1)', padding: '2px 6px', borderColor: missing ? '#e11d48' : undefined }}
                    />
                  </span>
                ) : (
                  r.phone && <span style={{ color: 'var(--ink-3)' }}>📞 {r.phone}</span>
                )}
                <button onClick={() => setRecipients((p) => p.filter((x) => x.contactId !== r.contactId))} style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: '#c00', fontWeight: 700 }} title="제거">×</button>
              </div>
            );
          })}
        </div>
      )}

      {/* 첨부파일 (인쇄·발송용) — 선택. 대부분은 사무실에서 인쇄본 전달이라 생략. */}
      <div style={{ fontSize: 'var(--fs-1)', fontWeight: 700, color: '#345', margin: '12px 0 6px' }}>
        · 첨부파일 <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>— 인쇄해서 발송할 문서가 있으면 첨부(docx·hwp·pdf 등, 20MB 이하). 없으면 생략.</span>
      </div>
      <label className="btn-sm btn-sm-blue" style={{ cursor: 'pointer', display: 'inline-block' }}>
        📎 파일 선택
        <input
          type="file"
          multiple
          accept={ATTACH_ACCEPT}
          style={{ display: 'none' }}
          onChange={(e) => {
            const fs = Array.from(e.target.files ?? []);
            setFiles((p) => [...p, ...fs.filter((f) => !p.some((x) => x.name === f.name && x.size === f.size))]);
            e.target.value = '';
          }}
        />
      </label>
      {files.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {files.map((f, i) => (
            <span key={f.name + i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid var(--rule)', borderRadius: 6, padding: '3px 8px', fontSize: 'var(--fs-1)' }}>
              📄 {f.name} <span style={{ color: 'var(--ink-3)' }}>({fmtSize(f.size)})</span>
              <button onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#c00', fontWeight: 700 }} title="제거">×</button>
            </span>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
        <button className="btn-p" onClick={submit}>발송요청 등록 {recipients.length > 0 && `(${recipients.length}건)`}</button>
        <button className="btn-sm" onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}

// ── 발송요청 수정 폼 (단일 건) ──────────────────────────────
function EditRequestForm({
  req,
  clients,
  onSave,
  onCancel,
}: {
  req: SendRequest;
  clients: DocClient[];
  onSave: (common: SendCommon, recipient: SendRecipient) => void;
  onCancel: () => void;
}) {
  const [c, setCState] = useState<SendCommon>({
    requestDate: req.requestDate,
    requester: req.requester,
    workType: req.workType,
    sendKind: req.sendKind,
    docName: req.docName,
    copies: req.copies,
    sealRequired: req.sealRequired,
    deadline: req.deadline,
    etcRequest: req.etcRequest,
  });
  const setC = (patch: Partial<SendCommon>) => setCState((p) => ({ ...p, ...patch }));
  const [picked, setPicked] = useState<SendRecipient | null>(null);
  const [phone, setPhone] = useState(req.phone);
  const isQuick = c.workType === '퀵서비스';

  function save() {
    if (isQuick && !phone.trim()) {
      alert('퀵서비스는 수신자 연락처가 필수입니다.');
      return;
    }
    // 재선택했으면 스냅샷 갱신, 아니면 기존 스냅샷 유지. 연락처는 입력값으로 덮어씀.
    const base: SendRecipient = picked ?? {
      clientId: req.clientId || '',
      contactId: req.contactId,
      companyName: req.companyName,
      recipientName: req.recipientName,
      recipientTitle: req.recipientTitle,
      address: req.address,
      phone: req.phone,
    };
    onSave(c, { ...base, phone: phone.trim() });
  }

  return (
    <div style={{ padding: 4 }}>
      <div style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--ink-2)', marginBottom: 8 }}>✏️ 발송요청 수정 (미접수)</div>
      <CommonFields c={c} setC={setC} />
      <div style={{ fontSize: 'var(--fs-1)', fontWeight: 700, color: '#345', margin: '10px 0 6px' }}>
        · 수신자 <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>(현재: {req.companyName} · {req.recipientName} {req.recipientTitle} — 바꾸려면 검색해 선택, 미선택 시 유지)</span>
      </div>
      {picked && (
        <div style={{ fontSize: 'var(--fs-2)', color: '#059669', marginBottom: 6 }}>
          → 변경: <b>{picked.companyName}</b> · {picked.recipientName} {picked.recipientTitle}
        </div>
      )}
      <ContactSearch clients={clients} onPick={(cl, ct) => { const rc = toRecipient(cl, ct.id); setPicked(rc); if (rc) setPhone(rc.phone); }} placeholder="🔍 바꿀 담당자 검색…" />
      <div className="frow" style={{ maxWidth: 300, marginTop: 8 }}>
        <span className="fl">수신자 연락처{isQuick && <span className="req">*</span>}</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={isQuick ? '퀵서비스 필수' : '(선택)'} style={{ borderColor: isQuick && !phone.trim() ? '#e11d48' : undefined }} />
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
        <button className="btn-p" onClick={save}>저장</button>
        <button className="btn-sm" onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}


// ── 재발송요청 모달 (반송 건, 원 요청자) ────────────────────
function ResendModal({ req, onClose, onDone }: { req: SendRequest; onClose: () => void; onDone: () => void | Promise<void> }) {
  useEscape(onClose);
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!memo.trim()) { setErr('재발송 사유·조치 내용을 입력하세요.'); return; }
    setBusy(true);
    setErr(null);
    try {
      await requestResend(req.id, memo, req.statusNote);
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '재발송요청에 실패했습니다.');
      setBusy(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, maxWidth: 480, width: '100%', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--rule-2)' }}>
          <span style={{ fontWeight: 700, color: 'var(--warn)' }}>🔄 재발송요청</span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 'var(--fs-2)', marginBottom: 10 }}>
            <b>{req.companyName}</b> · {req.docName || req.workType}
            <div style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-1)', marginTop: 2 }}>
              {req.recipientName} {req.recipientTitle} · {req.address || '주소 없음'}
            </div>
          </div>
          {req.statusNote && (
            <div style={{ background: '#FEE2E2', color: 'var(--bad)', fontSize: 'var(--fs-1)', padding: '7px 10px', borderRadius: 6, marginBottom: 10 }}>
              반송 사유: {req.statusNote}
            </div>
          )}
          <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', marginBottom: 6 }}>
            ⚠️ 주소·수신자가 잘못되었다면 <b>거래처관리 › 거래처담당자등록</b>에서 먼저 정보를 고친 뒤 요청하세요.
            (이 건의 수신자 정보는 발송 당시 스냅샷이라 자동으로 바뀌지 않습니다.)
          </div>
          <textarea
            className="inp"
            rows={3}
            placeholder="재발송 사유·조치 내용 (예: 주소 확인함 — 3층 → 5층으로 정정, 수신자 변경 등)"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            style={{ width: '100%', fontSize: 'var(--fs-2)' }}
          />
          {err && <div style={{ color: '#dc2626', fontSize: 'var(--fs-1)', marginTop: 6 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 6, marginTop: 12, justifyContent: 'flex-end' }}>
            <button className="btn-sm" onClick={onClose} disabled={busy}>취소</button>
            <button className="btn-sm btn-sm-blue" onClick={() => void submit()} disabled={busy}>
              {busy ? '요청 중…' : '재발송요청'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 휴지통 모달 ──────────────────────────────────────────
function TrashModal({ rows, busy, onRestore, onHardDelete, onClose }: {
  rows: SendRequest[]; busy: boolean; onRestore: (r: SendRequest) => void; onHardDelete: (r: SendRequest) => void; onClose: () => void;
}) {
  useEscape(onClose);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, maxWidth: 900, width: '100%', maxHeight: '80vh', overflow: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--rule-2)', position: 'sticky', top: 0, background: '#fff' }}>
          <span style={{ fontWeight: 700, color: 'var(--navy)' }}>🗑 휴지통 — 삭제된 발송요청</span>
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginLeft: 8 }}>복원하면 원래 상태 그대로 목록에 돌아옵니다.</span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>
        <div style={{ padding: 12 }}>
          {rows.length === 0 ? (
            <div style={{ padding: 16, color: 'var(--ink-3)', fontSize: 'var(--fs-2)' }}>휴지통이 비어 있습니다.</div>
          ) : (
            <table className="tbl">
              <thead><tr><th style={{ minWidth: 88 }}>의뢰일</th><th>거래처·수신자</th><th>문서명</th><th>상태</th><th style={{ minWidth: 110 }}>삭제일</th><th style={{ minWidth: 130 }}>관리</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontSize: 'var(--fs-1)', whiteSpace: 'nowrap' }}>{r.requestDate}</td>
                    <td style={{ fontSize: 'var(--fs-2)' }}><b>{r.companyName}</b>{r.recipientName ? ` · ${r.recipientName} ${r.recipientTitle}` : ''}</td>
                    <td style={{ fontSize: 'var(--fs-2)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.docName}>{r.docName || r.sendKind}</td>
                    <td style={{ fontSize: 'var(--fs-1)' }}>{r.status}</td>
                    <td style={{ fontSize: 'var(--fs-1)', whiteSpace: 'nowrap' }}>{r.deletedAt ? dtTime(r.deletedAt) : ''}</td>
                    <td>
                      <span style={{ display: 'flex', gap: 4 }}>
                        <button className="btn-sm btn-sm-blue" disabled={busy} onClick={() => onRestore(r)}>↩ 복원</button>
                        <button className="btn-sm btn-sm-del" disabled={busy} onClick={() => onHardDelete(r)} title="되돌릴 수 없는 영구삭제">영구삭제</button>
                      </span>
                    </td>
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

// ── 변경 로그 모달 ──────────────────────────────────────────
function LogModal({ rows, onClose }: { rows: DocAudit[]; onClose: () => void }) {
  useEscape(onClose);
  const actLabel = (a: DocAudit['action']) => (a === 'insert' ? '등록' : a === 'update' ? '수정' : '삭제');
  const actColor = (a: DocAudit['action']) => (a === 'insert' ? '#059669' : a === 'update' ? '#2563eb' : '#dc2626');
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, maxWidth: 820, width: '100%', maxHeight: '80vh', overflow: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--rule-2)', position: 'sticky', top: 0, background: '#fff' }}>
          <span style={{ fontWeight: 700, color: 'var(--navy)' }}>📜 발송요청 변경 로그 (최근순)</span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>
        <div style={{ padding: 12 }}>
          {rows.length === 0 ? (
            <div style={{ padding: 16, color: 'var(--ink-3)', fontSize: 'var(--fs-2)' }}>기록이 없습니다.</div>
          ) : (
            <table className="tbl">
              <thead><tr><th style={{ minWidth: 120 }}>일시</th><th>담당자</th><th>작업</th><th>내용</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontSize: 'var(--fs-1)', whiteSpace: 'nowrap' }}>{dtTime(r.at)}</td>
                    <td style={{ fontWeight: 600 }}>{r.actorName}</td>
                    <td style={{ color: actColor(r.action), fontWeight: 700, fontSize: 'var(--fs-1)' }}>{actLabel(r.action)}</td>
                    <td style={{ fontSize: 'var(--fs-2)' }}>
                      {r.summary}
                      {auditChanges(r).map((c, i) => (
                        <div key={i} style={{ fontSize: 'var(--fs-1)', color: '#B45309', marginTop: 2 }}>↳ {c}</div>
                      ))}
                    </td>
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
