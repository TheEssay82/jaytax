// 감사업무관리 › 🔍 Journal Entry 시스템(JET) — 1차(사용자 2026-10-21).
//
// ① 기본정보 · 자료(분개장 · 잔액표 올리기, 판이 쌓여 재요청 경과가 남는다) → ② 검토(필수 A01~A04 + 선택 B01~, 켜고 끄기 · 기준값 · 결론)
// → ③ 보완할 점(회사에 다시 요청할 것 · 미수행 사유 · 완화절차 · 질문서) → 조서 엑셀(audit tool 업로드용).
// 2차: ④ 샘플링 증빙요청 · ⑤ 결과 입력(je_pick 칸은 이미 있다 — 1차는 B01 줄마다 REF · 결과 · 비고만).
// 분개장 줄은 DB(감사팀만 읽음). 검사는 브라우저에서 돈다(6만 줄도 0.2초).
import { useEffect, useMemo, useState } from 'react';
import Empty from '../common/Empty';
import MoneyInput from '../common/MoneyInput';
import { useAuth } from '../../context/AuthContext';
import { listEngagements, type Engagement } from '../../lib/dsdApi';
import { takePickedEngagement } from '../gwp/WtbTab';
import { parentCode, type JeLine } from '../../lib/jeParse';
import {
  NEEDS_USER_DATA, runAll, guessSide, balancesFromTb, salesTotal, benchThreshold, isBsCode,
  type BsBalance, type CheckResult, type ScenarioCode,
} from '../../lib/jeChecks';
import {
  ensureJob, saveJob, listUploads, uploadJournal, uploadBalances, saveBalances, loadLines, loadTb, listPicks, savePick, savePicks, jobSummaries, priorAccounts, priorBalanceMeta, applyPriorMeta, balancesFromWtb, materialityFromGwp,
  type JeJob, type JeUpload, type JePick,
} from '../../lib/jeApi';
import { exportJeWorkbook, exportListWorkbook, exportRequestWorkbook, memoOf, performed } from '../../lib/jeExport';
import { ALWAYS_ASK, buildCandidates, docsFor, parseReply, pickSummary, plainReason, recommendPicks, VOUCHER_SCENARIOS } from '../../lib/jeSample';
import { exportBalanceTemplate } from '../../lib/jeTemplate';

