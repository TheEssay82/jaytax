// 주석·DSD 관리 › ① 대상 거래처와 사업연도
//
// 이 화면이 하는 일은 둘뿐이다 — **「어느 회사의 어느 해를 다루는가」를 정하고, 그 해에 쓰는
// 주석 목록을 관리한다.** 검증(②)과 DSD 생성(③)은 이 목록을 읽어 돌아간다.
//
// ⚠️ 재무제표 파일은 여기로 올리지 않는다. 엑셀도 DSD 도 브라우저 안에서 열고 끝낸다.
//
// 주석을 찾는 열쇠는 **제목**이다 — ②③④ 가 제목으로 짝을 짓는다(notePick). 주석 번호는
// 하나가 빠지면 통째로 밀려서(올해 17번 무형자산이 내년엔 16번) 열쇠가 될 수 없다.
// 줄마다 붙는 코드는 화면에서 줄을 구별하는 데만 쓰므로 보여 주지 않는다.
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
  defaultAuditFy, DEFAULT_STATUS,
} from '../../lib/dsdNotes';
import NewEngagementModal from './NewEngagementModal';
import NotePrepareTab from './NotePrepareTab';
import NoteVerifyCard, { type Filled } from './NoteVerifyCard';
import NoteDsdCard from './NoteDsdCard';
import {
  useDsdFile, DsdBar, DsdTabs, NeedDsd, NoteFromBar, type TabDef, type NoteFrom,
} from './DsdShell';
import DateParts from '../common/DateParts';

const TABS: TabDef[] = [
  { key: '1', label: '① 대상', hint: '거래처·주석 목록' },
  { key: '2', label: '② 준비', hint: '감사 전', needsDsd: true },
  { key: '3', label: '③ 검증', hint: '감사 후', needsDsd: true },
  { key: '4', label: '④ DSD', hint: '완성본', needsDsd: true },
];

const STATUS_COLOR: Record<string, string> = {
  미할당: 'var(--ink-3)', 작업중: 'var(--info)', 작업완료: 'var(--good)', 작성제외: 'var(--ink-4)',
};

