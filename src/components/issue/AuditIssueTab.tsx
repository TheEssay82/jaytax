// 감사업무관리 › 📝 감사이슈 LOG — 회사(감사 건)마다 이슈를 아이템으로 쌓고 경과를 남긴다(사용자 2026-10-14).
//
// 옛 엑셀 ISSUELOG(화이브라더스코리아 2019)를 옮겼다. 감사는 계획 → 중간 → 기말로 가고(일반조서와 같은 흐름),
// 강평(워드)에 다 못 담는 것 · 내년으로 넘길 것 · 놓치기 쉬운 것을 여기서 아이템으로 잡는다. 우리 내부용.
//   · 회사별 — 이슈 표(엑셀 열 그대로) + 줄을 누르면 본문·결론·경과 기록. 경과는 날짜·작성자와 쌓기만 한다.
//   · 전체 진행중 — 내 손에 걸린 모든 회사의 진행중 이슈를 한 화면에.
//   · 다음 해로 이월 — 진행중 이슈를 다음 해 건으로 넘긴다(원래 이슈는 「이월」로 닫힌다).
import { useEffect, useMemo, useState } from 'react';
import Empty from '../common/Empty';
import { confirmDanger } from '../common/DangerConfirm';
import { useAuth } from '../../context/AuthContext';
import { listEngagements, type Engagement } from '../../lib/dsdApi';
import { CPA_OPTIONS } from '../../lib/bizRegistryApi';
import { takePickedEngagement } from '../gwp/WtbTab';
import {
  ISSUE_CATEGORIES, ISSUE_IMPORTANCE, ISSUE_STAGES, ISSUE_STATUSES,
  addIssueLog, carryOver, createIssue, deleteIssue, emptyIssueInput, issueCounts, issueToInput,
  listIssueLogs, listIssues, listIssuesByIds, listOpenIssues, updateIssue,
  type AuditIssue, type IssueInput, type IssueLog, type IssueStatus,
} from '../../lib/auditIssueApi';

const IMP_COLOR: Record<string, string> = { 높음: '#DC2626', 중간: '#D97706', 낮음: '#6B7280' };
const STATUS_STYLE: Record<IssueStatus, { bg: string; fg: string }> = {
  진행중: { bg: '#FEF3C7', fg: '#92400E' },
  완료: { bg: '#DCFCE7', fg: '#166534' },
  이월: { bg: '#E0E7FF', fg: '#3730A3' },
};
const STAGE_COLOR: Record<string, string> = { 계획: '#7C3AED', 중간: '#2F7BD8', 기말: '#12A38A' };
const fmt = (s: string) => s.slice(0, 16).replace('T', ' ');

type Counts = Map<string, { all: number; open: number; decision: number }>;

