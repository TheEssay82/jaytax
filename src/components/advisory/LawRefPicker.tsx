// 세법 조문 근거 선택기 — 상담진행에서 회신 근거로 첨부할 세법 조문(원문)을 검색·선택한다.
//  law-search Edge(법제처 원문)를 재사용: 법령 검색 → 조문 열람 → 토글로 선택.
//  선택분은 consult 함수의 lawRefs({ref,text})로 전달되어 회신 근거에 포함된다.
import { useState } from 'react';
import {
  searchLaws,
  fetchLawDetail,
  fmtEffDate,
  TAX_LAW_QUICKLIST,
  type LawSummary,
  type LawDetail,
} from '../../lib/lawApi';
import type { LawRef } from '../../lib/consultApi';

/** 조문 → 근거 인용 문자열(법령명·조문번호·시행일 명시 — 원문 근거 규약). */
function articleRef(law: LawDetail, no: string, title: string | null, effDate: string): string {
  const eff = effDate && effDate.length === 8 ? effDate : law.effDate;
  return `${law.name} 제${no}조${title ? `(${title})` : ''} · 시행 ${fmtEffDate(eff)}`;
}

export default function LawRefPicker({
  value,
  onChange,
}: {
  value: LawRef[];
  onChange: (refs: LawRef[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [laws, setLaws] = useState<LawSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<LawDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const selectedRefs = new Set(value.map((r) => r.ref));

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
      setError(err instanceof Error ? err.message : '법령 검색 중 오류가 발생했습니다.');
      setLaws(null);
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(law: LawSummary) {
    setDetailBusy(true);
    setError(null);
    try {
      setDetail(await fetchLawDetail(law.mst));
    } catch (err) {
      setError(err instanceof Error ? err.message : '조문을 불러오지 못했습니다.');
    } finally {
      setDetailBusy(false);
    }
  }

  function toggle(ref: string, text: string) {
    if (selectedRefs.has(ref)) onChange(value.filter((r) => r.ref !== ref));
    else onChange([...value, { ref, text }]);
  }

  return (
    <div style={{ border: '1px solid #e4e0d8', borderRadius: 8, padding: '12px 14px', background: '#faf8f3' }}>
      {/* 선택된 근거 칩 */}
      {value.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {value.map((r) => (
            <span key={r.ref} style={chipStyle} title={r.text}>
              <span style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.ref}</span>
              <button type="button" onClick={() => onChange(value.filter((x) => x.ref !== r.ref))} style={chipX} aria-label="제거">×</button>
            </span>
          ))}
          <button type="button" className="btn-sm" onClick={() => onChange([])} style={{ fontSize: 11 }}>모두 비우기</button>
        </div>
      )}

      {/* 검색 */}
      <form onSubmit={(e) => { e.preventDefault(); run(query); }}>
        <div className="frow" style={{ gridTemplateColumns: '1fr auto', alignItems: 'end', gap: 8, margin: 0 }}>
          <div>
            <label className="fl">세법 법령명 검색</label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="예: 부가가치세법 / 소득세법 / 법인세법"
            />
          </div>
          <button className="btn-sm btn-sm-navy" type="submit" disabled={busy || !query.trim()}>
            {busy ? '검색 중…' : '🔍 검색'}
          </button>
        </div>
      </form>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
        {TAX_LAW_QUICKLIST.slice(0, 7).map((name) => (
          <button key={name} type="button" className="btn-sm" onClick={() => { setQuery(name); run(name); }} disabled={busy} style={{ fontSize: 11 }}>
            {name}
          </button>
        ))}
      </div>

      {error && <div className="alert-w" style={{ marginTop: 10, fontSize: 12 }}>{error}</div>}
      {detailBusy && <div className="alert-i" style={{ marginTop: 10, fontSize: 12 }}>조문을 불러오는 중…</div>}

      {/* 법령 목록 */}
      {laws && !detail && !detailBusy && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 220, overflowY: 'auto' }}>
          {laws.length === 0 ? (
            <div className="alert-i" style={{ fontSize: 12 }}>검색 결과가 없습니다.</div>
          ) : (
            laws.map((l) => (
              <button key={l.mst} type="button" onClick={() => openDetail(l)} style={lawRowStyle}>
                <span style={{ fontWeight: 700, color: '#1A2B52', fontSize: 13 }}>{l.name}</span>
                {l.lawType && <span className="bdg b-on" style={{ fontSize: 9 }}>{l.lawType}</span>}
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9aa0ad' }}>시행 {fmtEffDate(l.effDate)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* 조문 열람 + 토글 선택 */}
      {detail && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <button type="button" className="btn-sm" onClick={() => setDetail(null)}>← 법령 목록</button>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#1A2B52' }}>{detail.name}</span>
            <span style={{ fontSize: 11, color: '#9aa0ad' }}>시행 {fmtEffDate(detail.effDate)} · 조문 {detail.articleCount}개</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 300, overflowY: 'auto' }}>
            {detail.articles.map((a, i) =>
              a.isChapter ? (
                <div key={i} style={{ fontSize: 12, fontWeight: 700, color: '#8a8170', margin: '8px 0 2px' }}>{a.content}</div>
              ) : (
                (() => {
                  const ref = articleRef(detail, a.no, a.title, a.effDate);
                  const on = selectedRefs.has(ref);
                  return (
                    <label key={i} style={{ ...artRowStyle, background: on ? '#fff7e6' : '#fff', borderColor: on ? '#d9b25f' : '#ececec' }}>
                      <input type="checkbox" checked={on} onChange={() => toggle(ref, a.content)} style={{ marginTop: 3 }} />
                      <span style={{ flex: 1 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1A2B52' }}>
                          제{a.no}조{a.title ? ` (${a.title})` : ''}
                          {a.effDate && a.effDate !== detail.effDate && (
                            <span style={{ fontWeight: 400, fontSize: 10.5, color: '#9aa0ad' }}> · 시행 {fmtEffDate(a.effDate)}</span>
                          )}
                        </span>
                        <span style={{ display: 'block', fontSize: 12, lineHeight: 1.55, color: '#4b5563', whiteSpace: 'pre-wrap', marginTop: 1 }}>
                          {a.content.length > 240 ? a.content.slice(0, 240) + '…' : a.content}
                        </span>
                      </span>
                    </label>
                  );
                })()
              )
            )}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: '#9aa0ad', marginTop: 10, lineHeight: 1.55 }}>
        선택한 조문은 법제처 <b>원문</b>으로 회신 근거에 포함됩니다. 회계기준(요지)과 달리 조문번호·시행일이 명시됩니다.
      </div>
    </div>
  );
}

const chipStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600,
  color: '#1A2B52', background: '#fff', border: '1px solid #d9b25f', borderRadius: 14, padding: '3px 6px 3px 10px',
};
const chipX: React.CSSProperties = {
  border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1, color: '#9aa0ad', padding: '0 2px',
};
const lawRowStyle: React.CSSProperties = {
  textAlign: 'left', border: '1px solid #e4e0d8', borderRadius: 6, padding: '7px 10px',
  background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, width: '100%',
};
const artRowStyle: React.CSSProperties = {
  display: 'flex', gap: 8, alignItems: 'flex-start', border: '1px solid #ececec', borderRadius: 6,
  padding: '7px 10px', cursor: 'pointer',
};
