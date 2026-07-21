// 조회서발송관리 › 조회서 발송및진행
// 연도의 거래처를 죽 세우고, 펼치면 조회처별로 발송을 처리한다.
//  · 전자조회 — 클릭으로 발송/취소
//  · 실물발송 — 등기번호를 넣으면 발송 처리 + 우체국 조회 링크
// 모두 발송되면 그 거래처가 '발송완료'가 되고 발송일이 표시된다(집계는 조회처에서 계산).
import { useEffect, useMemo, useState } from 'react';
import { todayYmd } from '../../lib/format';
import {
  listConfirmations,
  listFiscalYears,
  listItemsByYear,
  setSent,
  bulkApply,
  summarize,
  defaultFiscalYear,
  type Confirmation,
  type ConfirmItem,
} from '../../lib/confirmApi';
import TrackingLink from '../docsend/TrackingLink';


/** 거래처 발송 단계 — 조회처 집계에서 파생한다 */
export function sendStage(sent: number, total: number): '미발송' | '발송중' | '발송완료' {
  if (total === 0 || sent === 0) return '미발송';
  return sent >= total ? '발송완료' : '발송중';
}
export const stageStyle = (s: string): React.CSSProperties => {
  if (s === '발송완료') return { background: '#D1FAE5', color: '#065F46' };
  if (s === '발송중') return { background: '#DBEAFE', color: '#1E40AF' };
  return { background: '#F3F4F6', color: '#6B7280' };
};