export default function AuditIssueTab() {
  const { role, readonly, sandbox, profileName, user } = useAuth();
  const canWriteBase = !readonly && (role === 'superuser' || role === 'accountant' || role === 'per_head_accountant');
  const [engs, setEngs] = useState<Engagement[]>([]);
  const [counts, setCounts] = useState<Counts>(new Map());
  const [view, setView] = useState<'company' | 'open'>('company');
  const [fyAt, setFyAt] = useState<number | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const reloadCounts = () => issueCounts().then(setCounts).catch(() => undefined);
  useEffect(() => {
    void (async () => {
      try {
        const [list, c] = await Promise.all([listEngagements(), issueCounts()]);
        const real = list.filter((e) => !e.isDemo || sandbox);
        setEngs(real); setCounts(c);
        const want = takePickedEngagement();
        if (want && real.some((e) => e.id === want)) { setPickedId(want); setListOpen(false); }
      } catch (e) { setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'); } finally { setLoading(false); }
    })();
  }, []);

  const years = useMemo(() => [...new Set(engs.map((e) => e.fy))].sort((a, b) => b - a), [engs]);
  const fy = fyAt ?? years[0];
  const inYear = useMemo(() => engs.filter((e) => e.fy === fy).sort((a, b) => {
    const d = (counts.get(b.id)?.open ?? 0) - (counts.get(a.id)?.open ?? 0);
    return d || a.entityName.localeCompare(b.entityName, 'ko');
  }), [engs, fy, counts]);
  const picked = engs.find((e) => e.id === pickedId) ?? null;
  const canWrite = canWriteBase && (!sandbox || !!picked?.isDemo);
  const openTotal = [...counts.values()].reduce((s, c) => s + c.open, 0);

  function pick(id: string) { setPickedId(id); setListOpen(false); setView('company'); }

  if (loading) return <div className="card">불러오는 중…</div>;
  const shown = picked && !listOpen ? inYear.filter((e) => e.id === picked.id) : inYear;

  return (
    <div>
      <div className="card">
        <div className="chdr">📝 감사이슈 LOG
          <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>{view === 'open' ? '모든 회사의 진행중 이슈' : picked ? `${picked.entityName} · FY${picked.fy} ${picked.scope}` : '회사를 고르세요'}</span>
        </div>
        <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7 }}>
          감사 계획 → 중간 → 기말을 거치며 나온 <b>이슈를 아이템으로</b> 남깁니다. 강평에 다 못 담는 것, <b>내년으로 넘길 것</b>, 놓치기 쉬운 것까지.
          경과는 날짜·작성자와 함께 쌓이고, 끝나지 않은 이슈는 다음 해 건으로 이월합니다. <b>우리 내부용</b>입니다.
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button className={view === 'company' ? 'btn-sm btn-sm-navy' : 'btn-sm'} onClick={() => setView('company')}>회사별</button>
          <button className={view === 'open' ? 'btn-sm btn-sm-navy' : 'btn-sm'} onClick={() => setView('open')}>전체 진행중 {openTotal}</button>
        </div>
      </div>
      {err && <div className="card" style={{ color: 'var(--bad)', background: 'var(--bad-bg)' }}>{err}</div>}

      {view === 'open' ? <OpenBoard engs={engs} onPick={pick} /> : (
        <>
          <div className="card" style={{ padding: '10px 12px 12px' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 9 }}>
              <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>사업연도</span>
              {years.map((y) => (
                <button key={y} onClick={() => { setFyAt(y); setListOpen(true); }} style={{
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--fs-1)', border: `1px solid ${y === fy ? 'var(--navy)' : 'var(--rule)'}`,
                  background: y === fy ? 'var(--navy)' : '#fff', color: y === fy ? '#fff' : 'var(--ink-2)', fontWeight: y === fy ? 700 : 400, borderRadius: 999, padding: '3px 11px',
                }}>FY{y}<span style={{ opacity: 0.7, marginLeft: 6, fontWeight: 400 }}>· {engs.filter((e) => e.fy === y).length}건</span></button>
              ))}
              {picked && <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setListOpen(!listOpen)}>{listOpen ? '목록 접기 ▲' : `다른 회사 고르기 ▼ (${inYear.length - 1})`}</button>}
            </div>
            {inYear.length === 0 ? <Empty text="작업 건이 없습니다" hint="주석·DSD 관리 또는 일반조서 관리의 「새 건 만들기」로 만듭니다." /> : (
              <div style={{ border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
                {shown.map((e, i) => {
                  const c = counts.get(e.id), on = e.id === pickedId;
                  return (
                    <button key={e.id} onClick={() => pick(e.id)} style={{
                      display: 'grid', gridTemplateColumns: '6px minmax(0, 1fr) auto auto', gap: 10, alignItems: 'center', width: '100%',
                      textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', border: 0, borderTop: i ? '1px solid var(--rule)' : 0,
                      background: on ? 'var(--navy-bg)' : '#fff', padding: '7px 10px 7px 0',
                    }}>
                      <span style={{ alignSelf: 'stretch', background: c?.open ? '#D97706' : c?.all ? '#12A38A' : '#D1D5DB' }} />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--navy)' }}>{e.entityName}</span>
                        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginLeft: 8 }}>{e.scope}</span>
                      </span>
                      <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>
                        {c ? <>진행중 <b style={{ color: c.open ? '#B45309' : 'inherit' }}>{c.open}</b> / 전체 {c.all}{c.decision ? <span style={{ color: '#DC2626' }}> · 회사결정 {c.decision}</span> : null}</> : <span style={{ color: 'var(--ink-4)' }}>이슈 없음</span>}
                      </span>
                      <span style={{ color: 'var(--ink-4)', fontSize: 'var(--fs-1)' }}>{on ? '●' : '›'}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {!picked ? <div className="card"><Empty text="위에서 회사를 고르세요." /></div> : (
            <IssueBoard key={picked.id} eng={picked} engs={engs} canWrite={canWrite} myName={profileName} myId={user?.id ?? null} onChanged={reloadCounts} />
          )}
        </>
      )}
    </div>
  );
}

// ── 한 회사의 이슈 표 ───────────────────────────────────────────────
function IssueBoard({ eng, engs, canWrite, myName, myId, onChanged }: {
  eng: Engagement; engs: Engagement[]; canWrite: boolean; myName: string; myId: string | null; onChanged: () => void;
}) {
  const [issues, setIssues] = useState<AuditIssue[]>([]);
  const [logs, setLogs] = useState<Map<string, IssueLog[]>>(new Map());
  const [prev, setPrev] = useState<Map<string, AuditIssue>>(new Map());
  const [statusF, setStatusF] = useState<IssueStatus | null>('진행중');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<AuditIssue | 'new' | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const list = await listIssues(eng.id);
      const prevIds = list.map((i) => i.carriedFrom).filter((x): x is string => !!x);
      const prevList = await listIssuesByIds(prevIds);
      const lg = await listIssueLogs([...list.map((i) => i.id), ...prevIds]);
      setIssues(list); setLogs(lg); setPrev(new Map(prevList.map((p) => [p.id, p])));
      if (!list.some((i) => i.status === '진행중') && list.length) setStatusF(null);
    } catch (e) { setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [eng.id]);

  const nextEng = engs.find((e) => e.entityId === eng.entityId && e.scope === eng.scope && e.fy === eng.fy + 1) ?? null;
  const openOnes = issues.filter((i) => i.status === '진행중');
  const shown = issues.filter((i) => !statusF || i.status === statusF);
  const cnt = (s: IssueStatus) => issues.filter((i) => i.status === s).length;
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function save(x: IssueInput) {
    setBusy(true); setErr(null);
    try {
      if (editing === 'new') { const c = await createIssue(eng.id, x); setOpen((o) => new Set(o).add(c.id)); }
      else if (editing) await updateIssue(editing, x, myName);
      setEditing(null); await load(); onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : '저장하지 못했습니다.'); } finally { setBusy(false); }
  }
  async function quickStatus(i: AuditIssue, s: IssueStatus) {
    setBusy(true); setErr(null);
    try { await updateIssue(i, { ...issueToInput(i), status: s }, myName); await load(); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : '바꾸지 못했습니다.'); } finally { setBusy(false); }
  }
  async function remove(i: AuditIssue) {
    if (!await confirmDanger({ title: '이슈를 지웁니다', target: `#${i.no} ${i.title}`, detail: '경과 기록도 함께 지워집니다. 잘못 만든 이슈만 지우십시오 — 끝난 이슈는 「완료」로 두는 것이 기록으로 남습니다.' })) return;
    setBusy(true); setErr(null);
    try { await deleteIssue(i.id); await load(); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : '지우지 못했습니다.'); } finally { setBusy(false); }
  }
  async function doCarry() {
    if (!nextEng) return;
    if (!await confirmDanger({
      title: `진행중 이슈 ${openOnes.length}건을 FY${nextEng.fy} 로 넘깁니다`, level: 'bulk',
      targets: openOnes.map((i) => `#${i.no} ${i.title}`),
      detail: `FY${eng.fy} 쪽 이슈는 「이월」로 닫히고, FY${nextEng.fy} ${nextEng.entityName} 에 진행중으로 새로 생깁니다. 지난 경과는 따라가 보입니다.`,
    })) return;
    setBusy(true); setErr(null);
    try { await carryOver(openOnes, nextEng.id, myName, nextEng.fy); await load(); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : '이월하지 못했습니다.'); } finally { setBusy(false); }
  }
  async function exportXlsx() {
    const XLSX = await import('xlsx');
    const head = ['#', '구분', '중요도', '검토사항', '관련 계정·주제', '인덕담당자', '회사담당자', '검토내용', '경과', '결론', '상태', '회사의사결정필요', '처리시점'];
    const rows = issues.map((i) => [
      i.no, i.category, i.importance, i.title, i.account ?? '', i.ourStaff.join('/'), i.clientContact ?? '', i.body,
      [...(i.carriedFrom ? logs.get(i.carriedFrom) ?? [] : []), ...(logs.get(i.id) ?? [])].map((l) => `${l.createdAt.slice(0, 10)} ${l.createdName ?? ''}: ${l.body}`).join('\n'),
      i.conclusion ?? '', i.status, i.decisionNeeded ? 'Y' : '', i.dueStage,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
    ws['!cols'] = [4, 6, 6, 30, 14, 14, 10, 50, 50, 30, 7, 8, 7].map((w) => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Issuelog_${eng.fy}`);
    XLSX.writeFile(wb, `ISSUELOG_${eng.entityName}_FY${eng.fy}_${eng.scope}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`);
  }

  if (loading) return <div className="card">불러오는 중…</div>;
  const chip = (on: boolean, n: number) => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--fs-1)',
    border: `1px solid ${on ? 'var(--navy)' : 'var(--rule)'}`, background: on ? 'var(--navy-bg)' : '#fff', color: 'var(--ink-2)',
    fontWeight: on ? 700 : 400, borderRadius: 999, padding: '2px 10px', opacity: n ? 1 : 0.5,
  } as const);
  const lastContact = [...issues].reverse().find((i) => i.clientContact)?.clientContact ?? '';

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <button style={chip(!statusF, issues.length)} onClick={() => setStatusF(null)}>전체 {issues.length}</button>
        {ISSUE_STATUSES.map((s) => (
          <button key={s} style={chip(statusF === s, cnt(s))} onClick={() => setStatusF(statusF === s ? null : s)}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: STATUS_STYLE[s].fg }} />{s} {cnt(s)}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {issues.length > 0 && <button className="btn-sm" onClick={() => void exportXlsx()}>엑셀로 내려받기</button>}
          {canWrite && openOnes.length > 0 && (nextEng
            ? <button className="btn-sm btn-sm-blue" disabled={busy} onClick={() => void doCarry()}>FY{nextEng.fy} 로 이월 ({openOnes.length})</button>
            : <span title={`FY${eng.fy + 1} ${eng.scope} 건을 주석·DSD 관리나 일반조서 관리에서 먼저 만들면 이월할 수 있습니다.`} style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-4)', alignSelf: 'center' }}>FY{eng.fy + 1} 건이 생기면 이월 가능</span>)}
          {canWrite && <button className="btn-sm btn-sm-navy" onClick={() => setEditing('new')}>＋ 이슈 추가</button>}
        </span>
      </div>
      {err && <div className="alert-w">{err}</div>}

      {shown.length === 0 ? (
        issues.length === 0
          ? <Empty text="아직 이슈가 없습니다" hint="감사하면서 나온 이슈를 하나씩 남겨 두면, 기말·강평·내년 감사 때 그대로 이어집니다." action={canWrite ? { label: '＋ 첫 이슈 추가', onClick: () => setEditing('new') } : undefined} />
          : <Empty text={`「${statusF}」 이슈가 없습니다`} action={{ label: '전체 보기', onClick: () => setStatusF(null) }} />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-2)', minWidth: 760 }}>
            <thead>
              <tr style={{ background: 'var(--surface-3)', color: 'var(--ink-2)', fontSize: 'var(--fs-1)' }}>
                {['#', '구분', '중요도', '검토사항', '인덕담당', '회사담당', '처리시점', '회사결정', '상태'].map((h) => (
                  <th key={h} style={{ textAlign: h === '검토사항' ? 'left' : 'center', padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid var(--rule)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => {
                const on = open.has(i.id);
                const pv = i.carriedFrom ? prev.get(i.carriedFrom) : undefined;
                const trail = [...(i.carriedFrom ? logs.get(i.carriedFrom) ?? [] : []).map((l) => ({ ...l, old: true })), ...(logs.get(i.id) ?? []).map((l) => ({ ...l, old: false }))];
                const td = { padding: '7px 8px', borderTop: '1px solid var(--rule)', textAlign: 'center' as const, whiteSpace: 'nowrap' as const };
                return [
                  <tr key={i.id} onClick={() => toggle(i.id)} style={{ cursor: 'pointer', background: on ? 'var(--navy-bg)' : '#fff' }}>
                    <td style={{ ...td, color: 'var(--ink-3)' }}>{i.no}</td>
                    <td style={td}>{i.category}</td>
                    <td style={{ ...td, color: IMP_COLOR[i.importance], fontWeight: 700 }}>{i.importance}</td>
                    <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal' }}>
                      <span style={{ fontWeight: 700, color: 'var(--navy)' }}>{i.title}</span>
                      {i.account && <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginLeft: 6 }}>· {i.account}</span>}
                      {pv && <span style={{ fontSize: 'var(--fs-1)', color: '#3730A3', marginLeft: 6 }}>↩ FY{eng.fy - 1}</span>}
                      {trail.length > 0 && <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-4)', marginLeft: 6 }}>경과 {trail.length}</span>}
                    </td>
                    <td style={td}>{i.ourStaff.join(', ')}</td>
                    <td style={td}>{i.clientContact}</td>
                    <td style={td}><span style={{ color: STAGE_COLOR[i.dueStage], fontWeight: 700 }}>{i.dueStage}</span></td>
                    <td style={{ ...td, color: '#DC2626', fontWeight: 700 }}>{i.decisionNeeded ? 'Y' : ''}</td>
                    <td style={td}><span style={{ background: STATUS_STYLE[i.status].bg, color: STATUS_STYLE[i.status].fg, borderRadius: 999, padding: '1px 9px', fontSize: 'var(--fs-1)', fontWeight: 700 }}>{i.status}</span></td>
                  </tr>,
                  on && (
                    <tr key={`${i.id}:d`}>
                      <td colSpan={9} style={{ padding: '4px 12px 14px 34px', borderTop: 0, background: 'var(--navy-bg)' }}>
                        <IssueDetail issue={i} trail={trail} canWrite={canWrite} busy={busy}
                          canDelete={canWrite && i.createdBy === myId}
                          onEdit={() => setEditing(i)} onStatus={(s) => void quickStatus(i, s)} onDelete={() => void remove(i)}
                          onLog={async (t) => { await addIssueLog(i.id, t, myName); await load(); }} />
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <IssueEditor
          initial={editing === 'new' ? emptyIssueInput({ clientContact: lastContact, ourStaff: myName ? [myName] : [], dueStage: '중간' }) : issueToInput(editing)}
          title={editing === 'new' ? `새 이슈 — ${eng.entityName} FY${eng.fy}` : `#${editing.no} 고치기`}
          busy={busy} onCancel={() => setEditing(null)} onSave={(x) => void save(x)} />
      )}
    </div>
  );
}

