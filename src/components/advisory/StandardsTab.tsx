// 회계기준서검토 — 회계기준(K-IFRS) 근거 검색 UI.
// standards-query Edge Function(queryStandards)을 호출해 질의→유사 문단을 반환한다.
// 근거 문단은 요지 정리본이므로 인용 시 "(요지)"·원문 대조 권고를 함께 노출한다(prompts/grounding-instructions 규약).
import { useState, type FormEvent } from 'react';
import { queryStandards, type StandardMatch } from '../../lib/standardsApi';

const STANDARD_OPTIONS = [
  { value: '1115', label: 'K-IFRS 제1115호 (수익)' },
  { value: '', label: '전체 (적재된 기준서)' },
];

export default function StandardsTab() {
  const [question, setQuestion] = useState('');
  const [standardNo, setStandardNo] = useState('1115');
  const [matchCount, setMatchCount] = useState(5);
  const [matches, setMatches] = useState<StandardMatch[] | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: FormEvent) {
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
    <div className="card">
      <div className="chdr">📚 회계기준서검토</div>

      <form onSubmit={handleSearch}>
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
              {STANDARD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="fl">결과 수</label>
            <select value={matchCount} onChange={(e) => setMatchCount(Number(e.target.value))}>
              {[3, 5, 8, 10].map((n) => (
                <option key={n} value={n}>
                  {n}개
                </option>
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
          {notice && (
            <div className="alert-i" style={{ marginBottom: 12, fontSize: 12, lineHeight: 1.6 }}>
              ⚠️ {notice}
            </div>
          )}

          {matches.length === 0 ? (
            <div className="alert-i">관련 문단을 찾지 못했습니다. 질의를 상위개념·동의어로 바꿔 다시 검색해 보세요.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {matches.map((m, i) => (
                <div
                  key={`${m.standard_no}-${m.paragraph_no}-${i}`}
                  style={{ border: '1px solid #e4e0d8', borderRadius: 8, padding: '12px 14px', background: '#fff' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span className="bdg b-on" style={{ fontSize: 11 }}>{m.citation}</span>
                    {m.section_title && (
                      <span style={{ fontSize: 12, color: '#6b7280' }}>{m.section_title}</span>
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9aa0ad' }}>
                      유사도 {(m.similarity * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.65, color: '#1f2937', whiteSpace: 'pre-wrap' }}>
                    {m.content}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!matches && !error && (
        <div className="alert-i" style={{ marginTop: 14, lineHeight: 1.7 }}>
          회계기준서(현재 파일럿: K-IFRS 제1115호)에 대한 질의를 입력하면 관련 문단을 유사도순으로 검색합니다.
          <br />
          검색된 문단은 <b>요지 정리본</b>이며, 인용·적용 전 원문 대조를 권고합니다.
        </div>
      )}
    </div>
  );
}
