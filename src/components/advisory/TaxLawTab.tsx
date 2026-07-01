// 세법 검색 — 법제처 국가법령정보(law-search Edge Function) 기반. 두 모드:
//  📜 법령: 법령 검색 → 조문 전문 열람(원문·시행일).
//  🏛️ 판례: 판례 검색(target=prec) → 판시사항·판결요지·참조조문·전문 열람. 전문 미제공 건은 법제처 링크.
// 회계기준(요지)과 달리 법령·판례는 원문이며, 판결문은 저작권 보호대상이 아니다(저작권법 §7).
import { useState } from 'react';
import {
  searchLaws,
  fetchLawDetail,
  fetchLawTrio,
  fmtEffDate,
  TAX_LAW_QUICKLIST,
  searchPrecedents,
  fetchPrecedent,
  fmtPrecDate,
  type LawSummary,
  type LawDetail,
  type LawTrio,
  type PrecedentSummary,
  type PrecedentDetail,
} from '../../lib/lawApi';

type Mode = 'law' | 'trio' | 'prec';

export default function TaxLawTab() {
  const [mode, setMode] = useState<Mode>('law');
  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        ⚖️ 세법 검색
        <span style={{ display: 'inline-flex', gap: 6, marginLeft: 'auto' }}>
          {(
            [
              ['law', '📜 법령'],
              ['trio', '📊 3단비교'],
              ['prec', '🏛️ 판례'],
            ] as [Mode, string][]
          ).map(([m, label]) => (
            <button key={m} className={`btn-sm${mode === m ? ' btn-sm-navy' : ''}`} onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
        </span>
      </div>
      {mode === 'law' && <LawView />}
      {mode === 'trio' && <TrioView />}
      {mode === 'prec' && <PrecedentView />}
    </div>
  );
}

// ───────────────────────────────────────── 3단비교 (법 · 시행령 · 시행규칙)
const TRIO_QUICK = ['법인세법', '소득세법', '부가가치세법', '상속세 및 증여세법', '조세특례제한법', '국세기본법'];

function TrioView() {
  const [query, setQuery] = useState('');
  const [trio, setTrio] = useState<LawTrio | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(q: string) {
    const term = q.trim();
    if (!term || busy) return;
    setBusy(true);
    setError(null);
    try {
      const t = await fetchLawTrio(term);
      if (!t.law && !t.decree && !t.rule) {
        setError('법·시행령·시행규칙을 찾지 못했습니다. 법령명을 확인해 주세요.');
        setTrio(null);
      } else {
        setTrio(t);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '3단비교 조회 중 오류가 발생했습니다.');
      setTrio(null);
    } finally {
      setBusy(false);
    }
  }

  const cols: { label: string; detail: LawDetail | null }[] = trio
    ? [
        { label: '법률', detail: trio.law },
        { label: '시행령', detail: trio.decree },
        { label: '시행규칙', detail: trio.rule },
      ]
    : [];

  return (
    <>
      <form onSubmit={(e) => { e.preventDefault(); run(query); }}>
        <div className="frow" style={{ gridTemplateColumns: '1fr auto', alignItems: 'end', gap: 10 }}>
          <div>
            <label className="fl">법령명 (법·시행령·시행규칙 3단비교)</label>
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="예: 법인세법 / 소득세법 / 부가가치세법" autoFocus />
          </div>
          <button className="btn-p" type="submit" disabled={busy || !query.trim()}>{busy ? '조회 중…' : '📊 3단 조회'}</button>
        </div>
      </form>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {TRIO_QUICK.map((name) => (
          <button key={name} className="btn-sm" onClick={() => { setQuery(name); run(name); }} disabled={busy} style={{ fontSize: 12 }}>{name}</button>
        ))}
      </div>

      {error && <div className="alert-w" style={{ marginTop: 14 }}>{error}</div>}
      {busy && <div className="alert-i" style={{ marginTop: 14 }}>법·시행령·시행규칙을 불러오는 중…</div>}

      {trio && !busy && (
        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, alignItems: 'start' }}>
          {cols.map((c) => (
            <TrioColumn key={c.label} label={c.label} detail={c.detail} />
          ))}
        </div>
      )}

      {!trio && !error && !busy && (
        <div className="alert-i" style={{ marginTop: 14, lineHeight: 1.7 }}>
          법령명을 입력하면 <b>법률 · 시행령 · 시행규칙</b>을 3열로 나란히 열람합니다. 각 열에서 조문을 선택해
          법-시행령-시행규칙을 대조하세요(법제처 원문). 별표·별지서식, 관련통칙·집행기준 연동은 추후 추가 예정입니다.
        </div>
      )}
    </>
  );
}