// ── 펼친 줄: 본문 · 결론 · 경과 ─────────────────────────────────────
function IssueDetail({ issue: i, trail, canWrite, canDelete, busy, onEdit, onStatus, onDelete, onLog }: {
  issue: AuditIssue; trail: (IssueLog & { old: boolean })[]; canWrite: boolean; canDelete: boolean; busy: boolean;
  onEdit: () => void; onStatus: (s: IssueStatus) => void; onDelete: () => void; onLog: (t: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const box = { background: '#fff', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', padding: '8px 10px', whiteSpace: 'pre-wrap' as const, lineHeight: 1.6, fontSize: 'var(--fs-2)' };
  const lbl = { fontSize: 'var(--fs-1)', color: 'var(--ink-3)', margin: '8px 0 3px', fontWeight: 600 };
  return (
    <div>
      <div style={lbl}>검토내용</div>
      <div style={box}>{i.body || <span style={{ color: 'var(--ink-4)' }}>(비어 있음)</span>}</div>
      {i.conclusion && <><div style={lbl}>결론</div><div style={{ ...box, borderColor: '#86EFAC' }}>{i.conclusion}</div></>}
      <div style={lbl}>경과</div>
      <div style={{ ...box, whiteSpace: 'normal', padding: '6px 10px' }}>
        {trail.length === 0 && <div style={{ color: 'var(--ink-4)' }}>아직 없음 — 회사와 주고받은 것, 확인한 것, 바뀐 것을 그때그때 남기세요.</div>}
        {trail.map((l) => (
          <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '128px 64px 1fr', gap: 8, padding: '3px 0', borderTop: '1px dashed var(--rule)', opacity: l.old ? 0.7 : 1 }}>
            <span style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-1)' }}>{fmt(l.createdAt)}{l.old ? ' (작년)' : ''}</span>
            <span style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-1)' }}>{l.createdName}</span>
            <span style={{ whiteSpace: 'pre-wrap', color: l.statusTo ? STATUS_STYLE[l.statusTo].fg : 'var(--ink-1)', fontWeight: l.statusTo ? 700 : 400 }}>{l.body}</span>
          </div>
        ))}
        {canWrite && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="경과 한 줄 — 예: 10/14 재무팀장과 통화, 평가보고서 11월 말 수령 예정"
              style={{ flex: 1, fontFamily: 'inherit', fontSize: 'var(--fs-2)', padding: '5px 8px', border: '1px solid var(--rule)', borderRadius: 4, resize: 'vertical' }} />
            <button className="btn-sm btn-sm-navy" disabled={!text.trim() || saving} style={{ alignSelf: 'stretch' }}
              onClick={async () => { setSaving(true); try { await onLog(text); setText(''); } finally { setSaving(false); } }}>{saving ? '…' : '남기기'}</button>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-4)' }}>
          {i.closedAt ? `닫힘 ${fmt(i.closedAt)} · ` : ''}고친 때 {fmt(i.updatedAt)}
        </span>
        {canWrite && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {i.status === '진행중' && <button className="btn-sm btn-sm-grn" disabled={busy} onClick={onStatus.bind(null, '완료')}>완료로</button>}
            {i.status !== '진행중' && <button className="btn-sm" disabled={busy} onClick={onStatus.bind(null, '진행중')}>다시 진행중으로</button>}
            <button className="btn-sm" disabled={busy} onClick={onEdit}>고치기</button>
            {canDelete && <button className="btn-sm btn-sm-del" disabled={busy} onClick={onDelete}>지우기</button>}
          </span>
        )}
      </div>
    </div>
  );
}

