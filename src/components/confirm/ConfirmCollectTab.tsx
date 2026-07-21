// 조회서발송관리 › 조회서 회수관리
// 발송한 조회처를 거래처별로 펼쳐 회수완료/반송을 처리한다. 체크해서 일괄 반영도 된다.
// 반송은 사유가 필수이고, 그 사유가 조회현황에 그대로 나타난다.
import { useEffect, useMemo, useState } from 'react';
import { todayYmd } from '../../lib/format';
import {
  listConfirmations,
  listFiscalYears,
  listItemsByYear,
  setCollect,
  bulkApply,
  summarize,
  defaultFiscalYear,
  type Confirmation,
  type ConfirmItem,
  findOverdue,
  countPending,
  OVERDUE_THRESHOLDS,
  DEFAULT_OVERDUE_DAYS,
  type CollectStatus,
  type OverdueRow,
} from '../../lib/confirmApi';
import TrackingLink from '../docsend/TrackingLink';
import { Bar } from './ConfirmDispatchTab';


/** 거래처 회수 단계 — 조회처 집계에서 파생 */
function collectStage(collected: number, sent: number, returned: number): string {
  if (sent === 0) return '발송 전';
  if (collected >= sent && sent > 0) return '회수완료';
  if (returned > 0) return '반송 있음';
  return collected > 0 ? '회수중' : '미회수';
}
const stageStyle = (s: string): React.CSSProperties => {
  if (s === '회수완료') return { background: '#D1FAE5', color: '#065F46' };
  if (s === '반송 있음') return { background: '#FEE2E2', color: '#B91C1C' };
  if (s === '회수중') return { background: '#DBEAFE', color: '#1E40AF' };
  return { background: '#F3F4F6', color: '#6B7280' };
};

