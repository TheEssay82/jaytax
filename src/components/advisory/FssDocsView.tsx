// 📚 회계기준 검색 › 🏛 금감원 자료 — 금감원 회계업무자료 Open API 7종(인계 4단계, 2026-11-28).
// 매일 07:30 fss-sync 가 모은다. 지난 자료는 하루 약 석 달씩 거꾸로 채운다(개인용 키 하루 30회).
// 본문은 요약뿐인 것이 많다 — 실내용은 첨부(hwp/pdf)라 첨부 링크와 금감원 원문을 함께 보여 준다.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { listFssDocs, fssSummary, FSS_APIS, FSS_LABEL, FSS_COLOR, type FssApi, type FssDoc } from '../../lib/fssApi';

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) : '');

export default function FssDocsView() {
  const [q, setQ] = useState('');
  const [apis, setApis] = useState<Set<FssApi>>(new Set());
  const [relStand, setRelStand] = useState('');
  const [issRealm, setIssRealm] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<FssDoc[] | null>(null);
  const [sum, setSum] = useState<Awaited<ReturnType<typeof fssSummary>> | null>(null);
  const [open, setOpen] = useState<FssDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true); setErr(null);
    try { setRows(await listFssDocs({ q, apis: [...apis], relStand, issRealm, from, to })); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { void run(); void fssSummary().then(setSum).catch(() => setSum(null)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (a: FssApi) => setApis((s) => { const n = new Set(s); if (n.has(a)) n.delete(a); else n.add(a); return n; });

  return (
    <div style={{ marginTop: 8 }}>
      <div className="alert-i" style={{ fontSize: 'var(--fs-2)', lineHeight: 1.6 }}>
        금감원 회계업무자료 Open API — 질의회신 · 심사·감리 지적사례 · 주석공시 모범사례 · 내부회계 · 외부감사 자료 · FAQ 를 <b>매일 아침 7시 30분</b>에 모읍니다.
        지난 자료는 금감원 한도(하루 30회) 때문에 <b>최근 달부터 거꾸로 날마다 채우는 중</b>입니다.
        {sum && <> 지금 <b>{sum.total.toLocaleString()}건</b>{sum.lastFetched && <> · 마지막 수집 {new Date(sum.lastFetched).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</>}.</>}
        {' '}상담진행(회계·공통)은 이 자료를 근거로 함께 찾습니다.
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void run(); }} style={{ display: 'grid', gap: 8, marginTop: 10 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="낱말 검색 — 제목 · 본문 · 관련기준서 · 쟁점분야 (공백 = 모두 포함)"
            style={{ flex: 1, minWidth: 260 }} autoFocus />
          <button className="btn-p" type="submit" disabled={busy}>{busy ? '찾는 중…' : '검색'}</button>
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', fontSize: 'var(--fs-1)' }}>
          <button type="button" className={`btn-sm${apis.size === 0 ? ' btn-sm-navy' : ''}`} onClick={() => setApis(new Set())}>전체</button>
          {FSS_APIS.map((a) => (
            <button key={a} type="button" className={`btn-sm${apis.has(a) ? ' btn-sm-navy' : ''}`} onClick={() => toggle(a)}>
              {FSS_LABEL[a]}{sum ? ` ${sum.counts[a]}` : ''}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 'var(--fs-2)' }}>
          <label>관련기준서 <input type="text" value={relStand} onChange={(e) => setRelStand(e.target.value)} placeholder="예: 1115" style={{ width: 110 }} /></label>
          <label>쟁점분야 <input type="text" value={issRealm} onChange={(e) => setIssRealm(e.target.value)} placeholder="예: 수익" style={{ width: 110 }} /></label>
          <label>등록일 <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 140 }} /> ~ <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 140 }} /></label>
        </div>
      </form>

      {err && <div className="alert-w" style={{ marginTop: 10 }}>불러오지 못했습니다: {err}</div>}
      {rows && (
        <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-3)', margin: '10px 0 8px' }}>
          {rows.length}건{rows.length >= 200 && ' (최근 200건까지 — 조건을 좁혀 보세요)'} · 제목을 누르면 본문 · 첨부 · 금감원 원문
        </div>
      )}
      {rows && rows.length === 0 && (
        <div style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-2)', padding: 12, border: '1px dashed var(--rule)', borderRadius: 8 }}>
          맞는 자료가 없습니다. 지난 자료는 아직 채우는 중이라 오래된 질의회신 · 지적사례는 며칠 뒤에 나올 수 있습니다.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(rows ?? []).map((d) => (
          <button key={`${d.api}:${d.contentId}`} type="button" onClick={() => setOpen(d)} style={rowBtn}>
            <span className="bdg" style={{ background: FSS_COLOR[d.api][0], color: FSS_COLOR[d.api][1], fontSize: 'var(--fs-0)', flexShrink: 0 }}>{FSS_LABEL[d.api]}</span>
            <span style={{ flex: 1, textAlign: 'left' }}>{d.subject}</span>
            {(d.relStand || d.issRealm) && <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[d.relStand, d.issRealm].filter(Boolean).join(' · ')}</span>}
            {d.attachments.length > 0 && <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>📎{d.attachments.length}</span>}
            <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{day(d.regDate)}</span>
          </button>
        ))}
      </div>
      {open && <FssModal d={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function FssModal({ d, onClose }: { d: FssDoc; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  const meta = [
    FSS_LABEL[d.api], `등록 ${day(d.regDate)}`, d.relStand && `관련기준서 ${d.relStand}`, d.issRealm && `쟁점분야 ${d.issRealm}`,
    d.dcsnYr && `결정 ${d.dcsnYr}`, d.sprvisnTrgtYr && `감리대상 ${d.sprvisnTrgtYr}`, d.rlsNo && `공개번호 ${d.rlsNo}`, d.deptNm,
  ].filter(Boolean).join(' · ');
  return createPortal(
    <div onClick={onClose} style={backdrop}>
      <div onClick={(e) => e.stopPropagation()} style={sheet}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--navy)', lineHeight: 1.4 }}>{d.subject}</div>
            <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginTop: 3 }}>{meta}</div>
          </div>
          <button className="btn-sm" onClick={onClose}>닫기 ✕</button>
        </div>
        <div style={{ marginTop: 12, fontSize: 13.5, lineHeight: 1.7, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>
          {d.bodyText || <span style={{ color: 'var(--ink-3)' }}>(요약 본문 없음 — 첨부 · 원문을 보세요)</span>}
        </div>
        {d.attachments.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <b style={{ fontSize: 'var(--fs-2)' }}>첨부</b>
            <ul style={{ margin: '4px 0 0 18px', fontSize: 'var(--fs-2)' }}>
              {d.attachments.map((a, i) => <li key={i}><a href={a.url} target="_blank" rel="noreferrer">{a.name || `첨부 ${i + 1}`} ↗</a></li>)}
            </ul>
          </div>
        )}
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--rule-2)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {d.originUrl && <a href={d.originUrl} target="_blank" rel="noreferrer" style={{ fontSize: 'var(--fs-2)', color: 'var(--gold)', fontWeight: 700, textDecoration: 'none' }}>금감원 원문 ↗</a>}
          <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>출처: 금융감독원 회계업무자료 Open API(공개자료)</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const rowBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, width: '100%', border: '1px solid var(--rule-2)', borderRadius: 6,
  padding: '8px 11px', background: '#fff', color: 'var(--ink-2)', fontSize: 'var(--fs-3)', cursor: 'pointer', fontFamily: 'inherit',
};
const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(20,25,40,.45)',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflow: 'auto', padding: '40px 16px',
};
const sheet: React.CSSProperties = {
  background: '#fff', borderRadius: 10, padding: '18px 20px', maxWidth: 760, width: '100%', boxShadow: '0 10px 40px rgba(0,0,0,.25)', margin: 'auto',
};