// ── 새 이슈 · 고치기 창 ─────────────────────────────────────────────
function IssueEditor({ initial, title, busy, onCancel, onSave }: {
  initial: IssueInput; title: string; busy: boolean; onCancel: () => void; onSave: (x: IssueInput) => void;
}) {
  const [x, setX] = useState<IssueInput>(initial);
  const [staffText, setStaffText] = useState(initial.ourStaff.join(', '));
  const set = <K extends keyof IssueInput>(k: K, v: IssueInput[K]) => setX((p) => ({ ...p, [k]: v }));
  const staff = staffText.split(/[,/]/).map((s) => s.trim()).filter(Boolean);
  const toggleStaff = (n: string) => setStaffText((staff.includes(n) ? staff.filter((s) => s !== n) : [...staff, n]).join(', '));
  const seg = <T extends string>(vals: readonly T[], cur: T, on: (v: T) => void, color?: (v: T) => string) => (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {vals.map((v) => (
        <button key={v} type="button" onClick={() => on(v)} className="btn-sm" style={cur === v ? { background: color?.(v) ?? 'var(--navy)', borderColor: color?.(v) ?? 'var(--navy)', color: '#fff', fontWeight: 700 } : undefined}>{v}</button>
      ))}
    </span>
  );
  const inp = { width: '100%', fontFamily: 'inherit', fontSize: 'var(--fs-2)', padding: '5px 8px', border: '1px solid var(--rule)', borderRadius: 4, boxSizing: 'border-box' as const };
  const ok = x.title.trim().length > 0;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="card" style={{ maxWidth: 640, width: '100%', maxHeight: '90vh', overflowY: 'auto', marginBottom: 0 }}>
        <div className="chdr">{title}</div>
        <div className="frow"><span className="fl">검토사항<span className="req">*</span></span>
          <input style={inp} value={x.title} autoFocus onChange={(e) => set('title', e.target.value)} placeholder="예: 영업권 손상평가 — 매드맨" /></div>
        <div className="frow"><span className="fl">구분</span>{seg(ISSUE_CATEGORIES, x.category, (v) => set('category', v))}</div>
        <div className="frow"><span className="fl">중요도</span>{seg(ISSUE_IMPORTANCE, x.importance, (v) => set('importance', v), (v) => IMP_COLOR[v])}</div>
        <div className="frow"><span className="fl">처리 시점</span>{seg(ISSUE_STAGES, x.dueStage, (v) => set('dueStage', v), (v) => STAGE_COLOR[v])}</div>
        <div className="frow"><span className="fl">관련 계정·주제</span>
          <input style={inp} value={x.account} onChange={(e) => set('account', e.target.value)} placeholder="예: 매출, 영업권, 리스, 법인세" /></div>
        <div className="frow"><span className="fl">인덕담당자</span>
          <span>
            <input style={inp} value={staffText} onChange={(e) => setStaffText(e.target.value)} placeholder="쉼표로 여럿" />
            <span style={{ display: 'inline-flex', gap: 4, marginTop: 4 }}>
              {CPA_OPTIONS.map((n) => <button key={n} type="button" className="btn-sm" onClick={() => toggleStaff(n)} style={staff.includes(n) ? { background: 'var(--navy-bg)', borderColor: 'var(--navy)', fontWeight: 700 } : undefined}>{n}</button>)}
            </span>
          </span></div>
        <div className="frow"><span className="fl">회사담당자</span>
          <input style={inp} value={x.clientContact} onChange={(e) => set('clientContact', e.target.value)} placeholder="예: 재무팀 임원규 이사" /></div>
        <div className="frow" style={{ alignItems: 'start' }}><span className="fl">검토내용</span>
          <textarea style={{ ...inp, resize: 'vertical' }} rows={5} value={x.body} onChange={(e) => set('body', e.target.value)}
            placeholder={'무엇이 문제이고 무엇을 봐야 하는지.\n이후 경과는 저장한 뒤 「경과」 칸에 날짜와 함께 남깁니다.'} /></div>
        <div className="frow"><span className="fl">회사 의사결정</span>
          <label style={{ fontSize: 'var(--fs-2)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={x.decisionNeeded} onChange={(e) => set('decisionNeeded', e.target.checked)} /> 회사의 결정이 필요한 이슈
          </label></div>
        <div className="frow"><span className="fl">상태</span>{seg(ISSUE_STATUSES.filter((s) => s !== '이월' || initial.status === '이월'), x.status, (v) => set('status', v), (v) => STATUS_STYLE[v].fg)}</div>
        <div className="frow" style={{ alignItems: 'start' }}><span className="fl">결론</span>
          <textarea style={{ ...inp, resize: 'vertical' }} rows={2} value={x.conclusion} onChange={(e) => set('conclusion', e.target.value)} placeholder="끝났으면 어떻게 정리됐는지" /></div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button className="btn-s" onClick={onCancel}>그만두기</button>
          <button className="btn-p" disabled={busy || !ok} onClick={() => onSave({ ...x, ourStaff: staff })}>{busy ? '저장 중…' : '저장'}</button>
        </div>
      </div>
    </div>
  );
}

// ── 모든 회사의 진행중 이슈 ─────────────────────────────────────────
function OpenBoard({ engs, onPick }: { engs: Engagement[]; onPick: (engId: string) => void }) {
  const [rows, setRows] = useState<AuditIssue[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [decisionOnly, setDecisionOnly] = useState(false);
  useEffect(() => { listOpenIssues().then(setRows).catch((e) => setErr(e instanceof Error ? e.message : '불러오지 못했습니다.')); }, []);
  const byId = useMemo(() => new Map(engs.map((e) => [e.id, e])), [engs]);
  if (err) return <div className="card" style={{ color: 'var(--bad)' }}>{err}</div>;
  if (!rows) return <div className="card">불러오는 중…</div>;
  const list = rows.filter((r) => byId.has(r.engagementId) && (!stage || r.dueStage === stage) && (!decisionOnly || r.decisionNeeded));
  const groups = new Map<string, AuditIssue[]>();
  for (const r of list) groups.set(r.engagementId, [...(groups.get(r.engagementId) ?? []), r]);
  const order = [...groups.keys()].sort((a, b) => (byId.get(a)!.entityName).localeCompare(byId.get(b)!.entityName, 'ko'));
  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>처리 시점</span>
        <button className={!stage ? 'btn-sm btn-sm-navy' : 'btn-sm'} onClick={() => setStage(null)}>전체</button>
        {ISSUE_STAGES.map((s) => <button key={s} className={stage === s ? 'btn-sm btn-sm-navy' : 'btn-sm'} onClick={() => setStage(stage === s ? null : s)}>{s}</button>)}
        <label style={{ marginLeft: 12, fontSize: 'var(--fs-2)', display: 'flex', gap: 5, alignItems: 'center' }}>
          <input type="checkbox" checked={decisionOnly} onChange={(e) => setDecisionOnly(e.target.checked)} /> 회사 의사결정 필요만
        </label>
        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>{order.length}개 회사 · {list.length}건</span>
      </div>
      {list.length === 0 ? <Empty text="진행중 이슈가 없습니다" hint={stage || decisionOnly ? '거른 조건을 풀어 보세요.' : '회사별 화면에서 이슈를 추가하면 여기 모입니다.'} /> : order.map((id) => {
        const e = byId.get(id)!;
        return (
          <div key={id} style={{ marginBottom: 10 }}>
            <button onClick={() => onPick(id)} style={{ border: 0, background: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '2px 0', fontSize: 'var(--fs-3)', fontWeight: 700, color: 'var(--navy)' }}>
              {e.entityName} <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>FY{e.fy} {e.scope} · 열기 ›</span>
            </button>
            {groups.get(id)!.map((i) => (
              <div key={i.id} style={{ display: 'grid', gridTemplateColumns: '34px 40px 1fr auto auto', gap: 8, alignItems: 'center', padding: '4px 0 4px 8px', borderTop: '1px solid var(--rule)', fontSize: 'var(--fs-2)' }}>
                <span style={{ color: 'var(--ink-3)' }}>#{i.no}</span>
                <span style={{ color: IMP_COLOR[i.importance], fontWeight: 700 }}>{i.importance}</span>
                <span><b style={{ color: 'var(--ink-1)' }}>{i.title}</b>{i.ourStaff.length > 0 && <span style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-1)', marginLeft: 6 }}>{i.ourStaff.join(', ')}</span>}</span>
                <span style={{ color: '#DC2626', fontWeight: 700, fontSize: 'var(--fs-1)' }}>{i.decisionNeeded ? '회사결정' : ''}</span>
                <span style={{ color: STAGE_COLOR[i.dueStage], fontWeight: 700, fontSize: 'var(--fs-1)' }}>{i.dueStage}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
