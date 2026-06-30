// 세법 검색 — 법제처 국가법령정보 Open API(law-search Edge Function) 기반.
// 회계기준 검색과 대칭 구조지만, 법제처는 '원문'을 주므로 조문 원문 + 시행일을 그대로 표시한다(요지 아님).
//  통합검색/빠른선택 → 법령 목록 → 클릭 → 조문 전문 열람.
import { useState } from 'react';
import {
  searchLaws,
  fetchLawDetail,
  fmtEffDate,
  TAX_LAW_QUICKLIST,
  type LawSummary,
  type LawDetail,
} from '../../lib/lawApi';

export default function TaxLawTab() {
  const [query, setQuery] = useState('');
  const [laws, setLaws] = useState<LawSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<LawDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  async function run(q: string) {
    const term = q.trim();
    if (!term || busy) return;
    setBusy(true);
    setError(null);
    setDetail(null);
    try {
      const r = await searchLaws(term, 30);
      setLaws(r.laws);
    } catch (err) {
      setError(err instanceof Error ? err.message : '검색 중 오류가 발생했습니다.');
      setLaws(null);
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(law: LawSummary) {
    setDetailBusy(true);
    setError(null);
    try {
      const d = await fetchLawDetail(law.mst);
      setDetail(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : '조문을 불러오지 못했습니다.');
    } finally {
      setDetailBusy(false);
    }
  }

  // ── 조문 열람 ──
  if (detail) {
    return (
      <div className="card">
        <div className="chdr">⚖️ 세법 검색</div>
        <button className="btn-sm" onClick={() => setDetail(null)} style={{ marginBottom: 12 }}>← 목록으로</button>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1A2B52' }}>{detail.name}</div>
        <div style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 12px' }}>
          시행일 {fmtEffDate(detail.effDate)} {detail.dept && `· ${detail.dept}`} · 조문 {detail.articleCount}개 · 법제처 원문
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {detail.articles.map((a, i) =>
            a.isChapter ? (
              <div key={i} style={{ fontSize: 13, fontWeight: 700, color: '#8a8170', margin: '14px 0 4px' }}>
                {a.content}
              </div>
            ) : (
              <div key={i} style={{ padding: '5px 0', borderBottom: '1px solid #f3f1ea' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1A2B52' }}>
                  제{a.no}조{a.title ? ` (${a.title})` : ''}
                  {a.effDate && a.effDate !== detail.effDate && (
                    <span style={{ fontWeight: 400, fontSize: 11, color: '#9aa0ad' }}> · 시행 {fmtEffDate(a.effDate)}</span>
                  )}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.65, color: '#1f2937', whiteSpace: 'pre-wrap', marginTop: 2 }}>
                  {a.content}
                </div>
              </div>
            )
          )}
        </div>
      </div>
    );
  }

  // ── 검색 + 목록 ──
  return (
    <div className="card">
      <div className="chdr">⚖️ 세법 검색</div>

      <form onSubmit={(e) => { e.preventDefault(); run(query); }}>
        <div className="frow" style={{ gridTemplateColumns: '1fr auto', alignItems: 'end', gap: 10 }}>
          <div>
            <label className="fl">법령명 검색</label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="예: 부가가치세법 / 소득세법 / 법인세법"
              autoFocus
            />
          </div>
          <button className="btn-p" type="submit" disabled={busy || !query.trim()}>
            {busy ? '검색 중…' : '🔍 법령 검색'}
          </button>
        </div>
      </form>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {TAX_LAW_QUICKLIST.map((name) => (
          <button
            key={name}
            className="btn-sm"
            onClick={() => { setQuery(name); run(name); }}
            disabled={busy}
            style={{ fontSize: 12 }}
          >
            {name}
          </button>
        ))}
      </div>

      {error && <div className="alert-w" style={{ marginTop: 14 }}>{error}</div>}
      {detailBusy && <div className="alert-i" style={{ marginTop: 14 }}>조문을 불러오는 중…</div>}

      {laws && !detailBusy && (
        <div style={{ marginTop: 16 }}>
          {laws.length === 0 ? (
            <div className="alert-i">검색 결과가 없습니다. 법령명을 확인해 주세요.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {laws.map((l) => (
                <button
                  key={l.mst}
                  onClick={() => openDetail(l)}
                  style={{
                    textAlign: 'left', border: '1px solid #e4e0d8', borderRadius: 7, padding: '10px 13px',
                    background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                  }}
                >
                  <span style={{ fontWeight: 700, color: '#1A2B52', fontSize: 13.5 }}>{l.name}</span>
                  {l.lawType && <span className="bdg b-on" style={{ fontSize: 10 }}>{l.lawType}</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9aa0ad' }}>
                    시행 {fmtEffDate(l.effDate)} {l.dept && `· ${l.dept}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!laws && !error && (
        <div className="alert-i" style={{ marginTop: 14, lineHeight: 1.7 }}>
          세법 법령명을 검색하거나 위 빠른선택을 누르면, 법제처 원문에서 법령(법·시행령·시행규칙)을 찾아
          조문 전문을 열람합니다. 시행일·소관부처가 함께 표시됩니다(법제처 원문 그대로).
        </div>
      )}
    </div>
  );
}
