// 자료실 — 사무소 내부 문서 보관소. 참고자료(예규·해석사례·개정세법 등)와 서식·템플릿을 한곳에서
//  업로드·검색·다운로드한다. 열람은 전 직원, 업로드는 읽기전용·외부인 제외, 수정·삭제는 업로더/관리자(RLS 0024).
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { dtFmt } from '../../lib/format';
import {
  listDocuments,
  uploadDocument,
  deleteDocument,
  getDocumentUrl,
  fmtFileSize,
  LIBRARY_KIND_LABEL,
  type LibraryDoc,
  type LibraryKind,
} from '../../lib/libraryApi';
import { TagEditor, TagList } from './TagsField';

const KIND_CATEGORIES: Record<LibraryKind, string[]> = {
  reference: ['예규·해석사례', '개정세법', '실무 가이드', '체크리스트', '국세청 발간자료', '기타'],
  template: ['회신 서식', '검토보고서', '위임장·확인서', '계약서', '기타'],
};

export default function LibraryTab() {
  const { user, role, readonly } = useAuth();
  const canWrite = !readonly && role !== 'external';
  const isManager = role === 'superuser' || role === 'accountant' || role === 'team_lead';

  const [docs, setDocs] = useState<LibraryDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [kindFilter, setKindFilter] = useState<'all' | LibraryKind>('all');
  const [text, setText] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  async function reload() {
    try {
      const rows = await listDocuments();
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
    const kindOk = kindFilter === 'all' || d.kind === kindFilter;
    const catOk = !categoryFilter || d.category === categoryFilter;
    const tagOk = !tagFilter || d.tags.includes(tagFilter);
    const textOk =
      !f || d.title.includes(f) || d.description.includes(f) || d.category.includes(f) || d.fileName.includes(f) || d.uploadedByName.includes(f) || d.tags.some((t) => t.includes(f));
    return kindOk && catOk && tagOk && textOk;
  });

  const categories = useMemo(
    () => [...new Set((docs ?? []).filter((d) => (kindFilter === 'all' || d.kind === kindFilter) && d.category).map((d) => d.category))].sort((a, b) => a.localeCompare(b, 'ko')),
    [docs, kindFilter]
  );
  const topTags = useMemo(() => {
    const c = new Map<string, number>();
    for (const d of docs ?? []) for (const t of d.tags) c.set(t, (c.get(t) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map((e) => e[0]);
  }, [docs]);

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        📁 자료실
        <span style={{ marginLeft: 'auto' }}>
          <button className="btn-sm" onClick={reload}>↻ 새로고침</button>
        </span>
      </div>

      {canWrite && <UploadForm onDone={reload} />}

      {/* 유형 탭 */}
      <div style={{ display: 'flex', gap: 6, marginTop: canWrite ? 16 : 0, marginBottom: 10 }}>
        {(['all', 'reference', 'template'] as const).map((k) => (
          <button
            key={k}
            className={`btn-sm${kindFilter === k ? ' btn-p' : ''}`}
            onClick={() => { setKindFilter(k); setCategoryFilter(''); }}
          >
            {k === 'all' ? '전체' : LIBRARY_KIND_LABEL[k]}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
        <div style={{ flex: '1 1 240px' }}>
          <label className="fl">제목 · 내용 · 파일명 · 태그 검색</label>
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="예: 접대비 / 개정세법 / 위임장" />
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
          총 {docs.length}건 {(f || categoryFilter || tagFilter || kindFilter !== 'all') && `· 필터 ${filtered.length}건`}
        </div>
      )}

      {docs !== null && filtered.length === 0 && (
        <div className="alert-i">
          {docs.length === 0 ? '등록된 자료가 없습니다. 참고자료·서식을 업로드해 보세요.' : '검색 결과가 없습니다.'}
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
  const [kind, setKind] = useState<LibraryKind>('reference');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function resetForm() {
    setTitle(''); setCategory(''); setTags([]); setDescription(''); setFile(null); setErr(null);
  }

  async function submit() {
    if (busy) return;
    if (!file) { setErr('파일을 선택해 주세요.'); return; }
    setBusy(true);
    setErr(null);
    setOk(false);
    try {
      await uploadDocument({ kind, title: title.trim() || file.name, description, category: category.trim(), tags, file });
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
        {open ? '▾' : '▸'} ⬆️ 자료 업로드
      </button>
      {ok && !open && <span style={{ marginLeft: 8, fontSize: 12, color: '#1A6E3C', fontWeight: 600 }}>업로드됨 ✓</span>}

      {open && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
            <div style={{ flex: '0 1 150px' }}>
              <label className="fl">유형 *</label>
              <select value={kind} onChange={(e) => { setKind(e.target.value as LibraryKind); setCategory(''); }}>
                <option value="reference">참고자료</option>
                <option value="template">서식·템플릿</option>
              </select>
            </div>
            <div style={{ flex: '0 1 200px' }}>
              <label className="fl">분류</label>
              <input list="lib-cats" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="예: 예규·해석사례" />
              <datalist id="lib-cats">
                {KIND_CATEGORIES[kind].map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div style={{ flex: '2 1 240px' }}>
              <label className="fl">제목 (비우면 파일명)</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="자료 제목" />
            </div>
          </div>

          <div>
            <label className="fl">파일 *</label>
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file && <span style={{ marginLeft: 8, fontSize: 12, color: '#6b7280' }}>{file.name} · {fmtFileSize(file.size)}</span>}
          </div>

          <div>
            <label className="fl">설명 (선택)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} style={{ resize: 'vertical', lineHeight: 1.5 }} placeholder="자료 요약·활용 메모" />
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

function DocRow({ doc, canManage, onChanged }: { doc: LibraryDoc; canManage: boolean; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function open(download: boolean) {
    setErr(null);
    try {
      const url = await getDocumentUrl(doc.storagePath, download ? { download: doc.fileName } : {});
      if (!url) { setErr('파일 링크를 생성하지 못했습니다.'); return; }
      window.open(url, '_blank', 'noopener');
    } catch {
      setErr('파일을 여는 중 오류가 발생했습니다.');
    }
  }

  async function remove() {
    if (busy || !window.confirm('이 자료를 삭제하시겠습니까? 파일과 정보가 함께 삭제됩니다.')) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteDocument(doc);
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '삭제 중 오류가 발생했습니다.');
      setBusy(false);
    }
  }

  return (
    <div style={rowStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
        <span className="bdg" style={{ fontSize: 10, fontWeight: 700, color: doc.kind === 'template' ? '#8a5a00' : '#1A2B52', background: doc.kind === 'template' ? '#fdf3e0' : '#eef2fb', border: `1px solid ${doc.kind === 'template' ? '#f0dcb4' : '#cdd8ef'}`, whiteSpace: 'nowrap' }}>
          {LIBRARY_KIND_LABEL[doc.kind]}
        </span>
        {doc.category && <span style={{ fontSize: 11, color: '#8a8170', whiteSpace: 'nowrap' }}>{doc.category}</span>}
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
