// 상담기록 — 저장된 상담 회신 이력을 조회한다(직원 공유). 본인 작성 건은 편집·상태변경·삭제 가능(RLS).
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/roles';
import { dtFmt } from '../../lib/format';
import {
  listConsultations,
  updateConsultation,
  deleteConsultation,
  modelLabel,
  type Consultation,
  type ConsultStatus,
} from '../../lib/consultApi';
import { TagList, TagEditor } from './TagsField';

export default function ConsultLogTab() {
  const { user, role } = useAuth();
  const [items, setItems] = useState<Consultation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Consultation | null>(null);

  async function reload() {
    try {
      const rows = await listConsultations();
      setItems(rows);
      setError(null);
      // 상세 열람 중이면 최신 데이터로 동기화
      setSelected((s) => (s ? rows.find((r) => r.id === s.id) ?? null : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : '상담기록을 불러오지 못했습니다.');
      setItems(null);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 확정(final) 건 순번: 오래된 순으로 1,2,3… (표시용, 저장 안 함)
  const finalSeq = new Map<string, number>();
  [...(items ?? [])]
    .filter((c) => c.status === 'final')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .forEach((c, i) => finalSeq.set(c.id, i + 1));

  if (selected) {
    return (
      <Detail
        item={selected}
        seq={selected.status === 'final' ? finalSeq.get(selected.id) : undefined}
        isOwner={!!user && selected.authorId === user.id}
        canFinalize={can(role, 'finalizeConsult')}
        onBack={() => setSelected(null)}
        onChanged={reload}
      />
    );
  }

  const f = filter.trim();
  const filtered = (items ?? []).filter((c) => {
    const textOk =
      !f || c.title.includes(f) || c.question.includes(f) || c.authorName.includes(f) || c.authorEmail.includes(f) || c.tags.some((t) => t.includes(f));
    const tagOk = !tagFilter || c.tags.includes(tagFilter);
    return textOk && tagOk;
  });

  // 태그 필터 바: 빈도순 상위 태그
  const tagCounts = new Map<string, number>();
  for (const c of items ?? []) for (const t of c.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map((e) => e[0]);

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        🗂️ 상담기록
        <span style={{ marginLeft: 'auto' }}>
          <button className="btn-sm" onClick={reload}>↻ 새로고침</button>
        </span>
      </div>

      <div className="frow" style={{ gridTemplateColumns: '1fr' }}>
        <label className="fl">제목 · 질문 · 작성자 검색</label>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="예: 라이선스 / 변동대가 / 수익인식"
          autoFocus
        />
      </div>

      {topTags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 10 }}>
          <span style={{ fontSize: 11.5, color: '#8a8170', fontWeight: 700 }}>태그</span>
          <TagList tags={topTags} active={tagFilter} onSelect={(t) => setTagFilter((cur) => (cur === t ? null : t))} />
          {tagFilter && (
            <button className="btn-sm" style={{ fontSize: 11 }} onClick={() => setTagFilter(null)}>필터 해제</button>
          )}
        </div>
      )}

      {error && <div className="alert-w" style={{ marginTop: 12 }}>{error}</div>}
      {items === null && !error && <div className="alert-i" style={{ marginTop: 12 }}>불러오는 중…</div>}

      {items !== null && (
        <div style={{ fontSize: 12, color: '#6b7280', margin: '10px 0' }}>
          총 {items.length}건 {f && `· 검색 ${filtered.length}건`}
        </div>
      )}

      {items !== null && filtered.length === 0 && (
        <div className="alert-i">
          {items.length === 0 ? '저장된 상담기록이 없습니다. 상담진행에서 회신 초안을 작성·저장해 보세요.' : '검색 결과가 없습니다.'}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.map((c) => (
          <button key={c.id} onClick={() => setSelected(c)} style={rowStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
              <StatusBadge status={c.status} />
              {finalSeq.has(c.id) && (
                <span style={{ fontSize: 11, fontWeight: 700, color: '#1A6E3C', whiteSpace: 'nowrap' }}>#{finalSeq.get(c.id)}</span>
              )}
              <span style={{ flex: 1, fontWeight: 600, color: '#1f2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.title || '(제목 없음)'}
              </span>
              <span style={{ fontSize: 11, color: '#9aa0ad', whiteSpace: 'nowrap' }}>
                초안 {c.authorName}
                {c.status === 'final' && c.finalizedByName && ` · 확정 ${c.finalizedByName}`}
              </span>
              <span style={{ fontSize: 11, color: '#9aa0ad', whiteSpace: 'nowrap' }}>{dtFmt(c.createdAt)}</span>
            </div>
            {c.tags.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <TagList tags={c.tags} />
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function Detail({
  item,
  seq,
  isOwner,
  canFinalize,
  onBack,
  onChanged,
}: {
  item: Consultation;
  seq?: number;
  isOwner: boolean;
  canFinalize: boolean;
  onBack: () => void;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [answer, setAnswer] = useState(item.answerMd);
  const [tags, setTags] = useState<string[]>(item.tags);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyOk, setCopyOk] = useState(false);

  async function saveEdit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateConsultation(item.id, { title: title.trim() || '(제목 없음)', answerMd: answer, tags });
      await onChanged();
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '수정 중 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus() {
    if (busy) return;
    const next: ConsultStatus = item.status === 'final' ? 'draft' : 'final';
    setBusy(true);
    setError(null);
    try {
      await updateConsultation(item.id, { status: next });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '상태 변경 중 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy || !window.confirm('이 상담기록을 삭제하시겠습니까? 되돌릴 수 없습니다.')) return;
    setBusy(true);
    setError(null);
    try {
      await deleteConsultation(item.id);
      await onChanged();
      onBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : '삭제 중 오류가 발생했습니다.');
      setBusy(false);
    }
  }

  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(item.answerMd);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 1500);
    } catch {
      /* 무시 */
    }
  }

  return (
    <div className="card">
      <div className="chdr">🗂️ 상담기록</div>
      <button className="btn-sm" onClick={onBack} style={{ marginBottom: 12 }}>← 목록으로</button>

      {error && <div className="alert-w" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
        <StatusBadge status={item.status} />
        {seq != null && (
          <span style={{ fontSize: 12, fontWeight: 700, color: '#1A6E3C' }}>확정 #{seq}</span>
        )}
        {editing ? (
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ flex: 1, minWidth: 240, fontSize: 15, fontWeight: 700 }}
          />
        ) : (
          <span style={{ fontSize: 16, fontWeight: 700, color: '#1A2B52' }}>{item.title || '(제목 없음)'}</span>
        )}
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 14 }}>
        초안 저장 {item.authorName} · {dtFmt(item.createdAt)}
        {item.status === 'final' && item.finalizedByName && (
          <span style={{ color: '#1A6E3C', fontWeight: 600 }}>
            {' · '}확정 저장 {item.finalizedByName}{item.finalizedAt && ` · ${dtFmt(item.finalizedAt)}`}
          </span>
        )}
        {item.updatedAt !== item.createdAt && ` · 수정 ${dtFmt(item.updatedAt)}`}
        {item.llmModel && ` · ${modelLabel(item.llmModel)}`}
      </div>

      {/* 액션 */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        <button className="btn-sm" onClick={copyAnswer}>{copyOk ? '복사됨 ✓' : '📋 회신 복사'}</button>
        {isOwner && !editing && (
          <button className="btn-sm" onClick={() => setEditing(true)} disabled={busy}>✏️ 편집</button>
        )}
        {!editing && (isOwner || canFinalize) && (
          <button className="btn-sm" onClick={toggleStatus} disabled={busy}>
            {item.status === 'final' ? '↩ 초안으로' : '✅ 확정으로'}
          </button>
        )}
        {isOwner && !editing && (
          <button className="btn-sm" onClick={remove} disabled={busy} style={{ color: '#b91c1c' }}>🗑️ 삭제</button>
        )}
        {isOwner && editing && (
          <>
            <button className="btn-p btn-sm" onClick={saveEdit} disabled={busy}>{busy ? '저장 중…' : '저장'}</button>
            <button className="btn-sm" onClick={() => { setEditing(false); setTitle(item.title); setAnswer(item.answerMd); setTags(item.tags); }} disabled={busy}>취소</button>
          </>
        )}
      </div>

      {/* 키워드 해시태그 */}
      {(editing || item.tags.length > 0) && (
        <Section label="키워드 해시태그">
          {editing ? <TagEditor value={tags} onChange={setTags} /> : <TagList tags={item.tags} />}
        </Section>
      )}

      {/* 질문 */}
      <Section label="질문 · 사실관계">
        <div style={{ fontSize: 13, lineHeight: 1.65, color: '#1f2937', whiteSpace: 'pre-wrap' }}>{item.question}</div>
      </Section>

      {/* 회신 */}
      <Section label="회신 초안">
        {editing ? (
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={18}
            style={{ width: '100%', resize: 'vertical', lineHeight: 1.65, fontSize: 13.5, fontFamily: 'inherit' }}
          />
        ) : (
          <div style={{ fontSize: 13.5, lineHeight: 1.65, color: '#1f2937', whiteSpace: 'pre-wrap' }}>{item.answerMd}</div>
        )}
      </Section>

      {/* 근거 */}
      {item.citations.length > 0 && (
        <Section label={`근거 (${item.citations.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {item.citations.map((c, i) => (
              <div key={i} style={{ border: '1px solid #e4e0d8', borderRadius: 8, padding: '10px 12px', background: '#fffdf6' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                  <span className="bdg" style={{ fontSize: 10, color: c.type === '세법' ? '#1A2B52' : '#8a5a00' }}>{c.type}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#1A2B52' }}>{c.ref}</span>
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.6, color: '#4b5563', whiteSpace: 'pre-wrap' }}>{c.text}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <div style={{ fontSize: 11, color: '#9aa0ad', marginTop: 12, lineHeight: 1.6 }}>
        회계기준 근거는 요지 정리본입니다. 인용·적용 전 원문 대조를 권고하며, 최종 판단·서명은 담당 회계사·세무사가 합니다.
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#1A2B52', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: ConsultStatus }) {
  const final = status === 'final';
  return (
    <span
      className="bdg"
      style={{
        fontSize: 10, fontWeight: 700,
        color: final ? '#1A6E3C' : '#8a5a00',
        background: final ? '#e6f4ec' : '#fdf3e0',
        border: `1px solid ${final ? '#bfe3cc' : '#f0dcb4'}`,
      }}
    >
      {final ? '확정' : '초안'}
    </span>
  );
}

const rowStyle: React.CSSProperties = {
  textAlign: 'left', border: '1px solid #e4e0d8', borderRadius: 7, padding: '10px 13px',
  background: '#fff', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'stretch', width: '100%',
};
