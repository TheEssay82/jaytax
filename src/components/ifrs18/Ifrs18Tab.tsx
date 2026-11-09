// K-IFRS 1118 월결산 — 회사 담당자가 SAP 분개장 하나를 올려 1118 손익계산서를 만든다(사용자 2026-11-09).
// 순서대로만 따라오면 되게 한 화면에 STEP 1~6 을 세로로 놓는다(「시트 이해가 어렵다 — 순서만 따라가도 되게」).
// 분개장은 브라우저 안에서만 읽는다. 서버에는 판단표 · 판단 기록만 오간다(0189).
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  compute, computeAt, computePeriods, closeSummary, close2Checks, close2Summary, needsClose2, monthEnd, parseSapJournal, validateConfig, keyOf, LINES_1118, PL1118_ORDER, PL1001_ORDER,
  type Ifrs18Config, type JLine, type Judgment, type Line1118, type Decision,
} from '../../lib/ifrs18';
import {
  listIfrs18Clients, saveIfrs18Client, listIfrs18Judgments, saveIfrs18Judgment, deleteIfrs18Judgment,
  listIfrs18Closes, closeIfrs18Month, reopenIfrs18Month, close2Ifrs18Month, listIfrs18Log, logIfrs18,
  type Ifrs18ClientRow, type Ifrs18CloseRow, type Ifrs18LogRow,
} from '../../lib/ifrs18Api';
import Ifrs18Dashboard, { type Drift } from './Ifrs18Dashboard';

const won = (n: number) => (n < 0 ? `(${Math.abs(Math.round(n)).toLocaleString()})` : Math.round(n).toLocaleString());
const td: React.CSSProperties = { padding: '4px 8px', borderBottom: '1px solid var(--rule)', fontSize: 'var(--fs-1)', verticalAlign: 'top' };
const th: React.CSSProperties = { ...td, background: '#F1F5F9', fontWeight: 700, position: 'sticky', top: 0 };
const num: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const stepHead = (n: number, t: string, done: boolean, sub?: string) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
    <span style={{ background: done ? '#16A34A' : 'var(--navy)', color: '#fff', borderRadius: 12, padding: '1px 9px', fontWeight: 700, fontSize: 'var(--fs-1)' }}>STEP {n}{done ? ' ✔' : ''}</span>
    <b style={{ color: 'var(--navy)' }}>{t}</b>
    {sub && <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>{sub}</span>}
  </div>
);

/**
 * `fixedKey` — 회사 전용 주소(/kifrs1118_<회사키>)로 들어오면 그 회사만 보인다(사용자 2026-11-09 「주소는 별도로」).
 * 회사 고르기는 감추고, 권한이 없는 회사 키면 안내만 한다.
 */
