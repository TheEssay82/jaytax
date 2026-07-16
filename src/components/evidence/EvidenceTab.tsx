// 증빙 자료실 — 일반업무관리 대분류. 각종 계약서·증빙 자료를 업로드·검색·다운로드한다.
//  열람은 외부인 제외 전 직원(인당회계사 포함), 업로드는 읽기전용·외부인 제외, 수정·삭제는 업로더/관리자(RLS 0038).
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { dtFmt } from '../../lib/format';
import {
  listEvidence,
  uploadEvidence,
  deleteEvidence,
  getEvidenceUrl,
  fmtFileSize,
  type EvidenceDoc,
} from '../../lib/evidenceApi';
import { TagEditor, TagList } from '../advisory/TagsField';

const CATEGORIES = [
  '계약서',
  '사업자등록증',
  '위임장·확인서',
  '통장사본',
  '신분증 사본',
  '견적서·발주서',
  '세금계산서·영수증',
  '기타',
];

export default function EvidenceTab() {
  const { user, role, readonly } = useAuth();
  const canWrite = !readonly && role !== 'external';
  const isManager = role === 'superuser' || role === 'accountant' || role === 'team_lead';

  const [docs, setDocs] = useState<EvidenceDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [text, setText] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  async function reload() {
    try {
      const rows = await listEvidence();
      setDocs(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '자료를 불러오지 못했습니다.');
      setDocs(null);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  const f = text.trim();
  const filtered = (docs ?? []).filter((d) => {
    const catOk = !categoryFilter || d.category === categoryFilter;
    const tagOk = !tagFilter || d.tags.includes(tagFilter);
    const textOk =
      !f ||
      d.title.includes(f) ||
      d.description.includes(f) ||
      d.category.includes(f) ||
      d.counterparty.includes(f) ||
      d.fileName.includes(f) ||
      d.uploadedByName.includes(f) ||
      d.tags.some((t) => t.includes(f));
    return catOk && tagOk && textOk;
  });

  const categories = useMemo(
    () => [...new Set((docs ?? []).filter((d) => d.category).map((d) => d.category))].sort((a, b) => a.localeCompare(b, 'ko')),
    [docs]
  );
  const topTags = useMemo(() => {
    const c = new Map<string, number>();
    for (const d of docs ?? []) for (const t of d.tags) c.set(t, (c.get(t) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map((e) => e[0]);
  }, [docs]);

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        📑 증빙 자료실
        <span style={{ marginLeft: 'auto' }}>
          <button className="btn-sm" onClick={reload}>↻ 새로고침</button>
        </span>
      </div>

      <div style={{ fontSize: 12, color: '#8a8170', marginBottom: canWrite ? 12 : 8 }}>
        각종 계약서·사업자등록증·위임장 등 증빙 자료를 보관합니다. 열람은 외부인을 제외한 전 직원이 가능합니다.
      </div>

      {canWrite && <UploadForm onDone={reload} />}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end', marginTop: canWrite ? 16 : 0 }}>
        <div style={{ flex: '1 1 240px' }}>
          <label className="fl">제목 · 내용 · 거래처 · 파일명 · 태그 검색</label>
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="예: 임대차 / ㈜오톰 / 위임장" />
        </div>
        {categories.length > 0 && (
          <div style={{ flex: '0 1 200px' }}>
            <label className="fl">분류</label>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">전체 분류</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {topTags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 10 }}>
          <span style={{ fontSize: 11.5, color: '#8a8170', fontWeight: 700 }}>태그</span>
          <TagList tags={topTags} active={tagFilter} onSelect={(t) => setTagFilter((cur) => (cur === t ? null : t))} />
          {tagFilter && <button className="btn-sm" style={{ fontSize: 11 }} onClick={() => setTagFilter(null)}>필터 해제</button>}
        </div>
      )}

      {error && <div className="alert-w" style={{ marginTop: 12 }}>{error}</div>}
      {docs === null && !error && <div className="alert-i" style={{ marginTop: 12 }}>불러오는 중…</div>}

      {docs !== null && (
        <div style={{ fontSize: 12, color: '#6b7280', margin: '10px 0' }}>
          총 {docs.length}건 {(f || categoryFilter || tagFilter) && `· 필터 ${filtered.length}건`}
        </div>
      )}

      {docs !== null && filtered.length === 0 && (
        <div className="alert-i">
          {docs.length === 0 ? '등록된 증빙이 없습니다. 계약서·증빙 자료를 업로드해 보세요.' : '검색 결과가 없습니다.'}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.map((d) => (
          <DocRow
            key={d.id}
            doc={d}
            canManage={canWrite && (isManager || (!!user && d.uploadedById === user.id))}
            onChanged={reload}
          />
        ))}
      </div>
    </div>
  );
}

function UploadForm({ onDone }: { onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function resetForm() {
    setTitle(''); setCategory(''); setCounterparty(''); setTags([]); setDescription(''); setFile(null); setErr(null);
  }

  async function submit() {
    if (busy) return;
    if (!file) { setErr('파일을 선택해 주세요.'); return; }
    setBusy(true);
    setErr(null);
    setOk(false);
    try {
      await uploadEvidence({ title: title.trim() || file.name, description, category: category.trim(), counterparty: counterparty.trim(), tags, file });
      resetForm();
      setOk(true);
      await onDone();
      setTimeout(() => setOk(false), 2500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '업로드 중 오류가 발생했습니다.';
      setErr(/row-level security|ro_block|policy/i.test(msg) ? '권한이 없어 업로드할 수 없습니다.' : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: '1px dashed #d8d2c6', borderRadius: 8, background: '#fbfaf6', padding: '10px 12px' }}>
      <button type="button" className="btn-sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? '▾' : '▸'} ⬆️ 증빙 업로드
      </button>
      {ok && !open && <span style={{ marginLeft: 8, fontSize: 12, color: '#1A6E3C', fontWeight: 600 }}>업로드됨 ✓</span>}

      {open && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
            <div style={{ flex: '0 1 190px' }}>
              <label className="fl">분류</label>
              <input list="ev-cats" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="예: 계약서" />
              <datalist id="ev-cats">
                {CATEGORIES.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div style={{ flex: '0 1 200px' }}>
              <label className="fl">관련 거래처·상대방</label>
              <input type="text" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="예: ㈜오톰" />
            </div>
            <div style={{ flex: '2 1 240px' }}>
              <label className="fl">제목 (비우면 파일명)</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="증빙 제목" />
            </div>
          </div>

          <div>
            <label className="fl">파일 *</label>
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file && <span style={{ marginLeft: 8, fontSize: 12, color: '#6b7280' }}>{file.name} · {fmtFileSize(file.size)}</span>}
          </div>

          <div>
            <label className="fl">설명 (선택)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} style={{ resize: 'vertical', lineHeight: 1.5 }} placeholder="증빙 요약·메모(계약기간·금액 등)" />
          </div>

          <div>
            <label className="fl">태그</label>
            <TagEditor value={tags} onChange={setTags} />
          </div>

          {err && <div className="alert-w">{err}</div>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn-p btn-sm" onClick={submit} disabled={busy || !file}>
              {busy ? '업로드 중…' : '⬆️ 업로드'}
            </button>
            <button type="button" className="btn-sm" onClick={resetForm} disabled={busy}>초기화</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DocRow({ doc, canManage, onChanged }: { doc: EvidenceDoc; canManage: boolean; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function open(download: boolean) {
    setErr(null);
    try {
      const url = await getEvidenceUrl(doc.storagePath, download ? { download: doc.fileName } : {});
      if (!url) { setErr('파일 링크를 생성하지 못했습니다.'); return; }
      window.open(url, '_blank', 'noopener');
    } catch {
      setErr('파일을 여는 중 오류가 발생했습니다.');
    }
  }

  async function remove() {
    if (busy || !window.confirm('이 증빙을 삭제하시겠습니까? 파일과 정보가 함께 삭제됩니다.')) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteEvidence(doc);
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '삭제 중 오류가 발생했습니다.');
      setBusy(false);
    }
  }

  return (
    <div style={rowStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
        {doc.category && (
          <span className="bdg" style={{ fontSize: 10, fontWeight: 700, color: '#1A2B52', background: '#eef2fb', border: '1px solid #cdd8ef', whiteSpace: 'nowrap' }}>
            {doc.category}
          </span>
        )}
        {doc.counterparty && <span style={{ fontSize: 11, color: '#8a8170', whiteSpace: 'nowrap' }}>{doc.counterparty}</span>}
        <span style={{ flex: 1, fontWeight: 600, color: '#1f2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {doc.title || doc.fileName}
        </span>
        <span style={{ fontSize: 11, color: '#9aa0ad', whiteSpace: 'nowrap' }}>
          {doc.fileExt && <b style={{ textTransform: 'uppercase' }}>{doc.fileExt}</b>}{doc.fileSize ? ` · ${fmtFileSize(doc.fileSize)}` : ''}
        </span>
        <span style={{ display: 'inline-flex', gap: 6, whiteSpace: 'nowrap' }}>
          <button className="btn-sm" onClick={() => open(false)}>열기</button>
          <button className="btn-sm" onClick={() => open(true)}>⬇️</button>
          {canManage && <button className="btn-sm" onClick={remove} disabled={busy} style={{ color: '#b91c1c' }}>🗑️</button>}
        </span>
      </div>
      {doc.description && (
        <div style={{ marginTop: 6, fontSize: 12.5, color: '#4b5563', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{doc.description}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        {doc.tags.length > 0 && <TagList tags={doc.tags} />}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9aa0ad', whiteSpace: 'nowrap' }}>
          {doc.uploadedByName} · {dtFmt(doc.createdAt)}
        </span>
      </div>
      {err && <div className="alert-w" style={{ marginTop: 6 }}>{err}</div>}
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  border: '1px solid #e4e0d8', borderRadius: 7, padding: '10px 13px',
  background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'stretch', width: '100%',
};
