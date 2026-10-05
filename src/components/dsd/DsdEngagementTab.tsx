// 주석·DSD 관리 — 회사 고르기 + 감사 흐름 네 단계
//
//   ① 작년 보고서   — 작년 감사보고서(.dsd) 올리기 + 그 해에 쓰는 주석 목록
//   ② 중간감사      — 주석 엑셀(정산표에 얹기) · 사전작성 DSD
//   ③ 기말감사      — 채운 엑셀 검증
//   ④ 보고서        — DSD 완성본 + 표준주석엑셀 등록(내년용)
// (2026-10-05 재편 — 사용자 「감사의 전체적인 흐름을 감안하여 순서 검토」. 전에는 ① 대상 ② 준비 ③ 검증 ④ DSD 였고
//  작년 DSD 올리기는 탭 위에, 표준주석엑셀은 ① 에 있었다.)
//
// ⚠️ 재무제표 파일은 서버에 올리지 않는다. 엑셀도 DSD 도 브라우저 안에서 열고 끝낸다.
//
// 주석을 찾는 열쇠는 **제목**이다 — ②③④ 가 제목으로 짝을 짓는다(notePick). 주석 번호는
// 하나가 빠지면 통째로 밀려서(올해 17번 무형자산이 내년엔 16번) 열쇠가 될 수 없다.
import { useEffect, useMemo, useState } from 'react';
import Empty from '../common/Empty';
import { confirmDanger } from '../common/DangerConfirm';
import { useAuth } from '../../context/AuthContext';
import { listBizEntities, type BizEntityFull } from '../../lib/bizRegistryApi';
import {
  listEngagements, updateEngagement, deleteEngagement,
  listNotes, replaceNotes, listAuditEntityIds, setDemo,
  type Engagement, type NoteRow, type Basis, type SheetLayout,
} from '../../lib/dsdApi';
import { getNoteBook, type NoteBook } from '../../lib/dsdBookApi';
import { LAYOUT_LABEL } from '../../lib/notePick';
import NoteBookCard from './NoteBookCard';
import {
  suggestCode, renumber, progress,
  defaultAuditFy, DEFAULT_STATUS, DSD_PROGRESS, dsdProgressOf, type DsdProgressKey,
} from '../../lib/dsdNotes';
import NewEngagementModal from './NewEngagementModal';
import NotePrepareTab from './NotePrepareTab';
import NoteVerifyCard, { type Filled } from './NoteVerifyCard';
import NoteDsdCard from './NoteDsdCard';
import {
  useDsdFile, DsdBar, DsdTabs, NeedDsd, WorkSettings, StepHead, More, type TabDef, type NoteFrom,
} from './DsdShell';
import DateParts from '../common/DateParts';
import { pickEngagementFor, takePickedEngagement } from '../gwp/WtbTab';

const TABS: TabDef[] = [
  { key: '1', no: '①', label: '작년 보고서', when: '준비 · 주석 목록' },
  { key: '2', no: '②', label: '주석 엑셀 준비', when: '중간감사', needsDsd: true },
  { key: '3', no: '③', label: '검증', when: '기말감사', needsDsd: true },
  { key: '4', no: '④', label: 'DSD 완성', when: '보고서', needsDsd: true },
];

const STATUS_TONE: Record<string, { bg: string; ink: string }> = {
  미할당: { bg: '#EEF0F3', ink: 'var(--ink-3)' },
  작업중: { bg: '#E6F0FC', ink: '#2F7BD8' },
  작업완료: { bg: 'var(--good-bg)', ink: 'var(--good)' },
  작성제외: { bg: '#F4F4F4', ink: 'var(--ink-4)' },
};

