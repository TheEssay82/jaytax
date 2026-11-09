// 보존·파기 — 개인정보 보호법 제21조.
//
// 화면이 답해야 하는 질문은 하나다. **"지금 지워야 할 것이 있는가?"**
// 그래서 자료마다 근거 법령·기간·경과 건수를 한 줄로 놓고, 경과한 것만 눈에 띄게 한다.
import { Fragment, useEffect, useState } from 'react';
import { confirmDanger } from '../common/DangerConfirm';
import Guide from '../common/Guide';
import { kstDateTime } from '../../lib/format';
import {
  surveyRetention, purgeRetention, listPurgeLog, listRetentionDue, periodLabel, modeLabel,
  type RetentionRow, type PurgeLogRow, type RetentionDueItem,
} from '../../lib/retentionApi';

export default function RetentionTab() {
  const [rows, setRows] = useState<RetentionRow[]>([]);
  const [log, setLog] = useState<PurgeLogRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  // 「경과」 숫자를 누르면 그 정책의 대상이 아래로 펼쳐진다(사용자 2026-11-09 「어느 거래처인지 알 수 없나요?」).
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [dueItems, setDueItems] = useState<Record<string, RetentionDueItem[] | 'loading' | string>>({});
  async function toggleDue(key: string) {
    if (openKey === key) { setOpenKey(null); return; }
    setOpenKey(key);
    setDueItems((m) => ({ ...m, [key]: 'loading' }));
    try {
      const list = await listRetentionDue(key);
      setDueItems((m) => ({ ...m, [key]: list }));
    } catch (e) { setDueItems((m) => ({ ...m, [key]: e instanceof Error ? e.message : String(e) })); }
  }

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
      + `방식: ${modeLabel(r)}\n`
      + '되돌릴 수 없습니다 (법 제21조제2항 "복구 또는 재생되지 아니하도록").\n\n'
      + '파기 사유를 적어 주세요. 파기 이력과 접속기록에 남습니다.',
      `보존기한(${periodLabel(r.months)}) 경과 — 정기 파기`);
    if (reason === null) return;
    if (!reason.trim()) return alert('사유 없이는 파기할 수 없습니다.');
    if (!await confirmDanger({
      title: `${r.label} ${r.due.toLocaleString('ko-KR')}건을 파기합니다`,
      level: 'purge',
      target: r.label,
      detail: `기준일 ${r.cutoff} 이전 자료 · 방식 ${modeLabel(r)}\n`
        + '개인정보보호법 제21조제2항 — 복구 또는 재생되지 아니하도록 파기합니다.',
      okLabel: '파기합니다',
    })) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const n = await purgeRetention(r.key, reason);
      setMsg(`✅ ${r.label} ${n.toLocaleString('ko-KR')}건을 파기했습니다.`);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const dueTotal = rows.reduce((s, r) => s + r.due, 0);

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        🗑️ 보존기한 · 파기
        <button className="btn-sm" style={{ marginLeft: 'auto' }} disabled={busy}
          onClick={() => void load()}>{busy ? '조회 중…' : '새로고침'}</button>
      </div>

      <Guide id="retention" label="법 근거와 셈법 자세히"
        summary={<>
          <b>개인정보 보호법 제21조</b> — 보유기간이 지난 개인정보는 <b>지체 없이 파기</b>합니다.
          {' '}<b>파기는 되돌릴 수 없습니다.</b>
        </>}>
        · 다른 <b>법령에 따라 보존해야 하는 경우</b>는 그 기간까지 남깁니다.
        <br />· 같은 조 제2항 “복구 또는 재생되지 아니하도록” — 지움 표시가 아니라 실제로 지웁니다.
        <br />· <b>업무·회계 자료는 영구보관</b>합니다. 상호·사업자번호·금액·계약조건은 개인정보가 아니라
        {' '}제21조의 파기 대상이 아니기 때문입니다. 대신 그 안에 섞인 <b>개인정보만 골라 비웁니다</b>
        {' '}(「안전성 확보조치 기준」 제13조제2항제1호 — 일부 파기).
        <br />· 기간과 근거는 아래 표가 정본입니다. 법이 바뀌면 이 표만 고치면 됩니다.
        <br />· <b>거래 종료월을 모르는 사업장</b>은 시스템 시작일(<b>2026-07</b>)에 끝난 것으로 보고 셉니다 —
        {' '}자료에 거짓 폐업월을 써 넣지 않으면서도 언젠가는 파기되게 하려는 것입니다.
        {' '}진짜 종료월을 알게 되면 거래처등록에서 넣으시면 그 날짜가 기준이 됩니다.
      </Guide>

      {dueTotal === 0 ? (
        <div className="alert-s" style={{ fontSize: 'var(--fs-1)' }}>
          ✅ 지금 파기해야 할 자료가 없습니다. (시스템 가동이 2026년이라 5년·10년 항목은 한참 뒤에 도래합니다)
        </div>
      ) : (
        <div className="alert-w" style={{ fontSize: 'var(--fs-1)' }}>
          ⚠️ 보존기한이 지난 자료가 <b>{dueTotal.toLocaleString('ko-KR')}건</b> 있습니다 — 지체 없이 파기해야 합니다.
        </div>
      )}
      {msg && <div className="alert-s" style={{ fontSize: 'var(--fs-1)' }}>{msg}</div>}
      {err && <div className="alert-e" style={{ fontSize: 'var(--fs-1)' }}>{err}</div>}

      <table className="tbl" style={{ fontSize: 'var(--fs-1)', marginTop: 8 }}>
        <thead>
          <tr>
            <th style={{ minWidth: 130 }}>자료</th>
            <th style={{ width: 70 }}>보존기한</th>
            <th style={{ minWidth: 210 }}>근거</th>
            <th style={{ minWidth: 130 }}>파기 방식</th>
            <th style={{ width: 92 }}>기준일</th>
            <th className="r" style={{ width: 78 }}>경과</th>
            <th className="r" style={{ width: 78 }}>전체</th>
            <th style={{ width: 84 }}>파기</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={r.key}>
            <tr style={r.due > 0 && r.destroyOk ? { background: '#FFFBEB' } : undefined}>
              <td style={{ fontWeight: 700, color: 'var(--navy)' }}>
                {r.label}
                <div style={{ fontSize: 'var(--fs-0)', fontWeight: 400, color: 'var(--ink-3)' }}>{r.tableName}</div>
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>{periodLabel(r.months)}</td>
              <td style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-2)' }}>
                {r.basis}
                {r.note && <div style={{ color: 'var(--ink-3)', marginTop: 2 }}>· {r.note}</div>}
              </td>
              <td style={{ fontSize: 'var(--fs-0)' }}>
                {r.mode === 'keep'
                  ? <span className="bdg" style={{ fontSize: 'var(--fs-0)', background: '#EEF2FF', borderColor: '#C7D2FE', color: '#3730A3' }}>영구보관</span>
                  : r.mode === 'columns'
                    ? <><span className="bdg" style={{ fontSize: 'var(--fs-0)', background: '#FEF3C7', borderColor: '#FCD34D', color: 'var(--warn)' }}>개인정보만 비움</span>
                        <div style={{ color: 'var(--ink-3)', marginTop: 2 }}>{r.piiCols.join(', ')}</div></>
                    : <span className="bdg" style={{ fontSize: 'var(--fs-0)' }}>행 삭제</span>}
              </td>
              <td style={{ whiteSpace: 'nowrap', color: 'var(--ink-2)' }}>{r.mode === 'keep' ? '—' : r.cutoff}</td>
              <td className="r" style={r.due > 0 ? { fontWeight: 700, color: 'var(--warn)' } : { color: 'var(--ink-4)' }}>
                {r.due > 0 && r.mode !== 'keep' ? (
                  <button className="btn-sm" style={{ fontWeight: 700, color: 'var(--warn)' }}
                    title="누르면 어느 거래처 · 누구 것인지 아래에 펼칩니다" onClick={() => void toggleDue(r.key)}>
                    {r.due.toLocaleString('ko-KR')} {openKey === r.key ? '▴' : '▾'}
                  </button>
                ) : r.due.toLocaleString('ko-KR')}
              </td>
              <td className="r" style={{ color: 'var(--ink-2)' }}>{r.total.toLocaleString('ko-KR')}</td>
              <td>
                {!r.destroyOk ? (
                  <span className="bdg" style={{ fontSize: 'var(--fs-0)', background: '#FEE2E2', borderColor: '#FCA5A5', color: 'var(--bad)' }}
                    title="외부감사법 제19조제3항 — 감사조서의 파기를 금지한다">파기 금지</span>
                ) : r.mode === 'keep' ? (
                  <span style={{ color: 'var(--ink-4)' }}>—</span>
                ) : r.due > 0 ? (
                  <button className="btn-sm btn-sm-del" disabled={busy} onClick={() => void purge(r)}>파기</button>
                ) : (
                  <span style={{ color: 'var(--ink-4)' }}>—</span>
                )}
              </td>
            </tr>
            {openKey === r.key && (
              <tr>
                <td colSpan={8} style={{ background: '#FFFDF5', padding: '6px 12px 10px' }}>
                  <DueList items={dueItems[r.key]} total={r.due} />
                </td>
              </tr>
            )}
            </Fragment>
          ))}
        </tbody>
      </table>

      <div className="chdr" style={{ marginTop: 16 }}>📜 파기 이력</div>
      <table className="tbl" style={{ fontSize: 'var(--fs-1)' }}>
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
            <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 12 }}>
              파기한 이력이 없습니다.
            </td></tr>
          )}
          {log.map((l) => (
            <tr key={l.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{kstDateTime(l.at)}</td>
              <td>{l.actorName}</td>
              <td>{l.policyKey}<div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)' }}>{l.tableName}</div></td>
              <td style={{ color: 'var(--ink-2)' }}>{l.cutoff}</td>
              <td className="r" style={{ fontWeight: 700 }}>{l.deleted.toLocaleString('ko-KR')}</td>
              <td style={{ fontSize: 'var(--fs-0)' }}>{l.reason}</td>
              <td style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-2)' }}>{l.method}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="alert-s" style={{ fontSize: 'var(--fs-1)', marginTop: 12 }}>
        <b>분리 저장·관리 (법 제21조제3항)</b> — 거래가 끝난 거래처의 <b>주민등록번호·홈택스 비밀번호</b>는
        <b> 최고관리자만 열람</b>할 수 있습니다. 목적을 다한 개인정보가 계속 열람되지 않게 접근을 가른 것입니다.
        시도하면 거부되고 그 사실이 접속기록에 남습니다.
        <br />거래처 정보·계약·청구 이력은 <b>지금처럼 전원이 봅니다</b> — 거래가 끝나도 세무서 통지·경정청구로
        연락이 계속 오는 업종이라, 무작정 막으면 업무가 됩니다.
      </div>
    </div>
  );
}