export default function DsdEngagementTab() {
  // 외부인 시연 — 「시연용」 표가 붙은 건 하나만 서버가 내준다(0145). 화면에서는 **보기만**
  // 하게 막는다. 쓰기는 RLS 가 이미 막지만, 눌러도 안 되는 단추를 내놓을 까닭이 없다.
  const { role } = useAuth();
  const isExternal = role === 'external';
  const isSuper = role === 'superuser';
  const [engs, setEngs] = useState<Engagement[]>([]);
  const [ents, setEnts] = useState<BizEntityFull[]>([]);
  const [auditIds, setAuditIds] = useState<Set<string>>(new Set());
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [at, setAt] = useState('1');
  // 작년 감사보고서와 「채워 넣은 엑셀」은 **탭들이 함께 쓴다** — 같은 파일을 세 번 고르지 않는다.
  const dsdFile = useDsdFile();
  const [filled, setFilled] = useState<Filled | null>(null);
  // 주석을 ① 목록에서 고를까, 올린 파일에서 고를까 — ② ③ ④ 가 **같아야** 한다(DsdShell).
  const [from, setFrom] = useState<NoteFrom>('list');
  // 표마다 깔아 둘 빈 줄. 거래처가 해마다 늘고 준다 — 적을 자리가 없으면 사람이 엑셀에서
  // 행을 끼워 넣게 되고, 그러면 아래 자리가 전부 밀려 되돌릴 수 없다.
  const [spare, setSpare] = useState(3);
  // 고른 건에 등록된 표준주석엑셀 — ① 이 보여 주고 ④ 가 등록한다.
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
      const id = keep ?? pickedId ?? list[0]?.id ?? null;
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
  const years = useMemo(
    () => [...new Set(engs.map((e) => e.fy))].sort((a, b) => b - a),
    [engs],
  );
  const [fyAt, setFyAt] = useState<number | null>(null);
  const fy = fyAt ?? years[0] ?? defaultAuditFy();
  const inYear = useMemo(() => engs.filter((e) => e.fy === fy), [engs, fy]);
  const prog = useMemo(() => progress(notes), [notes]);

  async function pick(id: string) {
    if (dirty && !window.confirm('저장하지 않은 주석 목록이 있습니다. 그냥 옮길까요?')) return;
    setPickedId(id);
    setNotes(await listNotes(id));
    setBook(await getNoteBook(id).catch(() => null));
    setDirty(false);
  }

  function edit(code: string, patch: Partial<NoteRow>) {
    setNotes((prev) => renumber(prev.map((n) => (n.code === code ? { ...n, ...patch } : n))));
    setDirty(true);
  }

  async function save() {
    if (!picked) return;
    try {
      await replaceNotes(picked.id, notes);
      setDirty(false);
      setMsg('주석 목록을 저장했습니다.');
      await load(picked.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장하지 못했습니다.');
    }
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
    setPickedId(null);
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

  if (loading) return <div className="card">불러오는 중…</div>;

  return (
    <div>
      <div className="card">
        <div className="chdr">
          📗 주석·DSD 관리
          <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>
            {picked ? `${picked.entityName} · FY${picked.fy} ${picked.scope}` : '작업 건을 고르세요'}
          </span>
          {!isExternal && (
            <button className="btn-sm btn-sm-navy" style={{ marginLeft: 'auto' }} onClick={() => setAdding(true)}>
              + 새 건 만들기
            </button>
          )}
        </div>
        <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7 }}>
          <b>작년 감사보고서 하나가 모든 것의 틀</b>입니다 — ② 준비도 ③ 검증도 ④ 완성본도 그 파일을
          씁니다. ② 가 내는 <b>사전작성 DSD 는 나갈 때 들고 가는 것</b>이고, 완성본을 만들 때는
          쓰지 않습니다.
          <div style={{ color: 'var(--ink-3)', marginTop: 4 }}>
            작년 것이 <b>없어도</b> ③ 은 쓸 수 있습니다 — 다 적힌 <b>당기 DSD</b> 를 올리면 그 파일을
            그대로 훑습니다. 주석을 회사 쪽에서 지어 주거나, 초도감사라 손으로 짠 경우입니다.
          </div>
          <span style={{ color: 'var(--ink-3)' }}>파일은 저장하지 않습니다 — 브라우저 안에서만 열립니다.</span>
        </div>
      </div>

      {err && <div className="card" style={{ color: 'var(--bad)', background: 'var(--bad-bg)' }}>{err}</div>}
      {msg && (
        <div className="card" style={{ color: 'var(--good)', background: 'var(--good-bg)', display: 'flex' }}>
          {msg}
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setMsg(null)}>닫기</button>
        </div>
      )}

      <DsdBar {...dsdFile} expect={picked?.entityName} />
      <DsdTabs tabs={TABS} at={at} go={setAt} hasDsd={!!dsdFile.dsd} />

      {at !== '1' && dsdFile.dsd && (
        <NoteFromBar
          from={useFrom} set={setFrom} spare={spare} setSpare={setSpare}
          listCount={notes.length} fileCount={dsdFile.dsd.blocks.length}
          layout={picked?.sheetLayout ?? 'sheets'}
        />
      )}
      {at !== '1' && !dsdFile.dsd && <NeedDsd />}
      {at !== '1' && !picked && (
        <div className="card" style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-2)' }}>
          <b>① 대상</b>에서 작업 건을 먼저 고르세요.
        </div>
      )}
      {at === '2' && picked && dsdFile.dsd && (
        <NotePrepareTab eng={picked} notes={notes} dsd={dsdFile.dsd} from={useFrom} spare={spare} layout={picked.sheetLayout} />
      )}
      {at === '3' && picked && dsdFile.dsd && (
        <NoteVerifyCard notes={notes} dsd={dsdFile.dsd} xl={filled} setXl={setFilled} from={useFrom} spare={spare} layout={picked.sheetLayout} />
      )}
      {at === '4' && picked && dsdFile.dsd && (
        <NoteDsdCard eng={picked} notes={notes} dsd={dsdFile.dsd} xl={filled} setXl={setFilled} from={useFrom} spare={spare}
          layout={picked.sheetLayout} book={book} onBook={setBook} readOnly={isExternal} />
      )}

      <div style={{ display: at === '1' ? 'block' : 'none' }}>
        {/* ── 사업연도 · 작업 건 ─────────────────────── */}
        <div className="card" style={{ padding: '10px 12px 12px' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 9 }}>
            <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', letterSpacing: '.04em' }}>
              사업연도
            </span>
            {years.map((y) => (
              <button
                key={y}
                onClick={() => setFyAt(y)}
                style={{
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--fs-1)',
                  border: `1px solid ${y === fy ? 'var(--navy)' : 'var(--rule)'}`,
                  background: y === fy ? 'var(--navy)' : '#fff',
                  color: y === fy ? '#fff' : 'var(--ink-2)',
                  fontWeight: y === fy ? 700 : 400,
                  borderRadius: 999, padding: '3px 11px',
                }}
              >
                FY{y}
                <span style={{ opacity: 0.7, marginLeft: 6, fontWeight: 400 }}>
                  · {engs.filter((e) => e.fy === y).length}건
                </span>
              </button>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
              {inYear.length}건
            </span>
          </div>

          {engs.length === 0 && <Empty text="아직 없습니다. 「새 건 만들기」로 시작하세요." />}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {inYear.map((e) => (
              <button
                key={e.id}
                onClick={() => void pick(e.id)}
                style={{
                  textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', minWidth: 156,
                  border: `1px solid ${e.id === pickedId ? 'var(--navy)' : 'var(--rule)'}`,
                  background: e.id === pickedId ? 'var(--navy-bg)' : '#fff',
                  borderRadius: 'var(--r-sm)', padding: '7px 11px',
                }}
              >
                <div style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--navy)' }}>
                  {e.entityName}
                </div>
                <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginTop: 2 }}>
                  {e.scope} · {e.moneyUnit} · 주석 {e.noteCount}
                  <span style={{ marginLeft: 5, color: e.status === '완료' ? 'var(--good)' : 'var(--ink-3)' }}>
                    {e.status}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── 고른 건의 주석 목록 ───────────────────── */}
        {!picked ? (
          <div className="card"><Empty text="위에서 회사를 고르세요." /></div>
        ) : (
          <div className="card">
            <div className="chdr">
              {picked.entityName}
              <span style={{ fontSize: 'var(--fs-2)', fontWeight: 400, color: 'var(--ink-2)' }}>
                FY{picked.fy} · {picked.scope}
                {picked.periodFrom ? ` · ${picked.periodFrom} ~ ${picked.periodTo}` : ''}
              </span>
              {picked.isDemo && (
                <span style={{
                  padding: '2px 9px', borderRadius: 999, fontSize: 'var(--fs-0)', fontWeight: 700,
                  background: 'var(--warn-bg)', color: 'var(--warn)',
                }}>시연용</span>
              )}
              {/* 진짜 거래처에 켜면 그 회사 이름과 주석 목록이 외부인에게 보인다. 최고관리자만. */}
              {isSuper && (
                <label style={{ marginLeft: 'auto', fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}
                  title="켜면 외부인이 ① 에서 이 건과 주석 목록을 읽을 수 있습니다. 시연용 가짜 거래처에만 켜세요.">
                  <input type="checkbox" checked={picked.isDemo}
                    onChange={(ev) => void setDemo(picked.id, ev.target.checked).then(() => load(picked.id))} />{' '}
                  외부인에게 보여 주기
                </label>
              )}
              {!isExternal && (
                <button className="btn-sm btn-sm-del" style={{ marginLeft: isSuper ? 10 : 'auto' }}
                  onClick={() => void removeEng(picked)}>
                  건 지우기
                </button>
              )}
            </div>

            {isExternal && (
              <div style={{
                marginBottom: 12, padding: '9px 11px', borderRadius: 'var(--r-sm)', lineHeight: 1.7,
                background: 'var(--warn-bg)', color: 'var(--warn)', fontSize: 'var(--fs-2)',
              }}>
                <b>시연용 화면입니다.</b> 이 목록은 보기만 됩니다 — 고칠 수는 없습니다.
                <div style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-0)', marginTop: 3 }}>
                  ② 준비 · ③ 검증 · ④ DSD 는 <b>전부 써 보실 수 있습니다.</b> 그 세 단계는 서버를
                  쓰지 않습니다 — 올리신 파일은 이 브라우저 밖으로 나가지 않습니다.
                </div>
              </div>
            )}

            {/* 외부인에게는 통째로 잠근다 — 안의 입력·단추가 한꺼번에 꺼진다. */}
            <fieldset disabled={isExternal} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', marginBottom: 12 }}>
              <Field label="회계기준">
                <select className="btn-sm" value={picked.basis}
                  onChange={(ev) => void updateEngagement(picked.id, { basis: ev.target.value as Basis }).then(() => load(picked.id))}>
                  <option>K-IFRS</option><option>일반기업회계기준</option><option>소규모감사기준</option>
                </select>
              </Field>
              <Field label="금액 단위">
                <select className="btn-sm" value={picked.moneyUnit}
                  onChange={(ev) => void updateEngagement(picked.id, { moneyUnit: ev.target.value as '천원' | '원' }).then(() => load(picked.id))}>
                  <option>천원</option><option>원</option>
                </select>
              </Field>
              <Field label="시트 구성">
                <select className="btn-sm" value={picked.sheetLayout}
                  title="② 로 엑셀을 만든 뒤에는 바꾸지 마십시오 — ③④ 가 이 값으로 시트를 찾습니다."
                  onChange={(ev) => void updateEngagement(picked.id, { sheetLayout: ev.target.value as SheetLayout }).then(() => load(picked.id))}>
                  <option value="sheets">{LAYOUT_LABEL.sheets}</option>
                  <option value="long">{LAYOUT_LABEL.long}</option>
                </select>
              </Field>
              <Field label="대상기간">
                <DateParts value={picked.periodFrom ?? ''} onChange={(val) => { if (val) void updateEngagement(picked.id, { periodFrom: val }).then(() => load(picked.id)); }} />
              </Field>
              <Field label="~">
                <DateParts value={picked.periodTo ?? ''} onChange={(val) => { if (val) void updateEngagement(picked.id, { periodTo: val }).then(() => load(picked.id)); }} />
              </Field>
              <Field label="상태">
                <select className="btn-sm" value={picked.status}
                  onChange={(ev) => void updateEngagement(picked.id, { status: ev.target.value as Engagement['status'] }).then(() => load(picked.id))}>
                  <option>준비</option><option>진행</option><option>완료</option>
                </select>
              </Field>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)' }}>
                  작업완료 {prog.done} / {prog.total}
                </div>
                <div style={{ width: 120, height: 7, background: 'var(--rule-2)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${prog.pct}%`, height: '100%', background: 'var(--good)' }} />
                </div>
              </div>
            </div>

            <NoteBookCard eng={picked} book={book} onChange={setBook} readOnly={isExternal} />

            <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginBottom: 6 }}>
              금액은 엑셀에 <b>원(장부값)</b>으로 쓰고 DSD 에는 <b>{picked.moneyUnit}</b>으로 내보냅니다.
              주식수·지분율·외화는 환산하지 않습니다.
            </div>

            <div className="tbl-wide">
              <table className="tbl">
                <thead>
                  <tr style={{ background: 'var(--surface-2)' }}>
                    <th style={{ width: 38 }}>번호</th>
                    <th style={{ minWidth: 180 }}>제목</th>
                    <th style={{ width: 62 }}>시트</th>
                    <th style={{ width: 46 }}>쓰기</th>
                    <th style={{ width: 74 }}>작성</th>
                    <th style={{ width: 84 }}>담당</th>
                    <th style={{ width: 92 }}>상태</th>
                    <th style={{ minWidth: 130 }}>메모</th>
                  </tr>
                </thead>
                <tbody>
                  {notes.map((n) => (
                    <tr key={n.code} style={{ opacity: n.enabled ? 1 : 0.5 }}>
                      <td style={{ textAlign: 'center', color: 'var(--ink-3)' }}>{n.no ?? '—'}</td>
                      <td>
                        <input className="btn-sm" style={{ width: '100%', textAlign: 'left' }} value={n.title}
                          onChange={(ev) => edit(n.code, { title: ev.target.value })} />
                      </td>
                      <td>
                        <input className="btn-sm" style={{ width: '100%', textAlign: 'left' }} value={n.sheet ?? ''}
                          placeholder="N01"
                          onChange={(ev) => edit(n.code, { sheet: ev.target.value })} />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={n.enabled}
                          title="끄면 검증과 DSD 생성에서 빠지고 번호가 다시 매겨집니다"
                          onChange={(ev) => edit(n.code, { enabled: ev.target.checked })} />
                      </td>
                      <td>
                        <select className="btn-sm" style={{ width: '100%' }} value={n.source}
                          title="회사가 직접 쓰는 주석은 엑셀이 원천이 아니라 대조 대상에서 뺍니다"
                          onChange={(ev) => edit(n.code, { source: ev.target.value as NoteRow['source'] })}>
                          <option>감사인</option><option>회사</option>
                        </select>
                      </td>
                      <td>
                        <input className="btn-sm" style={{ width: '100%', textAlign: 'left' }} value={n.assignee ?? ''}
                          onChange={(ev) => edit(n.code, { assignee: ev.target.value })} />
                      </td>
                      <td>
                        <select className="btn-sm" style={{ width: '100%', color: STATUS_COLOR[n.status] }} value={n.status}
                          onChange={(ev) => edit(n.code, { status: ev.target.value as NoteRow['status'] })}>
                          <option>미할당</option><option>작업중</option><option>작업완료</option><option>작성제외</option>
                        </select>
                      </td>
                      <td>
                        <input className="btn-sm" style={{ width: '100%', textAlign: 'left' }} value={n.memo ?? ''}
                          onChange={(ev) => edit(n.code, { memo: ev.target.value })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}>
              <button className="btn-sm" onClick={addNote}>+ 주석 추가</button>
              <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-1)', color: dirty ? 'var(--warn)' : 'var(--ink-4)' }}>
                {dirty ? '저장하지 않은 변경이 있습니다' : '저장됨'}
              </span>
              <button className="btn-sm btn-sm-navy" disabled={!dirty} onClick={() => void save()}>저장</button>
            </div>
            </fieldset>
          </div>
        )}
      </div>

      {adding && (
        <NewEngagementModal
          entities={ents}
          auditIds={auditIds}
          onClose={() => setAdding(false)}
          onDone={async (id) => { setAdding(false); await load(id); setMsg('작업 건을 만들었습니다.'); }}
          onError={(m) => setErr(m)}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>{label}</span>
      {children}
    </label>
  );
}