export default function ConfirmCollectTab() {
  const [rows, setRows] = useState<Confirmation[]>([]);
  const [items, setItems] = useState<Record<string, ConfirmItem[]>>({});
  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState(defaultFiscalYear());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 독촉 대상 — 발송했는데 임계일이 지나도록 회신이 없는 건. 거래처를 가로질러 본다.
  const [mode, setMode] = useState<'client' | 'overdue'>('client');
  const [overdueDays, setOverdueDays] = useState<number>(DEFAULT_OVERDUE_DAYS);

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

  const yearOptions = useMemo(() => [...new Set([defaultFiscalYear(), ...years])].sort((a, b) => b - a), [years]);
  const totals = useMemo(() => summarize(rows.flatMap((r) => items[r.id] ?? [])), [rows, items]);
  const overdue = useMemo(() => findOverdue(rows, items, overdueDays), [rows, items, overdueDays]);
  const pending = useMemo(() => countPending(rows, items), [rows, items]);

  if (loading) {
    return (
      <div className="card">
        <div className="chdr">📬 조회서 회수관리</div>
        <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>불러오는 중…</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="chdr">조회서 회수관리</div>

      {error && <div className="alert-w">{error}</div>}
      {msg && <div className="alert-s" style={{ fontSize: 12 }}>{msg}</div>}

      <div className="alert-i" style={{ fontSize: 11 }}>
        📬 <b>발송한 조회처</b>만 표시됩니다. 회신되면 <b>회수완료</b>, 되돌아오면 <b>반송</b>(사유 필수)으로 처리하세요.
        체크해서 <b>일괄 반영</b>도 됩니다. 반송 사유는 <b>조회현황</b>에 그대로 표시됩니다.
        금융기관조회서는 <b>100% 회수</b>가 목표입니다.
      </div>

      <div className="sbar">
        <select value={year} onChange={(e) => { setYear(Number(e.target.value)); setOpenId(null); }}>
          {yearOptions.map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <span style={{ fontSize: 11, color: '#888' }}>발송 {totals.sent}건</span>
        <span style={{ fontSize: 11.5, color: '#065F46', fontWeight: 700 }}>회수 {totals.collected}/{totals.sent}</span>
        {totals.returned > 0 && (
          <span style={{ fontSize: 11.5, color: '#B91C1C', fontWeight: 700 }}>반송 {totals.returned}</span>
        )}
        <button className="btn-sm" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => void load()}>🔄 새로고침</button>

        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            className="btn-sm"
            style={{
              fontSize: 11, padding: '2px 8px', fontWeight: 700,
              ...(mode === 'overdue'
                ? { background: '#FEE2E2', color: '#B91C1C' }
                : overdue.length > 0
                  ? { background: '#FEF3C7', color: '#92400E' }
                  : {}),
            }}
            onClick={() => { setMode(mode === 'overdue' ? 'client' : 'overdue'); setOpenId(null); }}
            title="발송했는데 회신이 없는 건을 거래처 구분 없이 모아 봅니다"
          >
            {mode === 'overdue' ? '← 거래처별로' : `⏰ 독촉 대상 ${overdue.length}`}
          </button>
          {mode === 'overdue' && (
            <select
              value={overdueDays}
              onChange={(e) => setOverdueDays(Number(e.target.value))}
              style={{ fontSize: 11.5 }}
              title="발송 후 며칠이 지난 건을 독촉 대상으로 볼지"
            >
              {OVERDUE_THRESHOLDS.map((d) => <option key={d} value={d}>{d}일 경과</option>)}
            </select>
          )}
        </span>
      </div>

      {mode === 'overdue' ? (
        <OverdueView
          rows={overdue}
          days={overdueDays}
          pending={pending}
          busy={busy}
          onRun={run}
        />
      ) : (
      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 30 }}></th>
              <th>거래처명</th>
              <th style={{ width: 110, textAlign: 'center' }}>기준일</th>
              <th style={{ width: 150, textAlign: 'center' }}>회수 진행</th>
              <th style={{ width: 108, textAlign: 'center' }}>전자 / 실물</th>
              <th style={{ width: 70, textAlign: 'center' }}>반송</th>
              <th style={{ width: 96, textAlign: 'center' }}>상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: '#BBB', padding: 24 }}>
                {year}년에 등록된 조회서가 없습니다.
              </td></tr>
            )}
            {rows.map((r) => {
              const its = items[r.id] ?? [];
              const p = summarize(its);
              const stage = collectStage(p.collected, p.sent, p.returned);
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
      )}
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
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(todayYmd());

  // 회수 대상은 '발송한' 조회처뿐이다.
  const sentItems = items.filter((i) => i.sent);
  const pending = sentItems.filter((i) => i.collectStatus === null);
  const selected = [...sel].filter((id) => sentItems.some((i) => i.id === id));

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  async function bulkCollect(status: CollectStatus) {
    if (!selected.length) return;
    let reason = '';
    if (status === '반송') {
      const r = prompt(`선택한 ${selected.length}건을 반송 처리합니다.\n반송 사유를 입력하세요.`, '');
      if (r === null) return;
      if (!r.trim()) { alert('반송 사유를 입력해야 합니다.'); return; }
      reason = r;
    }
    await onRun(async () => {
      const { ok, fails } = await bulkApply(selected, (id) => setCollect(id, status, { date, reason }));
      setSel(new Set());
      if (fails.length) throw new Error(`${ok}건 처리, ${fails.length}건 실패 — ${fails[0]}`);
    }, status === '반송' ? `↪ ${selected.length}건 반송 처리` : `✅ ${selected.length}건 회수완료`);
  }

  return (
    <>
      <tr style={open ? { background: '#EEF6FF' } : undefined}>
        <td style={{ textAlign: 'center' }}>
          <button className="btn-sm" style={{ fontSize: 10, padding: '1px 5px' }} onClick={onToggle}>
            {open ? '▾' : '▸'}
          </button>
        </td>
        <td style={{ fontSize: 12.5 }}>
          <b style={{ color: '#1A2B52', cursor: 'pointer' }} onClick={onToggle}>{conf.companyName}</b>
        </td>
        <td style={{ textAlign: 'center', fontSize: 11.5 }}>{conf.baseDate?.replace(/-/g, '.')}</td>
        <td><Bar done={p.collected} total={p.sent} color="#059669" /></td>
        <td style={{ textAlign: 'center', fontSize: 11 }}>
          <span style={{ color: '#1E40AF' }}>전자 {p.elecCollected}/{p.elecSent}</span>
          <span style={{ color: '#CCC' }}> · </span>
          <span style={{ color: '#8a5a00' }}>실물 {p.postCollected}/{p.postSent}</span>
        </td>
        <td style={{ textAlign: 'center' }}>
          {p.returned > 0
            ? <b style={{ color: '#B91C1C', fontSize: 12 }}>{p.returned}</b>
            : <span style={{ color: '#CCC' }}>—</span>}
        </td>
        <td style={{ textAlign: 'center' }}>
          <span className="bdg" style={{ fontSize: 10, ...stageStyle(stage) }}>{stage}</span>
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={7} style={{ background: '#F7FAFF', padding: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <label style={{ fontSize: 11.5, color: '#555', display: 'flex', alignItems: 'center', gap: 4 }}>
                처리일
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ fontSize: 12 }} />
              </label>
              <button
                className="btn-sm"
                style={{ fontSize: 11 }}
                disabled={busy || pending.length === 0}
                onClick={() => setSel(new Set(pending.map((i) => i.id)))}
              >
                미처리 전체선택 ({pending.length})
              </button>
              <button className="btn-sm" style={{ fontSize: 11 }} disabled={busy || sel.size === 0} onClick={() => setSel(new Set())}>
                해제
              </button>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: '#1A2B52' }}>{selected.length}건 선택</span>
              <button
                className="btn-p"
                style={{ fontSize: 11 }}
                disabled={busy || selected.length === 0}
                onClick={() => void bulkCollect('회수완료')}
              >
                ✅ 회수완료
              </button>
              <button
                className="btn-sm"
                style={{ fontSize: 11, background: '#FEE2E2', color: '#B91C1C', fontWeight: 700 }}
                disabled={busy || selected.length === 0}
                onClick={() => void bulkCollect('반송')}
              >
                ↪ 반송 (사유 입력)
              </button>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#666' }}>미처리 {pending.length}건</span>
            </div>

            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 32, textAlign: 'center' }}>☑</th>
                  <th style={{ width: 36, textAlign: 'center' }}>No.</th>
                  <th style={{ width: 84 }}>구분</th>
                  <th style={{ width: 160 }}>금융기관명</th>
                  <th style={{ width: 84, textAlign: 'center' }}>조회방식</th>
                  <th style={{ width: 168 }}>등기번호</th>
                  <th style={{ width: 88, textAlign: 'center' }}>발송일</th>
                  <th>회수 / 반송사유</th>
                  <th style={{ width: 150, textAlign: 'center' }}>처리</th>
                </tr>
              </thead>
              <tbody>
                {sentItems.length === 0 && (
                  <tr><td colSpan={9} style={{ textAlign: 'center', color: '#BBB', padding: 16 }}>
                    아직 발송한 조회처가 없습니다. ‘조회서 발송및진행’에서 먼저 발송하세요.
                  </td></tr>
                )}
                {sentItems.map((it, i) => (
                  <CollectRow
                    key={it.id}
                    it={it}
                    seq={i + 1}
                    date={date}
                    busy={busy}
                    checked={sel.has(it.id)}
                    onCheck={() => toggle(it.id)}
                    onRun={onRun}
                  />
                ))}
              </tbody>
            </table>

            {items.some((i) => !i.sent) && (
              <div style={{ fontSize: 10.5, color: '#8a5a00', marginTop: 6 }}>
                ⚠️ 미발송 {items.filter((i) => !i.sent).length}건은 회수 대상이 아니라 표시하지 않았습니다.
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function CollectRow({
  it, seq, date, busy, checked, onCheck, onRun,
}: {
  it: ConfirmItem;
  seq: number;
  date: string;
  busy: boolean;
  checked: boolean;
  onCheck: () => void;
  onRun: (job: () => Promise<void>, done?: string) => Promise<void>;
}) {
  const done = it.collectStatus === '회수완료';
  const returned = it.collectStatus === '반송';

  function markReturned() {
    const r = prompt(`‘${it.institution}’ 반송 사유를 입력하세요.`, it.returnReason || '');
    if (r === null) return;
    if (!r.trim()) { alert('반송 사유를 입력해야 합니다.'); return; }
    void onRun(() => setCollect(it.id, '반송', { date, reason: r }), '↪ 반송 처리');
  }

  return (
    <tr style={done ? { background: '#F6FBF7' } : returned ? { background: '#FFF7F7' } : undefined}>
      <td style={{ textAlign: 'center' }}>
        <input type="checkbox" checked={checked} onChange={onCheck} />
      </td>
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
      <td>{it.isElectronic ? <span style={{ color: '#CCC', fontSize: 11 }}>—</span> : <TrackingLink no={it.trackingNo} />}</td>
      <td style={{ textAlign: 'center', fontSize: 11 }}>
        {it.sentDate ? it.sentDate.replace(/-/g, '.') : <span style={{ color: '#CCC' }}>—</span>}
      </td>
      <td style={{ fontSize: 11.5 }}>
        {done && (
          <span style={{ color: '#065F46' }}>
            ✅ 회수완료{it.collectDate ? ` · ${it.collectDate.replace(/-/g, '.')}` : ''}
          </span>
        )}
        {returned && (
          <span style={{ color: '#B91C1C' }}>
            ↪ 반송{it.collectDate ? ` · ${it.collectDate.replace(/-/g, '.')}` : ''}
            {it.returnReason && <span style={{ color: '#8a5a00' }}> — {it.returnReason}</span>}
          </span>
        )}
        {!done && !returned && <span style={{ color: '#BBB' }}>미처리</span>}
      </td>
      <td style={{ textAlign: 'center' }}>
        <div style={{ display: 'flex', gap: 3, justifyContent: 'center' }}>
          {it.collectStatus === null ? (
            <>
              <button
                className="btn-sm btn-p"
                style={{ fontSize: 10.5 }}
                disabled={busy}
                onClick={() => void onRun(() => setCollect(it.id, '회수완료', { date }), '✅ 회수완료')}
              >
                회수
              </button>
              <button
                className="btn-sm"
                style={{ fontSize: 10.5, background: '#FEE2E2', color: '#B91C1C' }}
                disabled={busy}
                onClick={markReturned}
              >
                반송
              </button>
            </>
          ) : (
            <>
              {returned && (
                <button className="btn-sm" style={{ fontSize: 10.5 }} disabled={busy} onClick={markReturned} title="반송 사유 수정">
                  ✏️
                </button>
              )}
              <button
                className="btn-sm"
                style={{ fontSize: 10.5 }}
                disabled={busy}
                title="미처리로 되돌립니다"
                onClick={() => void onRun(() => setCollect(it.id, null), '↩ 되돌림')}
              >
                되돌리기
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * 독촉 대상 — 발송했는데 회신이 없는 건을 거래처 구분 없이 모아 본다.
 * 오래 밀린 것부터 위로 올려, 전화 돌릴 순서를 그대로 보여준다.
 */
function OverdueView({
  rows, days, pending, busy, onRun,
}: {
  rows: OverdueRow[];
  days: number;
  pending: number;
  busy: boolean;
  onRun: (job: () => Promise<void>, done?: string) => Promise<void>;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const today = todayYmd();

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  async function bulk(status: CollectStatus) {
    const ids = [...sel];
    if (!ids.length) return;
    let reason = '';
    if (status === '반송') {
      const r = prompt(`선택한 ${ids.length}건을 반송 처리합니다.\n반송 사유를 입력하세요.`, '');
      if (r === null) return;
      if (!r.trim()) { alert('반송 사유를 입력해야 합니다.'); return; }
      reason = r;
    }
    await onRun(async () => {
      const { ok, fails } = await bulkApply(ids, (id) => setCollect(id, status, { date: today, reason }));
      setSel(new Set());
      if (fails.length) throw new Error(`${ok}건 처리, ${fails.length}건 실패 — ${fails[0]}`);
    }, status === '반송' ? `↪ ${ids.length}건 반송 처리` : `✅ ${ids.length}건 회수완료`);
  }

  /** 오래될수록 붉게 — 30일 넘으면 강조 */
  const dayStyle = (d: number): React.CSSProperties =>
    d >= 30
      ? { color: '#B91C1C', fontWeight: 800 }
      : d >= 21
        ? { color: '#92400E', fontWeight: 700 }
        : { color: '#555' };

  return (
    <>
      <div className="alert-i" style={{ fontSize: 11, marginBottom: 8 }}>
        ⏰ 발송한 지 <b>{days}일</b> 넘도록 회신이 없는 건입니다({rows.length}건 / 미회수 전체 {pending}건).
        오래 밀린 순으로 보여드리니 위에서부터 확인하세요. 반송된 건은 이미 조치 대상이라 여기 나오지 않습니다.
      </div>

      {rows.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <button className="btn-sm" style={{ fontSize: 11 }} disabled={busy} onClick={() => setSel(new Set(rows.map((r) => r.item.id)))}>
            전체선택 ({rows.length})
          </button>
          <button className="btn-sm" style={{ fontSize: 11 }} disabled={busy || sel.size === 0} onClick={() => setSel(new Set())}>해제</button>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: '#1A2B52' }}>{sel.size}건 선택</span>
          <button className="btn-p" style={{ fontSize: 11 }} disabled={busy || sel.size === 0} onClick={() => void bulk('회수완료')}>
            ✅ 회수완료
          </button>
          <button
            className="btn-sm"
            style={{ fontSize: 11, background: '#FEE2E2', color: '#B91C1C', fontWeight: 700 }}
            disabled={busy || sel.size === 0}
            onClick={() => void bulk('반송')}
          >
            ↪ 반송 (사유 입력)
          </button>
        </div>
      )}

      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 32, textAlign: 'center' }}>☑</th>
              <th style={{ width: 66, textAlign: 'center' }}>경과</th>
              <th>거래처명</th>
              <th style={{ width: 88 }}>담당회계사</th>
              <th style={{ width: 84 }}>구분</th>
              <th style={{ width: 170 }}>금융기관명</th>
              <th style={{ width: 84, textAlign: 'center' }}>조회방식</th>
              <th style={{ width: 168 }}>등기번호</th>
              <th style={{ width: 92, textAlign: 'center' }}>발송일</th>
              <th style={{ width: 128 }}>연락처</th>
              <th style={{ width: 140, textAlign: 'center' }}>처리</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={11} style={{ textAlign: 'center', color: '#7A9B7A', padding: 24, fontSize: 12.5 }}>
                🎉 {days}일 넘게 밀린 건이 없습니다.
              </td></tr>
            )}
            {rows.map(({ conf, item, days: d }) => (
              <tr key={item.id}>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={sel.has(item.id)} onChange={() => toggle(item.id)} />
                </td>
                <td style={{ textAlign: 'center', fontSize: 12, ...dayStyle(d) }}>{d}일</td>
                <td style={{ fontSize: 12.5 }}><b style={{ color: '#1A2B52' }}>{conf.companyName}</b></td>
                <td style={{ fontSize: 11.5 }}>{conf.accountantName || <span style={{ color: '#CCC' }}>—</span>}</td>
                <td style={{ fontSize: 11.5 }}>{item.kind}</td>
                <td style={{ fontSize: 12 }}><b>{item.institution}</b></td>
                <td style={{ textAlign: 'center' }}>
                  <span
                    className="bdg"
                    style={{
                      fontSize: 10,
                      ...(item.isElectronic ? { background: '#DBEAFE', color: '#1E40AF' } : { background: '#FEF3C7', color: '#92400E' }),
                    }}
                  >
                    {item.isElectronic ? '전자조회' : '실물발송'}
                  </span>
                </td>
                <td>{item.isElectronic ? <span style={{ color: '#CCC', fontSize: 11 }}>—</span> : <TrackingLink no={item.trackingNo} />}</td>
                <td style={{ textAlign: 'center', fontSize: 11 }}>{item.sentDate?.replace(/-/g, '.') ?? '—'}</td>
                <td style={{ fontSize: 11 }}>{item.phone || <span style={{ color: '#CCC' }}>—</span>}</td>
                <td style={{ textAlign: 'center' }}>
                  <div style={{ display: 'flex', gap: 3, justifyContent: 'center' }}>
                    <button
                      className="btn-sm btn-p"
                      style={{ fontSize: 10.5 }}
                      disabled={busy}
                      onClick={() => void onRun(() => setCollect(item.id, '회수완료', { date: today }), '✅ 회수완료')}
                    >
                      회수
                    </button>
                    <button
                      className="btn-sm"
                      style={{ fontSize: 10.5, background: '#FEE2E2', color: '#B91C1C' }}
                      disabled={busy}
                      onClick={() => {
                        const r = prompt(`‘${item.institution}’ 반송 사유를 입력하세요.`, '');
                        if (r === null) return;
                        if (!r.trim()) { alert('반송 사유를 입력해야 합니다.'); return; }
                        void onRun(() => setCollect(item.id, '반송', { date: today, reason: r }), '↪ 반송 처리');
                      }}
                    >
                      반송
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
