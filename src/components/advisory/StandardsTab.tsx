// 회계기준 검색 — 세 가지 진입(KASB 열람서비스 구조 차용):
//  1) 통합검색: 질의 → 의미검색(standards-query) → 유사 문단
//  2) 기준서 목록: 대분류 → 기준서 클릭 → 전체 문단 열람 + 관련 질의회신
//  3) 질의회신: KASB 질의회신 제목 인덱스(본문은 KASB 원문 링크)
// 근거 문단은 요지 정리본이므로 인용 시 "(요지)"·원문 대조 권고를 함께 노출한다.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  queryStandards,
  loadedStandardKeys,
  fetchStandardParagraphs,
  loadQnaIndex,
  filterQnasByStandardNo,
  fetchQnaContent,
  KASB_STANDARDS_URL,
  loadStandardPdfKeys,
  uploadStandardPdf,
  getStandardPdfUrl,
  deleteStandardPdf,
  type StandardMatch,
  type ParagraphRow,
  type QnaIndexItem,
  type QnaContent,
} from '../../lib/standardsApi';
import { CATALOG, type CatalogItem, type StandardSet } from '../../lib/standardsCatalog';

type Mode = 'search' | 'browse' | 'qna';

export default function StandardsTab() {
  const [mode, setMode] = useState<Mode>('browse');
  const [loadedKeys, setLoadedKeys] = useState<Set<string>>(new Set());
  const [qnaIndex, setQnaIndex] = useState<QnaIndexItem[]>([]);
  const [pdfKeys, setPdfKeys] = useState<Set<string>>(new Set());
  const [qnaOpen, setQnaOpen] = useState<QnaIndexItem | null>(null); // 질의회신 본문 모달

  const reloadPdfKeys = () =>
    loadStandardPdfKeys(CATALOG.map((c) => c.set)).then(setPdfKeys).catch(() => setPdfKeys(new Set()));

  useEffect(() => {
    loadedStandardKeys().then(setLoadedKeys).catch(() => setLoadedKeys(new Set()));
    loadQnaIndex().then(setQnaIndex).catch(() => setQnaIndex([]));
    reloadPdfKeys();
  }, []);

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        📚 회계기준 검색
        <span style={{ display: 'inline-flex', gap: 6, marginLeft: 'auto' }}>
          {(
            [
              ['browse', '📂 기준서 목록'],
              ['search', '🔎 통합검색'],
              ['qna', '💬 질의회신'],
            ] as [Mode, string][]
          ).map(([m, label]) => (
            <button
              key={m}
              className={`btn-sm${mode === m ? ' btn-sm-navy' : ''}`}
              onClick={() => setMode(m)}
            >
              {label}
            </button>
          ))}
        </span>
      </div>

      {mode === 'search' && <SearchView />}
      {mode === 'browse' && (
        <BrowseView loadedKeys={loadedKeys} qnaIndex={qnaIndex} pdfKeys={pdfKeys} onPdfChange={reloadPdfKeys} onOpenQna={setQnaOpen} />
      )}
      {mode === 'qna' && <QnaView items={qnaIndex} onOpenQna={setQnaOpen} />}

      {qnaOpen && <QnaModal item={qnaOpen} onClose={() => setQnaOpen(null)} />}
    </div>
  );
}

