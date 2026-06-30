// 회계기준 검색 — 세 가지 진입(KASB 열람서비스 구조 차용):
//  1) 통합검색: 질의 → 의미검색(standards-query) → 유사 문단
//  2) 기준서 목록: 대분류 → 기준서 클릭 → 전체 문단 열람 + 관련 질의회신
//  3) 질의회신: KASB 질의회신 제목 인덱스(본문은 KASB 원문 링크)
// 근거 문단은 요지 정리본이므로 인용 시 "(요지)"·원문 대조 권고를 함께 노출한다.
import { useEffect, useState } from 'react';
import {
  queryStandards,
  loadedStandardKeys,
  fetchStandardParagraphs,
  loadQnaIndex,
  filterQnasByStandardNo,
  loadKasbStandardIndex,
  kasbStandardUrl,
  type StandardMatch,
  type ParagraphRow,
  type QnaIndexItem,
  type KasbStandardIndex,
} from '../../lib/standardsApi';
import { CATALOG, type CatalogItem, type StandardSet } from '../../lib/standardsCatalog';

type Mode = 'search' | 'browse' | 'qna';

export default function StandardsTab() {
  const [mode, setMode] = useState<Mode>('browse');
  const [loadedKeys, setLoadedKeys] = useState<Set<string>>(new Set());
  const [qnaIndex, setQnaIndex] = useState<QnaIndexItem[]>([]);
  const [kasbIndex, setKasbIndex] = useState<KasbStandardIndex | null>(null);

  useEffect(() => {
    loadedStandardKeys().then(setLoadedKeys).catch(() => setLoadedKeys(new Set()));
    loadQnaIndex().then(setQnaIndex).catch(() => setQnaIndex([]));
    loadKasbStandardIndex().then(setKasbIndex).catch(() => setKasbIndex(null));
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
      {mode === 'browse' && <BrowseView loadedKeys={loadedKeys} qnaIndex={qnaIndex} kasbIndex={kasbIndex} />}
      {mode === 'qna' && <QnaView items={qnaIndex} />}
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
  kasbIndex,
}: {
  loadedKeys: Set<string>;
  qnaIndex: QnaIndexItem[];
  kasbIndex: KasbStandardIndex | null;
}) {
  const [catIdx, setCatIdx] = useState(0);
  const [selected, setSelected] = useState<{ set: StandardSet; item: CatalogItem } | null>(null);

  if (selected) {
    return (
      <StandardDetail
        set={selected.set}
        item={selected.item}
        qnaIndex={qnaIndex}
        kasbUrl={kasbStandardUrl(kasbIndex, selected.item.no)}
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
              const kasbUrl = kasbStandardUrl(kasbIndex, item.no);
              return (
                <div
                  key={`${item.no}-${i}`}
                  style={{
                    display: 'flex',
                    alignItems: 'stretch',
                    border: '1px solid ' + (loaded ? '#c9b88a' : '#ececec'),
                    background: loaded ? '#fffdf6' : '#fafafa',
                    borderRadius: 6,
                    overflow: 'hidden',
                  }}
                >
                  <button
                    disabled={!loaded}
                    onClick={() => loaded && setSelected({ set: cat.set, item })}
                    title={loaded ? '클릭하여 열람' : '미적재 (열람 준비 중)'}
                    style={{
                      flex: 1,
                      textAlign: 'left',
                      border: 'none',
                      background: 'transparent',
                      color: loaded ? '#1f2937' : '#b0b0b0',
                      padding: '7px 10px',
                      cursor: loaded ? 'pointer' : 'default',
                      fontSize: 12.5,
                      display: 'flex',
                      gap: 8,
                      alignItems: 'baseline',
                      minWidth: 0,
                    }}
                  >
                    {item.no && <span style={{ fontWeight: 700, minWidth: 38, color: loaded ? '#1A2B52' : '#bbb' }}>{item.no}</span>}
                    <span style={{ flex: 1 }}>{item.title}</span>
                    {loaded && <span className="bdg b-on" style={{ fontSize: 9 }}>열람</span>}
                  </button>
                  {kasbUrl && (
                    <a
                      href={kasbUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="KASB에서 원문 보기"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0 8px',
                        borderLeft: '1px solid #ece6d6',
                        color: '#C8963C',
                        fontSize: 10.5,
                        fontWeight: 700,
                        textDecoration: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      원문 ↗
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="alert-i" style={{ fontSize: 12, lineHeight: 1.6 }}>
        강조 표시(열람)된 기준서만 본문이 적재돼 있습니다. 나머지는 목록만 있으며 적재 후 열람 가능합니다.
        본문은 <b>요지 정리본</b>입니다.
      </div>
    </div>
  );
}

function StandardDetail({
  set,
  item,
  qnaIndex,
  kasbUrl,
  onBack,
}: {
  set: StandardSet;
  item: CatalogItem;
  qnaIndex: QnaIndexItem[];
  kasbUrl: string | null;
  onBack: () => void;
}) {
  const [paras, setParas] = useState<ParagraphRow[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBusy(true);
    fetchStandardParagraphs(set, item.no)
      .then((rows) => { setParas(rows); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, [set, item.no]);

  const related = filterQnasByStandardNo(qnaIndex, item.no);
  let lastSection: string | null = null;

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button className="btn-sm" onClick={onBack}>← 목록으로</button>
        {kasbUrl && (
          <a
            href={kasbUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-sm btn-sm-navy"
            style={{ marginLeft: 'auto', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            title="한국회계기준원(KASB) 회계기준열람서비스에서 원문 보기·내려받기"
          >
            📄 KASB 원문 보기 ↗
          </a>
        )}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#1A2B52', marginBottom: 4 }}>
        {set} {item.no && `제${item.no}호 `}{item.title}
      </div>
      <div className="alert-i" style={{ fontSize: 12, marginBottom: 12 }}>
        본문은 요지 정리본(원문 verbatim 아님)입니다. 인용·적용 전 원문 대조를 권고합니다. 원문은 우측 <b>KASB 원문 보기</b>에서 확인하세요.
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

      {related.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1A2B52', marginBottom: 8 }}>
            💬 관련 질의회신 ({related.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {related.map((q) => (
              <a key={q.id} href={q.link} target="_blank" rel="noreferrer" style={qnaLinkStyle}>
                <span style={{ flex: 1 }}>{q.title}</span>
                {q.date && <span style={{ fontSize: 11, color: '#9aa0ad' }}>{q.date}</span>}
                <span style={{ fontSize: 11, color: '#C8963C' }}>KASB ↗</span>
              </a>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#9aa0ad', marginTop: 6 }}>
            질의회신 본문은 KASB 원문에서 확인하세요(제목·연결만 제공).
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────── 3) 질의회신 인덱스
function QnaView({ items }: { items: QnaIndexItem[] }) {
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
        총 {items.length}건 중 {filtered.length}건 {filtered.length > LIMIT && `(상위 ${LIMIT}건 표시)`} · 본문은 KASB 원문 링크
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {shown.map((q) => (
          <a key={q.id} href={q.link} target="_blank" rel="noreferrer" style={qnaLinkStyle}>
            <span style={{ flex: 1 }}>
              {q.title}
              {q.deprecated && <span className="bdg" style={{ marginLeft: 6, fontSize: 9, color: '#b91c1c' }}>폐지</span>}
            </span>
            {q.relStds && <span style={{ fontSize: 11, color: '#6b7280', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.relStds}</span>}
            <span style={{ fontSize: 11, color: '#C8963C' }}>KASB ↗</span>
          </a>
        ))}
      </div>
    </div>
  );
}

// ── 공통 스타일 ──
const cardStyle: React.CSSProperties = { border: '1px solid #e4e0d8', borderRadius: 8, padding: '12px 14px', background: '#fff' };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' };
const subStyle: React.CSSProperties = { fontSize: 12, color: '#6b7280' };
const contentStyle: React.CSSProperties = { fontSize: 13.5, lineHeight: 1.65, color: '#1f2937', whiteSpace: 'pre-wrap' };
const qnaLinkStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none',
  border: '1px solid #ececec', borderRadius: 6, padding: '8px 11px', background: '#fff',
  color: '#1f2937', fontSize: 13,
};
