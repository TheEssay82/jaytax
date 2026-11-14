// 감사업무관리 › 📅 기말감사일정 — 감사 대상 연도의 다음 해 1~3월 달력에 회사 × 업무를 배정한다(사용자 2026-11-15).
//
// 원본은 엑셀 「거래처관리등_FY26.xlsx」 [기말일정검토26](2026-11-04 v9) · [기말일정검토25](FY2025 실제, 마감). 사용자 원칙:
//   배정=노랑 · 확정=녹색 · 같은 날 필드가 팀 수보다 많으면 분홍 · 날짜 머리칸도 그날 색(넘겨도 보이게).
//   외감·상장 3/23 이전 · PEF·SPC 주말 · 착수 1/25 · 설 전날·다음날 곤란. 재고실사는 팀 겹침에서 뺀다.
//   나가는 사람은 성 한 글자 아이콘(조·김·정·윤) — 기말감사는 줄마다, 재고실사는 날마다 다르다.
//   상장사는 주총 6주 전까지 제시재무제표를 증선위에 낸다 — 🚩.
import { useEffect, useMemo, useRef, useState } from 'react';
import Loading from '../common/Loading';
import { confirmDanger } from '../common/DangerConfirm';
import { useAuth } from '../../context/AuthContext';
import {
  PEOPLE, SCHEDULE_KINDS, SCHEDULE_TASKS, WEEKDAYS, calendarDays, capacity, cellTone, checkItem, dayOrdinal, dayStats, dayTitle,
  defaultStaff, fsDueDate, headTone, isInventory, nameKey, parseMark, personDays, sortItems,
  type CellTone, type ScheduleItem, type ScheduleKind, type ScheduleSetting, type SortMode,
} from '../../lib/auditSchedule';
import {
  addItem, auditContractsFor, deleteItem, getSetting, guessKind, listAgm, listSchedule, saveAgm, saveSetting, setDay, updateItem,
} from '../../lib/auditScheduleApi';

const TONE: Record<CellTone, { bg: string; fg: string } | null> = {
  none: null,
  assigned: { bg: '#FFEB9C', fg: '#7A5B00' },
  confirmed: { bg: '#C6EFCE', fg: '#0B6B2B' },
  overlap: { bg: '#FFC7CE', fg: '#9C0006' },
};
const KIND_COLOR: Record<ScheduleKind, string> = { 상장: '#7C3AED', 외감: '#1f5f8b', 임의: '#12A38A', PEF: '#B45309', SPC: '#A16207', 용역: '#6B7280' };
const PCOLOR = Object.fromEntries(PEOPLE.map((p) => [p.k, p.bg])) as Record<string, string>;
const PNAME = Object.fromEntries(PEOPLE.map((p) => [p.k, p.name])) as Record<string, string>;
const W = 28;    // 날짜 칸 폭
const COLS = [28, 150, 60, 82, 88, 48, 36, 96];   // 확정 · 회사 · 구분 · 업무구분 · 인원 · 소요 · 배정 · 점검
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 사람 아이콘 — 성 한 글자 동그라미. */
function Badge({ k, size = 15, off = false, onClick }: { k: string; size?: number; off?: boolean; onClick?: () => void }) {
  return (
    <span title={PNAME[k] ?? k} onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, borderRadius: '50%',
      background: off ? 'transparent' : PCOLOR[k] ?? '#888', color: off ? '#bbb' : '#fff', border: off ? '1px dashed #ccc' : 'none',
      fontSize: Math.round(size * 0.62), fontWeight: 700, lineHeight: 1, cursor: onClick ? 'pointer' : 'default', flex: 'none',
    }}>{k}</span>
  );
}

