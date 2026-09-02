// 접속기록 점검 — 「개인정보의 안전성 확보조치 기준」 제8조제2항.
//
// 고시는 "접속기록 및 개인정보 다운로드 상황을 확인하고 점검"하라고 한다.
// 그러려면 **월 단위로 훑을 수 있고, 위험한 것이 먼저 눈에 띄어야** 한다.
// 그래서 기본 조회를 이번 달로 두고, 주민번호·홈택스PW 열람을 따로 세어 위에 올린다.
import { useEffect, useMemo, useState } from 'react';
import { kstDateTime } from '../../lib/format';
import {
  listAccessLog, verifyAccessLog, ACTIONS, actionLabel,
  type AccessLogRow, type VerifyResult,
} from '../../lib/accessLogApi';

// **현지 날짜**로 찍는다. toISOString() 은 UTC 라 새벽에 쓰면 어제로 잡혀
// 오늘 기록이 조회에서 빠진다(한국은 UTC+9).
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthStart = () => { const d = new Date(); d.setDate(1); return ymd(d); };

/** 열람 성격의 행위 — 점검할 때 가장 먼저 봐야 하는 것들. */
const SENSITIVE = new Set(['reveal_resident', 'reveal_hometax_pw', 'download_resident_all', 'download_hometax_pw_all']);

export default function AccessLogTab() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(ymd(new Date()));
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [subject, setSubject] = useState('');
  const [rows, setRows] = useState<AccessLogRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [verify, setVerify] = useState<VerifyResult | null>(null);

  async function load() {
    setBusy(true); setErr('');
    try { setRows(await listAccessLog({ from, to, actor, action, subject, limit: 1000 })); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function runVerify() {
    setBusy(true); setErr('');
    try { setVerify(await verifyAccessLog(from)); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const summary = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.action, (m.get(r.action) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const sensitiveCount = rows.filter((r) => SENSITIVE.has(r.action)).length;
  const noIp = rows.filter((r) => !r.ip).length;

  return (
    <div className="card">
      <div className="chdr">🔎 접속기록 점검</div>

      <div className="alert-i" style={{ fontSize: 11.5 }}>
        「개인정보의 안전성 확보조치 기준」 <b>제8조</b> — 누가·언제·<b>어디서(IP)</b> 접속해
        <b> 누구의</b> 개인정보를 <b>무엇을</b> 했는지 남깁니다.
        주민등록번호를 다루므로 <b>2년 이상 보관</b>해야 합니다(제8조제1항 단서 제2호).
        <br />이 기록은 <b>고치거나 지울 수 없습니다</b> — 표에 수정·삭제 권한 자체를 두지 않았고,
        줄마다 앞줄의 해시를 물고 있어 한 줄만 빠져도 <b>[무결성 검증]</b>에서 드러납니다.
        <br /><b>월 1회 이상</b> 이 화면을 훑고, 낯선 IP·과한 열람이 있는지 확인해 주세요.
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end', margin: '10px 0' }}>
        <label style={{ fontSize: 11.5 }}>기간<br />
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label style={{ fontSize: 11.5 }}>~<br />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label style={{ fontSize: 11.5 }}>사용자<br />
          <input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="이름 일부" style={{ width: 110 }} />
        </label>
        <label style={{ fontSize: 11.5 }}>수행업무<br />
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">전체</option>
            {Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11.5 }}>정보주체<br />
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="거래처·대표자" style={{ width: 130 }} />
        </label>
        <button className="btn-p" disabled={busy} onClick={() => void load()}>{busy ? '조회 중…' : '조회'}</button>
        <button className="btn-sm" disabled={busy} onClick={() => void runVerify()}
          title="줄마다 앞줄의 해시를 다시 계산해 맞춰 봅니다">🔐 무결성 검증</button>
      </div>

      {verify && (
        <div className={verify.ok ? 'alert-s' : 'alert-e'} style={{ fontSize: 11.5 }}>
          {verify.ok
            ? `✅ ${verify.checked.toLocaleString('ko-KR')}건 검증 — 고쳐지거나 빠진 줄이 없습니다.`
            : `⚠️ ${verify.checked.toLocaleString('ko-KR')}건 중 id ${verify.firstBadId} (${kstDateTime(verify.firstBadAt)}) 부터 어긋납니다 — 그 줄이 고쳐졌거나, 그 앞줄이 지워졌습니다.`}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11.5, margin: '8px 0' }}>
        <span className="bdg b-on">전체 {rows.length.toLocaleString('ko-KR')}건</span>
        <span className="bdg" style={{ background: sensitiveCount ? '#FEF3C7' : undefined, borderColor: sensitiveCount ? '#FCD34D' : undefined }}>
          민감정보 열람 {sensitiveCount}건
        </span>
        {noIp > 0 && <span className="bdg" style={{ background: '#fee', borderColor: '#fbb' }}>접속지 없음 {noIp}건</span>}
        {summary.map(([a, n]) => <span key={a} className="bdg" style={{ color: '#666' }}>{actionLabel(a)} {n}</span>)}
      </div>

      {err && <div className="alert-e" style={{ fontSize: 11.5 }}>{err}</div>}

      <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
        <table className="tbl" style={{ fontSize: 11.5 }}>
          <thead>
            <tr>
              <th style={{ minWidth: 130 }}>접속일시</th>
              <th style={{ minWidth: 90 }}>사용자</th>
              <th style={{ minWidth: 110 }}>접속지(IP)</th>
              <th style={{ minWidth: 110 }}>수행업무</th>
              <th style={{ minWidth: 120 }}>대상 정보주체</th>
              <th style={{ minWidth: 110 }}>자료</th>
              <th style={{ minWidth: 150 }}>사유·비고</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: '#888', padding: 14 }}>
                이 기간에 기록이 없습니다.
              </td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} style={SENSITIVE.has(r.action) ? { background: '#FFFBEB' } : undefined}>
                <td style={{ whiteSpace: 'nowrap' }}>{kstDateTime(r.at)}</td>
                <td>
                  {r.actorName}
                  <div style={{ fontSize: 10, color: '#888' }}>{r.actorEmail}</div>
                </td>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }} title={r.userAgent}>
                  {r.ip || <span style={{ color: '#c33' }}>—</span>}
                </td>
                <td style={SENSITIVE.has(r.action) ? { fontWeight: 700, color: '#92400E' } : undefined}>
                  {actionLabel(r.action)}
                </td>
                <td>{r.subjectName || '—'}</td>
                <td style={{ fontSize: 10.5, color: '#666' }}>{r.target || '—'}</td>
                <td style={{ fontSize: 10.5 }}>
                  {r.reason}
                  {r.detail?.count != null && (
                    <span style={{ color: '#92400E', fontWeight: 700 }}> ({String(r.detail.count)}건)</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
