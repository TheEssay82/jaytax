// 보존·파기 — 개인정보 보호법 제21조.
//
// 화면이 답해야 하는 질문은 하나다. **"지금 지워야 할 것이 있는가?"**
// 그래서 자료마다 근거 법령·기간·경과 건수를 한 줄로 놓고, 경과한 것만 눈에 띄게 한다.
import { useEffect, useState } from 'react';
import { kstDateTime } from '../../lib/format';
import {
  surveyRetention, purgeRetention, listPurgeLog, periodLabel,
  type RetentionRow, type PurgeLogRow,
} from '../../lib/retentionApi';

export default function RetentionTab() {
  const [rows, setRows] = useState<RetentionRow[]>([]);
  const [log, setLog] = useState<PurgeLogRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  async function load() {
    setBusy(true); setErr('');
    try {
      const [r, l] = await Promise.all([surveyRetention(), listPurgeLog()]);
      setRows(r); setLog(l);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);

  async function purge(r: RetentionRow) {
    const reason = prompt(
      `${r.label} — 보존기한 ${periodLabel(r.months)}이 지난 ${r.due.toLocaleString('ko-KR')}건을 파기합니다.\n\n`
      + `기준일 ${r.cutoff} 이전 자료가 대상입니다.\n`
      + '되돌릴 수 없습니다 — 행을 지웁니다(법 제21조제2항 "복구·재생되지 아니하도록").\n\n'
      + '파기 사유를 적어 주세요. 파기 이력과 접속기록에 남습니다.',
      `보존기한(${periodLabel(r.months)}) 경과 — 정기 파기`);
    if (reason === null) return;
    if (!reason.trim()) return alert('사유 없이는 파기할 수 없습니다.');
    if (!confirm(`정말 ${r.due.toLocaleString('ko-KR')}건을 지웁니다. 되돌릴 수 없습니다.`)) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const n = await purgeRetention(r.key, reason);
      setMsg(`✅ ${r.label} ${n.toLocaleString('ko-KR')}건을 파기했습니다.`);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const dueTotal = rows.reduce((s, r) => s + (r.destroyOk ? r.due : 0), 0);

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        🗑️ 보존기한 · 파기
        <button className="btn-sm" style={{ marginLeft: 'auto' }} disabled={busy}
          onClick={() => void load()}>{busy ? '조회 중…' : '새로고침'}</button>
      </div>

      <div className="alert-i" style={{ fontSize: 11.5 }}>
        <b>개인정보 보호법 제21조</b> — 보유기간이 지나거나 목적을 달성해 불필요해진 개인정보는
        <b> 지체 없이 파기</b>합니다. 다만 <b>다른 법령에 따라 보존해야 하는 경우</b>는 그 기간까지 남깁니다.
        <br />파기는 <b>행을 지웁니다</b> — 되돌릴 수 없습니다(같은 조 제2항 “복구 또는 재생되지 아니하도록”).
        <br />기간과 근거는 아래 표가 정본입니다. 법이 바뀌면 이 표만 고치면 됩니다.
      </div>

      {dueTotal === 0 ? (
        <div className="alert-s" style={{ fontSize: 11.5 }}>
          ✅ 지금 파기해야 할 자료가 없습니다. (시스템 가동이 2026년이라 5년·10년 항목은 한참 뒤에 도래합니다)
        </div>
      ) : (
        <div className="alert-w" style={{ fontSize: 11.5 }}>
          ⚠️ 보존기한이 지난 자료가 <b>{dueTotal.toLocaleString('ko-KR')}건</b> 있습니다 — 지체 없이 파기해야 합니다.
        </div>
      )}
      {msg && <div className="alert-s" style={{ fontSize: 11.5 }}>{msg}</div>}
      {err && <div className="alert-e" style={{ fontSize: 11.5 }}>{err}</div>}

      <table className="tbl" style={{ fontSize: 11.5, marginTop: 8 }}>
        <thead>
          <tr>
            <th style={{ minWidth: 130 }}>자료</th>
            <th style={{ width: 70 }}>보존기한</th>
            <th style={{ minWidth: 230 }}>근거</th>
            <th style={{ width: 92 }}>기준일</th>
            <th className="r" style={{ width: 78 }}>경과</th>
            <th className="r" style={{ width: 78 }}>전체</th>
            <th style={{ width: 84 }}>파기</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} style={r.due > 0 && r.destroyOk ? { background: '#FFFBEB' } : undefined}>
              <td style={{ fontWeight: 700, color: '#1A2B52' }}>
                {r.label}
                <div style={{ fontSize: 10, fontWeight: 400, color: '#888' }}>{r.tableName}</div>
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>{periodLabel(r.months)}</td>
              <td style={{ fontSize: 10.5, color: '#555' }}>
                {r.basis}
                {r.note && <div style={{ color: '#888', marginTop: 2 }}>· {r.note}</div>}
              </td>
              <td style={{ whiteSpace: 'nowrap', color: '#666' }}>{r.cutoff}</td>
              <td className="r" style={r.due > 0 ? { fontWeight: 700, color: '#92400E' } : { color: '#bbb' }}>
                {r.due.toLocaleString('ko-KR')}
              </td>
              <td className="r" style={{ color: '#666' }}>{r.total.toLocaleString('ko-KR')}</td>
              <td>
                {!r.destroyOk ? (
                  <span className="bdg" style={{ fontSize: 10, background: '#FEE2E2', borderColor: '#FCA5A5', color: '#991B1B' }}
                    title="외부감사법 제19조제3항 — 감사조서의 파기를 금지한다">파기 금지</span>
                ) : r.due > 0 ? (
                  <button className="btn-sm btn-sm-del" disabled={busy} onClick={() => void purge(r)}>파기</button>
                ) : (
                  <span style={{ color: '#bbb' }}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="chdr" style={{ marginTop: 16 }}>📜 파기 이력</div>
      <table className="tbl" style={{ fontSize: 11.5 }}>
        <thead>
          <tr>
            <th style={{ minWidth: 130 }}>일시</th><th style={{ width: 80 }}>처리자</th>
            <th style={{ minWidth: 120 }}>자료</th><th style={{ width: 92 }}>기준일</th>
            <th className="r" style={{ width: 70 }}>건수</th>
            <th style={{ minWidth: 160 }}>사유</th><th style={{ minWidth: 150 }}>방법</th>
          </tr>
        </thead>
        <tbody>
          {log.length === 0 && (
            <tr><td colSpan={7} style={{ textAlign: 'center', color: '#888', padding: 12 }}>
              파기한 이력이 없습니다.
            </td></tr>
          )}
          {log.map((l) => (
            <tr key={l.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{kstDateTime(l.at)}</td>
              <td>{l.actorName}</td>
              <td>{l.policyKey}<div style={{ fontSize: 10, color: '#888' }}>{l.tableName}</div></td>
              <td style={{ color: '#666' }}>{l.cutoff}</td>
              <td className="r" style={{ fontWeight: 700 }}>{l.deleted.toLocaleString('ko-KR')}</td>
              <td style={{ fontSize: 10.5 }}>{l.reason}</td>
              <td style={{ fontSize: 10.5, color: '#666' }}>{l.method}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="alert-w" style={{ fontSize: 11, marginTop: 12 }}>
        <b>아직 못 지킨 것</b> — 법 제21조제3항은 보존의무 때문에 남기는 개인정보를
        <b> 다른 개인정보와 분리해 저장·관리</b>하라고 합니다. 지금은 거래가 끝난 거래처도 같은 표에
        함께 있습니다. 분리 보관은 구조를 손대야 하는 일이라 아직 하지 않았습니다.
      </div>
    </div>
  );
}
