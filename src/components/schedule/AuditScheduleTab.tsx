// 감사업무관리 › 📅 기말감사일정 — 감사 대상 연도의 다음 해 1~3월 달력에 회사 × 일을 배정한다(사용자 2026-11-15).
//
// 원본은 엑셀 「거래처관리등_FY26.xlsx」 [기말일정검토26](2026-11-04 v9). 사용자 원칙:
//   배정=노랑 · 확정=녹색 · 같은 날 필드가 팀 수보다 많으면 분홍 · 날짜 머리칸도 그날 색(넘겨도 보이게).
//   외감·상장 3/23 이전 · PEF·SPC 주말 · 착수 1/25 · 설 전날·다음날 곤란. 재고실사는 겹침에서 뺀다.
// 칸을 누르면 배정/빼기, Shift+누르기는 칸 글(재고실사 담당 이니셜). 확정은 줄 맨 앞 체크.
import { useEffect, useMemo, useState } from 'react';
import Loading from '../common/Loading';
import { confirmDanger } from '../common/DangerConfirm';
import { useAuth } from '../../context/AuthContext';
import {
  SCHEDULE_KINDS, SCHEDULE_TASKS, WEEKDAYS, calendarDays, capacity, cellTone, checkItem, dayOrdinal, dayStats, dayTitle, headTone,
  type CellTone, type ScheduleItem, type ScheduleKind, type ScheduleSetting,
} from '../../lib/auditSchedule';
import {
  addItem, auditContractsFor, deleteItem, getSetting, guessKind, listSchedule, saveSetting, setDay, updateItem,
} from '../../lib/auditScheduleApi';

const TONE: Record<CellTone, { bg: string; fg: string } | null> = {
  none: null,
  assigned: { bg: '#FFEB9C', fg: '#7A5B00' },
  confirmed: { bg: '#C6EFCE', fg: '#0B6B2B' },
  overlap: { bg: '#FFC7CE', fg: '#9C0006' },
};
const KIND_COLOR: Record<ScheduleKind, string> = { 상장: '#7C3AED', 외감: '#1f5f8b', 임의: '#12A38A', PEF: '#B45309', SPC: '#A16207', 용역: '#6B7280' };
const W = 26;   // 날짜 칸 폭
const KW = 60;  // 구분 칸 폭