export default function Ifrs18Tab({ fixedKey }: { fixedKey?: string } = {}) {
  const { role, profileName, readonly } = useAuth();
  const admin = !readonly && (role === 'superuser' || role === 'accountant');
  const [clients, setClients] = useState<Ifrs18ClientRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [key, setKey] = useState(fixedKey ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(Math.max(1, now.getMonth())); // 기본: 지난달
  const [lines, setLines] = useState<JLine[]>([]);
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [annual, setAnnual] = useState<Record<string, number>>({});
  const [judgments, setJudgments] = useState<Judgment[]>([]);
  const [busy, setBusy] = useState(false);
  const [closes, setCloses] = useState<Ifrs18CloseRow[]>([]);
  const [logs, setLogs] = useState<Ifrs18LogRow[]>([]);
  const reloadDash = (k = key) => {
    if (!k) return;
    listIfrs18Closes(k).then(setCloses).catch(() => setCloses([]));
    listIfrs18Log(k).then(setLogs).catch(() => setLogs([]));
  };
  const log = async (action: Parameters<typeof logIfrs18>[3], detail: Record<string, unknown>) => {
    if (!key) return;
    await logIfrs18(key, year, month, action, detail, profileName);
    listIfrs18Log(key).then(setLogs).catch(() => undefined);
  };

  async function reload() {
    try {
      const cs = await listIfrs18Clients();
      setClients(fixedKey ? cs.filter((c) => c.key === fixedKey) : cs);
      if (!fixedKey && cs.length === 1 && !key) setKey(cs[0].key);
    } catch (e) { setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'); }
    finally { setLoaded(true); }
  }
  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const client = clients.find((c) => c.key === key) ?? null;
  const cfgBase = client?.config ?? null;
  useEffect(() => {
    if (!key) return;
    setAnnual({});
    listIfrs18Judgments(key).then(setJudgments).catch((e) => setErr(e instanceof Error ? e.message : '판단 기록을 불러오지 못했습니다.'));
    reloadDash(key);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const cfg: Ifrs18Config | null = useMemo(() => cfgBase && {
    ...cfgBase,
    actuarial: cfgBase.actuarial.map((a) => (a.key in annual ? { ...a, annual: annual[a.key] } : a)),
  }, [cfgBase, annual]);
  const res = useMemo(() => (cfg && lines.length ? compute(lines, cfg, judgments, year, month) : null), [cfg, lines, judgments, year, month]);
  const lastDate = useMemo(() => lines.reduce((m, l) => (l.date > m ? l.date : m), ''), [lines]);
  const per = useMemo(() => (cfg && res ? computePeriods(lines, cfg, judgments, year, month, res) : null), [cfg, res, lines, judgments, year, month]);
  const closedThisYear = useMemo(() => new Map(closes.filter((c) => c.year === year).map((c) => [c.month, c])), [closes, year]);
  const closedRow = closedThisYear.get(month) ?? null;
  /** 마감한 달(기준월까지)을 지금 분개장으로 다시 계산해 마감 때와 다르면 표시 */
  const drift = useMemo(() => {
    const out = new Map<number, Drift>();
    if (!cfg || !res || !lines.length) return out;
    for (const [m, c] of closedThisYear) {
      if (m > month) continue;
      const r = m === month ? res : computeAt(lines, cfg, judgments, year, m);
      if (!r) continue;
      const op = Math.round(r.pl1118['영업손익'] - c.summary.op.cum), ni = Math.round(r.pl1118['당기순손익'] - c.summary.ni.cum);
      if (op || ni) out.set(m, { op, ni });
    }
    return out;
  }, [cfg, res, lines, judgments, year, month, closedThisYear]);
  /** 그 라인이 마감된 달의 전표면 판단을 잠근다(바꾸려면 그 달 마감 해제). */
  const lockedLine = (date: string) => date.slice(0, 4) === String(year) && closedThisYear.has(Number(date.slice(5, 7)));
  const periodOk = !lastDate || lastDate.slice(0, 7) === `${year}-${String(month).padStart(2, '0')}`;

  async function onConfigFile(f: File) {
    setErr(null);
    try {
      const v = validateConfig(JSON.parse(await f.text()));
      if (!v.ok) { setErr(`판단표 파일: ${v.error}`); return; }
      if (fixedKey && v.cfg.clientKey !== fixedKey) { setErr(`이 주소는 「${fixedKey}」 전용입니다 — 올린 판단표의 회사키는 「${v.cfg.clientKey}」입니다.`); return; }
      await saveIfrs18Client(v.cfg);
      await reload(); setKey(v.cfg.clientKey);
      setMsg(`판단표를 올렸습니다 — ${v.cfg.clientName} · 계정 ${v.cfg.accounts.length}개 · BS 속성 ${Object.keys(v.cfg.bsAttr).length}개`);
    } catch (e) { setErr(e instanceof Error ? e.message : '판단표를 올리지 못했습니다.'); }
  }
  async function onJournal(f: File) {
    setErr(null); setReading(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await f.arrayBuffer()); // 날짜는 일련번호로 받아 시간대 영향 없이 바꾼다
      let best: ReturnType<typeof parseSapJournal> | null = null;
      for (const sh of wb.SheetNames) {
        const p = parseSapJournal(XLSX.utils.sheet_to_json(wb.Sheets[sh], { header: 1, defval: '', raw: true }) as unknown[][]);
        if (p.head >= 0 && (!best || p.lines.length > best.lines.length)) best = p;
      }
      if (!best) { setErr('SAP 분개장 머리글(전표번호 · 전기일 · G/L 계정 · G/L 계정명 · 차변금액(로컬) · 대변금액(로컬))을 찾지 못했습니다. SAP 에서 내려받은 파일을 그대로 올려 주세요.'); return; }
      setLines(best.lines); setFileName(f.name);
      void log('분개장 읽음', { fileName: f.name, lines: best.lines.length, lastDate: best.lines.reduce((m, l) => (l.date > m ? l.date : m), '') });
      setMsg(`분개장 ${best.lines.length.toLocaleString()}줄을 읽었습니다(브라우저 안에서만 — 서버로 보내지 않습니다).`);
    } catch (e) { setErr(e instanceof Error ? e.message : '분개장을 읽지 못했습니다.'); }
    finally { setReading(false); }
  }
  async function decide(w: { docNo: string; gl: string }, decision: Decision | null, patch: Partial<Judgment> = {}) {
    if (!key) return;
    setBusy(true);
    try {
      if (decision === null) {
        await deleteIfrs18Judgment(key, w.docNo, w.gl);
        setJudgments((js) => js.filter((j) => keyOf(j.docNo, j.gl) !== keyOf(w.docNo, w.gl)));
        void log('판단 삭제', { docNo: w.docNo, gl: w.gl });
      } else {
        const cur = judgments.find((j) => keyOf(j.docNo, j.gl) === keyOf(w.docNo, w.gl));
        const j: Judgment = { docNo: w.docNo, gl: w.gl, decision, target: cur?.target ?? null, reason: cur?.reason ?? '', ...patch, byName: profileName, at: new Date().toISOString() };
        await saveIfrs18Judgment(key, j, profileName);
        setJudgments((js) => [...js.filter((x) => keyOf(x.docNo, x.gl) !== keyOf(j.docNo, j.gl)), j]);
        void log('판단 저장', { docNo: j.docNo, gl: j.gl, decision: j.decision, target: j.target, reason: j.reason });
      }
    } catch (e) { setErr(e instanceof Error ? e.message : '저장하지 못했습니다.'); }
    finally { setBusy(false); }
  }
  async function download() {
    if (!cfg || !res) return;
    const { exportIfrs18Workbook, ifrs18FileName } = await import('../../lib/ifrs18Excel');
    await exportIfrs18Workbook({ cfg, res, per: per ?? undefined, lines, judgments, fileName, byName: profileName, close1: closedRow, close2: closedRow?.close2 ?? null });
    void log('엑셀 내려받기', { file: ifrs18FileName({ cfg, res }) });
  }
  async function closeMonth() {
    if (!key || !res || !per) return;
    const earlier = Array.from({ length: month - 1 }, (_, i) => i + 1).filter((m) => !closedThisYear.has(m));
    if (earlier.length && !confirm(`${earlier.map((m) => `${m}월`).join(' · ')}이 아직 마감되지 않았습니다. 그래도 ${month}월을 마감할까요?`)) return;
    setBusy(true);
    try {
      const sm = closeSummary(res, per, fileName, lastDate);
      await closeIfrs18Month(key, sm, profileName);
      await log('마감', { opCum: sm.op.cum, opMonth: sm.op.month, niCum: sm.ni.cum, fileName });
      reloadDash();
      setMsg(`${year}년 ${month}월을 마감했습니다. 이 달 전표의 주의계정 판단은 잠깁니다.`);
    } catch (e) { setErr(e instanceof Error ? e.message : '마감하지 못했습니다.'); }
    finally { setBusy(false); }
  }
  async function close2Month(undo: boolean) {
    if (!key || !res) return;
    let reason = '';
    if (undo) {
      reason = prompt(`${year}년 ${month}월 2차 마감을 해제합니다. 사유를 적어 주세요(작업 기록에 남습니다).`)?.trim() ?? '';
      if (!reason) return;
    }
    setBusy(true);
    try {
      await close2Ifrs18Month(key, year, month, undo ? null : close2Summary(res, fileName, lastDate), profileName);
      await log(undo ? '2차 마감 해제' : '2차 마감', undo ? { reason } : { fileName, op: Math.round(res.pl1118['영업손익']), posted: res.moves.reduce((a, m) => a + Math.abs(m.posted), 0) });
      reloadDash();
      setMsg(undo ? `${year}년 ${month}월 2차 마감을 해제했습니다.` : `${year}년 ${month}월 2차 마감을 했습니다 — 조정전표 반영이 확인되었습니다.`);
    } catch (e) { setErr(e instanceof Error ? e.message : '저장하지 못했습니다.'); }
    finally { setBusy(false); }
  }
  async function reopenMonth() {
    if (!key) return;
    if (closedRow?.close2) { alert('2차 마감을 먼저 해제해 주세요(STEP 7).'); return; }
    const reason = prompt(`${year}년 ${month}월 마감을 해제합니다. 사유를 적어 주세요(작업 기록에 남습니다).`);
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      await reopenIfrs18Month(key, year, month);
      await log('마감 해제', { reason: reason.trim() });
      reloadDash();
      setMsg(`${year}년 ${month}월 마감을 해제했습니다.`);
    } catch (e) { setErr(e instanceof Error ? e.message : '마감을 해제하지 못했습니다.'); }
    finally { setBusy(false); }
  }

  const jm = new Map(judgments.map((j) => [keyOf(j.docNo, j.gl), j]));
  const pending = res?.watch.filter((w) => w.decision === '미판단').length ?? 0;
  const allOk = !!res && res.checks.every((c) => c.ok) && periodOk;

  return (<>
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 'var(--fs-4)', color: 'var(--navy)' }}>📐 K-IFRS 1118 월결산</b>
        {clients.length > 1 && (
          <select value={key} onChange={(e) => { setKey(e.target.value); setLines([]); }} style={{ width: 'auto' }}>
            <option value="">회사 선택</option>
            {clients.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
        )}
        {client && clients.length === 1 && <span style={{ fontWeight: 700 }}>{client.name}</span>}
        {admin && <label className="btn-sm" style={{ cursor: 'pointer' }}>판단표 올리기(JSON)<input type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onConfigFile(f); }} /></label>}
        {res && <span style={{ marginLeft: 'auto', fontWeight: 700, color: allOk ? '#16A34A' : '#B45309' }}>{closedRow ? `🔒 ${month}월 마감됨` : allOk ? '✔ 마감 가능 — STEP 6 에서 마감' : `진행 중 — 남은 확인 ${res.checks.filter((c) => !c.ok).length + (periodOk ? 0 : 1)}건`}</span>}
      </div>
      <div style={{ fontSize: 'var(--fs-2)', lineHeight: 1.7, marginTop: 6, background: '#F8FAFC', border: '1px solid var(--rule)', borderRadius: 6, padding: '8px 10px' }}>
        <b>하는 일</b> — 매달 <b>SAP 분개장(1월~기준월 누적, 전체 계정) 하나</b>만 올리면 계정 판단표에 따라 K-IFRS 1118 손익계산서 · 영업손익 브릿지 · 범주별 주석 금액을 만들고, <b>엑셀 수식으로 다시 계산되는 검증 파일</b>로 내려받습니다.
        <div style={{ color: 'var(--ink-3)' }}>분개장은 이 브라우저 안에서만 읽습니다. 서버에 저장되는 것은 주의계정 판단 기록(전표번호 · 계정 · 판단 · 근거)뿐입니다. 기존 SAP 계정을 그대로 써도 됩니다(신설 계정 불필요).</div>
      </div>
      {err && <div className="alert-w" style={{ marginTop: 6 }}>{err}</div>}
      {msg && !err && <div style={{ marginTop: 6, fontSize: 'var(--fs-1)', color: '#166534' }}>{msg}</div>}
      {loaded && !clients.length && <div style={{ marginTop: 8, color: 'var(--ink-3)' }}>{fixedKey ? '이 회사 화면을 볼 권한이 없거나 아직 판단표가 없습니다. ' : '연결된 회사가 없습니다. '}{admin ? '「판단표 올리기」로 회사 판단표(JSON)를 올려 주세요.' : '인덕회계법인에 연결을 요청해 주세요.'}</div>}
    </div>

    {cfg && <>
      <Ifrs18Dashboard year={year} month={month} closes={closes} logs={logs} drift={drift} onPick={setMonth} />
      <div className="card">
        {stepHead(1, '기준월 고르기', true, '마감할 달(누적 마지막 달)')}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 'auto' }}>{[year - 1, year, year + 1].map((y) => <option key={y}>{y}</option>)}</select>년
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={{ width: 'auto' }}>{Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}</select>
          <span style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-1)' }}>→ 누적 {year}. 1. 1 ~ {monthEnd(year, month).slice(5).replace('-', '. ')} · 당월 {month}월 · 당분기 {Math.floor((month - 1) / 3) * 3 + 1}~{month}월</span>
          {closedRow && <span style={{ fontWeight: 700, color: '#16A34A' }}>🔒 마감됨({new Date(closedRow.at).toLocaleDateString('ko-KR')} {closedRow.byName})</span>}
        </div>
      </div>

      <div className="card">
        {stepHead(2, 'SAP 분개장 올리기', lines.length > 0 && periodOk, '1월 1일 ~ 기준월 말일 누적 · 전체 계정 · SAP 에서 내려받은 파일 그대로')}
        <label className="btn-sm btn-sm-navy" style={{ cursor: 'pointer' }}>{reading ? '읽는 중…' : '분개장 xlsx 선택'}<input type="file" accept=".xlsx,.xls" hidden disabled={reading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onJournal(f); }} /></label>
        {lines.length > 0 && <span style={{ marginLeft: 8, fontSize: 'var(--fs-1)' }}>{fileName} · {lines.length.toLocaleString()}줄 · 마지막 전기일 {lastDate}{res ? ` · 임시전표 ${res.tempCount}줄 제외` : ''}</span>}
        {lines.length > 0 && !periodOk && <div className="alert-w" style={{ marginTop: 6 }}>분개장의 마지막 전기일({lastDate})이 기준월({year}-{String(month).padStart(2, '0')})과 다릅니다. 기준월이나 파일을 확인하세요.</div>}
        {res && res.tb.some((t) => !t.registered) && (
          <div className="alert-w" style={{ marginTop: 6 }}>판단표에 없는 손익 계정: {res.tb.filter((t) => !t.registered).map((t) => `${t.gl} ${t.name}`).join(', ')} — 인덕회계법인에 판단표 추가를 요청하세요.</div>
        )}
        {res && res.unregisteredBs.length > 0 && <div className="alert-w" style={{ marginTop: 6 }}>속성이 없는 BS 계정 {res.unregisteredBs.length}개: {res.unregisteredBs.slice(0, 10).join(', ')}{res.unregisteredBs.length > 10 ? ' …' : ''} — 판단표 갱신 필요</div>}
      </div>

      <div className="card">
        {stepHead(3, '계리 금액 확인', true, '연초(계리보고서를 새로 받았을 때)만 바꿉니다. 매월은 「당기분」이 기준월에 맞는지만 봅니다.')}
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr><th style={th}>항목</th><th style={th}>원천 계정</th><th style={th}>대상</th><th style={{ ...th, textAlign: 'right' }}>연간 금액(차변+)</th><th style={{ ...th, textAlign: 'right' }}>당기분 ({month}/12)</th><th style={th}>근거</th></tr></thead>
          <tbody>{cfg.actuarial.map((a) => (
            <tr key={a.key}>
              <td style={td}>{a.label}</td><td style={td}>{a.srcGl}</td><td style={td}>{a.target}</td>
              <td style={num}><input type="number" value={a.annual} onChange={(e) => setAnnual((x) => ({ ...x, [a.key]: Number(e.target.value) }))} style={{ width: 130, textAlign: 'right', background: '#FFF8DB' }} /></td>
              <td style={num}>{won(a.override ?? Math.round((a.annual * month) / 12))}</td>
              <td style={{ ...td, color: 'var(--ink-3)' }}>{a.note}</td>
            </tr>
          ))}</tbody>
        </table>
        <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)', marginTop: 4 }}>부호: 원천 계정 기준 차변+ (비용 +, 수익 −). 여기서 바꾼 값은 이번 계산에만 쓰입니다 — 판단표에 고정하려면 인덕회계법인에 알려 주세요.</div>
      </div>

      {res && <>
        <div className="card">
          {stepHead(4, '주의계정 판단', pending === 0, `같은 계정에 투자 · 재무 거래가 섞일 수 있는 계정만 — 같은 전표에 대여금 · 투자주식 · 차입금 같은 계정이 있는 라인 ${res.watch.length}줄`)}
          {res.watch.length === 0 ? <div style={{ color: 'var(--ink-3)' }}>검토할 라인이 없습니다.</div> : <>
            <div style={{ fontSize: 'var(--fs-1)', marginBottom: 4 }}>
              라인마다 <b>영업 유지</b>(그대로 둠) 또는 <b>조정</b>(제안 항목으로 옮김)을 누르고 근거를 적습니다. 판단은 저장되어 다음 달 누적 분개장에서도 다시 묻지 않습니다.
              <span style={{ color: pending ? 'var(--bad)' : '#16A34A', fontWeight: 700 }}> 미판단 {pending}줄</span>
            </div>
            <div style={{ maxHeight: 420, overflow: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr>{['전표번호', '전기일', '계정', '금액(차변+)', '라인텍스트', '같은 전표 투자·재무 계정', '판단', '조정 시 대상', '근거'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>{res.watch.map((w) => {
                  const j = jm.get(keyOf(w.docNo, w.gl));
                  const lk = lockedLine(w.date);
                  return (
                    <tr key={keyOf(w.docNo, w.gl)} style={{ background: w.decision === '미판단' ? '#FEF2F2' : undefined }}>
                      <td style={td}>{w.docNo}</td><td style={td}>{w.date}</td><td style={td}>{w.gl} {w.glName}</td><td style={num}>{won(w.amt)}</td>
                      <td style={td}>{w.memo}</td><td style={td}>{w.cpName} [{w.cpAttr}]</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {(['영업 유지', '조정'] as Decision[]).map((d) => (
                          <button key={d} className={`btn-sm${w.decision === d ? ' btn-sm-navy' : ''}`} disabled={busy || readonly || lk} title={lk ? '마감된 달의 전표 — 바꾸려면 그 달 마감 해제' : undefined} onClick={() => void decide(w, w.decision === d ? null : d)} style={{ marginRight: 4 }}>{d}</button>
                        ))}{lk && '🔒'}
                      </td>
                      <td style={td}>
                        <select value={j?.target ?? ''} style={{ width: 'auto' }} disabled={busy || readonly || lk || w.decision !== '조정'} onChange={(e) => void decide(w, '조정', { target: (e.target.value as Line1118) || null })}>
                          <option value="">제안: {w.suggest ?? '-'}</option>
                          {LINES_1118.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </td>
                      <td style={td}><input defaultValue={j?.reason ?? ''} key={j?.reason ?? ''} disabled={busy || readonly || lk || w.decision === '미판단'} placeholder="판단 근거" style={{ width: 220 }}
                        onBlur={(e) => { if (j && e.target.value !== j.reason) void decide(w, j.decision, { reason: e.target.value }); }} /></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </>}
        </div>

        <div className="card">
          {stepHead(5, '결과 확인', true, '수익 + / 비용 −')}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(520px, 1fr))', gap: 16 }}>
            {per && ([['K-IFRS 1118 손익계산서', PL1118_ORDER, 'pl1118'], ['1001 (현행)', PL1001_ORDER, 'pl1001']] as const).map(([t, order, k]) => (
              <table key={t} style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr><th style={th}>{t}</th>
                  <th style={{ ...th, textAlign: 'right' }}>당월({month}월)</th>
                  <th style={{ ...th, textAlign: 'right' }}>당분기({per.prevQuarterNo + 1}~{month}월)</th>
                  <th style={{ ...th, textAlign: 'right' }}>누적(1~{month}월)</th></tr></thead>
                <tbody>{order.map((o) => (
                  <tr key={o.key} style={{ background: o.sub ? '#ECFDF5' : undefined, fontWeight: o.sub ? 700 : undefined }}>
                    <td style={td}>{o.label}</td>
                    <td style={num}>{won(per.month[k][o.key] ?? 0)}</td><td style={num}>{won(per.quarter[k][o.key] ?? 0)}</td><td style={num}>{won(per.cum[k][o.key] ?? 0)}</td>
                  </tr>
                ))}</tbody>
              </table>
            ))}
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr><th style={th}>영업손익 브릿지</th><th style={{ ...th, textAlign: 'right' }}>금액</th></tr></thead>
              <tbody>{res.bridge.map((b, i) => (
                <tr key={b.label} style={{ fontWeight: i === 0 || i === res.bridge.length - 1 ? 700 : undefined }}>
                  <td style={td}>{b.label}{b.note && <div style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-0)' }}>{b.note}</div>}</td><td style={num}>{won(b.amount)}</td>
                </tr>
              ))}</tbody>
            </table>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr><th style={th}>주석 금액(#6~#8)</th><th style={th}>세부항목</th><th style={{ ...th, textAlign: 'right' }}>금액</th></tr></thead>
              <tbody>{res.notes.map((n) => (
                <tr key={`${n.line}|${n.detail}`}><td style={td}>{n.line}</td><td style={td}>{n.detail}</td><td style={num}>{won(n.amount)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>

        <div className="card">
          {stepHead(6, '마감 체크 · 마감 · 엑셀 내려받기', !!closedRow)}
          <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 820 }}>
            <tbody>
              <tr><td style={td}>{periodOk ? '✔' : '✘'}</td><td style={td}>분개장 마지막 전기일이 기준월과 같음</td><td style={{ ...td, color: 'var(--ink-3)' }}>{periodOk ? '' : '기준월 · 파일 확인'}</td></tr>
              {res.checks.map((c) => (
                <tr key={c.id}><td style={{ ...td, color: c.ok ? '#16A34A' : 'var(--bad)', fontWeight: 700 }}>{c.ok ? '✔' : '✘'}</td><td style={td}>{c.label}</td><td style={{ ...td, color: 'var(--ink-3)' }}>{c.ok ? '' : c.fix}</td></tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            {closedRow
              ? <><span style={{ fontWeight: 700, color: '#16A34A' }}>🔒 {month}월 마감됨 · {new Date(closedRow.at).toLocaleString('ko-KR')} · {closedRow.byName}</span>
                  <button className="btn-sm" disabled={busy || readonly} onClick={() => void reopenMonth()}>마감 해제</button></>
              : <button className="btn-sm btn-sm-navy" disabled={busy || readonly || !allOk} title={allOk ? '' : '위 확인이 모두 ✔ 여야 마감할 수 있습니다'} onClick={() => void closeMonth()}>{month}월 마감하기</button>}
            <button className="btn-sm" onClick={() => void download()}>엑셀 내려받기(수식 검증 파일)</button>
            <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>엑셀만으로 다시 계산 · 검증되는 파일입니다(00_읽는법 → 01_검증체크 → 보고 · 권고 · 검토 · 근거 시트). 조정이 있으면 20_조정권고전표에 장부 기표용 전표가 나옵니다.{!allOk && ' 확인이 남아 있어도 내려받을 수 있습니다(진행 중 표시). 마감은 모두 ✔ 일 때만 됩니다.'}</span>
          </div>
        </div>
        {(() => {
          const c2 = close2Checks(res, closedRow?.summary ?? null);
          const due = needsClose2(cfg, year, month);
          const c2ok = c2.every((c) => c.ok);
          return (
            <div className="card">
              {stepHead(7, '조정전표 반영 검증 · 2차 마감', !!closedRow?.close2,
                cfg.adjustFrom ? (due ? `${cfg.adjustFrom.replace('-', '년 ')}월 결산부터 매월 — 1차 마감 → 조정 권고 전표 기표 → 분개장 다시 올리기 → 2차 마감` : `이 달은 대상 아님 — 회사가 조정전표를 기표하기 시작하는 ${cfg.adjustFrom.replace('-', '년 ')}월 결산부터`) : '조정전표를 기표한 달에만')}
              <div style={{ fontSize: 'var(--fs-1)', lineHeight: 1.7, marginBottom: 6 }}>
                ① STEP 6 에서 1차 마감하고 엑셀을 내려받습니다 → ② 엑셀 <b>20_조정권고전표</b>대로 SAP 에 기표합니다(<b>라인텍스트 맨 앞에 권고코드</b>) →
                ③ 같은 기준월 분개장을 다시 받아 아래에서 올립니다 → ④ 확인이 모두 ✔ 이면 2차 마감.
              </div>
              <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 6 }}>
                <thead><tr>{['권고코드', '구분', '원천 → 대상', '대상 G/L 제안', '옮길 금액(누적)', '이미 기표', '남은 권고액'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>{res.moves.map((m) => (
                  <tr key={m.code} style={{ background: m.amount !== 0 && due ? '#FEF2F2' : undefined }}>
                    <td style={td}><code>{m.code}</code></td><td style={td}>{m.kind}</td><td style={td}>{m.srcGl} {m.src} → {m.target}</td><td style={td}>{m.reclassGl || '지정 필요'}</td>
                    <td style={num}>{won(m.required)}</td><td style={num}>{won(m.posted)}</td><td style={{ ...num, fontWeight: 700 }}>{won(m.amount)}</td>
                  </tr>
                ))}{!res.moves.length && <tr><td style={td} colSpan={7}>조정 없음</td></tr>}</tbody>
              </table>
              <label className="btn-sm" style={{ cursor: 'pointer' }}>{reading ? '읽는 중…' : '조정전표 기표 후 분개장 다시 올리기'}<input type="file" accept=".xlsx,.xls" hidden disabled={reading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onJournal(f); }} /></label>
              <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 980, marginTop: 6 }}>
                <tbody>{c2.map((c) => (
                  <tr key={c.id}><td style={{ ...td, color: c.ok ? '#16A34A' : 'var(--bad)', fontWeight: 700 }}>{c.ok ? '✔' : '✘'}</td><td style={td}>{c.label}</td><td style={{ ...td, color: 'var(--ink-3)' }}>{c.ok ? '' : c.detail}</td></tr>
                ))}</tbody>
              </table>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                {closedRow?.close2
                  ? <><span style={{ fontWeight: 700, color: '#16A34A' }}>🔒 2차 마감됨 · {new Date(closedRow.close2.at).toLocaleString('ko-KR')} · {closedRow.close2.byName}</span>
                      <button className="btn-sm" disabled={busy || readonly} onClick={() => void close2Month(true)}>2차 마감 해제</button></>
                  : <button className="btn-sm btn-sm-navy" disabled={busy || readonly || !due || !c2ok} title={!due ? '조정전표 기표 시작월 전입니다' : c2ok ? '' : '확인이 모두 ✔ 여야 합니다'} onClick={() => void close2Month(false)}>{month}월 2차 마감하기</button>}
              </div>
            </div>
          );
        })()}
      </>}
    </>}
  </>);
}