export default function AuditScheduleTab() {
  const { role, readonly } = useAuth();
  const canEdit = !readonly && (role === 'superuser' || role === 'accountant' || role === 'per_head_accountant');
  const thisYear = new Date().getFullYear();
  const [fy, setFy] = useState(new Date().getMonth() >= 6 ? thisYear : thisYear - 1);
  const [items, setItems] = useState<ScheduleItem[] | null>(null);
  const [setting, setSetting] = useState<ScheduleSetting | null>(null);
  const [draftSet, setDraftSet] = useState<ScheduleSetting | null>(null);
  const [agm, setAgm] = useState<Map<string, string>>(new Map());
  const [kinds, setKinds] = useState<Set<ScheduleKind>>(new Set(SCHEDULE_KINDS));
  const [tasks, setTasks] = useState<Set<string>>(new Set());   // 비면 전체
  const [who, setWho] = useState<string>('');                    // 사람 거르기('' = 전체)
  const [q, setQ] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('가나다');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [more, setMore] = useState(false);   // 기준·주총·범례 펼치기
  const topScroll = useRef<HTMLDivElement>(null);
  const tableScroll = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  const reload = async () => {
    try {
      const [it, s, a] = await Promise.all([listSchedule(fy), getSetting(fy), listAgm(fy)]);
      setItems(it); setSetting(s); setDraftSet(s); setAgm(a); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'); }
  };
  useEffect(() => { setItems(null); setTasks(new Set()); void reload(); }, [fy]); // eslint-disable-line react-hooks/exhaustive-deps

  const closed = !!setting?.closed;
  const canWrite = canEdit && !closed;
  const cal = useMemo(() => calendarDays(fy), [fy]);
  const stats = useMemo(() => dayStats(items ?? [], setting?.teams ?? 1), [items, setting]);
  const pdays = useMemo(() => personDays(items ?? []), [items]);
  const cap = useMemo(() => (items && setting ? capacity(items, setting, fy) : null), [items, setting, fy]);
  const checks = useMemo(() => new Map((items ?? []).map((it) => [it.id, setting ? checkItem(it, setting) : null])), [items, setting]);
  const taskList = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items ?? []) m.set(it.task, (m.get(it.task) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);
  const shown = useMemo(() => sortItems((items ?? []).filter((it) =>
    kinds.has(it.kind) && (!tasks.size || tasks.has(it.task)) && (!q.trim() || nameKey(it.company).includes(nameKey(q)))
    && (!who || it.staff.includes(who) || [...it.days.values()].some((m) => parseMark(m).includes(who)))), sortMode),
  [items, kinds, tasks, q, who, sortMode]);
  const months = useMemo(() => [1, 2, 3].map((m) => ({ m, n: cal.filter((c) => c.month === m).length })), [cal]);
  // 상장사 — 주총일 · 제시재무제표 제출 기한(주총 6주 전)
  const listed = useMemo(() => [...new Set((items ?? []).filter((it) => it.kind === '상장').map((it) => it.company))], [items]);
  const dues = useMemo(() => new Map(listed.filter((c) => agm.get(c)).map((c) => [c, { agm: agm.get(c)!, due: fsDueDate(agm.get(c)!) }])), [listed, agm]);
  const dueDays = useMemo(() => new Map([...dues.entries()].flatMap(([c, d]) => [[d.due, `🚩 ${c} 제시재무제표 증선위 제출 기한(주총 ${md(d.agm)} − 6주)`], [d.agm, `🏛 ${c} 정기주총`]] as [string, string][])), [dues]);
  const badCount = [...checks.values()].filter((c) => c && !c.ok).length;
  const overDays = [...stats.entries()].filter(([d, s]) => s.over && d >= `${fy + 1}-01-01`).length;
  const outside = (items ?? []).reduce((a, it) => a + [...it.days.keys()].filter((d) => d < `${fy + 1}-01-01` || d > `${fy + 1}-03-31`).length, 0);

  const patch = (id: string, f: (it: ScheduleItem) => ScheduleItem) => setItems((xs) => (xs ? xs.map((x) => (x.id === id ? f(x) : x)) : xs));
  const fail = (e: unknown) => { setErr(e instanceof Error ? e.message : '저장하지 못했습니다.'); void reload(); };

  /** 재고실사 칸 — 나가는 사람을 성으로(조정김). */
  const askPeople = (it: ScheduleItem, date: string, cur: string) =>
    window.prompt(`${it.company} 재고실사 ${md(date)} — 나가는 사람을 성으로 적으세요(조=조현규 · 김=김준성 · 정=정우철 · 윤=윤영미, 예: 조정김)`, cur);

  async function toggleCell(it: ScheduleItem, date: string, shift: boolean) {
    if (!canWrite) return;
    const has = it.days.has(date);
    let mark = it.days.get(date) ?? '';
    let on = !has;
    if (shift || (!has && isInventory(it.task))) {
      const v = isInventory(it.task) ? askPeople(it, date, mark) : window.prompt(`${it.company} ${it.task} — ${md(date)} 칸에 적을 글(비우면 n일차 숫자)`, mark);
      if (v == null) return;
      mark = v.trim(); on = true;
    }
    patch(it.id, (x) => { const d = new Map(x.days); if (on) d.set(date, mark); else d.delete(date); return { ...x, days: d }; });
    try { await setDay(it.id, date, on, on ? mark : ''); } catch (e) { fail(e); }
  }
  async function change(it: ScheduleItem, p: Parameters<typeof updateItem>[1]) {
    patch(it.id, (x) => ({ ...x, ...p } as ScheduleItem));
    try { await updateItem(it.id, p); } catch (e) { fail(e); }
  }
  const toggleStaff = (it: ScheduleItem, k: string) => {
    const next = it.staff.includes(k) ? it.staff.filter((x) => x !== k) : PEOPLE.map((p) => p.k).filter((x) => x === k || it.staff.includes(x));
    void change(it, { staff: next });
  };
  async function remove(it: ScheduleItem) {
    if (!await confirmDanger({ title: '일정 줄을 지웁니다', target: `${it.company} · ${it.task}`, detail: `배정한 ${it.days.size}일도 함께 지워집니다.` })) return;
    try { await deleteItem(it.id); await reload(); } catch (e) { fail(e); }
  }
  async function importContracts() {
    try {
      const cs = await auditContractsFor(fy);
      const have = new Set((items ?? []).map((it) => it.entityId).filter(Boolean));
      const seen = new Set<string>();
      let sort = Math.max(0, ...(items ?? []).map((it) => it.sort)) + 10;
      for (const c of cs.filter((x) => !have.has(x.entityId))) {
        if (seen.has(c.entityId)) continue;
        seen.add(c.entityId);
        await addItem(fy, { entityId: c.entityId, company: c.name, kind: guessKind(c.name, c.cpa), task: '개별감사', daysNeeded: 1, daysUncertain: true, sort, staff: defaultStaff(c.name, '개별감사') });
        sort += 10;
      }
      setMsg(seen.size ? `감사 계약에서 ${seen.size}곳을 새로 넣었습니다(개별감사 1일?, 구분은 짐작 — 고쳐 주세요).` : `FY${fy} 감사 계약 거래처는 모두 이미 있습니다.`);
      await reload();
    } catch (e) { fail(e); }
  }
  async function storeSetting(next?: ScheduleSetting) {
    const s = next ?? draftSet;
    if (!s) return;
    try { await saveSetting(fy, s); setSetting(s); setDraftSet(s); setMsg(next ? (s.closed ? `FY${fy} 일정을 마감했습니다.` : `FY${fy} 마감을 풀었습니다.`) : '기준을 저장했습니다.'); } catch (e) { fail(e); }
  }
  async function setClosed(v: boolean) {
    if (!setting) return;
    if (v && !await confirmDanger({ title: `FY${fy} 기말감사일정을 마감합니다`, target: `FY${fy} 감사 → ${fy + 1}년 1~3월`, detail: '마감하면 줄 · 칸 · 사람을 고칠 수 없습니다. 최고관리자가 다시 풀 수 있습니다.' })) return;
    await storeSetting({ ...setting, closed: v });
  }
  async function changeAgm(company: string, v: string) {
    setAgm((m) => { const n = new Map(m); if (v) n.set(company, v); else n.delete(company); return n; });
    try { await saveAgm(fy, company, v || null); } catch (e) { fail(e); }
  }

  if (!items || !setting || !draftSet) return err ? <div className="card"><div className="err">{err}</div></div> : <Loading title="📅 기말감사일정" />;

  const lefts = COLS.reduce<number[]>((a, _w, i) => [...a, i ? a[i - 1] + COLS[i - 1] : 0], []);
  const leftW = lefts[COLS.length - 1] + COLS[COLS.length - 1];
  const sticky = (i: number, extra?: React.CSSProperties): React.CSSProperties =>
    ({ position: 'sticky', left: lefts[i], minWidth: COLS[i], maxWidth: COLS[i], width: COLS[i], background: '#fff', zIndex: 2, ...extra });
  const dayBg = (date: string, weekend: boolean, holiday: string | null, hard: string | null) =>
    hard ? '#D9D9D9' : holiday || weekend ? '#EFEFEF' : date < setting.startDay ? '#FAFAF7' : '#fff';

  return (
    <div className="card">
      {/* 맨 위 한 줄 — 연도 · 요약 · 펼치기 */}
      <div className="chdr" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        📅 기말감사일정
        <select value={fy} onChange={(e) => setFy(Number(e.target.value))} style={{ fontSize: 'var(--fs-2)', width: 'auto' }}>
          {[thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map((y) => <option key={y} value={y}>FY{y} 감사 → {y + 1}년 1~3월</option>)}
        </select>
        {closed && <span className="bdg" style={{ background: '#E5E7EB', color: '#374151', fontWeight: 700 }}>🔒 마감</span>}
        <span style={{ display: 'inline-flex', gap: 12, alignItems: 'center', fontSize: 'var(--fs-1)', fontWeight: 400 }}>
          {cap && <span title={`외감·상장 기말 ${cap.need}일 필요 · ${md(setting.startDay)}~${md(setting.deadline)} 가용 ${cap.avail}일`}>
            여유 <b style={{ color: cap.spare < 0 ? '#DC2626' : cap.spare <= 3 ? '#D97706' : '#0B6B2B' }}>{cap.spare}</b>일 <span style={{ color: 'var(--ink-3)' }}>({cap.need}/{cap.avail})</span></span>}
          <span>점검 <b style={{ color: badCount ? '#DC2626' : '#0B6B2B' }}>{badCount}</b></span>
          <span>겹친 날 <b style={{ color: overDays ? '#9C0006' : '#0B6B2B' }}>{overDays}</b></span>
          {[...dues.entries()].map(([c, d]) => <span key={c} title={`${c} 주총 ${md(d.agm)} — 6주 전까지 제시재무제표 증선위 제출`} style={{ color: '#9C0006' }}>🚩 {c.replace(/㈜/g, '')} {md(d.due)}</span>)}
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
          <button className="btn-sm" onClick={() => setMore((v) => !v)}>⚙ 기준 · 주총 · 범례 {more ? '▴' : '▾'}</button>
          {canEdit && role === 'superuser' && (closed
            ? <button className="btn-sm" onClick={() => void setClosed(false)}>🔓 마감 풀기</button>
            : <button className="btn-sm" onClick={() => void setClosed(true)}>🔒 이 해 마감</button>)}
        </span>
      </div>

      {/* 접어 두는 것 — 기준 · 상장사 주총 · 범례 · 쓰는 법 */}
      {more && (
        <div style={{ display: 'grid', gap: 6, fontSize: 'var(--fs-1)', marginBottom: 8, padding: 8, background: '#faf8f4', borderRadius: 'var(--r-sm)' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <b>기준</b>
            <label style={lbl}>하루 팀 수 <input type="number" min={1} max={9} value={draftSet.teams} disabled={!canWrite} style={{ width: 52 }}
              onChange={(e) => setDraftSet({ ...draftSet, teams: Math.max(1, Number(e.target.value) || 1) })} /></label>
            <label style={lbl}>기말 착수 <input type="date" style={{ width: 140 }} value={draftSet.startDay} disabled={!canWrite} onChange={(e) => setDraftSet({ ...draftSet, startDay: e.target.value })} /></label>
            <label style={lbl}>외감·상장 한도 <input type="date" style={{ width: 140 }} value={draftSet.deadline} disabled={!canWrite} onChange={(e) => setDraftSet({ ...draftSet, deadline: e.target.value })} /></label>
            <label style={lbl}>임의·PEF 한도 <input type="date" style={{ width: 140 }} value={draftSet.deadlineOther} disabled={!canWrite} onChange={(e) => setDraftSet({ ...draftSet, deadlineOther: e.target.value })} /></label>
            {canWrite && JSON.stringify(draftSet) !== JSON.stringify(setting) && <button className="btn-sm btn-sm-navy" onClick={() => void storeSetting()}>기준 저장</button>}
            {cap && <span style={{ color: 'var(--ink-3)' }}>외감·상장 기말 {cap.need}일 필요 · 가용 {cap.avail}일</span>}
          </div>
          {listed.length > 0 && (
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <b style={{ color: '#9C0006' }}>상장사 주총</b>
              {listed.map((c) => {
                const d = dues.get(c);
                return (
                  <span key={c} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    {c}
                    <input type="date" value={agm.get(c) ?? ''} disabled={!canWrite} onChange={(e) => void changeAgm(c, e.target.value)} style={{ width: 140 }} />
                    {d ? <span>→ 🚩 <b>{md(d.due)}({WEEKDAYS[new Date(`${d.due}T00:00:00Z`).getUTCDay()]})</b>까지 제시재무제표 증선위 제출(주총 6주 전)</span> : <span style={{ color: 'var(--ink-3)' }}>주총일을 넣으면 6주 전이 🚩 로 보입니다</span>}
                  </span>
                );
              })}
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <b>범례</b>
            {(['assigned', 'confirmed', 'overlap'] as const).map((t) => (
              <span key={t}><span style={{ ...swatch, background: TONE[t]!.bg }} /> {t === 'assigned' ? '배정(미확정)' : t === 'confirmed' ? '확정' : `겹침(하루 ${setting.teams}팀 초과)`}</span>
            ))}
            <span><span style={{ ...swatch, background: '#EFEFEF' }} /> 주말·공휴일</span>
            <span><span style={{ ...swatch, background: '#D9D9D9' }} /> 설 전날·다음날</span>
            <span>🚩 제시재무제표 제출 기한 · 🏛 주총</span>
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>{PEOPLE.map((p) => <span key={p.k} style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}><Badge k={p.k} size={14} />{p.name}</span>)}</span>
          </div>
          {!closed && <div style={{ color: 'var(--ink-3)' }}>칸 누르기 = 배정/빼기 · 재고실사 칸은 나가는 사람(성) 묻기 · Shift+누르기 = 칸 글 고치기 · 맨 앞 체크 = 확정 · 인원 아이콘 누르기 = 넣기/빼기</div>}
          {outside > 0 && <div style={{ color: 'var(--ink-3)' }}>1~3월 밖에 배정한 날 {outside}(전년 12월 재고실사·중간 등 — 달력엔 안 보임)</div>}
        </div>
      )}

      {/* 거르기 · 정렬 — 한 줄 */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', fontSize: 'var(--fs-1)', marginBottom: 6 }}>
        <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)} style={{ width: 'auto', fontSize: 'var(--fs-1)', padding: '1px 4px' }} title="정렬">
          <option value="가나다">가나다순</option><option value="일정">첫 일정순</option><option value="입력">넣은 차례</option>
        </select>
        <input placeholder="회사 찾기" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 100, fontSize: 'var(--fs-1)', padding: '1px 4px' }} />
        <span style={sep} />
        <button className={!tasks.size ? 'btn-p' : 'btn-sm'} style={chip} onClick={() => setTasks(new Set())}>전체</button>
        {taskList.map(([t, n]) => (
          <button key={t} className={tasks.has(t) ? 'btn-p' : 'btn-sm'} style={chip}
            onClick={() => setTasks((x0) => { const x = new Set(x0); if (x.has(t)) x.delete(t); else x.add(t); return x; })}>{t} {n}</button>
        ))}
        <span style={sep} />
        {SCHEDULE_KINDS.map((k) => (
          <button key={k} className={kinds.has(k) ? 'btn-p' : 'btn-sm'} style={chip}
            onClick={() => setKinds((x0) => { const n = new Set(x0); if (n.has(k)) n.delete(k); else n.add(k); return n; })}>{k}</button>
        ))}
        <span style={sep} />
        {PEOPLE.map((p) => <Badge key={p.k} k={p.k} size={18} off={!!who && who !== p.k} onClick={() => setWho((w) => (w === p.k ? '' : p.k))} />)}
        {err && <span className="err" style={{ marginLeft: 8 }}>{err}</span>}
        {msg && <span style={{ color: '#0B6B2B', marginLeft: 8 }}>{msg}</span>}
      </div>

      {/* 가로 스크롤 — 표 위에도(아래 것과 함께 움직인다) */}
      <div ref={topScroll} onScroll={(e) => { if (tableScroll.current && !syncing.current) { syncing.current = true; tableScroll.current.scrollLeft = e.currentTarget.scrollLeft; syncing.current = false; } }}
        style={{ overflowX: 'auto', overflowY: 'hidden', height: 14, marginBottom: 2 }}>
        <div style={{ width: leftW + cal.length * W, height: 1 }} />
      </div>
      <div ref={tableScroll} onScroll={(e) => { if (topScroll.current && !syncing.current) { syncing.current = true; topScroll.current.scrollLeft = e.currentTarget.scrollLeft; syncing.current = false; } }}
        style={{ overflow: 'auto', maxHeight: 'calc(100vh - 215px)', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 'var(--fs-1)', tableLayout: 'fixed', width: leftW + cal.length * W }}>
          <colgroup>
            {COLS.map((w, i) => <col key={i} style={{ width: w }} />)}
            {cal.map((c) => <col key={c.date} style={{ width: W }} />)}
          </colgroup>
          <thead style={{ position: 'sticky', top: 0, zIndex: 3 }}>
            <tr style={{ background: '#F3F0EA' }}>
              <th colSpan={COLS.length} style={{ position: 'sticky', left: 0, background: '#F3F0EA', zIndex: 4, textAlign: 'left', padding: '3px 6px' }}>{fy + 1}년</th>
              {months.map(({ m, n }) => <th key={m} colSpan={n} style={{ textAlign: 'left', padding: '3px 6px', borderLeft: '2px solid #bbb', background: '#F3F0EA' }}>{m}월</th>)}
            </tr>
            <tr>
              {['확정', '회사', '구분', '업무구분', '인원', '소요', '배정', '점검'].map((h, i) => (
                <th key={h} style={sticky(i, { ...th, textAlign: i === 1 || i === 3 || i === 7 ? 'left' : 'center', ...(i === 7 ? { borderRight: '2px solid #bbb' } : {}) })}>{h}</th>
              ))}
              {cal.map((c) => {
                const t = TONE[headTone(c.date, stats)];
                const flag = dueDays.get(c.date);
                return (
                  <th key={c.date} title={[dayTitle(c, items), flag].filter(Boolean).join('\n')} style={{ ...th, width: W, minWidth: W, padding: '2px 0', borderLeft: c.day === 1 ? '2px solid #bbb' : undefined,
                    background: t?.bg ?? dayBg(c.date, c.weekend, c.holiday, c.hard), color: t?.fg ?? (c.wd === 0 || c.holiday ? '#C0392B' : c.wd === 6 ? '#2F5FA8' : undefined),
                    boxShadow: flag?.startsWith('🚩') ? 'inset 0 -3px 0 #DC2626' : undefined }}>
                    <div style={{ fontWeight: 700 }}>{c.day}</div>
                    <div style={{ fontWeight: 400, fontSize: 10 }}>{flag ? flag.slice(0, 2) : WEEKDAYS[c.wd]}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((it, i) => {
              const ck = checks.get(it.id);
              const prev = shown[i - 1];
              const newCo = !prev || prev.company !== it.company;
              const rowTone = it.confirmed ? TONE.confirmed! : it.days.size ? TONE.assigned! : null;
              const rb = rowTone?.bg ?? '#fff';
              const inv = isInventory(it.task);
              const invPeople = inv ? [...new Set([...it.days.values()].flatMap(parseMark))] : [];
              const due = dues.get(it.company);
              return (
                <tr key={it.id}>
                  <td style={sticky(0, { ...td, textAlign: 'center', background: rb, borderTop: newCo ? '1px solid #ddd' : undefined })}>
                    <input type="checkbox" checked={it.confirmed} disabled={!canWrite} title="회사와 날짜가 확정되면 체크" onChange={(e) => void change(it, { confirmed: e.target.checked })} />
                  </td>
                  <td style={sticky(1, { ...td, background: rb, fontWeight: newCo ? 700 : 400, color: newCo ? 'var(--navy)' : 'var(--ink-3)', borderTop: newCo ? '1px solid #ddd' : undefined })} title={it.company}>
                    <div style={clip}>{newCo ? it.company : '〃'}</div>
                  </td>
                  <td style={sticky(2, { ...td, background: rb, textAlign: 'center', borderTop: newCo ? '1px solid #ddd' : undefined })}>
                    {canWrite
                      ? <select value={it.kind} onChange={(e) => void change(it, { kind: e.target.value as ScheduleKind })} style={{ ...mini, color: KIND_COLOR[it.kind], fontWeight: 700 }}>
                          {SCHEDULE_KINDS.map((k) => <option key={k}>{k}</option>)}
                        </select>
                      : <span style={{ color: KIND_COLOR[it.kind], fontWeight: 700 }}>{it.kind}</span>}
                  </td>
                  <td style={sticky(3, { ...td, background: rb, borderTop: newCo ? '1px solid #ddd' : undefined })}>
                    {canWrite
                      ? <input key={it.task} list="sched-tasks" defaultValue={it.task} style={{ ...mini, width: 76 }} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== it.task) void change(it, { task: v }); }} />
                      : it.task}
                  </td>
                  <td style={sticky(4, { ...td, background: rb, borderTop: newCo ? '1px solid #ddd' : undefined })}>
                    <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
                      {inv
                        ? (invPeople.length ? invPeople.map((k) => <Badge key={k} k={k} />) : <span style={{ color: 'var(--ink-4)', fontSize: 10 }}>날짜 칸에</span>)
                        : canWrite
                          ? PEOPLE.map((p) => <Badge key={p.k} k={p.k} off={!it.staff.includes(p.k)} onClick={() => toggleStaff(it, p.k)} />)
                          : it.staff.map((k) => <Badge key={k} k={k} />)}
                    </span>
                  </td>
                  <td style={sticky(5, { ...td, background: rb, textAlign: 'center', whiteSpace: 'nowrap', borderTop: newCo ? '1px solid #ddd' : undefined })}>
                    {canWrite
                      ? <>
                          <input key={it.daysNeeded} type="number" min={0} step={0.5} defaultValue={it.daysNeeded} style={{ ...mini, width: 30, textAlign: 'right' }}
                            onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== it.daysNeeded) void change(it, { daysNeeded: v }); }} />
                          <button title="일수가 늘거나 줄 수 있음(?)" onClick={() => void change(it, { daysUncertain: !it.daysUncertain })}
                            style={{ border: 0, background: 'none', cursor: 'pointer', padding: 0, color: it.daysUncertain ? '#DC2626' : '#ccc', fontWeight: 700 }}>?</button>
                        </>
                      : `${it.daysNeeded}${it.daysUncertain ? '?' : ''}`}
                  </td>
                  <td style={sticky(6, { ...td, background: rb, textAlign: 'center', borderTop: newCo ? '1px solid #ddd' : undefined })}>{it.days.size}</td>
                  <td style={sticky(7, { ...td, background: '#fff', borderRight: '2px solid #bbb', whiteSpace: 'nowrap', borderTop: newCo ? '1px solid #ddd' : undefined })}>
                    <span style={{ color: ck?.ok ? '#0B6B2B' : '#DC2626', fontWeight: 700 }} title={ck?.issues.join(' · ')}>{ck?.ok ? 'OK' : ck?.issues[0]}</span>
                    {canWrite && <button onClick={() => void remove(it)} title="이 줄 지우기" style={{ float: 'right', border: 0, background: 'none', cursor: 'pointer', color: '#bbb' }}>✕</button>}
                  </td>
                  {cal.map((c) => {
                    const tone = TONE[cellTone(it, c.date, stats)];
                    const mark = it.days.get(c.date);
                    const ppl = inv && mark ? parseMark(mark) : [];
                    const isDue = due && (c.date === due.due || c.date === due.agm);
                    return (
                      <td key={c.date} onClick={(e) => void toggleCell(it, c.date, e.shiftKey)}
                        title={`${it.company} ${it.task} — ${c.month}/${c.day}(${WEEKDAYS[c.wd]})${c.holiday ? ` ${c.holiday}` : ''}${c.hard ? ` ${c.hard}` : ''}${ppl.length ? ` · ${ppl.map((k) => PNAME[k]).join('·')}` : ''}${isDue ? `\n${dueDays.get(c.date)}` : ''}`}
                        style={{ ...td, padding: 0, width: W, textAlign: 'center', cursor: canWrite ? 'pointer' : 'default', borderLeft: c.day === 1 ? '2px solid #bbb' : '1px solid #f0f0f0',
                          borderTop: newCo ? '1px solid #ddd' : undefined,
                          background: tone?.bg ?? dayBg(c.date, c.weekend, c.holiday, c.hard), color: tone?.fg, fontWeight: tone ? 700 : 400, fontSize: 11,
                          boxShadow: isDue ? 'inset 0 0 0 2px #DC2626' : undefined }}>
                        {mark == null
                          ? (isDue ? <span style={{ fontSize: 10 }}>{c.date === due!.due ? '🚩' : '🏛'}</span> : '')
                          : ppl.length
                            ? <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center', maxWidth: W - 2 }}>{ppl.map((k) => <Badge key={k} k={k} size={11} />)}</span>
                            : (mark || dayOrdinal(it, c.date))}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {/* 일별 집계 */}
            {([['필드(재고 제외)', 'field'], ['재고실사', 'inventory'], ['PEF·SPC', 'fund']] as const).map(([label, key]) => (
              <tr key={key} style={{ background: '#faf8f4' }}>
                <td colSpan={COLS.length} style={{ position: 'sticky', left: 0, zIndex: 2, background: '#faf8f4', borderRight: '2px solid #bbb', ...td, fontWeight: 700, borderTop: key === 'field' ? '2px solid #bbb' : undefined }}>일별 {label}</td>
                {cal.map((c) => {
                  const s = stats.get(c.date); const v = s?.[key] ?? 0;
                  const bad = key === 'field' && s?.over;
                  return <td key={c.date} style={{ ...td, padding: 0, textAlign: 'center', borderTop: key === 'field' ? '2px solid #bbb' : undefined, background: bad ? TONE.overlap!.bg : undefined, color: bad ? TONE.overlap!.fg : v ? undefined : '#ccc', fontWeight: bad ? 700 : 400 }}>{v || ''}</td>;
                })}
              </tr>
            ))}
            {/* 사람별 — 같은 날 두 곳이면 분홍 */}
            {PEOPLE.map((p, pi) => (
              <tr key={p.k} style={{ background: '#fff' }}>
                <td colSpan={COLS.length} style={{ position: 'sticky', left: 0, zIndex: 2, background: '#fff', borderRight: '2px solid #bbb', ...td, borderTop: pi === 0 ? '2px solid #bbb' : undefined }}>
                  <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Badge k={p.k} /> {p.name} <span style={{ color: 'var(--ink-3)' }}>· {[...(pdays.get(p.k)?.entries() ?? [])].filter(([d]) => d >= `${fy + 1}-01-01`).length}일</span></span>
                </td>
                {cal.map((c) => {
                  const v = pdays.get(p.k)?.get(c.date) ?? 0;
                  return <td key={c.date} style={{ ...td, padding: 0, textAlign: 'center', borderTop: pi === 0 ? '2px solid #bbb' : undefined, background: v > 1 ? TONE.overlap!.bg : v ? `${p.bg}22` : undefined, color: v > 1 ? TONE.overlap!.fg : p.bg, fontWeight: 700 }}>{v ? (v > 1 ? v : '●') : ''}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="sched-tasks">{SCHEDULE_TASKS.map((t) => <option key={t} value={t} />)}</datalist>
      </div>

      {canWrite && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn-sm btn-sm-navy" onClick={() => setAdding((v) => !v)}>＋ 줄 추가</button>
          <button className="btn-sm" onClick={() => void importContracts()} title={`FY${fy} 감사 계약(매출계약 · 회계감사) 가운데 아직 없는 거래처를 개별감사 줄로 넣습니다`}>📥 감사 계약에서 불러오기</button>
          {adding && <AddRow fy={fy} nextSort={Math.max(0, ...items.map((x) => x.sort)) + 10} companies={[...new Set(items.map((x) => x.company))]}
            onDone={async (m) => { setAdding(false); setMsg(m); await reload(); }} onError={fail} />}
        </div>
      )}
    </div>
  );
}

function AddRow({ fy, nextSort, companies, onDone, onError }: { fy: number; nextSort: number; companies: string[]; onDone: (msg: string) => void; onError: (e: unknown) => void }) {
  const [company, setCompany] = useState('');
  const [kind, setKind] = useState<ScheduleKind>('외감');
  const [task, setTask] = useState('개별감사');
  const [days, setDays] = useState(1);
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 'var(--fs-1)' }}>
      <input list="sched-cos" placeholder="회사" value={company} onChange={(e) => setCompany(e.target.value)} style={{ width: 160 }} />
      <datalist id="sched-cos">{companies.map((c) => <option key={c} value={c} />)}</datalist>
      <select value={kind} onChange={(e) => setKind(e.target.value as ScheduleKind)} style={{ width: 'auto' }}>{SCHEDULE_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
      <input list="sched-tasks" value={task} onChange={(e) => setTask(e.target.value)} style={{ width: 90 }} placeholder="업무구분" />
      <label style={lbl}>소요 <input type="number" min={0} step={0.5} value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 52 }} />일</label>
      <button className="btn-sm btn-sm-navy" disabled={!company.trim() || !task.trim()} onClick={() => {
        void (async () => {
          try {
            await addItem(fy, { entityId: null, company, kind, task, daysNeeded: days, daysUncertain: false, sort: nextSort, staff: defaultStaff(company, task) });
            onDone(`${company} · ${task} 줄을 넣었습니다. 달력 칸을 눌러 날짜를 배정하세요.`);
          } catch (e) { onError(e); }
        })();
      }}>넣기</button>
    </span>
  );
}

const th: React.CSSProperties = { padding: '4px 4px', fontWeight: 700, background: '#F3F0EA', borderBottom: '1px solid #ccc', textAlign: 'center', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '3px 4px', borderBottom: '1px solid #f0f0f0', height: 24, verticalAlign: 'middle' };
const clip: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const swatch: React.CSSProperties = { display: 'inline-block', width: 14, height: 12, border: '1px solid #ccc', verticalAlign: 'middle' };
const lbl: React.CSSProperties = { display: 'inline-flex', gap: 4, alignItems: 'center', margin: 0, fontWeight: 400, whiteSpace: 'nowrap' };
const chip: React.CSSProperties = { fontSize: 'var(--fs-1)', padding: '1px 7px' };
const sep: React.CSSProperties = { width: 1, height: 16, background: '#ddd', margin: '0 4px' };
const mini: React.CSSProperties = { fontSize: 'var(--fs-1)', padding: '1px 2px', border: '1px solid #ddd', borderRadius: 3, background: 'transparent' };