export default function AuditScheduleTab() {
  const { role, readonly } = useAuth();
  const canWrite = !readonly && (role === 'superuser' || role === 'accountant' || role === 'per_head_accountant');
  const thisYear = new Date().getFullYear();
  const [fy, setFy] = useState(new Date().getMonth() >= 6 ? thisYear : thisYear - 1);
  const [items, setItems] = useState<ScheduleItem[] | null>(null);
  const [setting, setSetting] = useState<ScheduleSetting | null>(null);
  const [draftSet, setDraftSet] = useState<ScheduleSetting | null>(null);
  const [kinds, setKinds] = useState<Set<ScheduleKind>>(new Set(SCHEDULE_KINDS));
  const [hideInv, setHideInv] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const reload = async () => {
    try {
      const [it, s] = await Promise.all([listSchedule(fy), getSetting(fy)]);
      setItems(it); setSetting(s); setDraftSet(s); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'); }
  };
  useEffect(() => { setItems(null); void reload(); }, [fy]); // eslint-disable-line react-hooks/exhaustive-deps

  const cal = useMemo(() => calendarDays(fy), [fy]);
  const stats = useMemo(() => dayStats(items ?? [], setting?.teams ?? 1), [items, setting]);
  const cap = useMemo(() => (items && setting ? capacity(items, setting, fy) : null), [items, setting, fy]);
  const checks = useMemo(() => new Map((items ?? []).map((it) => [it.id, setting ? checkItem(it, setting) : null])), [items, setting]);
  const shown = (items ?? []).filter((it) => kinds.has(it.kind) && !(hideInv && /재고실사/.test(it.task)));
  const months = useMemo(() => [1, 2, 3].map((m) => ({ m, n: cal.filter((c) => c.month === m).length })), [cal]);
  const badCount = [...checks.values()].filter((c) => c && !c.ok).length;
  const overDays = [...stats.entries()].filter(([d, s]) => s.over && d >= `${fy + 1}-01-01`).length;
  const outside = (items ?? []).reduce((a, it) => a + [...it.days.keys()].filter((d) => d < `${fy + 1}-01-01` || d > `${fy + 1}-03-31`).length, 0);

  /** 바꾼 줄만 고쳐 넣는다(전체를 다시 읽지 않는다 — 칸을 빠르게 눌러도 끊기지 않게). */
  const patch = (id: string, f: (it: ScheduleItem) => ScheduleItem) => setItems((xs) => (xs ? xs.map((x) => (x.id === id ? f(x) : x)) : xs));
  const fail = (e: unknown) => { setErr(e instanceof Error ? e.message : '저장하지 못했습니다.'); void reload(); };

  async function toggleCell(it: ScheduleItem, date: string, withMark: boolean) {
    if (!canWrite) return;
    const has = it.days.has(date);
    let mark = it.days.get(date) ?? '';
    if (withMark) {
      const v = window.prompt(`${it.company} ${it.task} — ${date} 칸에 적을 글(담당 이니셜 등, 비우면 숫자)`, mark);
      if (v == null) return;
      mark = v.trim();
    }
    const on = withMark ? true : !has;
    patch(it.id, (x) => { const d = new Map(x.days); if (on) d.set(date, mark); else d.delete(date); return { ...x, days: d }; });
    try { await setDay(it.id, date, on, on ? mark : ''); } catch (e) { fail(e); }
  }
  async function change(it: ScheduleItem, p: Parameters<typeof updateItem>[1]) {
    patch(it.id, (x) => ({ ...x, ...p } as ScheduleItem));
    try { await updateItem(it.id, p); } catch (e) { fail(e); }
  }
  async function remove(it: ScheduleItem) {
    if (!await confirmDanger({ title: '일정 줄을 지웁니다', target: `${it.company} · ${it.task}`, detail: `배정한 ${it.days.size}일도 함께 지워집니다.` })) return;
    try { await deleteItem(it.id); await reload(); } catch (e) { fail(e); }
  }
  async function importContracts() {
    try {
      const cs = await auditContractsFor(fy);
      const have = new Set((items ?? []).map((it) => it.entityId).filter(Boolean));
      const add = cs.filter((c) => !have.has(c.entityId));
      const seen = new Set<string>();
      let sort = Math.max(0, ...(items ?? []).map((it) => it.sort)) + 10;
      for (const c of add) {
        if (seen.has(c.entityId)) continue;
        seen.add(c.entityId);
        await addItem(fy, { entityId: c.entityId, company: c.name, kind: guessKind(c.name, c.cpa), task: '개별감사', daysNeeded: 1, daysUncertain: true, sort });
        sort += 10;
      }
      setMsg(seen.size ? `감사 계약에서 ${seen.size}곳을 새로 넣었습니다(개별감사 1일?, 구분은 짐작 — 고쳐 주세요).` : `FY${fy} 감사 계약 거래처는 모두 이미 있습니다.`);
      await reload();
    } catch (e) { fail(e); }
  }
  async function storeSetting() {
    if (!draftSet) return;
    try { await saveSetting(fy, draftSet); setSetting(draftSet); setMsg('기준을 저장했습니다.'); } catch (e) { fail(e); }
  }

  if (!items || !setting || !draftSet) return err ? <div className="card"><div className="err">{err}</div></div> : <Loading title="📅 기말감사일정" />;

  const sticky = (left: number, w: number, extra?: React.CSSProperties): React.CSSProperties =>
    ({ position: 'sticky', left, minWidth: w, maxWidth: w, width: w, background: '#fff', zIndex: 2, ...extra });
  const L = { chk: 0, co: 28, kind: 178, task: 178 + KW, need: 178 + KW + 78, got: 178 + KW + 126, chkc: 178 + KW + 162 };
  const leftW = L.chkc + 96;
  const dayBg = (date: string, weekend: boolean, holiday: string | null, hard: string | null) =>
    hard ? '#D9D9D9' : holiday || weekend ? '#EFEFEF' : date < setting.startDay ? '#FAFAF7' : '#fff';

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        📅 기말감사일정
        <select value={fy} onChange={(e) => setFy(Number(e.target.value))} style={{ fontSize: 'var(--fs-2)', width: 'auto' }}>
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => <option key={y} value={y}>FY{y} 감사 → {y + 1}년 1~3월</option>)}
        </select>
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', fontWeight: 400 }}>
          칸 누르기 = 배정/빼기 · Shift+누르기 = 칸 글(재고실사 담당) · 맨 앞 체크 = 확정
        </span>
      </div>

      {/* 요약 · 기준 */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 'var(--fs-2)', margin: '6px 0 10px' }}>
        {cap && (
          <span>외감·상장 기말 <b>{cap.need}</b>일 필요 · {setting.startDay.slice(5).replace('-', '/')}~{setting.deadline.slice(5).replace('-', '/')} 가용 <b>{cap.avail}</b>일
            {' · '}여유 <b style={{ color: cap.spare < 0 ? '#DC2626' : cap.spare <= 3 ? '#D97706' : '#0B6B2B' }}>{cap.spare}</b>일</span>
        )}
        <span>점검 걸린 줄 <b style={{ color: badCount ? '#DC2626' : '#0B6B2B' }}>{badCount}</b></span>
        <span>겹친 날 <b style={{ color: overDays ? '#9C0006' : '#0B6B2B' }}>{overDays}</b></span>
        {outside > 0 && <span style={{ color: 'var(--ink-3)' }}>1~3월 밖에 배정한 날 {outside}(작년 12월 재고실사 등 — 달력엔 안 보임)</span>}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 'var(--fs-1)', marginBottom: 10, padding: 8, background: '#faf8f4', borderRadius: 'var(--r-sm)' }}>
        <b>기준</b>
        <label style={lbl}>하루 팀 수 <input type="number" min={1} max={9} value={draftSet.teams} disabled={!canWrite} style={{ width: 52 }}
          onChange={(e) => setDraftSet({ ...draftSet, teams: Math.max(1, Number(e.target.value) || 1) })} /></label>
        <label style={lbl}>기말 착수 <input type="date" style={{ width: 140 }} value={draftSet.startDay} disabled={!canWrite} onChange={(e) => setDraftSet({ ...draftSet, startDay: e.target.value })} /></label>
        <label style={lbl}>외감·상장 한도 <input type="date" style={{ width: 140 }} value={draftSet.deadline} disabled={!canWrite} onChange={(e) => setDraftSet({ ...draftSet, deadline: e.target.value })} /></label>
        <label style={lbl}>임의·PEF 한도 <input type="date" style={{ width: 140 }} value={draftSet.deadlineOther} disabled={!canWrite} onChange={(e) => setDraftSet({ ...draftSet, deadlineOther: e.target.value })} /></label>
        {canWrite && JSON.stringify(draftSet) !== JSON.stringify(setting) && <button className="btn-sm btn-sm-navy" onClick={() => void storeSetting()}>기준 저장</button>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {SCHEDULE_KINDS.map((k) => (
            <button key={k} className={kinds.has(k) ? 'btn-p' : 'btn-sm'} style={{ fontSize: 'var(--fs-1)', padding: '2px 8px' }}
              onClick={() => setKinds((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })}>{k}</button>
          ))}
          <label style={lbl}><input type="checkbox" checked={hideInv} onChange={(e) => setHideInv(e.target.checked)} /> 재고실사 숨기기</label>
        </span>
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 'var(--fs-1)', marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {(['assigned', 'confirmed', 'overlap'] as const).map((t) => (
          <span key={t}><span style={{ display: 'inline-block', width: 14, height: 12, background: TONE[t]!.bg, border: '1px solid #ccc', verticalAlign: 'middle' }} /> {t === 'assigned' ? '배정(미확정)' : t === 'confirmed' ? '확정' : `겹침(하루 ${setting.teams}팀 초과)`}</span>
        ))}
        <span><span style={{ display: 'inline-block', width: 14, height: 12, background: '#EFEFEF', border: '1px solid #ccc', verticalAlign: 'middle' }} /> 주말·공휴일</span>
        <span><span style={{ display: 'inline-block', width: 14, height: 12, background: '#D9D9D9', border: '1px solid #ccc', verticalAlign: 'middle' }} /> 설 전날·다음날</span>
        {err && <span className="err" style={{ marginLeft: 8 }}>{err}</span>}
        {msg && <span style={{ color: '#0B6B2B' }}>{msg}</span>}
      </div>

      <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 290px)', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 'var(--fs-1)', tableLayout: 'fixed', width: leftW + cal.length * W }}>
          <colgroup>
            {[28, 150, KW, 78, 48, 36, 96].map((w, i) => <col key={i} style={{ width: w }} />)}
            {cal.map((c) => <col key={c.date} style={{ width: W }} />)}
          </colgroup>
          <thead style={{ position: 'sticky', top: 0, zIndex: 3 }}>
            <tr style={{ background: '#F3F0EA' }}>
              <th colSpan={7} style={{ ...sticky(0, leftW, { background: '#F3F0EA', zIndex: 4 }), textAlign: 'left', padding: '3px 6px' }}>{fy + 1}년</th>
              {months.map(({ m, n }) => <th key={m} colSpan={n} style={{ textAlign: 'left', padding: '3px 6px', borderLeft: '2px solid #bbb', background: '#F3F0EA' }}>{m}월</th>)}
            </tr>
            <tr>
              <th style={sticky(L.chk, 28, th)}>확정</th>
              <th style={sticky(L.co, 150, { ...th, textAlign: 'left' })}>회사</th>
              <th style={sticky(L.kind, KW, th)}>구분</th>
              <th style={sticky(L.task, 78, { ...th, textAlign: 'left' })}>일</th>
              <th style={sticky(L.need, 48, th)}>소요</th>
              <th style={sticky(L.got, 36, th)}>배정</th>
              <th style={sticky(L.chkc, 96, { ...th, textAlign: 'left', borderRight: '2px solid #bbb' })}>점검</th>
              {cal.map((c) => {
                const t = TONE[headTone(c.date, stats)];
                return (
                  <th key={c.date} title={dayTitle(c, items)} style={{ ...th, width: W, minWidth: W, padding: '2px 0', borderLeft: c.day === 1 ? '2px solid #bbb' : undefined,
                    background: t?.bg ?? dayBg(c.date, c.weekend, c.holiday, c.hard), color: t?.fg ?? (c.wd === 0 || c.holiday ? '#C0392B' : c.wd === 6 ? '#2F5FA8' : undefined) }}>
                    <div style={{ fontWeight: 700 }}>{c.day}</div>
                    <div style={{ fontWeight: 400, fontSize: 10 }}>{WEEKDAYS[c.wd]}</div>
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
              return (
                <tr key={it.id} style={{ borderTop: newCo ? '1px solid #ddd' : undefined }}>
                  <td style={sticky(L.chk, 28, { ...td, textAlign: 'center', background: rowTone?.bg ?? '#fff' })}>
                    <input type="checkbox" checked={it.confirmed} disabled={!canWrite} title="회사와 날짜가 확정되면 체크" onChange={(e) => void change(it, { confirmed: e.target.checked })} />
                  </td>
                  <td style={sticky(L.co, 150, { ...td, background: rowTone?.bg ?? '#fff', fontWeight: newCo ? 700 : 400, color: newCo ? 'var(--navy)' : 'var(--ink-3)' })} title={it.company}>
                    <div style={clip}>{newCo ? it.company : '〃'}</div>
                  </td>
                  <td style={sticky(L.kind, KW, { ...td, background: rowTone?.bg ?? '#fff', textAlign: 'center' })}>
                    {canWrite
                      ? <select value={it.kind} onChange={(e) => void change(it, { kind: e.target.value as ScheduleKind })} style={{ ...mini, color: KIND_COLOR[it.kind], fontWeight: 700 }}>
                          {SCHEDULE_KINDS.map((k) => <option key={k}>{k}</option>)}
                        </select>
                      : <span style={{ color: KIND_COLOR[it.kind], fontWeight: 700 }}>{it.kind}</span>}
                  </td>
                  <td style={sticky(L.task, 78, { ...td, background: rowTone?.bg ?? '#fff' })}>
                    {canWrite
                      ? <input list="sched-tasks" defaultValue={it.task} style={{ ...mini, width: 72 }} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== it.task) void change(it, { task: v }); }} />
                      : it.task}
                  </td>
                  <td style={sticky(L.need, 48, { ...td, background: rowTone?.bg ?? '#fff', textAlign: 'center', whiteSpace: 'nowrap' })}>
                    {canWrite
                      ? <>
                          <input type="number" min={0} step={0.5} defaultValue={it.daysNeeded} style={{ ...mini, width: 30, textAlign: 'right' }}
                            onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== it.daysNeeded) void change(it, { daysNeeded: v }); }} />
                          <button title="일수가 늘거나 줄 수 있음(?)" onClick={() => void change(it, { daysUncertain: !it.daysUncertain })}
                            style={{ border: 0, background: 'none', cursor: 'pointer', padding: 0, color: it.daysUncertain ? '#DC2626' : '#ccc', fontWeight: 700 }}>?</button>
                        </>
                      : `${it.daysNeeded}${it.daysUncertain ? '?' : ''}`}
                  </td>
                  <td style={sticky(L.got, 36, { ...td, background: rowTone?.bg ?? '#fff', textAlign: 'center' })}>{it.days.size}</td>
                  <td style={sticky(L.chkc, 96, { ...td, background: '#fff', borderRight: '2px solid #bbb', whiteSpace: 'nowrap' })}>
                    <span style={{ color: ck?.ok ? '#0B6B2B' : '#DC2626', fontWeight: 700 }} title={ck?.issues.join(' · ')}>{ck?.ok ? 'OK' : ck?.issues[0]}</span>
                    {canWrite && <button onClick={() => void remove(it)} title="이 줄 지우기" style={{ float: 'right', border: 0, background: 'none', cursor: 'pointer', color: '#bbb' }}>✕</button>}
                  </td>
                  {cal.map((c) => {
                    const tone = TONE[cellTone(it, c.date, stats)];
                    const mark = it.days.get(c.date);
                    return (
                      <td key={c.date} onClick={(e) => void toggleCell(it, c.date, e.shiftKey)}
                        title={`${it.company} ${it.task} — ${c.month}/${c.day}(${WEEKDAYS[c.wd]})${c.holiday ? ` ${c.holiday}` : ''}${c.hard ? ` ${c.hard}` : ''}`}
                        style={{ ...td, padding: 0, width: W, textAlign: 'center', cursor: canWrite ? 'pointer' : 'default', borderLeft: c.day === 1 ? '2px solid #bbb' : '1px solid #f0f0f0',
                          background: tone?.bg ?? dayBg(c.date, c.weekend, c.holiday, c.hard), color: tone?.fg, fontWeight: tone ? 700 : 400, fontSize: mark && mark.length > 1 ? 9 : 11 }}>
                        {mark != null ? (mark || dayOrdinal(it, c.date)) : ''}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {/* 일별 집계 */}
            {([['필드(재고 제외)', 'field'], ['재고실사', 'inventory'], ['PEF·SPC', 'fund']] as const).map(([label, key]) => (
              <tr key={key} style={{ background: '#faf8f4' }}>
                <td colSpan={7} style={{ ...sticky(0, leftW, { background: '#faf8f4', borderRight: '2px solid #bbb' }), ...td, fontWeight: 700, borderTop: key === 'field' ? '2px solid #bbb' : undefined }}>일별 {label}</td>
                {cal.map((c) => {
                  const s = stats.get(c.date); const v = s?.[key] ?? 0;
                  const bad = key === 'field' && s?.over;
                  return <td key={c.date} style={{ ...td, padding: 0, textAlign: 'center', borderTop: key === 'field' ? '2px solid #bbb' : undefined, background: bad ? TONE.overlap!.bg : undefined, color: bad ? TONE.overlap!.fg : v ? undefined : '#ccc', fontWeight: bad ? 700 : 400 }}>{v || ''}</td>;
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
      <select value={kind} onChange={(e) => setKind(e.target.value as ScheduleKind)}>{SCHEDULE_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
      <input list="sched-tasks" value={task} onChange={(e) => setTask(e.target.value)} style={{ width: 90 }} />
      <label style={lbl}>소요 <input type="number" min={0} step={0.5} value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 44 }} />일</label>
      <button className="btn-sm btn-sm-navy" disabled={!company.trim() || !task.trim()} onClick={() => {
        void (async () => {
          try {
            await addItem(fy, { entityId: null, company, kind, task, daysNeeded: days, daysUncertain: false, sort: nextSort });
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
const lbl: React.CSSProperties = { display: 'inline-flex', gap: 4, alignItems: 'center', margin: 0, fontWeight: 400, whiteSpace: 'nowrap' };
const mini: React.CSSProperties = { fontSize: 'var(--fs-1)', padding: '1px 2px', border: '1px solid #ddd', borderRadius: 3, background: 'transparent' };