function TrioColumn({ label, detail }: { label: string; detail: LawDetail | null }) {
  const articles = (detail?.articles ?? []).filter((a) => !a.isChapter);
  const [sel, setSel] = useState(0);
  const cur = articles[sel];

  const head: React.CSSProperties = { border: '1px solid #e4e0d8', borderRadius: 8, background: '#fff', overflow: 'hidden' };

  if (!detail) {
    return (
      <div style={head}>
        <div style={{ background: '#f3f1ea', padding: '8px 10px', fontSize: 12, fontWeight: 700, color: '#8a8170' }}>{label}</div>
        <div className="alert-i" style={{ margin: 10, fontSize: 12 }}>해당 {label}이(가) 없습니다.</div>
      </div>
    );
  }

  return (
    <div style={head}>
      <div style={{ background: '#1A2B52', padding: '8px 10px', color: '#fff' }}>
        <div style={{ fontSize: 12.5, fontWeight: 700 }}>{detail.name}</div>
        <div style={{ fontSize: 10.5, color: '#c9d2e6' }}>시행 {fmtEffDate(detail.effDate)} · 조문 {detail.articleCount}개</div>
      </div>
      <div style={{ padding: 8, borderBottom: '1px solid #eee' }}>
        <select
          value={sel}
          onChange={(e) => setSel(Number(e.target.value))}
          style={{ width: '100%', fontSize: 12, padding: '5px 6px' }}
        >
          {articles.map((a, i) => (
            <option key={`${a.no}-${i}`} value={i}>
              제{a.no}조{a.title ? ` (${a.title})` : ''}
            </option>
          ))}
        </select>
      </div>
      <div style={{ padding: '8px 10px', maxHeight: '62vh', overflowY: 'auto' }}>
        {cur ? (
          <>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#1A2B52', marginBottom: 3 }}>
              제{cur.no}조{cur.title ? ` (${cur.title})` : ''}
              {cur.effDate && cur.effDate !== detail.effDate && (
                <span style={{ fontWeight: 400, fontSize: 10.5, color: '#9aa0ad' }}> · 시행 {fmtEffDate(cur.effDate)}</span>
              )}
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.65, color: '#1f2937', whiteSpace: 'pre-wrap' }}>{cur.content}</div>
          </>
        ) : (
          <div className="alert-i" style={{ fontSize: 12 }}>조문이 없습니다.</div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────────────────── 법령 검색·조문 열람
function LawView() {
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
      setDetail(await fetchLawDetail(law.mst));
    } catch (err) {
      setError(err instanceof Error ? err.message : '조문을 불러오지 못했습니다.');
    } finally {
      setDetailBusy(false);
    }
  }

  if (detail) {
    return (
      <div style={{ marginTop: 8 }}>
        <button className="btn-sm" onClick={() => setDetail(null)} style={{ marginBottom: 12 }}>← 목록으로</button>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1A2B52' }}>{detail.name}</div>
        <div style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 12px' }}>
          시행일 {fmtEffDate(detail.effDate)} {detail.dept && `· ${detail.dept}`} · 조문 {detail.articleCount}개 · 법제처 원문
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {detail.articles.map((a, i) =>
            a.isChapter ? (
              <div key={i} style={{ fontSize: 13, fontWeight: 700, color: '#8a8170', margin: '14px 0 4px' }}>{a.content}</div>
            ) : (
              <div key={i} style={{ padding: '5px 0', borderBottom: '1px solid #f3f1ea' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1A2B52' }}>
                  제{a.no}조{a.title ? ` (${a.title})` : ''}
                  {a.effDate && a.effDate !== detail.effDate && (
                    <span style={{ fontWeight: 400, fontSize: 11, color: '#9aa0ad' }}> · 시행 {fmtEffDate(a.effDate)}</span>
                  )}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.65, color: '#1f2937', whiteSpace: 'pre-wrap', marginTop: 2 }}>{a.content}</div>
              </div>
            )
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <form onSubmit={(e) => { e.preventDefault(); run(query); }}>
        <div className="frow" style={{ gridTemplateColumns: '1fr auto', alignItems: 'end', gap: 10 }}>
          <div>
            <label className="fl">법령명 검색</label>
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="예: 부가가치세법 / 소득세법 / 법인세법" autoFocus />
          </div>
          <button className="btn-p" type="submit" disabled={busy || !query.trim()}>{busy ? '검색 중…' : '🔍 법령 검색'}</button>
        </div>
      </form>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {TAX_LAW_QUICKLIST.map((name) => (
          <button key={name} className="btn-sm" onClick={() => { setQuery(name); run(name); }} disabled={busy} style={{ fontSize: 12 }}>{name}</button>
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
                <button key={l.mst} onClick={() => openDetail(l)} style={rowBtn}>
                  <span style={{ fontWeight: 700, color: '#1A2B52', fontSize: 13.5 }}>{l.name}</span>
                  {l.lawType && <span className="bdg b-on" style={{ fontSize: 10 }}>{l.lawType}</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9aa0ad' }}>시행 {fmtEffDate(l.effDate)} {l.dept && `· ${l.dept}`}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!laws && !error && (
        <div className="alert-i" style={{ marginTop: 14, lineHeight: 1.7 }}>
          세법 법령명을 검색하거나 위 빠른선택을 누르면, 법제처 원문에서 법령(법·시행령·시행규칙)을 찾아 조문 전문을 열람합니다.
          시행일·소관부처가 함께 표시됩니다(법제처 원문 그대로).
        </div>
      )}
    </>
  );
}

// ───────────────────────────────────────── 판례 검색·본문 열람
const PREC_QUICK = ['부가가치세 매입세액', '종합소득세 필요경비', '법인세 손금', '가산세', '양도소득세', '접대비', '원천징수', '경정청구'];

function PrecedentView() {
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<1 | 2>(1);
  const [list, setList] = useState<PrecedentSummary[] | null>(null);
  const [totalCnt, setTotalCnt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<PrecedentDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  async function run(q: string) {
    const term = q.trim();
    if (!term || busy) return;
    setBusy(true);
    setError(null);
    setDetail(null);
    try {
      const r = await searchPrecedents(term, { section, display: 40 });
      setList(r.precedents);
      setTotalCnt(r.totalCnt);
    } catch (err) {
      setError(err instanceof Error ? err.message : '판례 검색 중 오류가 발생했습니다.');
      setList(null);
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(p: PrecedentSummary) {
    setDetailBusy(true);
    setError(null);
    try {
      const d = await fetchPrecedent(p.serial);
      // 전문 미제공 건은 detail에 메타가 없으므로 검색 목록 정보로 보완
      setDetail({
        ...d,
        caseName: d.caseName || p.caseName,
        caseNo: d.caseNo || p.caseNo,
        court: d.court || p.court,
        date: d.date || p.date,
        caseType: d.caseType || p.caseType,
        judgmentType: d.judgmentType || p.judgmentType,
        link: d.link || p.link || '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '판례를 불러오지 못했습니다.');
    } finally {
      setDetailBusy(false);
    }
  }

  if (detail) return <PrecedentDetailView d={detail} onBack={() => setDetail(null)} />;

  return (
    <>
      <form onSubmit={(e) => { e.preventDefault(); run(query); }}>
        <div className="frow" style={{ gridTemplateColumns: '1fr auto auto', alignItems: 'end', gap: 10 }}>
          <div>
            <label className="fl">판례 검색 (세법 쟁점)</label>
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="예: 부가가치세 매입세액 안분 / 접대비 손금불산입" autoFocus />
          </div>
          <div>
            <label className="fl">검색범위</label>
            <select value={section} onChange={(e) => setSection(Number(e.target.value) as 1 | 2)}>
              <option value={1}>사건명</option>
              <option value={2}>본문 전체</option>
            </select>
          </div>
          <button className="btn-p" type="submit" disabled={busy || !query.trim()}>{busy ? '검색 중…' : '🔍 판례 검색'}</button>
        </div>
      </form>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {PREC_QUICK.map((name) => (
          <button key={name} className="btn-sm" onClick={() => { setQuery(name); run(name); }} disabled={busy} style={{ fontSize: 12 }}>{name}</button>
        ))}
      </div>

      {error && <div className="alert-w" style={{ marginTop: 14 }}>{error}</div>}
      {detailBusy && <div className="alert-i" style={{ marginTop: 14 }}>판례 본문을 불러오는 중…</div>}

      {list && !detailBusy && (
        <div style={{ marginTop: 16 }}>
          {list.length === 0 ? (
            <div className="alert-i">검색 결과가 없습니다. 다른 쟁점어로 시도해 보세요.</div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
                총 {totalCnt.toLocaleString('ko-KR')}건 {totalCnt > list.length && `(상위 ${list.length}건 표시)`}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {list.map((p) => (
                  <button key={p.serial} onClick={() => openDetail(p)} style={{ ...rowBtn, alignItems: 'flex-start', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%', flexWrap: 'wrap' }}>
                      {p.caseType && <span className="bdg b-on" style={{ fontSize: 9 }}>{p.caseType}</span>}
                      <span style={{ fontWeight: 700, color: '#1A2B52', fontSize: 12.5 }}>{p.court} {p.caseNo}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9aa0ad' }}>{fmtPrecDate(p.date)}</span>
                    </div>
                    <span style={{ fontSize: 13, color: '#1f2937', lineHeight: 1.5, textAlign: 'left' }}>{p.caseName}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {!list && !error && (
        <div className="alert-i" style={{ marginTop: 14, lineHeight: 1.7 }}>
          세법 쟁점(예: 매입세액 안분, 손금불산입, 경정청구)으로 판례를 검색합니다. 법제처 국가법령정보의 판례를
          <b> 사건명</b> 또는 <b>본문 전체</b>에서 찾습니다. 대법원 공간판례 등은 판시사항·판결요지·전문을 열람할 수 있고,
          전문 미제공 건은 법제처 원문으로 연결합니다.
        </div>
      )}
    </>
  );
}

function PrecedentDetailView({ d, onBack }: { d: PrecedentDetail; onBack: () => void }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button className="btn-sm" onClick={onBack}>← 목록으로</button>
        <a href={d.link} target="_blank" rel="noreferrer" className="btn-sm btn-sm-navy"
          style={{ marginLeft: 'auto', textDecoration: 'none' }} title="법제처 국가법령정보 판례 원문">
          법제처 원문 ↗
        </a>
      </div>

      <div style={{ fontSize: 15, fontWeight: 700, color: '#1A2B52', lineHeight: 1.5 }}>{d.caseName || '(사건명 없음)'}</div>
      <div style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 14px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {d.court && <span>{d.court}</span>}
        {d.caseNo && <span>· {d.caseNo}</span>}
        {d.date && <span>· 선고 {fmtPrecDate(d.date)}</span>}
        {d.caseType && <span className="bdg b-on" style={{ fontSize: 9 }}>{d.caseType}</span>}
      </div>

      {!d.hasText ? (
        <div className="alert-i" style={{ lineHeight: 1.7 }}>
          이 판례는 법제처에서 <b>전문을 제공하지 않습니다</b>(주로 대법원 공간판례만 전문 제공). 위{' '}
          <b>법제처 원문 ↗</b>에서 사건 정보를 확인하세요.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {d.issue && <PrecSection label="판시사항" text={d.issue} />}
          {d.summary && <PrecSection label="판결요지" text={d.summary} />}
          {d.refClauses && <PrecSection label="참조조문" text={d.refClauses} small />}
          {d.refCases && <PrecSection label="참조판례" text={d.refCases} small />}
          {d.body && <PrecSection label="판례 전문" text={d.body} />}
          <div style={{ fontSize: 11, color: '#9aa0ad', lineHeight: 1.6 }}>
            법제처 국가법령정보 원문입니다. 판결문은 저작권 보호대상이 아니나, 인용 시 사건번호·선고일자를 명시하세요.
          </div>
        </div>
      )}
    </div>
  );
}

function PrecSection({ label, text, small }: { label: string; text: string; small?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#8a8170', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: small ? 12.5 : 13.5, lineHeight: 1.7, color: '#1f2937', whiteSpace: 'pre-wrap' }}>{text}</div>
    </div>
  );
}

const rowBtn: React.CSSProperties = {
  textAlign: 'left', border: '1px solid #e4e0d8', borderRadius: 7, padding: '10px 13px',
  background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, width: '100%',
};
