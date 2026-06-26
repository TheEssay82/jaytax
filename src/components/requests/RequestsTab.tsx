// 업데이트요청 게시판 탭 — 원본 rRequests 포팅 (요청 등록·상태·삭제·댓글)
import { useState } from 'react';
import type { RequestStatus, UpdateRequest } from '../../types';
import { useRequests } from '../../hooks/useRequests';
import { useAuth } from '../../context/AuthContext';
import {
  createRequest,
  updateRequestStatus,
  deleteRequest,
  addComment,
} from '../../lib/requestsApi';

const STATUSES: RequestStatus[] = ['미접수', '개발중', '개발완료', '미반영종료'];
const STATUS_STYLE: Record<RequestStatus, React.CSSProperties> = {
  미접수: { background: '#FEE2E2', color: '#991B1B' },
  개발중: { background: '#FEF3C7', color: '#92400E' },
  개발완료: { background: '#D1FAE5', color: '#065F46' },
  미반영종료: { background: '#F3F4F6', color: '#6B7280' },
};
const dtShort = (s?: string) => (s ? s.replace('T', ' ').slice(0, 16) : '');

export default function RequestsTab() {
  const { requests, loading, error, refresh } = useRequests();
  const { user } = useAuth();
  const defaultName = user?.email?.split('@')[0] ?? '';

  const [reqName, setReqName] = useState(defaultName);
  const [reqContent, setReqContent] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!reqName.trim() || !reqContent.trim()) {
      alert('요청자와 요청내용을 모두 입력해주세요.');
      return;
    }
    setBusy(true);
    try {
      await createRequest(reqName.trim(), reqContent.trim());
      setReqContent('');
      await refresh();
    } catch (e) {
      alert('등록 실패: ' + (e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(id: string, status: RequestStatus) {
    try {
      await updateRequestStatus(id, status);
      await refresh();
    } catch (e) {
      alert('상태 변경 실패: ' + (e instanceof Error ? e.message : e));
    }
  }

  async function remove(id: string) {
    if (!confirm('삭제하시겠습니까?')) return;
    try {
      await deleteRequest(id);
      await refresh();
    } catch (e) {
      alert('삭제 실패: ' + (e instanceof Error ? e.message : e));
    }
  }

  if (loading) {
    return (
      <div className="card">
        <div className="chdr">💬 업데이트요청</div>
        <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>불러오는 중…</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="chdr">
        업데이트 요청 게시판
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#888' }}>총 {requests.length}건</span>
      </div>

      {error && <div className="alert-w">{error}</div>}

      <div className="card" style={{ background: '#F5F1EB' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 8 }}>새 요청 등록</div>
        <div className="frow">
          <span className="fl">요청자</span>
          <input value={reqName} placeholder="이름" onChange={(e) => setReqName(e.target.value)} />
        </div>
        <div className="frow" style={{ alignItems: 'flex-start' }}>
          <span className="fl" style={{ paddingTop: 6 }}>
            요청내용
          </span>
          <textarea
            rows={3}
            value={reqContent}
            placeholder="요청 내용을 상세히 입력해주세요"
            onChange={(e) => setReqContent(e.target.value)}
            style={{
              width: '100%',
              padding: '5px 8px',
              border: '1px solid #D0CCC4',
              borderRadius: 6,
              fontSize: 12,
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
        </div>
        <button className="btn-p" style={{ marginTop: 7 }} onClick={submit} disabled={busy}>
          {busy ? '등록 중…' : '📨 요청 등록'}
        </button>
      </div>

      {requests.length === 0 && (
        <div style={{ textAlign: 'center', padding: 24, color: '#BBB' }}>등록된 요청이 없습니다.</div>
      )}

      {requests.map((r) => (
        <RequestCard
          key={r.id}
          r={r}
          onStatus={(s) => changeStatus(r.id, s)}
          onDelete={() => remove(r.id)}
          onCommentAdded={refresh}
          defaultAuthor={defaultName}
        />
      ))}
    </div>
  );
}

interface CardProps {
  r: UpdateRequest;
  onStatus: (s: RequestStatus) => void;
  onDelete: () => void;
  onCommentAdded: () => Promise<void>;
  defaultAuthor: string;
}

function RequestCard({ r, onStatus, onDelete, onCommentAdded, defaultAuthor }: CardProps) {
  const [expanded, setExpanded] = useState(false);
  const [author, setAuthor] = useState(defaultAuthor);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const cmts = r.comments || [];
  const last = cmts.length ? cmts[cmts.length - 1] : null;

  async function submitComment() {
    if (!author.trim() || !text.trim()) {
      alert('작성자와 댓글 내용을 모두 입력해주세요.');
      return;
    }
    setBusy(true);
    try {
      await addComment(r.id, author.trim(), text.trim());
      setText('');
      setExpanded(true);
      await onCommentAdded();
    } catch (e) {
      alert('댓글 등록 실패: ' + (e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 7 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', marginBottom: 5 }}>
            <span style={{ fontWeight: 700, fontSize: 12 }}>{r.requester}</span>
            <span style={{ fontSize: 10, color: '#888' }}>{dtShort(r.createdAt)}</span>
            <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, ...STATUS_STYLE[r.status] }}>
              {r.status}
            </span>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{r.content}</div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <select
            className="btn-sm"
            style={{ fontSize: 11 }}
            value={r.status}
            onChange={(e) => onStatus(e.target.value as RequestStatus)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button className="btn-sm btn-sm-del" onClick={onDelete}>
            🗑
          </button>
        </div>
      </div>

      <div style={{ borderTop: '1px solid #EDE9E2', paddingTop: 8 }}>
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: 'none',
            border: '1px solid #D0CCC4',
            borderRadius: 5,
            padding: '3px 10px',
            cursor: 'pointer',
            fontSize: 11,
            color: '#555',
            fontFamily: 'inherit',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <span>💬 댓글 {cmts.length}개</span>
          {last && <span style={{ color: '#AAA', fontSize: 10 }}>· 최근: {dtShort(last.createdAt)}</span>}
          <span style={{ color: '#AAA', fontSize: 10 }}>{expanded ? '▲ 접기' : '▼ 펼치기'}</span>
        </button>

        {expanded && (
          <div style={{ marginTop: 9 }}>
            {cmts.length === 0 && (
              <div style={{ fontSize: 11, color: '#BBB', marginBottom: 8, padding: 6 }}>
                등록된 댓글이 없습니다.
              </div>
            )}
            {cmts.map((c) => (
              <div
                key={c.id}
                style={{ display: 'flex', gap: 8, padding: '7px 9px', background: '#F8F5EF', borderRadius: 7, marginBottom: 5 }}
              >
                <div
                  style={{
                    flexShrink: 0,
                    width: 28,
                    height: 28,
                    background: '#1A2B52',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {(c.author || '?').charAt(0)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, fontSize: 11 }}>{c.author}</span>
                    <span style={{ fontSize: 10, color: '#AAA' }}>{dtShort(c.createdAt)}</span>
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{c.text}</div>
                </div>
              </div>
            ))}

            <div style={{ display: 'flex', gap: 5, marginTop: 7, alignItems: 'flex-start' }}>
              <input
                value={author}
                placeholder="작성자"
                onChange={(e) => setAuthor(e.target.value)}
                style={{ width: 90, flexShrink: 0 }}
              />
              <textarea
                rows={1}
                value={text}
                placeholder="댓글 입력"
                onChange={(e) => setText(e.target.value)}
                style={{
                  flex: 1,
                  padding: '5px 8px',
                  border: '1px solid #D0CCC4',
                  borderRadius: 6,
                  fontSize: 12,
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
              />
              <button className="btn-sm btn-sm-blue" onClick={submitComment} disabled={busy} style={{ flexShrink: 0 }}>
                {busy ? '…' : '등록'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
