// 문서발송 › 발송요청 — 공통 문서정보 + 수신자 다중선택(거래처 담당자 관리 연동, 스냅샷) 요청 등록/목록/수정
import { useEffect, useMemo, useRef, useState } from 'react';
import { todayYmd } from '../../lib/format';
import { useAuth } from '../../context/AuthContext';
import { listDocClients, type DocClient, type DocContact } from '../../lib/docClientsApi';
import {
  listSendRequests,
  createSendRequests,
  updateSendRequest,
  deleteSendRequest,
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
  if (s === '반송') return { background: '#FEE2E2', color: '#B91C1C' };
  if (s === '재발송요청') return { background: '#FEF3C7', color: '#92400E' };
  if (s === '취소') return { background: '#E5E7EB', color: '#6B7280' };
  if (s === '진행중') return { background: '#DBEAFE', color: '#1E40AF' };
  return { background: '#F3F4F6', color: '#6B7280' }; // 미접수
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
  async function handleDelete(r: SendRequest) {
    // 처리가 시작된 건은 실물 발송과 대응할 수 있어 더 분명히 경고한다(최고관리자만 도달).
    const warn =
      r.status === '미접수'
        ? `발송요청(${r.companyName} · ${r.sendKind})을 삭제하시겠습니까?`
        : `⚠️ 처리가 진행된 건입니다 (상태: ${r.status}${r.trackingNo ? `, 등기 ${r.trackingNo}` : ''}).
` +
          `${r.companyName} · ${r.sendKind}

` +
          `실제 발송과 대응하는 기록일 수 있습니다. 그래도 삭제할까요?
` +
          `(필요 없어진 요청이라면 '발송요청 처리'에서 취소로 남기는 편이 낫습니다. 삭제해도 변경 로그에는 원본이 남습니다.)`;
    if (!confirm(warn)) return;
    try {
      await deleteSendRequest(r.id);
      await load();
      flash('✓ 삭제됨');
    } catch (e) {
      alert('삭제 실패: ' + (e instanceof Error ? e.message : e));
    }
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

  if (loading) {
    return (
      <div className="card">
        <div className="chdr">✉️ 발송요청</div>
        <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>불러오는 중…</div>
      </div>
    );
  }

  // 기본 3단계는 항상, 후속상태(반송·재발송완료)는 건이 있을 때만 표시
  const counts = [...SEND_STATUS, ...POST_SEND_STATUS]
    .map((s) => ({ s, n: reqs.filter((r) => r.status === s).length }))
    .filter((c) => (SEND_STATUS as readonly string[]).includes(c.s) || c.n > 0);
  // batch_id 별 요청 수(묶음 배지는 2건 이상일 때만)
  const batchCounts: Record<string, number> = {};
  for (const r of reqs) if (r.batchId) batchCounts[r.batchId] = (batchCounts[r.batchId] || 0) + 1;
  const attCount = (r: SendRequest) => (r.batchId ? (attByBatch[r.batchId]?.length ?? 0) : 0);

  return (
    <div className="card">
      <div className="chdr">
        발송요청 (총 {reqs.length}건)
        <span style={{ marginLeft: 10, fontSize: 11, color: '#888' }}>
          {counts.map((c) => `${c.s} ${c.n}`).join(' · ')}
        </span>
        {msg && <span style={{ marginLeft: 12, fontSize: 11, color: '#059669' }}>{msg}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 5, alignItems: 'center' }}>
          <button className="btn-sm btn-sm-blue" onClick={openLog}>📜 변경 로그</button>
          <button className="btn-sm" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => void refresh()} disabled={busy} title="최신 내역을 다시 불러옵니다">{busy ? '⏳' : '🔄'} 새로고침</button>
          {canWrite && (
            <button className="btn-sm" onClick={() => { setShowAdd((v) => !v); setEditId(null); }}>
              + 새 발송요청
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert-w">{error}</div>}
      <div className="alert-i" style={{ fontSize: 11 }}>
        ✉️ 거래처 담당자를 선택하면 회사명·주소·연락처가 <b>그 시점 값으로 저장(스냅샷)</b>되어, 이후 담당자 정보가 바뀌어도 과거 요청은 유지됩니다. 한 문서를 <b>여러 수신자</b>에게 한 번에 요청할 수 있습니다. 처리 전 <b>‘미접수’</b> 건만 수정·삭제할 수 있습니다. <b style={{ color: '#b45309' }}>⚡ 업무구분이 ‘퀵서비스’면 수신자 연락처가 필수</b>입니다.
        {!canWrite && <span style={{ color: '#8a5a00' }}> · 🔒 읽기전용 계정은 조회만 가능합니다.</span>}
      </div>

      {showAdd && canWrite && (
        <AddRequestForm clients={clients} defaultRequester={defaultRequester} onSubmit={handleAdd} onCancel={() => setShowAdd(false)} />
      )}

      <div className="sbar">
        <input placeholder="🔍 거래처·수신자·문서명·송부종류·의뢰인 (전체에서 검색)" value={q} onChange={(e) => setQ(e.target.value)} />
        <span style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>
          {searching ? `${view.length}건 검색됨` : `최근 ${view.length}건 표시`}
        </span>
        {!searching && (
          <span style={{ fontSize: 11, color: '#aaa', whiteSpace: 'nowrap' }}>· 전체 내역·처리현황은 ‘발송업무 현황’에서</span>
        )}
      </div>

      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
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
              <th style={{ textAlign: 'center' }}>발송일</th>
              <th style={{ textAlign: 'center' }}>등기번호</th>
              <th style={{ textAlign: 'center' }}>상태</th>
              {canWrite && <th style={{ width: 72 }}>관리</th>}
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && (
              <tr><td colSpan={canWrite ? 14 : 13} style={{ textAlign: 'center', color: '#BBB', padding: 24 }}>발송요청이 없습니다.</td></tr>
            )}
            {view.map((r) =>
              editId === r.id ? (
                <tr key={r.id}>
                  <td colSpan={canWrite ? 14 : 13} style={{ background: '#EEF6FF' }}>
                    <EditRequestForm req={r} clients={clients} onSave={(c, rc) => handleSaveEdit(r.id, c, rc)} onCancel={() => setEditId(null)} />
                  </td>
                </tr>
              ) : (
                <tr key={r.id}>
                  <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{r.requestDate?.replace(/-/g, '.')}</td>
                  <td style={{ fontSize: 12 }}>{r.requester}</td>
                  <td style={{ fontSize: 12 }}>
                    <b style={{ color: '#1A2B52' }}>{r.companyName}</b>
                    {r.recipientName && <span style={{ color: '#555' }}> · {r.recipientName} {r.recipientTitle}</span>}
                    {r.batchId && batchCounts[r.batchId] > 1 && (
                      <span className="bdg b-on" style={{ marginLeft: 5, fontSize: 9 }} title="여러 수신자 묶음">묶음 {batchCounts[r.batchId]}</span>
                    )}
                  </td>
                  <td style={{ fontSize: 12 }}>{r.workType}</td>
                  <td style={{ fontSize: 12 }}>{r.sendKind}</td>
                  <td style={{ fontSize: 12 }}>{r.docName || <span style={{ color: '#CCC' }}>—</span>}</td>
                  <td style={{ textAlign: 'center', fontSize: 12 }}>{r.copies}</td>
                  <td style={{ textAlign: 'center', fontSize: 11 }}>{r.sealRequired ? '🔖 날인요' : '—'}</td>
                  <td style={{ textAlign: 'center', fontSize: 11 }}>{r.deadline === '긴급' ? <b style={{ color: '#dc2626' }}>긴급</b> : r.deadline}</td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      className="btn-sm"
                      style={{ fontSize: 11, padding: '1px 7px', color: attCount(r) ? '#1A2B52' : '#bbb' }}
                      title={attCount(r) ? '첨부파일 보기/다운로드' : '첨부 없음 (클릭해 추가)'}
                      onClick={() => setAttachFor(r)}
                    >
                      📎 {attCount(r) || ''}
                    </button>
                  </td>
                  <td style={{ textAlign: 'center', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {r.sentDate ? r.sentDate.replace(/-/g, '.') : <span style={{ color: '#CCC' }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'center' }}><TrackingLink no={r.trackingNo} /></td>
                  <td style={{ textAlign: 'center' }}>
                    <span className="bdg" style={{ fontSize: 10, ...statusStyle(r.status) }}>{r.status}</span>
                    {r.statusNote && (
                      <div
                        style={{ fontSize: 10, color: '#B91C1C', marginTop: 2, maxWidth: 120, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        title={`사유: ${r.statusNote}`}
                      >
                        {r.statusNote}
                      </div>
                    )}
                  </td>
                  {canWrite && (
                    <td>
                      {r.status === '미접수' ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn-sm btn-sm-blue" title="수정" onClick={() => { setEditId(r.id); setShowAdd(false); }}>✏️</button>
                          <button className="btn-sm btn-sm-del" title="삭제" onClick={() => handleDelete(r)}>🗑</button>
                        </div>
                      ) : r.status === '반송' && isMine(r) ? (
                        <button
                          className="btn-sm"
                          style={{ fontSize: 10, padding: '2px 6px', background: '#FEF3C7', color: '#92400E', fontWeight: 700 }}
                          title="주소 등을 확인한 뒤 재발송을 요청합니다"
                          onClick={() => setResendFor(r)}
                        >
                          🔄 재발송요청
                        </button>
                      ) : isSuper ? (
                        <button
                          className="btn-sm btn-sm-del"
                          title="최고관리자 삭제 — 처리 이력이 있는 건입니다(이력에는 원본이 남습니다)"
                          onClick={() => handleDelete(r)}
                        >
                          🗑
                        </button>
                      ) : (
                        <span style={{ fontSize: 10, color: '#AAA' }}>
                          {r.status === '재발송요청' ? '재발송 대기' : '처리중/완료'}
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

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
        <select value={c.requester} onChange={(e) => setC({ requester: e.target.value })} style={{ padding: '4px 7px', fontSize: 12 }}>
          {DOC_REQUESTERS.map((r) => <option key={r} value={r}>{r}</option>)}
          {!(DOC_REQUESTERS as readonly string[]).includes(c.requester) && <option value={c.requester}>{c.requester}</option>}
        </select>
      </div>
      <div className="frow">
        <span className="fl">업무구분<span className="req">*</span></span>
        <select value={c.workType} onChange={(e) => setC({ workType: e.target.value })} style={{ padding: '4px 7px', fontSize: 12 }}>
          {WORK_TYPES.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
      </div>
      <div className="frow">
        <span className="fl">송부종류<span className="req">*</span></span>
        <select value={c.sendKind} onChange={(e) => setC({ sendKind: e.target.value })} style={{ padding: '4px 7px', fontSize: 12 }}>
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
        <select value={c.sealRequired ? 'Y' : 'N'} onChange={(e) => setC({ sealRequired: e.target.value === 'Y' })} style={{ padding: '4px 7px', fontSize: 12 }}>
          <option value="N">X (불필요)</option>
          <option value="Y">🔖 날인요</option>
        </select>
      </div>
      <div className="frow">
        <span className="fl">발송기한</span>
        <select value={c.deadline} onChange={(e) => setC({ deadline: e.target.value })} style={{ padding: '4px 7px', fontSize: 12 }}>
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
        <div style={{ position: 'absolute', zIndex: 50, top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #D0CCC4', borderRadius: 6, maxHeight: 260, overflowY: 'auto', boxShadow: '0 6px 18px rgba(0,0,0,0.15)' }}>
          {matches.length === 0 && <div style={{ padding: 8, color: '#999', fontSize: 12 }}>일치하는 담당자가 없습니다.</div>}
          {soleCompany && (
            <button
              type="button"
              onClick={() => { onPickAll!(soleCompany); setQ(''); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', border: 'none', borderBottom: '1px solid #E3DED3', background: '#F5F1EB', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#345' }}
            >
              ＋ {soleCompany.companyName} 전체 담당자 추가 ({matches.length}명)
            </button>
          )}
          {matches.map(({ cl, ct }) => (
            <button
              key={ct.id}
              type="button"
              onClick={() => { onPick(cl, ct); setQ(''); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', border: 'none', borderBottom: '1px solid #F0ECE4', background: '#fff', cursor: 'pointer', fontSize: 12.5 }}
            >
              <b>{ct.contactName}</b> <span style={{ color: '#888' }}>{ct.honorific}</span> · <span style={{ color: '#1A2B52' }}>{cl.companyName}</span> <span style={{ color: '#aaa', fontSize: 11 }}>({cl.accountant})</span>
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
      <div style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 8 }}>＋ 새 발송요청</div>
      <CommonFields c={c} setC={setC} />

      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#345', margin: '10px 0 6px' }}>
        · 수신자 <span style={{ fontWeight: 400, color: '#888' }}>— 담당자명 또는 거래처명을 입력해 검색 후 클릭하면 추가됩니다.</span>
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
            <div style={{ fontSize: 11, color: '#b45309', fontWeight: 600 }}>⚡ 퀵서비스는 수신자 연락처가 필수입니다.</div>
          )}
          {recipients.map((r) => {
            const missing = isQuick && !r.phone?.trim();
            return (
              <div key={r.contactId} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: `1px solid ${missing ? '#e11d48' : '#D0CCC4'}`, borderRadius: 8, padding: '4px 10px', fontSize: 11.5, flexWrap: 'wrap' }}>
                <span><b>{r.companyName}</b> · {r.recipientName} {r.recipientTitle}</span>
                {isQuick ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    📞
                    <input
                      value={r.phone}
                      onChange={(e) => updateRecipientPhone(r.contactId, e.target.value)}
                      placeholder="연락처 필수"
                      style={{ width: 150, fontSize: 11.5, padding: '2px 6px', borderColor: missing ? '#e11d48' : undefined }}
                    />
                  </span>
                ) : (
                  r.phone && <span style={{ color: '#888' }}>📞 {r.phone}</span>
                )}
                <button onClick={() => setRecipients((p) => p.filter((x) => x.contactId !== r.contactId))} style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: '#c00', fontWeight: 700 }} title="제거">×</button>
              </div>
            );
          })}
        </div>
      )}

      {/* 첨부파일 (인쇄·발송용) — 선택. 대부분은 사무실에서 인쇄본 전달이라 생략. */}
      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#345', margin: '12px 0 6px' }}>
        · 첨부파일 <span style={{ fontWeight: 400, color: '#888' }}>— 인쇄해서 발송할 문서가 있으면 첨부(docx·hwp·pdf 등, 20MB 이하). 없으면 생략.</span>
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
            <span key={f.name + i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #D0CCC4', borderRadius: 6, padding: '3px 8px', fontSize: 11.5 }}>
              📄 {f.name} <span style={{ color: '#999' }}>({fmtSize(f.size)})</span>
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
      <div style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 8 }}>✏️ 발송요청 수정 (미접수)</div>
      <CommonFields c={c} setC={setC} />
      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#345', margin: '10px 0 6px' }}>
        · 수신자 <span style={{ fontWeight: 400, color: '#888' }}>(현재: {req.companyName} · {req.recipientName} {req.recipientTitle} — 바꾸려면 검색해 선택, 미선택 시 유지)</span>
      </div>
      {picked && (
        <div style={{ fontSize: 12, color: '#059669', marginBottom: 6 }}>
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
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #eee' }}>
          <span style={{ fontWeight: 700, color: '#92400E' }}>🔄 재발송요청</span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 12.5, marginBottom: 10 }}>
            <b>{req.companyName}</b> · {req.docName || req.workType}
            <div style={{ color: '#888', fontSize: 11, marginTop: 2 }}>
              {req.recipientName} {req.recipientTitle} · {req.address || '주소 없음'}
            </div>
          </div>
          {req.statusNote && (
            <div style={{ background: '#FEE2E2', color: '#B91C1C', fontSize: 11.5, padding: '7px 10px', borderRadius: 6, marginBottom: 10 }}>
              반송 사유: {req.statusNote}
            </div>
          )}
          <div style={{ fontSize: 11.5, color: '#666', marginBottom: 6 }}>
            ⚠️ 주소·수신자가 잘못되었다면 <b>거래처 담당자 관리</b>에서 먼저 정보를 고친 뒤 요청하세요.
            (이 건의 수신자 정보는 발송 당시 스냅샷이라 자동으로 바뀌지 않습니다.)
          </div>
          <textarea
            className="inp"
            rows={3}
            placeholder="재발송 사유·조치 내용 (예: 주소 확인함 — 3층 → 5층으로 정정, 수신자 변경 등)"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            style={{ width: '100%', fontSize: 12.5 }}
          />
          {err && <div style={{ color: '#dc2626', fontSize: 11.5, marginTop: 6 }}>{err}</div>}
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

// ── 변경 로그 모달 ──────────────────────────────────────────
function LogModal({ rows, onClose }: { rows: DocAudit[]; onClose: () => void }) {
  const actLabel = (a: DocAudit['action']) => (a === 'insert' ? '등록' : a === 'update' ? '수정' : '삭제');
  const actColor = (a: DocAudit['action']) => (a === 'insert' ? '#059669' : a === 'update' ? '#2563eb' : '#dc2626');
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, maxWidth: 820, width: '100%', maxHeight: '80vh', overflow: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #eee', position: 'sticky', top: 0, background: '#fff' }}>
          <span style={{ fontWeight: 700, color: '#1A2B52' }}>📜 발송요청 변경 로그 (최근순)</span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>
        <div style={{ padding: 12 }}>
          {rows.length === 0 ? (
            <div style={{ padding: 16, color: '#888', fontSize: 12.5 }}>기록이 없습니다.</div>
          ) : (
            <table className="tbl">
              <thead><tr><th style={{ minWidth: 120 }}>일시</th><th>담당자</th><th>작업</th><th>내용</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{dtTime(r.at)}</td>
                    <td style={{ fontWeight: 600 }}>{r.actorName}</td>
                    <td style={{ color: actColor(r.action), fontWeight: 700, fontSize: 11 }}>{actLabel(r.action)}</td>
                    <td style={{ fontSize: 12 }}>
                      {r.summary}
                      {auditChanges(r).map((c, i) => (
                        <div key={i} style={{ fontSize: 11, color: '#B45309', marginTop: 2 }}>↳ {c}</div>
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