// ─────────────────────────────────────────── 1) 통합검색
function SearchView() {
  const [question, setQuestion] = useState('');
  const [standardNo, setStandardNo] = useState('1115');
  const [matchCount, setMatchCount] = useState(5);
  const [matches, setMatches] = useState<StandardMatch[] | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await queryStandards(q, { standardNo: standardNo || undefined, matchCount });
      setMatches(res.matches);
      setNotice(res.notice);
    } catch (err) {
      setError(err instanceof Error ? err.message : '검색 중 오류가 발생했습니다.');
      setMatches(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={run}>
        <div className="frow" style={{ gridTemplateColumns: '1fr' }}>
          <label className="fl">질의</label>
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="예: 변동대가 추정 방법은? / 기간에 걸쳐 수익을 인식하는 조건은?"
            autoFocus
          />
        </div>
        <div className="frow" style={{ gridTemplateColumns: '1fr 1fr auto', alignItems: 'end', gap: 10 }}>
          <div>
            <label className="fl">대상 기준서</label>
            <select value={standardNo} onChange={(e) => setStandardNo(e.target.value)}>
              <option value="1115">K-IFRS 제1115호 (수익)</option>
              <option value="">전체 (적재된 기준서)</option>
            </select>
          </div>
          <div>
            <label className="fl">결과 수</label>
            <select value={matchCount} onChange={(e) => setMatchCount(Number(e.target.value))}>
              {[3, 5, 8, 10].map((n) => (
                <option key={n} value={n}>{n}개</option>
              ))}
            </select>
          </div>
          <button className="btn-p" type="submit" disabled={busy || !question.trim()}>
            {busy ? '검색 중…' : '🔍 근거 검색'}
          </button>
        </div>
      </form>

      {error && <div className="alert-w" style={{ marginTop: 14 }}>{error}</div>}

      {matches && !error && (
        <div style={{ marginTop: 16 }}>
          {notice && <div className="alert-i" style={{ marginBottom: 12, fontSize: 12, lineHeight: 1.6 }}>⚠️ {notice}</div>}
          {matches.length === 0 ? (
            <div className="alert-i">관련 문단을 찾지 못했습니다. 상위개념·동의어로 바꿔 다시 검색해 보세요.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {matches.map((m, i) => (
                <div key={`${m.standard_no}-${m.paragraph_no}-${i}`} style={cardStyle}>
                  <div style={rowStyle}>
                    <span className="bdg b-on" style={{ fontSize: 11 }}>{m.citation}</span>
                    {m.section_title && <span style={subStyle}>{m.section_title}</span>}
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9aa0ad' }}>
                      유사도 {(m.similarity * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div style={contentStyle}>{m.content}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!matches && !error && (
        <div className="alert-i" style={{ marginTop: 14, lineHeight: 1.7 }}>
          회계기준(현재 파일럿: K-IFRS 제1115호)에 대한 질의를 입력하면 관련 문단을 유사도순으로 검색합니다.
          검색된 문단은 <b>요지 정리본</b>이며, 인용·적용 전 원문 대조를 권고합니다.
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────── 2) 기준서 목록(브라우징) + 상세 열람
function BrowseView({
  loadedKeys,
  qnaIndex,
  pdfKeys,
  onPdfChange,
  onOpenQna,
}: {
  loadedKeys: Set<string>;
  qnaIndex: QnaIndexItem[];
  pdfKeys: Set<string>;
  onPdfChange: () => void;
  onOpenQna: (q: QnaIndexItem) => void;
}) {
  const [catIdx, setCatIdx] = useState(0);
  const [selected, setSelected] = useState<{ set: StandardSet; item: CatalogItem } | null>(null);

  if (selected) {
    return (
      <StandardDetail
        set={selected.set}
        item={selected.item}
        qnaIndex={qnaIndex}
        loaded={loadedKeys.has(`${selected.set} ${selected.item.no}`)}
        hasPdf={pdfKeys.has(`${selected.set} ${selected.item.no}`)}
        onPdfChange={onPdfChange}
        onOpenQna={onOpenQna}
        onBack={() => setSelected(null)}
      />
    );
  }

  const cat = CATALOG[catIdx];
  return (
    <div style={{ marginTop: 8 }}>
      {/* 대분류 탭 */}
      <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid #e4e0d8', marginBottom: 12 }}>
        {CATALOG.map((c, i) => (
          <button
            key={c.set}
            onClick={() => setCatIdx(i)}
            style={{
              border: 'none',
              background: 'none',
              padding: '8px 12px',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: catIdx === i ? 700 : 500,
              color: catIdx === i ? '#1A2B52' : '#6b7280',
              borderBottom: catIdx === i ? '2px solid #1A2B52' : '2px solid transparent',
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {cat.groups.map((g) => (
        <div key={g.label} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#8a8170', marginBottom: 6 }}>{g.label}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6 }}>
            {g.items.map((item, i) => {
              const loaded = item.no !== '' && loadedKeys.has(`${cat.set} ${item.no}`);
              const hasPdf = item.no !== '' && pdfKeys.has(`${cat.set} ${item.no}`);
              const clickable = item.no !== ''; // 번호 있는 기준서는 PDF 게시·열람 위해 항상 진입 가능
              const active = loaded || hasPdf;
              return (
                <button
                  key={`${item.no}-${i}`}
                  disabled={!clickable}
                  onClick={() => clickable && setSelected({ set: cat.set, item })}
                  title={clickable ? '클릭하여 열람·PDF 게시' : '항목 없음'}
                  style={{
                    textAlign: 'left',
                    border: '1px solid ' + (active ? '#c9b88a' : clickable ? '#e4e0d8' : '#ececec'),
                    background: active ? '#fffdf6' : clickable ? '#fff' : '#fafafa',
                    color: clickable ? '#1f2937' : '#b0b0b0',
                    borderRadius: 6,
                    padding: '7px 10px',
                    cursor: clickable ? 'pointer' : 'default',
                    fontSize: 12.5,
                    display: 'flex',
                    gap: 6,
                    alignItems: 'baseline',
                  }}
                >
                  {item.no && <span style={{ fontWeight: 700, minWidth: 38, color: active ? '#1A2B52' : clickable ? '#6b7280' : '#bbb' }}>{item.no}</span>}
                  <span style={{ flex: 1 }}>{item.title}</span>
                  {hasPdf && <span className="bdg" style={{ fontSize: 9, color: '#b91c1c', background: '#fdeaea', border: '1px solid #f3caca' }}>PDF</span>}
                  {loaded && <span className="bdg b-on" style={{ fontSize: 9 }}>요지</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="alert-i" style={{ fontSize: 12, lineHeight: 1.6 }}>
        기준서를 클릭하면 <b>원문 PDF</b>를 게시·열람하고, <b>요지 정리본</b>(적재된 경우)을 함께 볼 수 있습니다.
        <span className="bdg" style={{ fontSize: 9, color: '#b91c1c', background: '#fdeaea', border: '1px solid #f3caca', margin: '0 3px' }}>PDF</span>는 원문 게시,
        <span className="bdg b-on" style={{ fontSize: 9, margin: '0 3px' }}>요지</span>는 정리본 적재를 뜻합니다.
        참고로 KASB 원문 열람은{' '}
        <a href={KASB_STANDARDS_URL} target="_blank" rel="noreferrer" style={{ color: '#C8963C', fontWeight: 700 }}>
          열람서비스 ↗
        </a>
        에서도 가능합니다.
      </div>
    </div>
  );
}

function StandardDetail({
  set,
  item,
  qnaIndex,
  loaded,
  hasPdf,
  onPdfChange,
  onOpenQna,
  onBack,
}: {
  set: StandardSet;
  item: CatalogItem;
  qnaIndex: QnaIndexItem[];
  loaded: boolean;
  hasPdf: boolean;
  onPdfChange: () => void;
  onOpenQna: (q: QnaIndexItem) => void;
  onBack: () => void;
}) {
  const [paras, setParas] = useState<ParagraphRow[] | null>(null);
  const [busy, setBusy] = useState(loaded);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) { setParas(null); setBusy(false); return; }
    setBusy(true);
    fetchStandardParagraphs(set, item.no)
      .then((rows) => { setParas(rows); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, [set, item.no, loaded]);

  const related = filterQnasByStandardNo(qnaIndex, item.no);
  let lastSection: string | null = null;

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button className="btn-sm" onClick={onBack}>← 목록으로</button>
        <a
          href={KASB_STANDARDS_URL}
          target="_blank"
          rel="noreferrer"
          className="btn-sm btn-sm-navy"
          style={{ marginLeft: 'auto', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          title="한국회계기준원(KASB) 회계기준열람서비스 열기 — 기준서 번호로 검색·열람·내려받기"
        >
          📖 KASB 열람서비스 ↗
        </a>
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#1A2B52', marginBottom: 10 }}>
        {set} {item.no && `제${item.no}호 `}{item.title}
      </div>

      {/* 원문 PDF (게시·열람·다운로드) */}
      <StandardPdfSection set={set} no={item.no} hasPdf={hasPdf} onChange={onPdfChange} />

      {/* 요지 정리본 (적재된 경우만) */}
      {loaded && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1A2B52', marginBottom: 6 }}>📝 요지 정리본</div>
          <div className="alert-i" style={{ fontSize: 12, marginBottom: 8 }}>
            아래는 <b>요지 정리본</b>(원문 verbatim 아님)입니다. 정확한 인용은 위 <b>원문 PDF</b>를 사용하세요.
          </div>
          {busy && <div className="alert-i">문단을 불러오는 중…</div>}
          {error && <div className="alert-w">{error}</div>}
          {paras && !busy && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {paras.map((p, i) => {
                const showSection = p.section_title && p.section_title !== lastSection;
                if (p.section_title) lastSection = p.section_title;
                return (
                  <div key={`${p.paragraph_no}-${i}`}>
                    {showSection && (
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#8a8170', margin: '12px 0 4px' }}>
                        {p.part !== '본문' ? `[${p.part}] ` : ''}{p.section_title}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, padding: '3px 0', alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 700, color: '#1A2B52', minWidth: 42, fontSize: 12.5 }}>§{p.paragraph_no}</span>
                      <span style={{ fontSize: 13.5, lineHeight: 1.6, color: '#1f2937' }}>{p.content}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {related.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1A2B52', marginBottom: 8 }}>
            💬 관련 질의회신 ({related.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {related.map((q) => (
              <button key={q.id} type="button" onClick={() => onOpenQna(q)} style={qnaLinkStyle}>
                <span style={{ flex: 1, textAlign: 'left' }}>{q.title}</span>
                {q.date && <span style={{ fontSize: 11, color: '#9aa0ad' }}>{q.date}</span>}
                <span style={{ fontSize: 11, color: '#C8963C' }}>본문 보기</span>
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#9aa0ad', marginTop: 6 }}>
            제목을 클릭하면 질의회신 본문을 앱에서 바로 봅니다(KASB 원문 링크도 함께 제공).
          </div>
        </div>
      )}
    </div>
  );
}

// 원문 PDF 게시 섹션 — Storage(standard-pdfs) 업로드·열람·다운로드·삭제
function StandardPdfSection({
  set,
  no,
  hasPdf,
  onChange,
}: {
  set: StandardSet;
  no: string;
  hasPdf: boolean;
  onChange: () => void;
}) {
  const [exists, setExists] = useState(hasPdf);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    setExists(hasPdf);
    if (hasPdf) getStandardPdfUrl(set, no).then((u) => { if (active) setUrl(u); });
    else setUrl(null);
    return () => { active = false; };
  }, [set, no, hasPdf]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf') { setError('PDF 파일만 업로드할 수 있습니다.'); return; }
    setBusy(true);
    setError(null);
    try {
      await uploadStandardPdf(set, no, file);
      setExists(true);
      setUrl(await getStandardPdfUrl(set, no)); // 교체 시 새 서명 URL
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : '업로드에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    const u = await getStandardPdfUrl(set, no, { download: `${set}_${no || '기준서'}.pdf` });
    if (u) window.location.href = u;
  }

  async function remove() {
    if (busy || !window.confirm('이 기준서의 원문 PDF를 삭제하시겠습니까? 되돌릴 수 없습니다.')) return;
    setBusy(true);
    setError(null);
    try {
      await deleteStandardPdf(set, no);
      setExists(false);
      setUrl(null);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : '삭제에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1A2B52' }}>📄 원문 PDF</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
          {exists && url && <a className="btn-sm" href={url} target="_blank" rel="noreferrer">↗ 새 탭</a>}
          {exists && <button className="btn-sm" onClick={download} disabled={busy}>⬇ 다운로드</button>}
          <button className="btn-sm btn-sm-navy" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? '처리 중…' : exists ? '🔁 교체' : '⬆ PDF 업로드'}
          </button>
          {exists && <button className="btn-sm" onClick={remove} disabled={busy} style={{ color: '#b91c1c' }}>🗑️ 삭제</button>}
        </span>
        <input ref={fileRef} type="file" accept="application/pdf" onChange={onFile} style={{ display: 'none' }} />
      </div>

      {error && <div className="alert-w" style={{ marginBottom: 8 }}>{error}</div>}

      {exists ? (
        url ? (
          <iframe title="기준서 원문 PDF" src={url} style={{ width: '100%', height: '78vh', border: '1px solid #e4e0d8', borderRadius: 8 }} />
        ) : (
          <div className="alert-i">PDF를 불러오는 중…</div>
        )
      ) : (
        <div className="alert-i" style={{ lineHeight: 1.7 }}>
          아직 게시된 원문 PDF가 없습니다. <b>⬆ PDF 업로드</b>로 이 기준서의 공식 전문 PDF를 올리면 여기서 열람·다운로드할 수 있습니다.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────── 3) 질의회신 인덱스
function QnaView({ items, onOpenQna }: { items: QnaIndexItem[]; onOpenQna: (q: QnaIndexItem) => void }) {
  const [filter, setFilter] = useState('');
  const LIMIT = 80;
  const f = filter.trim();
  const filtered = f
    ? items.filter((q) => q.title.includes(f) || (q.relStds ?? '').includes(f))
    : items;
  const shown = filtered.slice(0, LIMIT);

  return (
    <div style={{ marginTop: 8 }}>
      <div className="frow" style={{ gridTemplateColumns: '1fr' }}>
        <label className="fl">질의회신 제목·관련기준 검색</label>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="예: 리스 / 변동대가 / 1115 / 가상통화"
          autoFocus
        />
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', margin: '6px 0 10px' }}>
        총 {items.length}건 중 {filtered.length}건 {filtered.length > LIMIT && `(상위 ${LIMIT}건 표시)`} · 제목 클릭 시 본문 표시
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {shown.map((q) => (
          <button key={q.id} type="button" onClick={() => onOpenQna(q)} style={qnaLinkStyle}>
            <span style={{ flex: 1, textAlign: 'left' }}>
              {q.title}
              {q.deprecated && <span className="bdg" style={{ marginLeft: 6, fontSize: 9, color: '#b91c1c' }}>폐지</span>}
            </span>
            {q.relStds && <span style={{ fontSize: 11, color: '#6b7280', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.relStds}</span>}
            <span style={{ fontSize: 11, color: '#C8963C' }}>본문 보기</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────── 질의회신 본문 모달
// KASB SPA가 직접 링크로 본문을 렌더하지 않아, kasb-qna Edge로 API 본문을 받아 앱에서 표시한다.
function QnaModal({ item, onClose }: { item: QnaIndexItem; onClose: () => void }) {
  const [content, setContent] = useState<QnaContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setContent(null);
    setError(null);
    fetchQnaContent(item.id)
      .then((c) => { if (alive) setContent(c); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [item.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div onClick={onClose} style={qnaBackdrop}>
      <div onClick={(e) => e.stopPropagation()} style={qnaSheet}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: '#1A2B52', lineHeight: 1.4 }}>
              {item.title}
              {item.deprecated && <span className="bdg" style={{ marginLeft: 6, fontSize: 9, color: '#b91c1c' }}>폐지</span>}
            </div>
            <div style={{ fontSize: 11.5, color: '#8a8170', marginTop: 3 }}>
              {[item.relStds, content?.docNumber || item.docNumber, content?.date || item.date].filter(Boolean).join(' · ')}
            </div>
          </div>
          <button className="btn-sm" onClick={onClose}>닫기 ✕</button>
        </div>

        {!content && !error && <div className="alert-i" style={{ marginTop: 10 }}>본문을 불러오는 중…</div>}
        {error && <div className="alert-w" style={{ marginTop: 10 }}>본문을 불러오지 못했습니다: {error}</div>}
        {content && (
          <div style={{ marginTop: 10 }}>
            {content.body.split('\n').map((line, i) => {
              const t = line.trim();
              if (t.startsWith('###')) {
                const h = t.replace(/^#+\s*/, '').trim();
                return h ? <div key={i} style={{ fontSize: 13, fontWeight: 700, color: '#1A2B52', margin: '12px 0 4px' }}>{h}</div> : null;
              }
              if (!t) return <div key={i} style={{ height: 6 }} />;
              return <div key={i} style={{ fontSize: 13.5, lineHeight: 1.7, color: '#1f2937', whiteSpace: 'pre-wrap' }}>{line}</div>;
            })}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, paddingTop: 10, borderTop: '1px solid #ece8e0', flexWrap: 'wrap' }}>
          <a href={`https://db.kasb.or.kr/api/qnas/${item.id}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#C8963C', fontWeight: 700, textDecoration: 'none' }}
            title="KASB 원본 데이터(JSON)를 새 탭에서 엽니다 — 표시된 본문의 완전성을 대조할 수 있습니다">
            🔎 KASB 원문 데이터(대조용) ↗
          </a>
          <span style={{ fontSize: 11, color: '#9aa0ad', marginLeft: 'auto' }}>
            위 본문은 KASB 원문 데이터(content)를 가공 없이 그대로 표시합니다.
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── 공통 스타일 ──
const cardStyle: React.CSSProperties = { border: '1px solid #e4e0d8', borderRadius: 8, padding: '12px 14px', background: '#fff' };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' };
const subStyle: React.CSSProperties = { fontSize: 12, color: '#6b7280' };
const contentStyle: React.CSSProperties = { fontSize: 13.5, lineHeight: 1.65, color: '#1f2937', whiteSpace: 'pre-wrap' };
const qnaLinkStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', width: '100%',
  border: '1px solid #ececec', borderRadius: 6, padding: '8px 11px', background: '#fff',
  color: '#1f2937', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
};
const qnaBackdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(20,25,40,.45)',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflow: 'auto', padding: '40px 16px',
};
const qnaSheet: React.CSSProperties = {
  background: '#fff', borderRadius: 10, padding: '18px 20px', maxWidth: 760, width: '100%',
  boxShadow: '0 10px 40px rgba(0,0,0,.25)', margin: 'auto',
};