/** 파기 대상 목록 — 거래처 · 사업장 · 상태 · 기준 날짜. 파기할 값 자체는 보이지 않는다. */
function DueList({ items, total }: { items: RetentionDueItem[] | 'loading' | string | undefined; total: number }) {
  if (items === undefined || items === 'loading') return <div style={{ color: 'var(--ink-3)' }}>불러오는 중…</div>;
  if (typeof items === 'string') return <div className="alert-e" style={{ fontSize: 'var(--fs-1)' }}>{items}</div>;
  if (!items.length) return <div style={{ color: 'var(--ink-3)' }}>대상이 없습니다.</div>;
  return (
    <>
      <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)', marginBottom: 4 }}>
        파기 대상 {items.length.toLocaleString('ko-KR')}건{total > items.length && ` (앞 ${items.length}건만 표시 · 전체 ${total.toLocaleString('ko-KR')}건)`}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-1)' }}>
        <tbody>
          {items.map((it, i) => (
            <tr key={i} style={{ borderTop: i ? '1px solid var(--rule-2)' : undefined }}>
              <td style={{ padding: '3px 6px', width: 34, color: 'var(--ink-4)', textAlign: 'right' }}>{i + 1}</td>
              <td style={{ padding: '3px 6px', fontWeight: 700, color: 'var(--navy)', whiteSpace: 'nowrap' }}>{it.label || '—'}</td>
              <td style={{ padding: '3px 6px', color: 'var(--ink-2)' }}>{it.detail}</td>
              <td style={{ padding: '3px 6px', color: 'var(--ink-3)', whiteSpace: 'nowrap', textAlign: 'right' }}>{it.at}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