const won = (n: number) => Math.round(n).toLocaleString();
/** YYYY-MM-DD 가 든 달의 말일. */
const monthEnd = (d: string) => { const [y, m] = d.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
type Step = 'data' | 'check' | 'gap' | 'sample';
const STEP_KEY = 'jaytax:jeStep';

export default function JeTab() {
  const { readonly, sandbox, role } = useAuth();
  const canWrite = !readonly && (role === 'superuser' || role === 'accountant' || role === 'per_head_accountant');
  const [engs, setEngs] = useState<Engagement[]>([]);
  const [sum, setSum] = useState<Map<string, { journal: boolean; tb: boolean }>>(new Map());
  const [fyAt, setFyAt] = useState<number | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [list, s] = await Promise.all([listEngagements(), jobSummaries()]);
        const real = list.filter((e) => !e.isDemo || sandbox);
        setEngs(real); setSum(s);
        const want = takePickedEngagement();
        if (want && real.some((e) => e.id === want)) { setPickedId(want); setListOpen(false); }
      } catch (e) { setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'); } finally { setLoading(false); }
    })();
  }, []);

  const years = useMemo(() => [...new Set(engs.map((e) => e.fy))].sort((a, b) => b - a), [engs]);
  const fy = fyAt ?? years[0];
  const inYear = useMemo(() => engs.filter((e) => e.fy === fy).sort((a, b) => a.entityName.localeCompare(b.entityName, 'ko')), [engs, fy]);
  const picked = engs.find((e) => e.id === pickedId) ?? null;
  if (loading) return <div className="card">불러오는 중…</div>;
  const shown = picked && !listOpen ? inYear.filter((e) => e.id === picked.id) : inYear;

  return (
    <div>
      <div className="card">
        <div className="chdr">🔍 Journal Entry 시스템
          <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>{picked ? `${picked.entityName} · FY${picked.fy} ${picked.scope}` : '회사를 고르세요'}</span>
        </div>
        <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7 }}>
          회사 분개장(더존 · 영림원)을 올리면 <b>필수 검증</b>(유효성 · 필수필드 · 차대 · <b>기초잔액 대사</b>)과 <b>중요성 기준 이상 손익 분개</b> 등 시나리오를 돌리고,
          회사에 다시 요청할 것을 정리해 <b>조서 엑셀</b>(표지 · 총괄 · 시나리오별 시트)로 내려받습니다. 근거: 인덕 JE Test 가이드라인 · 감사기준 240 문단 32.
        </div>
      </div>
      {err && <div className="card" style={{ color: 'var(--bad)', background: 'var(--bad-bg)' }}>{err}</div>}
      <div className="card" style={{ padding: '10px 12px 12px' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 9 }}>
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>사업연도</span>
          {years.map((y) => (
            <button key={y} onClick={() => { setFyAt(y); setListOpen(true); }} style={{ cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--fs-1)', border: `1px solid ${y === fy ? 'var(--navy)' : 'var(--rule)'}`, background: y === fy ? 'var(--navy)' : '#fff', color: y === fy ? '#fff' : 'var(--ink-2)', fontWeight: y === fy ? 700 : 400, borderRadius: 999, padding: '3px 11px' }}>
              FY{y}<span style={{ opacity: 0.7, marginLeft: 6, fontWeight: 400 }}>· {engs.filter((e) => e.fy === y).length}건</span>
            </button>
          ))}
          {picked && <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setListOpen(!listOpen)}>{listOpen ? '목록 접기 ▲' : `다른 회사 고르기 ▼ (${inYear.length - 1})`}</button>}
        </div>
        {inYear.length === 0 ? <Empty text="작업 건이 없습니다" hint="일반조서 관리 또는 주석·DSD 관리의 「새 건 만들기」로 만듭니다." /> : (
          <div style={{ border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
            {shown.map((e, i) => {
              const s = sum.get(e.id), on = e.id === pickedId;
              return (
                <button key={e.id} onClick={() => { setPickedId(e.id); setListOpen(false); }} style={{ display: 'grid', gridTemplateColumns: '6px minmax(0, 1fr) auto auto', gap: 10, alignItems: 'center', width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', border: 0, borderTop: i ? '1px solid var(--rule)' : 0, background: on ? 'var(--navy-bg)' : '#fff', padding: '7px 10px 7px 0' }}>
                  <span style={{ alignSelf: 'stretch', background: s?.journal && s?.tb ? '#12A38A' : s?.journal ? '#D97706' : '#D1D5DB' }} />
                  <span style={{ minWidth: 0 }}><span style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--navy)' }}>{e.entityName}</span><span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginLeft: 8 }}>{e.scope}</span></span>
                  <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>{s?.journal ? `분개장 ✓${s.tb ? ' · 잔액표 ✓' : ''}` : '자료 없음'}</span>
                  <span style={{ color: 'var(--ink-4)', fontSize: 'var(--fs-1)' }}>{on ? '●' : '›'}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {picked ? <Workspace key={picked.id} eng={picked} canWrite={canWrite && (!sandbox || picked.isDemo)} onChanged={() => void jobSummaries().then(setSum)} /> : <div className="card"><Empty text="위에서 회사를 고르세요." /></div>}
    </div>
  );
}

// ── 한 회사의 JET ───────────────────────────────────────────────────────────

function Workspace({ eng, canWrite, onChanged }: { eng: Engagement; canWrite: boolean; onChanged: () => void }) {
  const { profileName } = useAuth();
  const from = eng.periodFrom ?? `${eng.fy}-01-01`, yearEnd = eng.periodTo ?? `${eng.fy}-12-31`;
  const [job, setJob] = useState<JeJob | null>(null);
  const [uploads, setUploads] = useState<JeUpload[]>([]);
  const [lines, setLines] = useState<JeLine[]>([]);
  const [ledgerTb, setLedgerTb] = useState<Awaited<ReturnType<typeof loadTb>>>([]);
  const [bal, setBal] = useState<BsBalance[] | null>(null);
  const [picks, setPicks] = useState<JePick[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [prior, setPrior] = useState<Map<string, string> | null>(null);
  const [step, setStepState] = useState<Step>(() => { try { const v = localStorage.getItem(STEP_KEY); if (v === 'data' || v === 'check' || v === 'gap' || v === 'sample') return v; } catch { /* 저장소 없음 */ } return 'data'; });
  const setStep = (s: Step) => { setStepState(s); try { localStorage.setItem(STEP_KEY, s); } catch { /* 저장소 없음 */ } };
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 8000); };

  async function reload() {
    setErr(null);
    try {
      const { job: j, inherited } = await ensureJob(eng, profileName);
      if (inherited) flash(`FY${eng.fy - 1} JET 설정(시나리오 · 기준값 · BENCHMARK 이름 · 적용률 · 사유 · 담당자)을 이어받았습니다 — BENCHMARK 금액은 새로 넣어 주세요.`);
      const ups = await listUploads(eng.id);
      setJob(j); setUploads(ups); setPicks(await listPicks(eng.id));
      setPrior(await priorAccounts(eng.entityId, eng.fy, eng.scope).catch(() => null));
      const jr = ups.find((u) => u.kind === 'journal' && u.current), tb = ups.find((u) => u.kind === 'tb' && u.current);
      if (jr) {
        setBusy('분개장을 불러오는 중…');
        const [ls, lt] = await Promise.all([loadLines(jr.id, (n) => setBusy(`분개장을 불러오는 중… ${n.toLocaleString()}줄`)), loadTb(jr.id)]);
        setLines(ls); setLedgerTb(lt);
      } else { setLines([]); setLedgerTb([]); }
      if (tb) { const t = await loadTb(tb.id); setBal(t.map((r) => ({ acctCode: r.acctCode, acctName: r.acctName, open: r.open, close: r.close, group: r.group, side: r.side }))); }
      else setBal(null);
    } catch (e) { setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'); } finally { setBusy(null); }
  }
  useEffect(() => { void reload(); }, [eng.id]);

  // 기준일 — 분개장 마지막 날짜가 든 달의 말일. 결산일보다 앞이면 중간감사(사용자 2026-10-21 제이스튜디오 FY2026 중간).
  const journalTo = uploads.find((u) => u.kind === 'journal' && u.current)?.dateTo ?? null;
  const asOf = journalTo ? monthEnd(journalTo) : yearEnd;
  const to = asOf < yearEnd ? asOf : yearEnd;
  const interim = to < yearEnd;
  // 본 계정 코드(하위 계정 → 본 계정 짝짓기용) — 잔액표 + 원장 시산표.
  const codes = useMemo(() => new Set([...(bal ?? []), ...ledgerTb].map((r) => r.acctCode).filter(Boolean)), [bal, ledgerTb]);
  // 계정과목표(B02)는 손익 계정까지 있는 시산표(영림원 원장)에서만 — 잔액표 · 정산표는 재무상태표 계정뿐이라 손익 전표가 모두 걸린다(제이 FY26 1,269장).
  const coa = useMemo(() => (ledgerTb.length ? new Set(ledgerTb.map((r) => r.acctCode)) : null), [ledgerTb]);
  const codeOf = useMemo(() => (c: string) => parentCode(c, codes), [codes]);
  const balances = useMemo<BsBalance[] | null>(() => (bal?.length ? bal : ledgerTb.length ? balancesFromTb(ledgerTb) : null), [bal, ledgerTb]);
  const results = useMemo<CheckResult[]>(() => (job && lines.length ? runAll({ lines, balances, coa, from, to, bench: job.bench, params: job.params, codeOf, priorAccounts: prior }) : []), [job, lines, balances, coa, codeOf, from, to, prior]);

  async function patchJob(p: Partial<JeJob>) {
    if (!job) return;
    const next = { ...job, ...p };
    setJob(next);
    try { await saveJob(next, profileName); } catch (e) { setErr(e instanceof Error ? e.message : '저장하지 못했습니다.'); }
  }
  async function onJournal(f: File) {
    const note = uploads.some((u) => u.kind === 'journal') ? window.prompt('다시 받은 분개장입니다. 재요청 사유를 적어 주세요(조서 1_데이터유효성에 남습니다).', '1차 자료 보완 요청') : null;
    setBusy('분개장을 읽는 중…'); setErr(null);
    try {
      const r = await uploadJournal(eng.id, f, note, profileName, (m) => setBusy(m));
      flash(`${r.erp} 분개장 ${r.upload.lines.toLocaleString()}줄 · 전표 ${r.upload.vouchers.toLocaleString()}장(${r.upload.dateFrom} ~ ${r.upload.dateTo})을 ${r.upload.version}차로 저장했습니다${r.upload.masked ? ` — 주민번호 꼴 ${r.upload.masked}칸을 지웠습니다` : ''}.`);
      onChanged(); await reload();
    } catch (e) { setErr(e instanceof Error ? e.message : '읽지 못했습니다.'); setBusy(null); }
  }
  async function onBalances(f: File) {
    setBusy('잔액표를 읽는 중…'); setErr(null);
    try {
      const meta = await priorBalanceMeta(eng);
      const n = await uploadBalances(eng.id, f, null, profileName, (rows) => applyPriorMeta(rows, meta).rows);
      flash(`잔액표 ${n}줄을 저장했습니다.`); onChanged(); await reload();
    } catch (e) { setErr(e instanceof Error ? e.message : '읽지 못했습니다.'); setBusy(null); }
  }
  async function onFromWtb() {
    setBusy('📒 정산표에서 읽는 중…'); setErr(null);
    try {
      const accts = [...new Map(lines.map((l) => [l.acctCode, l.acctName])).entries()].map(([code, name]) => ({ code, name }));
      const { rows, file } = await balancesFromWtb(eng.id, interim ? [to] : [yearEnd], accts);
      const { rows: withMeta, applied } = applyPriorMeta(rows, await priorBalanceMeta(eng));
      await saveBalances(eng.id, withMeta, file.fileName, `정산표 WBS(${file.kind})에서`, profileName);
      flash(`「${file.fileName}」 WBS 에서 ${rows.length}줄(분개장 계정과 이어진 것 ${rows.filter((r) => r.acctCode).length}줄)을 잔액표로 저장했습니다${applied ? ` — 전년 묶음 · 방향 ${applied}줄 이어받음` : ''}.`);
      onChanged(); await reload();
    } catch (e) { setErr(e instanceof Error ? e.message : '정산표를 읽지 못했습니다.'); setBusy(null); }
  }
  async function onExport() {
    if (!job) return;
    try {
      const f = ['전표일자', '전표번호', ...(job.erp === '더존' ? ['구분'] : ['결의일자', '결의번호']), '계정코드', '계정과목', '차변', '대변', ...(job.erp === '영림원' ? ['거래처코드'] : []), '거래처', '적요'];
      await exportJeWorkbook({ companyName: eng.entityName, fy: eng.fy, periodFrom: from, periodTo: to, yearEnd, job, results, uploads, picks, fields: f });
    } catch (e) { setErr(e instanceof Error ? e.message : '내려받지 못했습니다.'); }
  }

  if (!job) return <div className="card">{busy ?? '불러오는 중…'}{err && <div style={{ color: 'var(--bad)' }}>{err}</div>}</div>;
  const journal = uploads.find((u) => u.kind === 'journal' && u.current);
  const chip = (on: boolean) => ({ cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--fs-2)', fontWeight: on ? 700 : 500, padding: '7px 16px', border: '1px solid var(--rule)', borderBottom: 'none', borderRadius: '6px 6px 0 0', background: on ? 'var(--navy)' : '#fff', color: on ? '#fff' : 'var(--ink-2)' } as const);
  // 탭 머리: 필수 검증 불일치 수(빨강이어야 할 것)만 — 선택 시나리오의 「추출」은 오류가 아니다.
  const exc = results.filter((r) => r.kind === 'Mandatory' && r.status === '예외').length;

  return (
    <div>
      {err && <div className="alert-w">{err}</div>}
      {msg && <div className="card" style={{ color: 'var(--good)', padding: '8px 14px' }}>{msg}</div>}
      {busy && <div className="card" style={{ padding: '8px 14px', color: 'var(--ink-2)' }}>⏳ {busy}</div>}
      {interim && <div className="card" style={{ padding: '8px 14px', background: '#EEF4FF', color: 'var(--navy)', fontSize: 'var(--fs-2)' }}>🕒 <b>중간감사</b> — 분개장이 {journalTo}까지라 기준일 <b>{to}</b>로 봅니다. 기초잔액 대사는 {to} 기준 정산표(중간 이월) · 잔액표와, 결산분개(B09)는 {to} 월말 전표로 합니다.</div>}
      <div style={{ display: 'flex', gap: 2, borderBottom: '2px solid var(--navy)', margin: '0 0 10px', alignItems: 'flex-end' }}>
        {([['data', '① 기본정보 · 자료'], ['check', `② 검토${results.length ? (exc ? ` (불일치 ${exc})` : ' ✓') : ''}`], ['gap', '③ 보완할 점'], ['sample', `④ 선정 · 증빙요청 · 결과${picks.some((p) => p.selected) ? ` (${pickSummary(picks).total})` : ''}`]] as [Step, string][]).map(([k, l]) => (
          <button key={k} style={chip(step === k)} onClick={() => setStep(k)}>{l}</button>
        ))}
        <button className="btn-sm btn-sm-navy" style={{ marginLeft: 'auto', marginBottom: 4 }} disabled={!results.length} onClick={() => void onExport()} title="표지 · 총괄 · 시나리오별 시트 — audit tool 업로드용">📥 조서 엑셀</button>
      </div>

      {step === 'data' && <DataStep eng={eng} job={job} uploads={uploads} journal={journal ?? null} lines={lines} balances={balances} fromLedger={!bal?.length && !!ledgerTb.length}
        canWrite={canWrite} busy={!!busy} onJournal={onJournal} onBalances={onBalances} patchJob={patchJob}
        onSaveBal={async (rows) => { setBusy('잔액표 저장 중…'); try { await saveBalances(eng.id, rows, '화면에서 고침', '묶음 · 방향 수정', profileName); flash('잔액표를 새 판으로 저장했습니다.'); await reload(); } catch (e) { setErr(e instanceof Error ? e.message : '저장하지 못했습니다.'); setBusy(null); } }}
        onTemplate={() => void exportBalanceTemplate(eng.entityName, eng.fy, lines, balances)} onFromWtb={() => void onFromWtb()} />}
      {step === 'check' && (lines.length ? <CheckStep job={job} results={results} lines={lines} picks={picks} canWrite={canWrite} patchJob={patchJob}
        onPick={async (p) => { setPicks((ps) => [...ps.filter((x) => !(x.vdate === p.vdate && x.vno === p.vno)), p]); try { await savePick(eng.id, p, profileName); } catch (e) { setErr(e instanceof Error ? e.message : '저장하지 못했습니다.'); } }} /> : <div className="card"><Empty text="분개장을 먼저 올려 주세요" hint="① 기본정보 · 자료에서 올립니다." /></div>)}
      {step === 'sample' && (lines.length ? <SampleStep eng={eng} job={job} results={results} lines={lines} picks={picks} canWrite={canWrite}
        onSave={async (ps) => { setPicks((cur) => { const m = new Map(cur.map((p) => [`${p.vdate}|${p.vno}`, p])); for (const p of ps) m.set(`${p.vdate}|${p.vno}`, p); return [...m.values()]; }); try { await savePicks(eng.id, ps, profileName); } catch (e) { setErr(e instanceof Error ? e.message : '저장하지 못했습니다.'); } }}
        flash={flash} setErr={setErr} /> : <div className="card"><Empty text="분개장을 먼저 올려 주세요" /></div>)}
      {step === 'gap' && <GapStep eng={eng} job={job} results={results} hasBal={!!balances?.length} hasJournal={!!journal} canWrite={canWrite} patchJob={patchJob} />}
    </div>
  );
}

// ── ① 기본정보 · 자료 ──────────────────────────────────────────────────────

function Drop({ label, hint, onFile, disabled }: { label: string; hint: string; onFile: (f: File) => void; disabled?: boolean }) {
  return (
    <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f && !disabled) onFile(f); }}
      style={{ display: 'block', border: '2px dashed #c9b98a', borderRadius: 8, background: '#fdfaf3', padding: '10px 14px', textAlign: 'center', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
      <b style={{ color: 'var(--navy)' }}>{label}</b>
      <div style={{ fontSize: 'var(--fs-1)', color: '#777', marginTop: 2 }}>{hint}</div>
      <input type="file" accept=".xls,.xlsx" style={{ display: 'none' }} disabled={disabled} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
    </label>
  );
}

const inp = { fontFamily: 'inherit', fontSize: 'var(--fs-1)', padding: '3px 6px', border: '1px solid var(--rule)', borderRadius: 4 } as const;
const th = { padding: '5px 8px', textAlign: 'left' as const, whiteSpace: 'nowrap' as const, fontWeight: 600, background: 'var(--surface-3)', borderBottom: '1px solid var(--rule)', position: 'sticky' as const, top: 0 };
const td = { padding: '4px 8px', borderTop: '1px solid var(--rule)', verticalAlign: 'middle' as const };
const tdr = { ...td, textAlign: 'right' as const, whiteSpace: 'nowrap' as const };

function DataStep({ job, uploads, journal, lines, balances, fromLedger, canWrite, busy, onJournal, onBalances, patchJob, onSaveBal, onTemplate, onFromWtb }: {
  eng: Engagement; job: JeJob; uploads: JeUpload[]; journal: JeUpload | null; lines: JeLine[]; balances: BsBalance[] | null; fromLedger: boolean;
  canWrite: boolean; busy: boolean; onJournal: (f: File) => void; onBalances: (f: File) => void; patchJob: (p: Partial<JeJob>) => Promise<void>;
  onSaveBal: (rows: BsBalance[]) => Promise<void>; onTemplate: () => void; onFromWtb: () => void;
}) {
  const [edit, setEdit] = useState<BsBalance[] | null>(null);
  const rows = edit ?? balances ?? [];
  return (<>
    <div className="card">
      <b style={{ color: 'var(--navy)' }}>기본정보</b>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10, marginTop: 8, fontSize: 'var(--fs-1)' }}>
        <label>ERP <select value={job.erp} disabled={!canWrite} onChange={(e) => void patchJob({ erp: e.target.value as JeJob['erp'] })} style={inp}><option>더존</option><option>영림원</option></select> <span style={{ color: 'var(--ink-4)' }}>분개장을 올리면 자동</span></label>
        <label><input type="checkbox" checked={job.listed} disabled={!canWrite} onChange={(e) => void patchJob({ listed: e.target.checked })} /> 상장회사</label>
        <label>작성자 <input defaultValue={job.preparer ?? ''} disabled={!canWrite} onBlur={(e) => void patchJob({ preparer: e.target.value || null })} style={{ ...inp, width: 90 }} /> <input type="date" defaultValue={job.preparedOn ?? ''} disabled={!canWrite} onBlur={(e) => void patchJob({ preparedOn: e.target.value || null })} style={inp} /></label>
        <label>검토자 <input defaultValue={job.reviewer ?? ''} disabled={!canWrite} onBlur={(e) => void patchJob({ reviewer: e.target.value || null })} style={{ ...inp, width: 90 }} /> <input type="date" defaultValue={job.reviewedOn ?? ''} disabled={!canWrite} onBlur={(e) => void patchJob({ reviewedOn: e.target.value || null })} style={inp} /></label>
      </div>
      <div style={{ marginTop: 10, fontSize: 'var(--fs-1)' }}>
        <b>회사 담당자</b> <span style={{ color: 'var(--ink-4)' }}>(총괄 시트)</span>
        {(job.contacts.length ? job.contacts : [{ name: '', dept: '', phone: '', email: '' }]).map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            {(['name', 'dept', 'phone', 'email'] as const).map((k) => (
              <input key={k} placeholder={{ name: '성명', dept: '부서&직급', phone: '전화번호', email: '메일주소' }[k]} defaultValue={c[k]} disabled={!canWrite} style={{ ...inp, width: k === 'email' ? 200 : 120 }}
                onBlur={(e) => { const list = [...(job.contacts.length ? job.contacts : [c])]; list[i] = { ...list[i], [k]: e.target.value }; void patchJob({ contacts: list }); }} />
            ))}
          </div>
        ))}
      </div>
    </div>

    <div className="card">
      <b style={{ color: 'var(--navy)' }}>분개장</b> <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>더존(전표일자 · 전표번호 · 구분 · 계정 · 차변 · 대변 · 거래처 · 적요) · 영림원(구 분[기표] 두 줄 머리, 같은 파일의 계정별원장으로 잔액표도 만듦)</span>
      {journal && <div style={{ fontSize: 'var(--fs-2)', margin: '6px 0' }}>
        <b>{journal.version}차</b> {journal.fileName} — {journal.erp} · {journal.lines.toLocaleString()}줄 · 전표 {journal.vouchers.toLocaleString()}장 · {journal.dateFrom} ~ {journal.dateTo} · 차변 {won(journal.drTotal)} / 대변 {won(journal.crTotal)}
        {lines.length !== journal.lines && <span style={{ color: 'var(--bad)' }}> (불러온 줄 {lines.length.toLocaleString()})</span>}
      </div>}
      {canWrite && <Drop label={journal ? '다시 받은 분개장을 끌어다 놓기(새 판 — 재요청 경과가 남습니다)' : '분개장 엑셀을 끌어다 놓기'} hint="주민번호 꼴은 올릴 때 지웁니다. 줄은 서버에 저장되고 감사팀만 봅니다." onFile={onJournal} disabled={busy} />}
      {uploads.filter((u) => u.kind === 'journal').length > 1 && (
        <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginTop: 6 }}>지난 판: {uploads.filter((u) => u.kind === 'journal' && !u.current).map((u) => `${u.version}차 ${u.fileName}(${u.lines.toLocaleString()}줄, ${u.createdAt.slice(0, 10)}${u.note ? `, ${u.note}` : ''})`).join(' · ')}</div>
      )}
    </div>

    <div className="card">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ color: 'var(--navy)' }}>회사 제시 잔액표(기초 · 기말)</b>
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>4_기초잔액검토 — 재무상태표 계정. {fromLedger ? '영림원 계정별원장에서 만들었습니다.' : '더존은 「📒 정산표에서 채우기」(기말 정산표가 자료함에 있을 때) 또는 양식에 재무상태표 금액을 붙여 넣어 올립니다.'}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {canWrite && <button className="btn-sm btn-sm-navy" disabled={!lines.length || busy} onClick={onFromWtb} title="이 작업 건 자료함의 기말 정산표(수정전 · 이월 기말 · 확정) WBS 에서 전기말(작년 수정후) · 당기말(회사제시)을 가져옵니다">📒 정산표에서 채우기</button>}
          <button className="btn-sm" disabled={!lines.length} onClick={onTemplate}>잔액표 양식 내려받기</button>
        </span>
      </div>
      {canWrite && <div style={{ marginTop: 6 }}><Drop label="잔액표를 끌어다 놓기" hint="묶음 칸: 원장 계정 하나가 공시과목 여럿이면(감가상각누계액 → 건물 · 기계장치 …) 같은 이름을 적습니다. 차대 칸: 차 / 대." onFile={onBalances} disabled={busy} /></div>}
      {rows.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginBottom: 4 }}>
            {rows.length}줄 · 묶음 · 잔액방향을 고칠 수 있습니다.
            {edit && canWrite && <> <button className="btn-sm btn-sm-navy" onClick={() => void onSaveBal(edit).then(() => setEdit(null))}>새 판으로 저장</button> <button className="btn-sm" onClick={() => setEdit(null)}>취소</button></>}
          </div>
          <div style={{ overflow: 'auto', maxHeight: 360, border: '1px solid var(--rule)', borderRadius: 4 }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 'var(--fs-1)' }}>
              <thead><tr>{['묶음', '계정코드', '계정명', '차대', '전기말(기초)', '당기말(기말)'].map((h) => <th key={h} style={{ ...th, textAlign: /기/.test(h) ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={i}>
                  <td style={td}><input value={r.group ?? ''} disabled={!canWrite} onChange={(e) => { const n = [...rows]; n[i] = { ...r, group: e.target.value || null }; setEdit(n); }} style={{ ...inp, width: 90 }} /></td>
                  <td style={td}>{r.acctCode}</td><td style={td}>{r.acctName}</td>
                  <td style={td}><select value={r.side ?? guessSide(r.acctCode, r.acctName)} disabled={!canWrite} onChange={(e) => { const n = [...rows]; n[i] = { ...r, side: Number(e.target.value) as 1 | -1 }; setEdit(n); }} style={inp}><option value={1}>차</option><option value={-1}>대</option></select></td>
                  <td style={tdr}>{won(r.open)}</td><td style={tdr}>{won(r.close)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  </>);
}

// ── ② 검토 ────────────────────────────────────────────────────────────────

function CheckStep({ job, results, lines, picks, canWrite, patchJob, onPick }: {
  job: JeJob; results: CheckResult[]; lines: JeLine[]; picks: JePick[]; canWrite: boolean;
  patchJob: (p: Partial<JeJob>) => Promise<void>; onPick: (p: JePick) => Promise<void>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [showRef, setShowRef] = useState(false);
  const sales = useMemo(() => salesTotal(lines), [lines]);
  const plAccts = useMemo(() => {
    const th = benchThreshold(job.bench);
    const m = new Map<string, { name: string; n: number }>();
    for (const l of lines) if (!isBsCode(l.acctCode) && th > 0 && Math.abs(l.dr - l.cr) >= th && (job.params.matSide === '양쪽' || l.dr > 0)) { const a = m.get(l.acctCode) ?? { name: l.acctName, n: 0 }; a.n++; m.set(l.acctCode, a); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [lines, job.bench, job.params.matSide]);
  const [gwpNote, setGwpNote] = useState<string | null>(null);
  async function onGwp() {
    try {
      const g = await materialityFromGwp(job.engagementId);
      if (!g) { setGwpNote('일반조서 2700A 에 중요성 금액이 아직 없습니다.'); return; }
      await patchJob({ bench: { name: g.benchName, amount: g.amount, rate: g.rate, reason: g.reason } });
      setGwpNote(`${g.code}: 중요성 ${won(g.materiality)}원${g.pm != null ? ` · 수행중요성 ${won(g.pm)}원` : ''}${g.trivial != null ? ` · 명백히 사소한 금액 ${won(g.trivial)}원` : ''} — JET 기준은 실물처럼 적용률을 낮춰(예 1%) 쓸 수 있습니다.`);
    } catch (e) { setGwpNote(e instanceof Error ? e.message : '불러오지 못했습니다.'); }
  }
  const setScen = (code: ScenarioCode, p: Partial<{ on: boolean; reason: string; conclusion: string }>) => void patchJob({ scenarios: { ...job.scenarios, [code]: { ...(job.scenarios[code] ?? { on: false }), ...p } } });
  const pickMap = new Map(picks.map((p) => [`${p.vdate}|${p.vno}`, p]));
  const pr = job.params;

  return (<>
    <div className="card">
      <b style={{ color: 'var(--navy)' }}>중요성(5_일정금액이상)</b>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 6, fontSize: 'var(--fs-1)' }}>
        <label>BENCHMARK <select value={job.bench.name} disabled={!canWrite} onChange={(e) => void patchJob({ bench: { ...job.bench, name: e.target.value } })} style={inp}>{['매출', '세전이익', '총자산', '순자산', '비용'].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>금액 <MoneyInput value={job.bench.amount} disabled={!canWrite} width={150} onCommit={(v) => void patchJob({ bench: { ...job.bench, amount: v ?? 0 } })} /></label>
        {job.bench.name === '매출' && canWrite && <button className="btn-sm" onClick={() => void patchJob({ bench: { ...job.bench, amount: Math.round(sales) } })} title="분개장의 매출 계정 대변 − 차변">분개장 매출 {won(sales)} 넣기</button>}
        {canWrite && <button className="btn-sm" onClick={() => void onGwp()} title="일반조서 2700A(완결 → 수행 → 계획) 의 BENCHMARK · 금액 · 적용률 · 사유">📘 일반조서 중요성 불러오기</button>}
        <label>적용률 <input type="number" step="0.1" defaultValue={Math.round(job.bench.rate * 1000) / 10} key={job.bench.rate} disabled={!canWrite} onBlur={(e) => void patchJob({ bench: { ...job.bench, rate: Number(e.target.value) / 100 } })} style={{ ...inp, width: 60, textAlign: 'right' }} /> %</label>
        <b>= 중요성 기준 {won(benchThreshold(job.bench))}원</b>
        <label title="차변만: 차변 금액이 양수인 줄만 — 대체 분개의 맞은편(대변) 줄과 마이너스 역분개를 뺍니다">분개 <select value={pr.matSide} disabled={!canWrite} onChange={(e) => void patchJob({ params: { ...pr, matSide: e.target.value as '양쪽' | '차변만' } })} style={inp}><option>양쪽</option><option>차변만</option></select></label>
      </div>
      {gwpNote && <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', marginTop: 4 }}>📘 {gwpNote}</div>}
      <input placeholder="BENCHMARK 선택 사유(예: 세전이익 변동성이 커 매출을 지표로 선정)" defaultValue={job.bench.reason} disabled={!canWrite} onBlur={(e) => void patchJob({ bench: { ...job.bench, reason: e.target.value } })} style={{ ...inp, width: '100%', marginTop: 6 }} />
      {plAccts.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 'var(--fs-1)' }}>
          <span style={{ color: 'var(--ink-3)' }}>기준 이상 손익 계정 — 다른 조서에서 검토하는 계정은 빼세요(예: 매출 · 원가대체):</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {plAccts.map(([c, a]) => { const off = pr.matExclude.includes(c); return (
              <button key={c} disabled={!canWrite} onClick={() => void patchJob({ params: { ...pr, matExclude: off ? pr.matExclude.filter((x) => x !== c) : [...pr.matExclude, c] } })}
                style={{ ...inp, cursor: 'pointer', background: off ? '#F3F4F6' : '#EEF4FF', color: off ? 'var(--ink-4)' : 'var(--navy)', textDecoration: off ? 'line-through' : 'none' }}>{c} {a.name} {a.n}</button>
            ); })}
          </div>
        </div>
      )}
      <details style={{ marginTop: 8, fontSize: 'var(--fs-1)' }}>
        <summary style={{ cursor: 'pointer', color: 'var(--ink-2)' }}>그 밖의 기준값</summary>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
          <label>저빈도 <input type="number" defaultValue={pr.rareCount} disabled={!canWrite} onBlur={(e) => void patchJob({ params: { ...pr, rareCount: Number(e.target.value) || 0 } })} style={{ ...inp, width: 60 }} />건 이하</label>
          <label>라운드 단위 <MoneyInput value={pr.roundUnit} disabled={!canWrite} width={110} onCommit={(v) => void patchJob({ params: { ...pr, roundUnit: v || 1_000_000 } })} /></label>
          <label>결산분개 <input type="number" defaultValue={pr.closingDays} disabled={!canWrite} onBlur={(e) => void patchJob({ params: { ...pr, closingDays: Number(e.target.value) || 0 } })} style={{ ...inp, width: 50 }} />일 전부터</label>
        </div>
        <label style={{ display: 'block', marginTop: 6 }}>적요 낱말 <input defaultValue={pr.memoWords} disabled={!canWrite} onBlur={(e) => void patchJob({ params: { ...pr, memoWords: e.target.value } })} style={{ ...inp, width: '70%' }} /></label>
        <label style={{ display: 'block', marginTop: 6 }}>매출 정상 상대계정 <input defaultValue={pr.salesPartnerRe} disabled={!canWrite} onBlur={(e) => void patchJob({ params: { ...pr, salesPartnerRe: e.target.value } })} style={{ ...inp, width: '70%' }} /></label>
      </details>
    </div>

    {SECTIONS.map((sec) => {
      const list = results.filter((r) => sec.codes.includes(r.code));
      if (!list.length) return null;
      const folded = sec.key === 'ref' && !showRef;
      const onCount = list.filter((r) => job.scenarios[r.code as ScenarioCode]?.on).length;
      return (
        <div key={sec.key} style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '12px 2px 6px' }}>
            <b style={{ color: 'var(--navy)', fontSize: 'var(--fs-3)' }}>{sec.title}</b>
            <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>{sec.hint}</span>
            {sec.key === 'ref' && <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setShowRef(!showRef)}>{showRef ? '접기 ▲' : `펼치기 ▼ (${list.length}개 · 켠 것 ${onCount})`}</button>}
          </div>
          {!folded && list.map((r) => {
            const st = job.scenarios[r.code as ScenarioCode];
            const on = !!st?.on, isOpen = open === r.code;
            const userless = NEEDS_USER_DATA.includes(r.code as ScenarioCode);
            const chipTxt = chipLabel(r), cs = CHIP_STYLE[chipTxt.kind];
            return (
              <div key={r.code} className="card" style={{ padding: '8px 12px', opacity: on || r.kind === 'Mandatory' ? 1 : 0.7, marginBottom: 6 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label title={r.kind === 'Mandatory' ? '필수' : '수행 여부 — 끄면 조서 총괄에 X 와 미수행 사유'}><input type="checkbox" checked={on} disabled={!canWrite || userless} onChange={(e) => setScen(r.code as ScenarioCode, { on: e.target.checked })} /></label>
                  <b style={{ color: 'var(--navy)', minWidth: 40 }}>{r.code}</b>
                  <span style={{ fontWeight: 600 }}>{r.no}. {r.title}</span>
                  <span style={{ background: cs.bg, color: cs.fg, borderRadius: 999, padding: '1px 9px', fontSize: 'var(--fs-1)', fontWeight: 700 }}>{chipTxt.text}</span>
                  <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', flex: 1, minWidth: 200 }}>{r.summary}</span>
                  {(r.rows.length > 0 || r.code === 'A04') && <button className="btn-sm" onClick={() => setOpen(isOpen ? null : r.code)}>{isOpen ? '접기' : `펼치기 (${r.rows.length.toLocaleString()})`}</button>}
                </div>
                {on && <div style={{ fontSize: 'var(--fs-1)', color: '#7C5A00', marginTop: 4 }}>👉 {todoOf(r)}</div>}
                {!on && <input placeholder="미수행 사유(조서 총괄 각주)" defaultValue={st?.reason ?? ''} disabled={!canWrite} onBlur={(e) => setScen(r.code as ScenarioCode, { reason: e.target.value })} style={{ ...inp, width: '100%', marginTop: 6 }} />}
                {isOpen && (
                  <div style={{ marginTop: 8 }}>
                    <textarea placeholder={`결론(비우면 기본 문장): ${r.summary}`} defaultValue={st?.conclusion ?? ''} disabled={!canWrite} onBlur={(e) => setScen(r.code as ScenarioCode, { conclusion: e.target.value })} rows={2} style={{ ...inp, width: '100%', resize: 'vertical' }} />
                    {r.code === 'A04' ? <OpeningView r={r} /> : (
                      <div style={{ overflow: 'auto', maxHeight: 460, border: '1px solid var(--rule)', borderRadius: 4, marginTop: 6 }}>
                        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 'var(--fs-1)' }}>
                          <thead><tr>{r.head.map((h) => <th key={h} style={th}>{h}</th>)}{r.code === 'B01' && ['검토(REF 조서)', '결과', '비고'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                          <tbody>{r.rows.slice(0, 1500).map((row, i) => {
                            const p = r.code === 'B01' ? pickMap.get(`${row[0]}|${row[1]}`) : undefined;
                            return (
                              <tr key={i}>
                                {row.map((v, ci) => <td key={ci} style={typeof v === 'number' ? tdr : { ...td, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={typeof v === 'string' ? v : undefined}>{typeof v === 'number' ? won(v) : v}</td>)}
                                {r.code === 'B01' && (() => {
                                  const base: JePick = p ?? { vdate: String(row[0]), vno: String(row[1]), scenarios: ['B01'], amount: Number(row[5]) || 0, reason: '중요성 기준 이상 손익 분개', selected: false, evidence: null, answer: null, result: null, note: null };
                                  return (<>
                                    <td style={td}><input defaultValue={base.evidence ?? ''} disabled={!canWrite} onBlur={(e) => { if ((e.target.value || null) !== base.evidence) void onPick({ ...base, evidence: e.target.value || null }); }} style={{ ...inp, width: 120 }} /></td>
                                    <td style={td}><select value={base.result ?? ''} disabled={!canWrite} onChange={(e) => void onPick({ ...base, result: (e.target.value || null) as JePick['result'] })} style={inp}><option value="">—</option><option>이상없음</option><option>예외</option><option>확인중</option></select></td>
                                    <td style={td}><input defaultValue={base.note ?? ''} disabled={!canWrite} onBlur={(e) => { if ((e.target.value || null) !== base.note) void onPick({ ...base, note: e.target.value || null }); }} style={{ ...inp, width: 140 }} /></td>
                                  </>);
                                })()}
                              </tr>
                            );
                          })}</tbody>
                        </table>
                      </div>
                    )}
                    {r.rows.length > 1500 && <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginTop: 4 }}>화면에는 1,500줄까지 — 조서 엑셀에는 3,000줄까지 들어갑니다.</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    })}
  </>);
}

// ── 카드 묶음 · 칩 · 할 일 ───────────────────────────────────────────────────

/** 세 묶음 — 필수 검증 / 실물 조서의 주요 절차 / 참고(기본 접힘). */
const SECTIONS: { key: string; title: string; hint: string; codes: string[] }[] = [
  { key: 'must', title: '① 필수 검증', hint: '받은 분개장이 믿을 만한가 — 넷 다 「일치」여야 아래 절차가 의미가 있습니다', codes: ['A01', 'A02', 'A03', 'A04'] },
  { key: 'main', title: '② 주요 절차', hint: '실물 조서(나래 · 세원)가 한 절차 + 보고기간말 분개(감사기준 240 문단 32)', codes: ['B01', 'B02', 'B03', 'B09'] },
  { key: 'ref', title: '③ 참고 시나리오', hint: '필요한 회사만 켭니다 — 끈 것은 조서 총괄에 X 와 사유로 남습니다', codes: ['B07', 'B08', 'B10', 'B11', 'B12', 'B13', 'B14', 'B04', 'B05', 'B06'] },
];

type ChipKind = 'ok' | 'bad' | 'pick' | 'none';
const CHIP_STYLE: Record<ChipKind, { bg: string; fg: string }> = {
  ok: { bg: '#DCFCE7', fg: '#166534' }, bad: { bg: '#FEE2E2', fg: '#B91C1C' }, pick: { bg: '#E0EAFF', fg: '#1E3A8A' }, none: { bg: '#F3F4F6', fg: '#6B7280' },
};
/** A(필수)는 일치 / 불일치, B(선택)는 「추출 n건」 — 추출은 오류가 아니라 검토 대상이다. */
function chipLabel(r: CheckResult): { text: string; kind: ChipKind } {
  if (r.status === '자료없음' || r.status === '미수행') return { text: '자료 없음', kind: 'none' };
  if (r.kind === 'Mandatory') return r.status === '통과' ? { text: '일치', kind: 'ok' } : { text: '불일치', kind: 'bad' };
  return r.status === '통과' ? { text: '추출 0건', kind: 'ok' } : { text: `추출 ${r.rows.length.toLocaleString()}건`, kind: 'pick' };
}

/** 카드마다 「무엇을 하면 되는지」. */
function todoOf(r: CheckResult): string {
  if (r.status === '자료없음' || r.status === '미수행') return '자료가 없어 수행할 수 없습니다 — 체크를 끄면 조서 총괄에 X 와 사유(이 문장)가 각주로 남습니다.';
  const pass = r.status === '통과';
  switch (r.code) {
    case 'A01': return pass ? '할 일 없음 — 결론 문장이 조서에 들어갑니다.' : '기간 밖 · 차대 동시 기재 줄을 펼쳐 보고, 파일 문제면 ③ 보완할 점의 요청문으로 다시 받습니다.';
    case 'A02': return pass ? '할 일 없음.' : '빈 칸이 있는 필드를 확인하고 회사에 다시 출력을 요청합니다.';
    case 'A03': return pass ? '할 일 없음.' : '차대가 안 맞는 전표를 펼쳐 원인(소수점 · 데이터 오류)을 결론 칸에 적습니다.';
    case 'A04': return pass ? '펼쳐서 「어떻게 맞았나」를 확인하세요 — 묶음(재분류 · 손익 미대체)으로 맞춘 줄은 내용이 맞는지 봅니다.' : '펼쳐서 「남은 차이」 묶음을 확인합니다. 공시과목 나눔 · 재분류면 ① 잔액표의 묶음 칸에 같은 이름을 적고, 아니면 회사에 질의합니다.';
    case 'B01': return pass ? '할 일 없음.' : '줄마다 어느 조서에서 검토했는지(REF) · 결과를 적습니다. 증빙이 필요한 전표는 ④ 탭에서 회사에 요청합니다.';
    case 'B02': return pass ? '할 일 없음.' : '계정과목표에 없는 계정의 전표를 회사에 질의합니다.';
    case 'B03': return pass ? '할 일 없음.' : '계정마다 REF 칸에 검토한 조서 번호를 적습니다(엑셀에서 G열).';
    case 'B09': return pass ? '할 일 없음.' : '결산 · 기준일 전표의 내용이 결산조정으로 적정한지 훑고, 큰 것은 ④에서 증빙을 요청합니다.';
    case 'B10': return pass ? '할 일 없음.' : '빈 번호가 삭제 · 취소 전표인지 회사에 질의합니다(③ 요청문에 포함).';
    case 'B07': return pass ? '할 일 없음.' : '매출 상대계정이 현금 · 채권이 아닌 전표의 거래 내용을 확인합니다.';
    default: return pass ? '할 일 없음.' : '목록을 훑어 이상한 전표만 ④에서 고릅니다. 필요 없으면 체크를 끄고 사유를 적습니다.';
  }
}

/** A04 기초잔액 — 「어떻게 맞았나」를 한눈에: 그대로 일치 / 묶음으로 상쇄(이유별) / 남은 차이, 그리고 표(차이 있는 줄만 보기). */
function OpeningView({ r }: { r: CheckResult }) {
  const [onlyDiff, setOnlyDiff] = useState(true);
  type Row = { group: string; code: string; name: string; jdr: number; jcr: number; close: number; calc: number; open: number; diff: number; side: string };
  const rows: Row[] = r.rows.map((x) => ({ group: String(x[0] || x[1] || x[2]), code: String(x[1]), name: String(x[2]), jdr: Number(x[3]), jcr: Number(x[4]), close: Number(x[5]), calc: Number(x[6]), open: Number(x[7]), diff: Number(x[8]), side: String(x[9]) }));
  const groups = new Map<string, Row[]>();
  for (const x of rows) groups.set(x.group, [...(groups.get(x.group) ?? []), x]);
  const exact = rows.filter((x) => x.diff === 0 && (groups.get(x.group)?.length ?? 0) === 1).length;
  const multi = [...groups.entries()].filter(([, xs]) => xs.length > 1 || xs.some((x) => x.diff !== 0));
  const offset = multi.filter(([, xs]) => Math.round(xs.reduce((s, x) => s + x.diff, 0)) === 0 && xs.some((x) => x.diff !== 0));
  const left = multi.filter(([, xs]) => Math.round(xs.reduce((s, x) => s + x.diff, 0)) !== 0);
  /** 묶음 이름 — 계정코드로만 묶인 것(같은 계정이 공시과목 여럿)은 계정 이름으로 보인다. */
  const label = (g: string, xs: Row[]) => (g.startsWith('재분류:') ? g : xs.every((x) => x.code === g) ? `같은 계정 「${xs[0].name}」` : `묶음 「${g}」`);
  const why = (g: string, xs: Row[]) => (g.startsWith('재분류:') ? (xs.some((x) => x.name.startsWith('당기순이익')) ? '반대 금액 짝 + 손익 미대체' : '반대 금액 짝(회사 재무제표의 재분류) — 자동')
    : xs.some((x) => x.name.startsWith('당기순이익')) ? '손익 미대체(이익잉여금에 당기순이익이 아직 안 넘어감)' : '같은 묶음(공시과목 나눔 · 같은 이름)');
  const shown = onlyDiff ? rows.filter((x) => (groups.get(x.group)?.length ?? 0) > 1 || x.diff !== 0) : rows;
  const box = { border: '1px solid var(--rule)', borderRadius: 6, padding: '8px 10px', fontSize: 'var(--fs-1)', lineHeight: 1.7 } as const;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ ...box, background: '#F8FAFC' }}>
        <b>어떻게 대사하나</b> — 분개장에는 전기이월 전표가 없으므로, <b>회사 제시 기말잔액에서 올해 분개장 증감을 빼서 기초를 거꾸로 구하고</b>(역산 기초),
        그것이 <b>전기말 감사받은 잔액</b>과 같은지 봅니다. 같으면 「분개장이 빠짐없이 들어왔고 전기 잔액이 그대로 이월됐다」는 뜻입니다.
        <div style={{ color: 'var(--ink-3)' }}>역산 기초 = 회사제시 기말 − 차변합계 + 대변합계(자산 · 차감계정) / 회사제시 기말 + 차변합계 − 대변합계(부채 · 자본) · 차이 = 역산 기초 − 전기말 잔액</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, marginTop: 8 }}>
        <div style={{ ...box, borderColor: '#86EFAC' }}><div style={{ color: 'var(--ink-3)' }}>그대로 일치</div><b style={{ fontSize: 'var(--fs-3)' }}>{exact}줄</b></div>
        <div style={{ ...box, borderColor: '#93C5FD' }}><div style={{ color: 'var(--ink-3)' }}>묶음으로 상쇄</div><b style={{ fontSize: 'var(--fs-3)' }}>{offset.length}묶음</b> <span style={{ color: 'var(--ink-3)' }}>({offset.reduce((s, [, xs]) => s + xs.length, 0)}줄)</span></div>
        <div style={{ ...box, borderColor: left.length ? '#FCA5A5' : 'var(--rule)' }}><div style={{ color: 'var(--ink-3)' }}>남은 차이</div><b style={{ fontSize: 'var(--fs-3)', color: left.length ? 'var(--bad)' : undefined }}>{left.length}묶음</b></div>
      </div>
      {[...offset, ...left].length > 0 && (
        <div style={{ ...box, marginTop: 8 }}>
          <b>묶음 풀이</b> <span style={{ color: 'var(--ink-3)' }}>— 한 줄만 보면 차이가 있어도, 같은 묶음의 차이를 더해 0이면 상쇄된 것입니다.</span>
          {[...left, ...offset].map(([g, xs]) => {
            const sum = Math.round(xs.reduce((s, x) => s + x.diff, 0));
            return (
              <div key={g} style={{ marginTop: 6, padding: '6px 8px', borderRadius: 4, background: sum ? '#FEF2F2' : '#EFF6FF' }}>
                <b>{label(g, xs)}</b> <span style={{ color: 'var(--ink-3)' }}>· {why(g, xs)}</span>
                <div>{xs.map((x) => <span key={x.code + x.name} style={{ marginRight: 14, whiteSpace: 'nowrap' }}>{x.name} <b style={{ color: x.diff ? (x.diff > 0 ? '#1D4ED8' : '#B91C1C') : 'var(--ink-3)' }}>{x.diff > 0 ? '+' : ''}{won(x.diff)}</b></span>)}
                  <span style={{ whiteSpace: 'nowrap' }}>→ 합계 <b style={{ color: sum ? 'var(--bad)' : 'var(--good)' }}>{won(sum)}</b> {sum ? '— 원인 확인 필요' : '✓ 상쇄'}</span>
                </div>
              </div>
            );
          })}
          <div style={{ color: 'var(--ink-3)', marginTop: 6 }}>
            묶음을 바꾸려면 ① 기본정보 · 자료의 잔액표에서 「묶음」 칸에 같은 이름을 적고 저장합니다. 「재분류: A ↔ B」는 차이가 정확히 반대인 두 줄을 앱이 짝지은 것이라 내용(실제 재분류인지)을 확인하세요.
          </div>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 4px', fontSize: 'var(--fs-1)' }}>
        <label><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> 묶음 · 차이 있는 줄만 보기</label>
        <span style={{ color: 'var(--ink-3)' }}>{shown.length} / {rows.length}줄</span>
      </div>
      <div style={{ overflow: 'auto', maxHeight: 420, border: '1px solid var(--rule)', borderRadius: 4 }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 'var(--fs-1)' }}>
          <thead><tr>{['묶음', '계정코드', '계정명', '분개장 차변', '분개장 대변', '회사제시 기말', '역산 기초', '전기말 잔액', '차이', '방향'].map((h) => <th key={h} style={{ ...th, textAlign: /차변|대변|기말|기초|잔액|차이/.test(h) && h !== '방향' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
          <tbody>{shown.map((x, i) => {
            const grouped = (groups.get(x.group)?.length ?? 0) > 1;
            return (
              <tr key={i} style={{ background: x.diff && !grouped ? '#FEF2F2' : grouped ? '#EFF6FF' : undefined }}>
                <td style={{ ...td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={x.group}>{grouped ? label(x.group, groups.get(x.group)!) : ''}</td>
                <td style={td}>{x.code}</td><td style={td}>{x.name}</td>
                <td style={tdr}>{won(x.jdr)}</td><td style={tdr}>{won(x.jcr)}</td><td style={tdr}>{won(x.close)}</td><td style={tdr}>{won(x.calc)}</td><td style={tdr}>{won(x.open)}</td>
                <td style={{ ...tdr, fontWeight: x.diff ? 700 : 400, color: x.diff ? (x.diff > 0 ? '#1D4ED8' : '#B91C1C') : 'var(--ink-4)' }}>{won(x.diff)}</td>
                <td style={td}>{x.side}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </div>
  );
}

// ── ④ 선정 · 증빙요청 · 결과 ──────────────────────────────────────────────────
// ② 검토 화면과 같은 틀(2026-10-21): 흐름 설명 + 진행 숫자 → 1단계 고르기 · 2단계 요청 · 회신 · 3단계 결과, 단계마다 👉 할 일, 전표마다 상태 칩.

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

type PickState = '요청 전' | '요청함' | '회신 받음' | '이상없음' | '예외' | '확인중';
const pickState = (p: JePick): PickState => (p.result === '이상없음' || p.result === '예외' ? p.result : p.repliedAt || p.answer || p.replyDocs ? (p.result === '확인중' ? '확인중' : '회신 받음') : p.reqNo ? '요청함' : '요청 전');
const PICK_STYLE: Record<PickState, { bg: string; fg: string }> = {
  '요청 전': { bg: '#F3F4F6', fg: '#6B7280' }, 요청함: { bg: '#FEF3C7', fg: '#92400E' }, '회신 받음': { bg: '#E0EAFF', fg: '#1E3A8A' },
  확인중: { bg: '#E0EAFF', fg: '#1E3A8A' }, 이상없음: { bg: '#DCFCE7', fg: '#166534' }, 예외: { bg: '#FEE2E2', fg: '#B91C1C' },
};
const Chip = ({ s }: { s: PickState }) => <span style={{ background: PICK_STYLE[s].bg, color: PICK_STYLE[s].fg, borderRadius: 999, padding: '1px 8px', fontSize: 'var(--fs-1)', fontWeight: 700, whiteSpace: 'nowrap' }}>{s}</span>;
const Todo = ({ children }: { children: React.ReactNode }) => <div style={{ fontSize: 'var(--fs-1)', color: '#7C5A00', margin: '4px 0 6px' }}>👉 {children}</div>;
const StepHead = ({ n, title, hint }: { n: string; title: string; hint: string }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
    <b style={{ color: 'var(--navy)', fontSize: 'var(--fs-3)' }}>{n} {title}</b>
    <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>{hint}</span>
  </div>
);

function SampleStep({ eng, job, results, lines, picks, canWrite, onSave, flash, setErr }: {
  eng: Engagement; job: JeJob; results: CheckResult[]; lines: JeLine[]; picks: JePick[]; canWrite: boolean;
  onSave: (ps: JePick[]) => Promise<void>; flash: (m: string) => void; setErr: (m: string | null) => void;
}) {
  const { profileName } = useAuth();
  const cands = useMemo(() => buildCandidates(results, lines, (r) => performed(job, r)), [results, lines, job]);
  const pmap = useMemo(() => new Map(picks.map((p) => [`${p.vdate}|${p.vno}`, p])), [picks]);
  const thr = benchThreshold(job.bench);
  const [f, setF] = useState<{ scen: string; min: number; q: string; topN: number }>({ scen: '', min: 0, q: '', topN: 20 });
  // ② 검토 B01 표에서 계정 조서 REF · 결과로 이미 끝낸 전표 — 회사 증빙을 또 받지 않는다.
  const hasRef = (k: string) => { const p = pmap.get(k); return !!p && !p.selected && !!(p.evidence || p.result); };
  const rec = useMemo(() => recommendPicks(cands, thr, hasRef), [cands, thr, pmap]); // eslint-disable-line react-hooks/exhaustive-deps
  const recNew = rec.filter((c) => !pmap.get(c.key)?.selected);
  const refN = cands.filter((c) => hasRef(c.key)).length;
  const [stateF, setStateF] = useState<PickState | ''>('');
  const titleOf = (c: string) => results.find((r) => r.code === c)?.title ?? c;
  const shown = cands.filter((c) => (!f.scen || c.scenarios.includes(f.scen)) && (!f.min || c.amount >= f.min) && (!f.q || `${c.mainAcct} ${c.memo} ${c.cpName} ${c.no}`.includes(f.q)));
  const asPick = (c: (typeof cands)[number], selected: boolean): JePick => {
    const cur = pmap.get(c.key);
    return {
      evidence: null, answer: null, result: null, note: null, ...(cur ?? {}),
      vdate: c.date, vno: c.no, scenarios: c.scenarios, amount: c.amount, reason: c.scenarios.map(titleOf).join(' · '), selected, reqDocs: cur?.reqDocs ?? docsFor(c.scenarios),
    };
  };
  const sel = picks.filter((p) => p.selected).sort((a, b) => (a.reqNo ?? 99999) - (b.reqNo ?? 99999) || a.vdate.localeCompare(b.vdate) || a.vno.localeCompare(b.vno, 'en', { numeric: true }));
  const count = (s: PickState) => sel.filter((p) => pickState(p) === s).length;
  const notSent = count('요청 전'), sent = sel.filter((p) => p.reqNo).length, replied = sel.filter((p) => p.repliedAt || p.answer || p.replyDocs).length;
  const done = count('이상없음') + count('예외');
  const scenUsed = [...new Set(cands.flatMap((c) => c.scenarios))].sort();
  const selShown = stateF ? sel.filter((p) => pickState(p) === stateF) : sel;

  async function request() {
    // 요청 번호가 없는 선정 전표에 번호를 매긴다(이미 보낸 번호는 그대로).
    let n = Math.max(0, ...picks.map((p) => p.reqNo ?? 0));
    const d = today();
    const next = sel.map((p) => (p.reqNo ? p : { ...p, reqNo: ++n, requestedAt: d }));
    const fresh = next.filter((p, i) => p !== sel[i]);
    if (fresh.length) await onSave(fresh);
    await exportRequestWorkbook(eng.entityName, eng.fy, next, lines, d, { preparer: job.preparer });
    flash(`증빙요청 엑셀을 내려받았습니다 — 전표 ${next.length}장(새로 번호 매김 ${fresh.length}장). 회사에 보내 주세요.`);
  }
  async function onReply(file: File) {
    setErr(null);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer());
      const sh = wb.SheetNames.find((x) => /증빙요청/.test(x)) ?? wb.SheetNames[0];
      const rows = parseReply(XLSX.utils.sheet_to_json(wb.Sheets[sh], { header: 1, defval: '', raw: true }) as unknown[][]);
      const d = today();
      const upd: JePick[] = [];
      const miss: string[] = [];
      for (const r of rows) {
        const p = pmap.get(`${r.date}|${r.no}`);
        if (!p) { miss.push(`${r.date} ${r.no}`); continue; }
        upd.push({ ...p, answer: r.answer ?? p.answer, replyDocs: r.docs ?? p.replyDocs, repliedAt: d });
      }
      if (upd.length) await onSave(upd);
      flash(`회신 ${rows.length}줄 중 ${upd.length}장을 반영했습니다${miss.length ? ` — 선정 전표가 아닌 ${miss.length}줄은 건너뜀(${miss.slice(0, 3).join(', ')})` : ''}. 3단계에서 증빙을 보고 결과를 고르세요.`);
    } catch (e) { setErr(e instanceof Error ? e.message : '읽지 못했습니다.'); }
  }
  const setOne = (p: JePick, patch: Partial<JePick>) => void onSave([{ ...p, ...patch, checkedBy: 'result' in patch || 'evidence' in patch ? profileName : p.checkedBy }]);
  const cell = (p: JePick, k: 'reqDocs' | 'answer' | 'replyDocs' | 'evidence' | 'note', w: number, ph = '') => (
    <td style={td}><input defaultValue={p[k] ?? ''} key={`${k}${p[k] ?? ''}`} placeholder={ph} disabled={!canWrite} onBlur={(e) => { if ((e.target.value || null) !== (p[k] ?? null)) setOne(p, { [k]: e.target.value || null }); }} style={{ ...inp, width: w }} /></td>
  );
  const box = { border: '1px solid var(--rule)', borderRadius: 6, padding: '6px 10px' } as const;

  return (<>
    <div className="card">
      <div style={{ fontSize: 'var(--fs-2)', lineHeight: 1.7, background: '#F8FAFC', border: '1px solid var(--rule)', borderRadius: 6, padding: '8px 10px' }}>
        <b>무엇을 하는 곳인가</b> — ② 검토에서 뽑힌 전표 가운데 <b>증빙으로 확인할 전표를 골라</b> 회사에 요청하고, 회신을 받아 <b>전표마다 결과</b>를 남깁니다. 결과는 조서 <b>C01_선정전표검토</b> 시트가 됩니다.
        <div style={{ color: 'var(--ink-3)' }}>B01 처럼 다른 조서에서 이미 본 줄은 ② 검토의 REF · 결과 칸으로 끝내도 됩니다 — 여기는 <b>회사 증빙이 필요한 전표</b>만.</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 8, fontSize: 'var(--fs-1)' }}>
        {([['후보', cands.length, 'var(--rule)'], ['선정', sel.length, '#93C5FD'], ['요청함', sent, '#FCD34D'], ['회신 받음', replied, '#93C5FD'], ['결과 완료', done, '#86EFAC']] as [string, number, string][]).map(([k, v, c], i) => (
          <div key={k} style={{ ...box, borderColor: c }}><div style={{ color: 'var(--ink-3)' }}>{i ? '→ ' : ''}{k}</div><b style={{ fontSize: 'var(--fs-3)' }}>{v.toLocaleString()}장</b>
            {k === '결과 완료' && done > 0 && <div style={{ color: 'var(--ink-3)' }}>이상없음 {count('이상없음')} · <span style={{ color: count('예외') ? 'var(--bad)' : undefined }}>예외 {count('예외')}</span></div>}</div>
        ))}
      </div>
    </div>

    <div className="card">
      <b style={{ color: 'var(--navy)' }}>선정 기준</b> <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>— 인덕 JE Test 가이드라인 · 감사기준 240 문단 32</span>
      <div style={{ fontSize: 'var(--fs-2)', lineHeight: 1.75, marginTop: 4 }}>
        <div>원칙: 켜 둔 시나리오가 뽑은 전표는 <b>모두 확인</b>합니다. 확인 방법은 두 가지입니다.</div>
        <div>① <b>계정 조서에서 이미 본 전표</b> — ② 검토의 B01 표 「검토(REF 조서)」 칸에 조서 번호(예: 4100 매출)와 결과를 적으면 끝입니다. 회사 증빙을 따로 받지 않습니다. {refN > 0 && <span style={{ color: 'var(--ink-3)' }}>(지금 {refN}장)</span>}</div>
        <div>② <b>나머지는 여기서 회사 증빙으로</b> — 권장 기준: 금액이 <b>중요성 기준 {won(thr)}원 이상</b>인 전표 + 금액과 상관없이 <b>{ALWAYS_ASK.map((c) => `${c} ${titleOf(c)}`).join(' · ')}</b>에 걸린 전표 전부(성격 자체가 위험 신호). 기준 아래 B09 결산조정 등은 계정 조서에서 보거나, 필요하면 직접 더 고릅니다.</div>
        <div style={{ color: 'var(--ink-3)' }}>표본 수를 줄이고 싶으면 「금액 ≥」를 높이거나 상위 N장만 고르되, 줄인 이유를 C01 비고나 ③ 메모에 남깁니다.</div>
      </div>
      {canWrite && <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, fontSize: 'var(--fs-1)' }}>
        <button className="btn-sm btn-sm-navy" disabled={!recNew.length} onClick={() => void onSave(recNew.map((c) => asPick(c, true)))}>권장 기준으로 고르기{recNew.length ? ` (${recNew.length}장 더)` : ''}</button>
        <span style={{ color: 'var(--ink-3)' }}>권장 대상 {rec.length}장 = 금액 기준 {rec.filter((c) => c.amount >= thr).length} + {ALWAYS_ASK.join(' · ')} {rec.filter((c) => c.amount < thr).length}{refN ? ` · REF 로 끝낸 ${refN}장 제외` : ''}</span>
      </div>}
    </div>

    <div className="card">
      <StepHead n="1단계" title="후보에서 고르기" hint={`② 검토의 주요 · 참고 시나리오(${VOUCHER_SCENARIOS.filter((c) => scenUsed.includes(c)).join(' · ') || '없음'})가 뽑은 전표 ${cands.length.toLocaleString()}장 — 여러 시나리오에 걸린 전표는 한 줄`} />
      <Todo>{sel.length ? `${sel.length}장 골랐습니다${recNew.length ? ` — 권장 기준 중 ${recNew.length}장이 아직 남았습니다` : ''}. 더 고르거나 2단계로 갑니다.` : '위 「권장 기준으로 고르기」를 누르면 기준대로 골라집니다. 직접 고르려면 아래 거르기를 씁니다.'}</Todo>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 8px', fontSize: 'var(--fs-1)' }}>
        <select value={f.scen} onChange={(e) => setF({ ...f, scen: e.target.value })} style={inp}><option value="">시나리오 전체</option>{scenUsed.map((c) => <option key={c} value={c}>{c} {titleOf(c)}</option>)}</select>
        <label>금액 ≥ <MoneyInput value={f.min} width={120} onCommit={(v) => setF({ ...f, min: v ?? 0 })} /></label>
        <button className="btn-sm" onClick={() => setF({ ...f, min: thr })} title="B01 중요성 기준">= 중요성 {won(thr)}</button>
        <input placeholder="🔍 계정 · 적요 · 거래처" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} style={{ ...inp, width: 160 }} />
        <span style={{ color: 'var(--ink-3)' }}>{shown.length.toLocaleString()}장</span>
        {canWrite && <>
          <label>금액 상위 <input type="number" value={f.topN} onChange={(e) => setF({ ...f, topN: Number(e.target.value) || 0 })} style={{ ...inp, width: 50 }} />장</label>
          <button className="btn-sm btn-sm-navy" onClick={() => void onSave([...shown].sort((a, b) => b.amount - a.amount).slice(0, f.topN).filter((c) => !pmap.get(c.key)?.selected).map((c) => asPick(c, true)))}>고르기</button>
          <button className="btn-sm" onClick={() => void onSave(shown.filter((c) => !pmap.get(c.key)?.selected).map((c) => asPick(c, true)))}>보이는 것 모두</button>
          <button className="btn-sm" onClick={() => void onSave(shown.filter((c) => pmap.get(c.key)?.selected && !pmap.get(c.key)?.reqNo).map((c) => asPick(c, false)))} title="이미 요청한 전표는 남깁니다">보이는 것 빼기</button>
        </>}
      </div>
      <div style={{ overflow: 'auto', maxHeight: 340, border: '1px solid var(--rule)', borderRadius: 4 }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 'var(--fs-1)' }}>
          <thead><tr>{['선정', '전표일자', '번호', '뽑힌 이유', '전표금액', '주요 계정', '적요', '거래처'].map((h) => <th key={h} style={{ ...th, textAlign: h === '전표금액' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
          <tbody>{shown.slice(0, 1500).map((c) => { const p = pmap.get(c.key); return (
            <tr key={c.key} style={{ background: p?.selected ? 'var(--navy-bg)' : undefined }}>
              <td style={td}><input type="checkbox" checked={!!p?.selected} disabled={!canWrite || !!p?.reqNo} onChange={(e) => void onSave([asPick(c, e.target.checked)])} title={p?.reqNo ? '이미 요청한 전표' : undefined} /></td>
              <td style={td}>{c.date}</td><td style={td}>{c.no}</td>
              <td style={td} title={`${c.scenarios.map(titleOf).join('\n')}\n회사에 보이는 이유: ${plainReason(c.scenarios)}`}>{c.scenarios.map((s) => <span key={s} style={{ background: '#EEF2F7', borderRadius: 4, padding: '0 5px', marginRight: 3 }}>{s}</span>)}{hasRef(c.key) && <span style={{ background: '#DCFCE7', borderRadius: 4, padding: '0 5px' }} title={`계정 조서에서 확인: ${pmap.get(c.key)?.evidence ?? ''}`}>REF</span>}</td>
              <td style={tdr}>{won(c.amount)}</td>
              <td style={td}>{c.mainAcct}</td><td style={{ ...td, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.memo}>{c.memo}</td><td style={td}>{c.cpName}</td>
            </tr>
          ); })}</tbody>
        </table>
      </div>
      <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-4)', marginTop: 4 }}>「뽑힌 이유」에 마우스를 올리면 시나리오 이름과 회사 엑셀에 적히는 쉬운 말 이유가 보입니다. 초록 REF = 계정 조서에서 이미 확인. 요청을 보낸 전표는 빼지 못합니다.</div>
    </div>

    <div className="card">
      <StepHead n="2단계" title="회사에 증빙 요청 · 회신 받기" hint="회사는 엑셀의 노란 칸(회사 설명 · 증빙 파일명)만 채워 그대로 돌려보내면 됩니다" />
      <Todo>{!sel.length ? '1단계에서 먼저 고르세요.' : notSent ? `요청 전 ${notSent}장 — 「📤 증빙요청 엑셀」로 번호를 매기고 내려받아 회사에 보냅니다.` : replied < sent ? `요청한 ${sent}장 중 회신 ${replied}장 — 회사가 돌려준 엑셀을 「📥 회신 올리기」로 올립니다.` : '회신을 다 받았습니다 — 3단계에서 결과를 고릅니다.'}</Todo>
      {canWrite && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn-sm btn-sm-navy" disabled={!sel.length} onClick={() => void request().catch((e) => setErr(e instanceof Error ? e.message : '내려받지 못했습니다.'))}>📤 증빙요청 엑셀{notSent ? ` (새로 ${notSent}장)` : ''}</button>
        <label className="btn-sm" style={{ cursor: 'pointer' }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const fl = e.dataTransfer.files?.[0]; if (fl) void onReply(fl); }}>
          📥 회신 올리기<input type="file" accept=".xls,.xlsx" style={{ display: 'none' }} onChange={(e) => { const fl = e.target.files?.[0]; e.target.value = ''; if (fl) void onReply(fl); }} />
        </label>
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>엑셀: 「안내」(회사 담당자용 — 왜 · 무엇을 · 어떻게 · 기한 · 문의) + 「증빙요청」(전표 한 장 = 한 줄, 쉬운 말 요청 이유 · 요청 증빙 미리 적힘) + 「전표내역」(고른 전표의 모든 줄).</span>
      </div>}
    </div>

    <div className="card">
      <StepHead n="3단계" title="결과 입력" hint="회신 설명 · 증빙을 보고 전표마다 결과를 고릅니다 — 조서 C01 로 나갑니다" />
      <Todo>{!sel.length ? '고른 전표가 없습니다.' : done === sel.length ? `모두 끝났습니다 — 이상없음 ${count('이상없음')} · 예외 ${count('예외')}. 예외는 비고에 처리 내용을 적으세요.` : `결과가 남은 전표 ${sel.length - done}장 — 「확인한 증빙(REF)」에 본 증빙 · 조서를 적고 결과를 고릅니다.`}</Todo>
      {sel.length > 0 && <>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '2px 0 6px', fontSize: 'var(--fs-1)' }}>
          <button className={stateF === '' ? 'btn-sm btn-sm-navy' : 'btn-sm'} onClick={() => setStateF('')}>전체 {sel.length}</button>
          {(['요청 전', '요청함', '회신 받음', '확인중', '이상없음', '예외'] as PickState[]).filter((s) => count(s)).map((s) => (
            <button key={s} className={stateF === s ? 'btn-sm btn-sm-navy' : 'btn-sm'} onClick={() => setStateF(s)}>{s} {count(s)}</button>
          ))}
        </div>
        <div style={{ overflow: 'auto', maxHeight: 520, border: '1px solid var(--rule)', borderRadius: 4 }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 'var(--fs-1)' }}>
            <thead><tr>{['상태', 'No', '전표', '금액', '요청 증빙', '회사 설명', '회신 증빙', '확인한 증빙(REF)', '결과', '비고'].map((h) => <th key={h} style={{ ...th, textAlign: h === '금액' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
            <tbody>{selShown.map((p) => (
              <tr key={`${p.vdate}|${p.vno}`} style={{ background: p.result === '예외' ? '#FEF2F2' : p.result === '이상없음' ? '#F0FDF4' : undefined }}>
                <td style={td}><Chip s={pickState(p)} /></td>
                <td style={td}>{p.reqNo ?? '—'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }} title={p.reason ?? ''}>{p.vdate} {p.vno} <span style={{ color: 'var(--ink-4)' }}>{p.scenarios.join(' ')}</span></td>
                <td style={tdr}>{won(p.amount)}</td>
                {cell(p, 'reqDocs', 170)}{cell(p, 'answer', 200, '회신 엑셀에서')}{cell(p, 'replyDocs', 120, '회신 엑셀에서')}{cell(p, 'evidence', 130, '예: 세금계산서 · 4100')}
                <td style={td}><select value={p.result ?? ''} disabled={!canWrite} onChange={(e) => setOne(p, { result: (e.target.value || null) as JePick['result'] })} style={inp}><option value="">—</option><option>이상없음</option><option>예외</option><option>확인중</option></select></td>
                {cell(p, 'note', 140)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </>}
    </div>
  </>);
}

// ── ③ 보완할 점 ────────────────────────────────────────────────────────────

const RELAX_TEMPLATE = [
  '비상장회사로서 아래 사항을 검토한 결과 부정위험으로 인한 중요왜곡표시위험이 크지 않다고 판단하여 완화된 절차(기말 · 결산조정 분개 중심)를 적용함',
  '① 재무제표 작성 및 분개 입력의 자동화 정도: ',
  '② 계정의 성격과 복잡성: ',
  '③ 분개 · 조정사항에 대한 내부통제: ',
  '④ 통제무력화를 막는 전사 수준 통제와 통제환경: ',
  '보완절차: 재무보고 관여자에게 부적합 · 비경상 분개 여부를 질문하고 그 내용을 문서화함',
].join('\n');

function GapStep({ eng, job, results, hasBal, hasJournal, canWrite, patchJob }: { eng: Engagement; job: JeJob; results: CheckResult[]; hasBal: boolean; hasJournal: boolean; canWrite: boolean; patchJob: (p: Partial<JeJob>) => Promise<void> }) {
  const by = (c: string) => results.find((r) => r.code === c);
  // 수행한(켜진) 시나리오의 예외만 — 꺼 둔 시나리오는 요청문에 넣지 않는다(사용자 2026-10-21: 제이스튜디오 B10 문장이 왜 나오나).
  const exc = (c: string) => { const r = by(c); return r && performed(job, r) && r.status === '예외' ? r : undefined; };
  const src = (c: string) => { const r = by(c); return r ? `${r.code} ${r.title} — ② 검토 › ${r.kind === 'Mandatory' ? '필수 검증' : '선택 시나리오'}` : c; };
  // text = 우리가 보는 설명, ask = 회사에 보낼 문장(없으면 요청문에 안 넣는다), src = 어느 절차에서 나왔나, list = 별첨할 목록.
  type Item = { kind: '자료요청' | '질의' | '판단'; text: string; ask?: string; src: string; list?: CheckResult };
  const items: Item[] = [];
  if (!hasJournal) items.push({ kind: '자료요청', src: '① 자료 › 분개장', text: '분개장이 아직 없습니다.', ask: '회계기간 전체 분개장(엑셀) — 전표일자 · 전표번호 · 계정코드 · 계정과목 · 차변 · 대변 · 거래처 · 적요가 나오도록 출력해 주십시오.' });
  if (!hasBal) items.push({ kind: '자료요청', src: '① 자료 › 잔액표 (A04 기초잔액 대사에 씀)', text: '회사 제시 잔액(기초 · 기말)이 없어 A04 기초잔액 대사를 못 합니다 — 잔액표 양식에 재무상태표 금액을 붙여 넣어 올리세요.', ask: '전기말 · 당기말 재무상태표(계정별 금액, 엑셀)를 보내 주십시오.' });
  items.push({ kind: '자료요청', src: 'B04 · B05 · B06 (작성자 · 승인자 · 입력일 시나리오)', text: '분개장에 작성자 · 승인자 · 입력일시가 없어 B04 · B05 · B06을 못 합니다. 회사가 포함해서 출력할 수 있으면 받고(더존은 대부분 안 됨), 안 되면 미수행 사유로 남깁니다.', ask: '가능하시면 분개장을 작성자 · 승인자 · 입력일시가 함께 나오도록 출력해 주십시오. 프로그램에서 안 되면 「안 된다」고만 회신해 주셔도 됩니다.' });
  if (exc('A01')) items.push({ kind: '자료요청', src: src('A01'), text: `분개장 유효성 예외 — ${by('A01')!.summary}`, ask: '받은 분개장에 회계기간 밖 날짜 또는 차변 · 대변이 한 줄에 함께 적힌 줄이 있습니다. 출력 조건을 확인해 다시 보내 주십시오.' });
  if (exc('A03')) items.push({ kind: '자료요청', src: src('A03'), text: `차대 불일치 — ${by('A03')!.summary}`, ask: '차변 합계와 대변 합계가 맞지 않는 전표가 있습니다. 출력이 잘렸는지 확인해 다시 보내 주십시오.' });
  if (exc('A04')) items.push({ kind: '질의', src: src('A04'), text: `기초잔액 대사 차이 — ${by('A04')!.summary}. 재분류 · 공시과목 나눔이면 묶음으로 정리, 아니면 회사 질의` });
  if (exc('B10')) items.push({ kind: '질의', src: src('B10'), list: by('B10'), text: `전표번호 결번 — ${by('B10')!.summary}`, ask: '같은 날짜 안에서 전표번호가 건너뛴 곳이 있습니다(예: 3번 다음이 5번). 지운 전표 · 취소한 전표인지, 프로그램이 번호를 건너뛴 것인지 별첨 목록에 적어 주십시오.' });
  if (exc('B07')) items.push({ kind: '질의', src: src('B07'), list: by('B07'), text: `매출 상대계정 — ${by('B07')!.summary}`, ask: '매출을 기록하면서 상대 계정이 현금 · 외상매출금 · 선수금이 아닌 전표가 있습니다. 어떤 거래인지 별첨 목록에 한 줄씩 적어 주십시오.' });
  if (!job.listed) items.push({ kind: '판단', src: '감사기준 240 A43 (비상장 완화)', text: '비상장회사 — 완화된 절차를 적용할지 판단하고, 적용하면 사유(4요소)와 결론을 아래에 남깁니다.' });
  items.push({ kind: '판단', src: '감사기준 240 문단 32 (1)', text: '재무보고 관여자 질문 — 부적합 · 비경상 분개나 조정이 있었는지 질문하고 답변을 아래 「질문 · 종합 메모」에 남깁니다(기본 문장이 들어가 있음).' });
  const asks = items.filter((i) => i.ask);
  const letter = [
    `${eng.entityName} 담당자님께`, '',
    `안녕하세요. FY${eng.fy} 외부감사 가운데 「분개 테스트」 절차를 위해 아래 자료를 부탁드립니다.`,
    '분개 테스트는 회계기간의 전표를 훑어 금액이 크거나 성격이 특이한 전표를 확인하는, 모든 감사에서 하는 표준 절차입니다. 회사에 문제가 있다는 뜻은 아닙니다.', '',
    ...asks.map((i, n) => `${n + 1}. ${i.ask}`), '',
    ...(asks.some((i) => i.list) ? ['「(별첨)」이 붙은 항목은 함께 보내 드리는 엑셀 목록의 노란 칸에 답을 적어 돌려주시면 됩니다.', ''] : []),
    `회신은 ${(() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })()}까지 부탁드리며, 어려우시면 말씀해 주십시오.`,
    `문의: ${job.preparer ? `${job.preparer} 회계사` : '담당 회계사'}`, '', '감사합니다.',
  ].join('\n');
  async function attach(r: CheckResult) {
    const note = r.code === 'B10' ? '같은 날짜 안에서 건너뛴 전표번호입니다. 오른쪽 노란 칸에 「삭제」 「취소」 「프로그램 자동 건너뜀」 등을 적어 주십시오.' : '매출 상대 계정이 일반적이지 않은 전표입니다. 오른쪽 노란 칸에 어떤 거래인지 적어 주십시오.';
    await exportListWorkbook(eng.entityName, eng.fy, `${r.code === 'B10' ? '전표번호 결번' : '매출 상대계정'} 목록`, note, r.head, r.rows);
  }
  const kindColor = (k: Item['kind']) => (k === '자료요청' ? '#2F7BD8' : k === '질의' ? '#B45309' : '#7C3AED');
  return (<>
    <div className="card">
      <b style={{ color: 'var(--navy)' }}>보완할 점</b> <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>「나온 곳」은 그 줄을 만든 절차입니다 — ② 검토에서 켜 둔 시나리오의 예외만 여기에 옵니다.</span>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-1)', marginTop: 6 }}>
        <thead><tr>{['구분', '내용', '나온 곳', '요청문'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>{items.map((i, n) => <tr key={n}>
          <td style={{ ...td, width: 70 }}><b style={{ color: kindColor(i.kind) }}>{i.kind}</b></td>
          <td style={td}>{i.text}</td>
          <td style={{ ...td, color: 'var(--ink-3)', width: 230 }}>{i.src}</td>
          <td style={{ ...td, width: 90 }}>{i.ask ? `${asks.indexOf(i) + 1}번` : '—'}{i.list && <button className="btn-sm" style={{ marginLeft: 4 }} onClick={() => void attach(i.list!)} title="회사에 보낼 목록 엑셀">별첨 ⬇</button>}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><b style={{ color: 'var(--navy)' }}>회사에 보낼 요청문</b><span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>번호마다 오른쪽에 나온 절차가 붙어 있습니다(복사할 때는 빠짐).</span><button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => void navigator.clipboard.writeText(letter)}>복사</button></div>
      <div style={{ fontSize: 'var(--fs-1)', background: 'var(--surface-3)', padding: 10, borderRadius: 6, marginTop: 6, lineHeight: 1.7 }}>
        {letter.split('\n').map((l, k) => {
          const m = /^(\d+)\. /.exec(l);
          const it = m ? asks[Number(m[1]) - 1] : undefined;
          return <div key={k} style={{ minHeight: '1em' }}>{l}{it && <span style={{ marginLeft: 8, fontSize: 11, color: '#64748B', background: '#EEF2F7', borderRadius: 4, padding: '0 6px' }}>← {it.src}{it.list ? ' · 별첨' : ''}</span>}</div>;
        })}
      </div>
    </div>
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ color: 'var(--navy)' }}>완화된 절차</b>
        <label style={{ fontSize: 'var(--fs-1)' }}><input type="checkbox" checked={job.relaxed} disabled={!canWrite || job.listed} onChange={(e) => void patchJob({ relaxed: e.target.checked, relaxedNote: e.target.checked && !job.relaxedNote ? RELAX_TEMPLATE : job.relaxedNote })} /> 적용(비상장만)</label>
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>총괄 시트에 사유가 들어갑니다.</span>
      </div>
      {job.relaxed && <textarea defaultValue={job.relaxedNote ?? RELAX_TEMPLATE} key={job.relaxed ? 'on' : 'off'} disabled={!canWrite} onBlur={(e) => void patchJob({ relaxedNote: e.target.value })} rows={7} style={{ ...inp, width: '100%', marginTop: 6 }} />}
    </div>
    <div className="card">
      <b style={{ color: 'var(--navy)' }}>질문 · 종합 메모</b> <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>기본 문장(작성일 {job.preparedOn ?? '— 머리의 작성일을 넣으면 채워짐'})이 들어가 있습니다. 실제 답변에 맞게 고치세요 — 총괄 결론 아래에 들어갑니다.</span>
      <textarea defaultValue={memoOf(job)} key={job.memo ? 'saved' : `def${job.preparedOn}${job.contacts[0]?.name ?? ''}`} disabled={!canWrite} onBlur={(e) => { const v = e.target.value.trim(); if (v !== memoOf(job).trim()) void patchJob({ memo: v || null }); }} rows={4} style={{ ...inp, width: '100%', marginTop: 6 }} />
      {canWrite && job.memo && <button className="btn-sm" style={{ marginTop: 4 }} onClick={() => void patchJob({ memo: null })}>기본 문장으로 되돌리기</button>}
    </div>
  </>);
}