export default function DsdEngagementTab({ onNavigate }: { onNavigate?: (tab: string) => void } = {}) {
  // 외부인 시연 — 「시연용」 표가 붙은 건 하나만 서버가 내준다(0145). 화면에서는 **보기만**
  // 하게 막는다. 쓰기는 RLS 가 이미 막지만, 눌러도 안 되는 단추를 내놓을 까닭이 없다.
  const { role, readonly } = useAuth();
  const isExternal = role === 'external';
  // 서버에 쓰는 것(새 건·건 지우기·① 입력·④ 저장)은 외부인과 쓰기 잠금 계정에게 잠근다. ②③④ 의 브라우저 안 작업은 그대로.
  const lockWrite = isExternal || readonly;
  const isSuper = role === 'superuser';
  const [engs, setEngs] = useState<Engagement[]>([]);
  const [ents, setEnts] = useState<BizEntityFull[]>([]);
  const [auditIds, setAuditIds] = useState<Set<string>>(new Set());
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [at, setAt] = useState('1');
  const [listOpen, setListOpen] = useState(true);
  const [progFilter, setProgFilter] = useState<DsdProgressKey | null>(null);
  // 작년 감사보고서와 「채워 넣은 엑셀」은 **탭들이 함께 쓴다** — 같은 파일을 세 번 고르지 않는다.
  const dsdFile = useDsdFile();
  const [filled, setFilled] = useState<Filled | null>(null);
  // ②③④ 공통 설정 — 셋이 같아야 자리가 맞는다(DsdShell.WorkSettings).
  const [from, setFrom] = useState<NoteFrom>('list');
  const [spare, setSpare] = useState(3);
  const [roll, setRoll] = useState(true);
  // 고른 건에 등록된 표준주석엑셀 — ④ 가 보여 주고 등록한다.
  const [book, setBook] = useState<NoteBook | null>(null);
  // ① 목록이 비면 고를 것이 없다. 첫 해거나, 남의 보고서를 그냥 떠 보는 자리다.
  const useFrom: NoteFrom = notes.length === 0 ? 'file' : from;

  async function load(keep?: string) {
    try {
      setErr(null);
      // 외부인은 「새 건 만들기」를 못 하므로 거래처·감사계약을 물을 일이 없다.
      const [list, es, aud] = await Promise.all([
        listEngagements(),
        isExternal ? Promise.resolve([]) : listBizEntities(),
        isExternal ? Promise.resolve(new Set<string>()) : listAuditEntityIds(),
      ]);
      setEngs(list);
      setEnts(es);
      setAuditIds(aud);
      // 다른 화면(📒 정산표 관리)에서 「주석·DSD 관리로」를 누르고 오면 그 회사를 골라 둔다.
      const want = takePickedEngagement();
      const id = keep ?? (want && list.some((e) => e.id === want) ? want : null) ?? pickedId ?? null;
      if (want && id === want) setListOpen(false);
      setPickedId(id);
      setNotes(id ? await listNotes(id) : []);
      setBook(id ? await getNoteBook(id).catch(() => null) : null);
      setDirty(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const picked = useMemo(() => engs.find((e) => e.id === pickedId) ?? null, [engs, pickedId]);
  // **사업연도로 거른다.** 해가 쌓이면 목록이 끝없이 길어진다(사용자 지적 2026-09-13).
  const years = useMemo(() => [...new Set(engs.map((e) => e.fy))].sort((a, b) => b - a), [engs]);
  const [fyAt, setFyAt] = useState<number | null>(null);
  const fy = fyAt ?? years[0] ?? defaultAuditFy();
  const inYear = useMemo(
    () => engs.filter((e) => e.fy === fy).sort((a, b) => Number(a.isDemo) - Number(b.isDemo) || a.entityName.localeCompare(b.entityName, 'ko')),
    [engs, fy],
  );
  const prog = useMemo(() => progress(notes), [notes]);
  const progOf = (e: Engagement) => {
    // 고른 건은 화면의 주석 목록(저장 전 포함)으로 센다.
    const p = e.id === pickedId ? { on: prog.total, done: prog.done } : { on: e.onCount, done: e.doneCount };
    return dsdProgressOf(p.on, p.done, e.status);
  };

  async function pick(id: string) {
    if (dirty && !window.confirm('저장하지 않은 주석 목록이 있습니다. 그냥 옮길까요?')) return;
    setPickedId(id);
    setNotes(await listNotes(id));
    setBook(await getNoteBook(id).catch(() => null));
    setDirty(false); setEditing(false); setListOpen(false); setAt('1');
    // 다른 회사로 옮기면 올려 둔 파일은 그 회사 것이 아니다.
    if (dsdFile.dsd) dsdFile.clear();
    setFilled(null);
  }

  function edit(code: string, patch: Partial<NoteRow>) {
    setNotes((prev) => renumber(prev.map((n) => (n.code === code ? { ...n, ...patch } : n))));
    setDirty(true);
  }

  async function save() {
    if (!picked) return;
    try {
      await replaceNotes(picked.id, notes);
      setDirty(false); setEditing(false);
      setMsg('주석 목록을 저장했습니다.');
      await load(picked.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장하지 못했습니다.');
    }
  }

  async function cancelEdit() {
    if (dirty && !window.confirm('고친 것을 버릴까요?')) return;
    if (picked) setNotes(await listNotes(picked.id));
    setDirty(false); setEditing(false);
  }

  async function removeEng(e: Engagement) {
    const ok = await confirmDanger({
      level: 'delete',
      title: '이 작업 건을 지웁니다',
      target: `${e.entityName} · FY${e.fy} ${e.scope}`,
      detail: `주석 ${e.noteCount}개가 함께 지워집니다. 재무제표 파일은 애초에 저장하지 않았으므로 사라지는 것은 주석 목록과 대응 규칙입니다.`,
    });
    if (!ok) return;
    await deleteEngagement(e.id);
    setPickedId(null); setListOpen(true);
    await load();
    setMsg('지웠습니다.');
  }

  function addNote() {
    const title = window.prompt('새 주석 제목');
    if (!title?.trim()) return;
    const basis = picked?.basis ?? 'K-IFRS';
    let code = suggestCode(title.trim(), basis);
    while (notes.some((n) => n.code === code)) code += '_2';
    setNotes((prev) => renumber([...prev, {
      code, no: null, title: title.trim(), sheet: null, enabled: true,
      source: '감사인', assignee: null, status: DEFAULT_STATUS, memo: null,
      sortOrder: (prev.at(-1)?.sortOrder ?? 0) + 10,
    }]));
    setDirty(true);
  }

  const upd = (patch: Parameters<typeof updateEngagement>[1]) => picked && void updateEngagement(picked.id, patch).then(() => load(picked.id));

  if (loading) return <div className="card">불러오는 중…</div>;

  const counts = new Map<DsdProgressKey, number>();
  for (const e of inYear) { const k = progOf(e); counts.set(k, (counts.get(k) ?? 0) + 1); }
  const shown = picked && !listOpen ? inYear.filter((e) => e.id === picked.id) : inYear.filter((e) => !progFilter || progOf(e) === progFilter);
  const chip = (on: boolean, n: number) => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, cursor: n ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 'var(--fs-1)',
    border: `1px solid ${on ? 'var(--navy)' : 'var(--rule)'}`, background: on ? 'var(--navy-bg)' : '#fff', color: 'var(--ink-2)',
    fontWeight: on ? 700 : 400, borderRadius: 999, padding: '2px 10px', opacity: n ? 1 : 0.45,
  } as const);

  return (
    <div>
      <div className="card">
        <div className="chdr">
          📗 주석·DSD 관리
          <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>
            {picked ? `${picked.entityName} · FY${picked.fy} ${picked.scope}` : '회사를 고르세요'}
          </span>
          {!lockWrite && (
            <button className="btn-sm btn-sm-navy" style={{ marginLeft: 'auto' }} onClick={() => setAdding(true)}>+ 새 건 만들기</button>
          )}
        </div>
        <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7 }}>
          <b>작년 감사보고서(DSD)를 틀로</b> — 중간감사 때 주석 엑셀을 만들어 두고, 기말감사 때 채운 엑셀을 검증해 DSD 완성본을 냅니다.
        </div>
        <More>
          ① 에서 작년 감사보고서를 한 번 올리면 ②③④ 가 함께 씁니다. ② 가 내는 <b>사전작성 DSD</b> 는 나갈 때 들고 가는 껍데기이고,
          ④ 완성본은 언제나 작년 감사보고서를 틀로 씁니다. 작년 것이 <b>없어도</b> ③ 은 쓸 수 있습니다 — 다 적힌 당기 DSD 를 ① 에 올리면
          그 파일을 그대로 훑습니다(회사가 주석을 지어 주거나 초도감사라 손으로 짠 경우). 파일은 서버에 올리지 않습니다 — 브라우저 안에서만 열립니다.
        </More>
      </div>

      {err && <div className="card" style={{ color: 'var(--bad)', background: 'var(--bad-bg)' }}>{err}</div>}
      {msg && (
        <div className="card" style={{ color: 'var(--good)', background: 'var(--good-bg)', display: 'flex' }}>
          {msg}
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setMsg(null)}>닫기</button>
        </div>
      )}

      {/* ── 회사 목록 — 일반조서 관리처럼 한 줄씩, 진행 색 ─────────────── */}
      <div className="card" style={{ padding: '10px 12px 12px' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 9 }}>
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', letterSpacing: '.04em' }}>사업연도</span>
          {years.map((y) => (
            <button key={y} onClick={() => { setFyAt(y); setListOpen(true); setProgFilter(null); }} style={{
              cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--fs-1)',
              border: `1px solid ${y === fy ? 'var(--navy)' : 'var(--rule)'}`, background: y === fy ? 'var(--navy)' : '#fff',
              color: y === fy ? '#fff' : 'var(--ink-2)', fontWeight: y === fy ? 700 : 400, borderRadius: 999, padding: '3px 11px',
            }}>FY{y}<span style={{ opacity: 0.7, marginLeft: 6, fontWeight: 400 }}>· {engs.filter((e) => e.fy === y).length}건</span></button>
          ))}
        </div>
        {engs.length === 0 && <Empty text="아직 없습니다. 「새 건 만들기」로 시작하세요." />}
        {inYear.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
              <button style={chip(!progFilter, inYear.length)} onClick={() => { setProgFilter(null); setListOpen(true); }}>전체 {inYear.length}</button>
              {(Object.keys(DSD_PROGRESS) as DsdProgressKey[]).map((k) => (
                <button key={k} style={chip(progFilter === k, counts.get(k) ?? 0)} disabled={!counts.get(k)}
                  title={`${DSD_PROGRESS[k].label}인 회사만 보기 — 다시 누르면 전체`}
                  onClick={() => { setProgFilter(progFilter === k ? null : k); setListOpen(true); }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: DSD_PROGRESS[k].color }} />{DSD_PROGRESS[k].label} {counts.get(k) ?? 0}
                </button>
              ))}
              {picked && (
                <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setListOpen(!listOpen)}>
                  {listOpen ? '목록 접기 ▲' : `다른 회사 고르기 ▼ (${inYear.length - 1})`}
                </button>
              )}
            </div>
            <div style={{ border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
              {shown.map((e, i) => {
                const k = progOf(e); const pg = DSD_PROGRESS[k];
                const on = e.id === pickedId;
                const cnt = e.id === pickedId ? { on: prog.total, done: prog.done } : { on: e.onCount, done: e.doneCount };
                return (
                  <button key={e.id} onClick={() => void pick(e.id)} style={{
                    display: 'grid', gridTemplateColumns: '6px minmax(0, 1fr) 150px auto auto', gap: 10, alignItems: 'center', width: '100%',
                    textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', border: 0, borderTop: i ? '1px solid var(--rule)' : 0,
                    background: on ? 'var(--navy-bg)' : '#fff', padding: '7px 10px 7px 0',
                  }}>
                    <span style={{ alignSelf: 'stretch', background: pg.color }} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--navy)' }}>{e.entityName}</span>
                      <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginLeft: 8 }}>
                        {e.scope} · {e.moneyUnit}{cnt.on ? ` · 주석 ${cnt.on}` : ''}
                      </span>
                      {e.isDemo && <span style={{ marginLeft: 6, fontSize: 'var(--fs-0)', fontWeight: 700, color: 'var(--warn)' }}>시연용</span>}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {cnt.on > 0 && (
                        <>
                          <span style={{ flex: 1, height: 6, background: 'var(--rule-2)', borderRadius: 3, overflow: 'hidden' }}>
                            <span style={{ display: 'block', width: `${Math.round((cnt.done / cnt.on) * 100)}%`, height: '100%', background: pg.color }} />
                          </span>
                          <span style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{cnt.done}/{cnt.on}</span>
                        </>
                      )}
                    </span>
                    <span style={{ fontSize: 'var(--fs-1)', fontWeight: 700, color: '#fff', background: pg.color, borderRadius: 999, padding: '1px 9px', whiteSpace: 'nowrap' }}>{pg.label}</span>
                    <span style={{ color: 'var(--ink-4)', fontSize: 'var(--fs-1)' }}>{on ? '●' : '›'}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {!picked ? (
        <div className="card"><Empty text="위에서 회사를 고르세요." /></div>
      ) : (
        <>
          <DsdTabs tabs={TABS} at={at} go={setAt} hasDsd={!!dsdFile.dsd} />

          {at !== '1' && !dsdFile.dsd && <NeedDsd goFirst={() => setAt('1')} />}
          {at !== '1' && dsdFile.dsd && (
            <WorkSettings
              dsd={dsdFile.dsd} from={useFrom} set={setFrom} spare={spare} setSpare={setSpare}
              listCount={notes.length} fileCount={dsdFile.dsd.blocks.length}
              layout={picked.sheetLayout} roll={roll} setRoll={setRoll} goFirst={() => setAt('1')}
            />
          )}
          {at === '2' && dsdFile.dsd && (
            <NotePrepareTab onWtb={() => { pickEngagementFor(picked.id); onNavigate?.('wtb'); }} eng={picked} notes={notes} dsd={dsdFile.dsd} from={useFrom} spare={spare} layout={picked.sheetLayout} roll={roll}
              canWrite={!lockWrite} onStarted={() => void listEngagements().then(setEngs).catch(() => undefined)} />
          )}
          {at === '3' && dsdFile.dsd && (
            <NoteVerifyCard notes={notes} dsd={dsdFile.dsd} xl={filled} setXl={setFilled} from={useFrom} spare={spare} layout={picked.sheetLayout} roll={roll} />
          )}
          {at === '4' && dsdFile.dsd && (
            <>
              <NoteDsdCard eng={picked} notes={notes} dsd={dsdFile.dsd} xl={filled} setXl={setFilled} from={useFrom} spare={spare}
                layout={picked.sheetLayout} book={book} onBook={setBook} readOnly={lockWrite} roll={roll} />
              <div className="card">
                <StepHead no="+" title="내년 준비 · 표준주석엑셀" when="완성 뒤"
                  line="DSD 까지 낸 엑셀을 등록해 두면, 내년 ② 가 노란 칸의 수식(정산표 링크)을 그대로 이어받습니다." />
                <NoteBookCard eng={picked} book={book} onChange={setBook} readOnly={lockWrite} />
              </div>
            </>
          )}

          <div className="card" style={{ display: at === '1' ? 'block' : 'none' }}>
            <StepHead no="①" title="작년 보고서 · 주석 목록" when="준비"
              line={<>작년 감사보고서(.dsd)를 올리고, 올해 쓸 <b>주석 목록</b>을 확인합니다. 끈 주석은 ②③④ 에서 빠집니다.</>}
              right={(
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {picked.isDemo && <span style={{ padding: '2px 9px', borderRadius: 999, fontSize: 'var(--fs-0)', fontWeight: 700, background: 'var(--warn-bg)', color: 'var(--warn)' }}>시연용</span>}
                  {isSuper && (
                    <label style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }} title="켜면 외부인이 이 건과 주석 목록을 읽을 수 있습니다. 시연용 가짜 거래처에만 켜세요.">
                      <input type="checkbox" checked={picked.isDemo} onChange={(ev) => void setDemo(picked.id, ev.target.checked).then(() => load(picked.id))} /> 외부인에게 보여 주기
                    </label>
                  )}
                  {!lockWrite && <button className="btn-sm btn-sm-del" onClick={() => void removeEng(picked)}>건 지우기</button>}
                </span>
              )}
            />

            <DsdBar {...dsdFile} expect={picked.entityName} />

            {isExternal && (
              <div style={{ margin: '10px 0', padding: '9px 11px', borderRadius: 'var(--r-sm)', lineHeight: 1.7, background: 'var(--warn-bg)', color: 'var(--warn)', fontSize: 'var(--fs-2)' }}>
                <b>시연용 화면입니다.</b> 주석 목록은 보기만 됩니다. ②③④ 는 전부 써 보실 수 있습니다 — 서버를 쓰지 않고, 올리신 파일은 이 브라우저 밖으로 나가지 않습니다.
              </div>
            )}

            {/* 외부인에게는 통째로 잠근다 — 안의 입력·단추가 한꺼번에 꺼진다. */}
            <fieldset disabled={lockWrite} style={{ border: 0, padding: 0, margin: '12px 0 0', minWidth: 0 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)' }}>
                <Field label="회계기준">
                  <select className="btn-sm" value={picked.basis} onChange={(ev) => upd({ basis: ev.target.value as Basis })}>
                    <option>K-IFRS</option><option>일반기업회계기준</option>
                  </select>
                </Field>
                <Field label="금액 단위" hint={`엑셀엔 원(장부값)으로 쓰고 DSD 에는 ${picked.moneyUnit}으로 내보냅니다. 주식수·지분율·외화는 환산하지 않습니다.`}>
                  <select className="btn-sm" value={picked.moneyUnit} onChange={(ev) => upd({ moneyUnit: ev.target.value as '천원' | '원' })}>
                    <option>천원</option><option>원</option>
                  </select>
                </Field>
                <Field label="시트 구성" hint="② 로 엑셀을 만든 뒤에는 바꾸지 마십시오 — ③④ 가 이 값으로 시트를 찾습니다.">
                  <select className="btn-sm" value={picked.sheetLayout} onChange={(ev) => upd({ sheetLayout: ev.target.value as SheetLayout })}>
                    <option value="sheets">{LAYOUT_LABEL.sheets}</option>
                    <option value="long">{LAYOUT_LABEL.long}</option>
                  </select>
                </Field>
                <Field label="대상기간">
                  <DateParts value={picked.periodFrom ?? ''} onChange={(val) => { if (val) upd({ periodFrom: val }); }} />
                  <span style={{ color: 'var(--ink-3)' }}>~</span>
                  <DateParts value={picked.periodTo ?? ''} onChange={(val) => { if (val) upd({ periodTo: val }); }} />
                </Field>
                <Field label="상태">
                  <select className="btn-sm" value={picked.status} onChange={(ev) => upd({ status: ev.target.value as Engagement['status'] })}>
                    <option>준비</option><option>진행</option><option>완료</option>
                  </select>
                </Field>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 6px', flexWrap: 'wrap' }}>
                <b style={{ fontSize: 'var(--fs-3)', color: 'var(--navy)' }}>주석 목록</b>
                <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>켜 둔 {prog.total}개 · 작업완료 {prog.done}</span>
                <span style={{ width: 120, height: 7, background: 'var(--rule-2)', borderRadius: 4, overflow: 'hidden' }}>
                  <span style={{ display: 'block', width: `${prog.pct}%`, height: '100%', background: 'var(--good)' }} />
                </span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                  {editing ? (
                    <>
                      <button className="btn-sm" onClick={addNote}>+ 주석 추가</button>
                      <span style={{ fontSize: 'var(--fs-1)', color: dirty ? 'var(--warn)' : 'var(--ink-4)' }}>{dirty ? '저장하지 않은 변경' : ''}</span>
                      <button className="btn-sm" onClick={() => void cancelEdit()}>취소</button>
                      <button className="btn-sm btn-sm-navy" disabled={!dirty} onClick={() => void save()}>저장</button>
                    </>
                  ) : (
                    !lockWrite && <button className="btn-sm btn-sm-navy" onClick={() => setEditing(true)}>✏️ 편집</button>
                  )}
                </span>
              </div>

              {notes.length === 0 ? (
                <Empty text="주석 목록이 없습니다" hint="「편집 → + 주석 추가」로 넣거나, 비워 두면 ②③④ 가 올린 파일의 주석을 전부 씁니다." />
              ) : (
                <div className="tbl-wide">
                  <table className="tbl">
                    <thead>
                      <tr style={{ background: 'var(--surface-2)' }}>
                        <th style={{ width: 44 }}>번호</th>
                        <th style={{ minWidth: 200 }}>제목</th>
                        {editing && <th style={{ width: 62 }}>시트</th>}
                        <th style={{ width: 52 }} title="끄면 ②③④ 에서 빠지고 번호가 다시 매겨집니다">쓰기</th>
                        <th style={{ width: 74 }} title="회사가 직접 쓰는 주석은 대조 대상에서 뺍니다">작성</th>
                        <th style={{ width: 90 }}>담당</th>
                        <th style={{ width: 96 }}>상태</th>
                        <th style={{ minWidth: 130 }}>메모</th>
                      </tr>
                    </thead>
                    <tbody>
                      {notes.map((n) => (
                        <tr key={n.code} style={{ opacity: n.enabled ? 1 : 0.45 }}>
                          <td style={{ textAlign: 'center', color: 'var(--ink-3)' }}>{n.no ?? '—'}</td>
                          {editing ? (
                            <>
                              <td><input className="btn-sm" style={{ width: '100%', textAlign: 'left' }} value={n.title} onChange={(ev) => edit(n.code, { title: ev.target.value })} /></td>
                              <td><input className="btn-sm" style={{ width: '100%', textAlign: 'left' }} value={n.sheet ?? ''} placeholder="N01" onChange={(ev) => edit(n.code, { sheet: ev.target.value })} /></td>
                              <td style={{ textAlign: 'center' }}><input type="checkbox" checked={n.enabled} onChange={(ev) => edit(n.code, { enabled: ev.target.checked })} /></td>
                              <td>
                                <select className="btn-sm" style={{ width: '100%' }} value={n.source} onChange={(ev) => edit(n.code, { source: ev.target.value as NoteRow['source'] })}>
                                  <option>감사인</option><option>회사</option>
                                </select>
                              </td>
                              <td><input className="btn-sm" style={{ width: '100%', textAlign: 'left' }} value={n.assignee ?? ''} onChange={(ev) => edit(n.code, { assignee: ev.target.value })} /></td>
                              <td>
                                <select className="btn-sm" style={{ width: '100%', color: STATUS_TONE[n.status]?.ink }} value={n.status} onChange={(ev) => edit(n.code, { status: ev.target.value as NoteRow['status'] })}>
                                  <option>미할당</option><option>작업중</option><option>작업완료</option><option>작성제외</option>
                                </select>
                              </td>
                              <td><input className="btn-sm" style={{ width: '100%', textAlign: 'left' }} value={n.memo ?? ''} onChange={(ev) => edit(n.code, { memo: ev.target.value })} /></td>
                            </>
                          ) : (
                            <>
                              <td style={{ fontWeight: 600, color: 'var(--ink)' }}>{n.title}</td>
                              <td style={{ textAlign: 'center', color: n.enabled ? 'var(--good)' : 'var(--ink-4)' }}>{n.enabled ? '✓' : '빠짐'}</td>
                              <td style={{ color: n.source === '회사' ? 'var(--warn)' : 'var(--ink-2)' }}>{n.source}</td>
                              <td style={{ color: n.assignee ? 'var(--ink)' : 'var(--ink-4)' }}>{n.assignee || '—'}</td>
                              <td>
                                <span style={{ fontSize: 'var(--fs-1)', fontWeight: 700, borderRadius: 999, padding: '1px 9px', background: STATUS_TONE[n.status]?.bg, color: STATUS_TONE[n.status]?.ink }}>{n.status}</span>
                              </td>
                              <td style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-1)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={n.memo ?? ''}>{n.memo || ''}</td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </fieldset>

            {dsdFile.dsd && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="btn-p" onClick={() => setAt('2')}>다음 — ② 중간감사 · 주석 엑셀 준비 ›</button>
              </div>
            )}
          </div>
        </>
      )}

      {adding && (
        <NewEngagementModal
          entities={ents}
          auditIds={auditIds}
          onClose={() => setAdding(false)}
          onDone={async (id) => { setAdding(false); await load(id); setListOpen(false); setMsg('작업 건을 만들었습니다.'); }}
          onError={(m) => setErr(m)}
        />
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 5 }} title={hint}>
      <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{label}{hint ? ' ⓘ' : ''}</span>
      {children}
    </label>
  );
}