export default function ConfirmDispatchTab() {
  const [rows, setRows] = useState<Confirmation[]>([]);
  const [items, setItems] = useState<Record<string, ConfirmItem[]>>({});
  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState(defaultFiscalYear());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(y = year) {
    try {
      setError(null);
      const [list, ys, map] = await Promise.all([listConfirmations(y), listFiscalYears(), listItemsByYear(y)]);
      setRows(list);
      setYears(ys);
      setItems(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load(year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(''), 3000);
  }

  async function run(job: () => Promise<void>, done?: string) {
    setBusy(true);
    try {
      await job();
      await load();
      if (done) flash(done);
    } catch (e) {
      alert(e instanceof Error ? e.message : '처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  const yearOptions = useMemo(
    () => [...new Set([defaultFiscalYear(), ...years])].sort((a, b) => b - a),
    [years],
  );

  const totals = useMemo(() => {
    const all = rows.flatMap((r) => items[r.id] ?? []);
    return summarize(all);
  }, [rows, items]);

  if (loading) {
    return (
      <div className="card">
        <div className="chdr">📮 조회서 발송및진행</div>
        <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>불러오는 중…</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="chdr">조회서 발송및진행</div>

      {error && <div className="alert-w">{error}</div>}
      {msg && <div className="alert-s" style={{ fontSize: 12 }}>{msg}</div>}

      <div className="alert-i" style={{ fontSize: 11 }}>
        📮 <b>전자조회</b>는 발송 버튼을 눌러 처리하고, <b>실물발송</b>은 <b>등기번호를 입력</b>하면 발송 처리됩니다.
        등기번호를 클릭하면 우체국 배달조회가 새 창으로 열립니다. 조회처를 모두 발송하면 거래처가 <b>발송완료</b>가 되고 발송일이 표시됩니다.
      </div>

      <div className="sbar">
        <select value={year} onChange={(e) => { setYear(Number(e.target.value)); setOpenId(null); }}>
          {yearOptions.map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <span style={{ fontSize: 11, color: '#888' }}>거래처 {rows.length}곳 · 조회처 {totals.total}건</span>
        <span style={{ fontSize: 11.5, color: '#1A2B52', fontWeight: 700 }}>
          발송 {totals.sent}/{totals.total}
        </span>
        <button className="btn-sm" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => void load()}>🔄 새로고침</button>
      </div>

      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 30 }}></th>
              <th>거래처명</th>
              <th style={{ width: 110, textAlign: 'center' }}>기준일</th>
              <th style={{ width: 92 }}>담당회계사</th>
              <th style={{ width: 150, textAlign: 'center' }}>발송 진행</th>
              <th style={{ width: 108, textAlign: 'center' }}>전자 / 실물</th>
              <th style={{ width: 96, textAlign: 'center' }}>상태</th>
              <th style={{ width: 100, textAlign: 'center' }}>발송일</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: '#BBB', padding: 24 }}>
                {year}년에 등록된 조회서가 없습니다. ‘조회서등록’에서 먼저 등록하세요.
              </td></tr>
            )}
            {rows.map((r) => {
              const its = items[r.id] ?? [];
              const p = summarize(its);
              const stage = sendStage(p.sent, p.total);
              const open = openId === r.id;
              return (
                <ClientRows
                  key={r.id}
                  conf={r}
                  items={its}
                  progress={p}
                  stage={stage}
                  open={open}
                  busy={busy}
                  onToggle={() => setOpenId(open ? null : r.id)}
                  onRun={run}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ClientRows({
  conf, items, progress: p, stage, open, busy, onToggle, onRun,
}: {
  conf: Confirmation;
  items: ConfirmItem[];
  progress: ReturnType<typeof summarize>;
  stage: string;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onRun: (job: () => Promise<void>, done?: string) => Promise<void>;
}) {
  const [date, setDate] = useState(todayYmd());
  const unsentIds = items.filter((i) => !i.sent).map((i) => i.id);
  const unsentElecIds = items.filter((i) => !i.sent && i.isElectronic).map((i) => i.id);

  return (
    <>
      <tr style={open ? { background: '#EEF6FF' } : undefined}>
        <td style={{ textAlign: 'center' }}>
          <button className="btn-sm" style={{ fontSize: 10, padding: '1px 5px' }} onClick={onToggle} title="조회처 펼치기">
            {open ? '▾' : '▸'}
          </button>
        </td>
        <td style={{ fontSize: 12.5 }}>
          <b style={{ color: '#1A2B52', cursor: 'pointer' }} onClick={onToggle}>{conf.companyName}</b>
        </td>
        <td style={{ textAlign: 'center', fontSize: 11.5 }}>{conf.baseDate?.replace(/-/g, '.')}</td>
        <td style={{ fontSize: 12 }}>{conf.accountantName || <span style={{ color: '#CCC' }}>—</span>}</td>
        <td>
          <Bar done={p.sent} total={p.total} color="#1E40AF" />
        </td>
        <td style={{ textAlign: 'center', fontSize: 11 }}>
          <span style={{ color: '#1E40AF' }}>전자 {p.elecSent}/{p.elecTotal}</span>
          <span style={{ color: '#CCC' }}> · </span>
          <span style={{ color: '#8a5a00' }}>실물 {p.postSent}/{p.postTotal}</span>
        </td>
        <td style={{ textAlign: 'center' }}>
          <span className="bdg" style={{ fontSize: 10, ...stageStyle(stage) }}>{stage}</span>
        </td>
        <td style={{ textAlign: 'center', fontSize: 11 }}>
          {stage === '발송완료' && p.lastSentDate
            ? p.lastSentDate.replace(/-/g, '.')
            : p.firstSentDate
              ? <span style={{ color: '#888' }}>{p.firstSentDate.replace(/-/g, '.')}~</span>
              : <span style={{ color: '#CCC' }}>—</span>}
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={8} style={{ background: '#F7FAFF', padding: 10 }}>
            {/* 일괄 처리 바 */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <label style={{ fontSize: 11.5, color: '#555', display: 'flex', alignItems: 'center', gap: 4 }}>
                발송일
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ fontSize: 12 }} />
              </label>
              <button
                className="btn-sm btn-p"
                style={{ fontSize: 11 }}
                disabled={busy || unsentElecIds.length === 0}
                title="아직 발송하지 않은 전자조회 건을 한 번에 발송 처리합니다"
                onClick={() =>
                  void onRun(async () => {
                    const { ok, fails } = await bulkApply(unsentElecIds, (id) => setSent(id, { sent: true, sentDate: date }));
                    if (fails.length) throw new Error(`${ok}건 처리, ${fails.length}건 실패 — ${fails[0]}`);
                  }, `⚡ 전자조회 ${unsentElecIds.length}건 발송 처리`)
                }
              >
                ⚡ 전자조회 일괄발송 ({unsentElecIds.length})
              </button>
              <span style={{ fontSize: 10.5, color: '#8a5a00' }}>
                실물발송은 등기번호가 건마다 달라 개별로 입력합니다.
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#666' }}>
                미발송 {unsentIds.length}건
              </span>
            </div>

            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 36, textAlign: 'center' }}>No.</th>
                  <th style={{ width: 88 }}>구분</th>
                  <th style={{ width: 160 }}>금융기관명</th>
                  <th style={{ width: 84, textAlign: 'center' }}>조회방식</th>
                  <th>주소 / 수신자</th>
                  <th style={{ width: 176 }}>등기번호</th>
                  <th style={{ width: 96, textAlign: 'center' }}>발송일</th>
                  <th style={{ width: 106, textAlign: 'center' }}>발송</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: '#BBB', padding: 16 }}>
                    조회처가 없습니다. ‘조회서등록’에서 명세를 입력하세요.
                  </td></tr>
                )}
                {items.map((it, i) => (
                  <ItemRow key={it.id} it={it} seq={i + 1} date={date} busy={busy} onRun={onRun} />
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function ItemRow({
  it, seq, date, busy, onRun,
}: {
  it: ConfirmItem;
  seq: number;
  date: string;
  busy: boolean;
  onRun: (job: () => Promise<void>, done?: string) => Promise<void>;
}) {
  const [tn, setTn] = useState(it.trackingNo);

  return (
    <tr style={it.sent ? { background: '#F6FBF7' } : undefined}>
      <td style={{ textAlign: 'center', fontSize: 11, color: '#888' }}>{seq}</td>
      <td style={{ fontSize: 11.5 }}>{it.kind}</td>
      <td style={{ fontSize: 12 }}><b>{it.institution}</b></td>
      <td style={{ textAlign: 'center' }}>
        <span
          className="bdg"
          style={{
            fontSize: 10,
            ...(it.isElectronic ? { background: '#DBEAFE', color: '#1E40AF' } : { background: '#FEF3C7', color: '#92400E' }),
          }}
        >
          {it.isElectronic ? '전자조회' : '실물발송'}
        </span>
      </td>
      <td style={{ fontSize: 11 }}>
        {it.isElectronic ? (
          <span style={{ color: '#93a3b8' }}>—</span>
        ) : (
          <>
            {it.address || <span style={{ color: '#CCC' }}>주소 미입력</span>}
            {it.contactName && <span style={{ color: '#888' }}> · {it.contactName}</span>}
          </>
        )}
      </td>
      <td>
        {it.isElectronic ? (
          <span style={{ color: '#CCC', fontSize: 11 }}>해당 없음</span>
        ) : it.sent && it.trackingNo ? (
          <TrackingLink no={it.trackingNo} />
        ) : (
          <input
            value={tn}
            onChange={(e) => setTn(e.target.value)}
            placeholder="등기번호 입력 후 발송"
            style={{ width: '100%', fontSize: 11.5 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && tn.trim() && !busy) {
                void onRun(() => setSent(it.id, { sent: true, sentDate: date, trackingNo: tn }), '📮 발송 처리');
              }
            }}
          />
        )}
      </td>
      <td style={{ textAlign: 'center', fontSize: 11 }}>
        {it.sentDate ? it.sentDate.replace(/-/g, '.') : <span style={{ color: '#CCC' }}>—</span>}
      </td>
      <td style={{ textAlign: 'center' }}>
        {it.sent ? (
          <button
            className="btn-sm"
            style={{ fontSize: 10.5, background: '#D1FAE5', color: '#065F46', fontWeight: 700 }}
            disabled={busy}
            title="발송을 취소하고 미발송으로 되돌립니다"
            onClick={() => {
              if (!confirm(`‘${it.institution}’ 발송을 취소할까요?`)) return;
              void onRun(() => setSent(it.id, { sent: false }), '↩ 발송 취소');
            }}
          >
            ✅ 발송됨
          </button>
        ) : (
          <button
            className="btn-sm btn-p"
            style={{ fontSize: 10.5 }}
            disabled={busy || (!it.isElectronic && !tn.trim())}
            title={!it.isElectronic && !tn.trim() ? '실물발송은 등기번호를 먼저 입력하세요' : undefined}
            onClick={() =>
              void onRun(
                () => setSent(it.id, { sent: true, sentDate: date, trackingNo: it.isElectronic ? '' : tn }),
                '📮 발송 처리',
              )
            }
          >
            발송
          </button>
        )}
      </td>
    </tr>
  );
}

/** 진행 막대 — 숫자와 비율을 함께 */
export function Bar({ done, total, color }: { done: number; total: number; color: string }) {
  const r = total > 0 ? (done / total) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 7, background: '#E9EDF3', borderRadius: 4, overflow: 'hidden', minWidth: 52 }}>
        <div style={{ width: `${r}%`, height: '100%', background: color, transition: 'width .2s' }} />
      </div>
      <span style={{ fontSize: 10.5, color: '#555', whiteSpace: 'nowrap', minWidth: 52 }}>
        {done}/{total} ({Math.round(r)}%)
      </span>
    </div>
  );
}
