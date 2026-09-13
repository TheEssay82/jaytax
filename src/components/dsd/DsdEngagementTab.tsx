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
  listEngagements, createEngagement, updateEngagement, deleteEngagement,
  listNotes, replaceNotes, findEngagement, listAuditEntityIds, setDemo,
  type Engagement, type NoteRow, type Basis,
} from '../../lib/dsdApi';
import {
  suggestCode, renumber, progress,
  defaultAuditFy, defaultPeriod, DEFAULT_STATUS,
} from '../../lib/dsdNotes';
import { readDsd, type DsdInfo } from '../../lib/dsdFile';
import NotePrepareTab from './NotePrepareTab';
import NoteVerifyCard, { type Filled } from './NoteVerifyCard';
import NoteDsdCard from './NoteDsdCard';
import {
  useDsdFile, DsdBar, DsdTabs, NeedDsd, NoteFromBar, type TabDef, type NoteFrom,
} from './DsdShell';

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
        />
      )}
      {at !== '1' && !dsdFile.dsd && <NeedDsd />}
      {at !== '1' && !picked && (
        <div className="card" style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-2)' }}>
          <b>① 대상</b>에서 작업 건을 먼저 고르세요.
        </div>
      )}
      {at === '2' && picked && dsdFile.dsd && (
        <NotePrepareTab eng={picked} notes={notes} dsd={dsdFile.dsd} from={useFrom} spare={spare} />
      )}
      {at === '3' && picked && dsdFile.dsd && (
        <NoteVerifyCard notes={notes} dsd={dsdFile.dsd} xl={filled} setXl={setFilled} from={useFrom} spare={spare} />
      )}
      {at === '4' && picked && dsdFile.dsd && (
        <NoteDsdCard eng={picked} notes={notes} dsd={dsdFile.dsd} xl={filled} setXl={setFilled} from={useFrom} spare={spare} />
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
                  <option>K-IFRS</option><option>일반기업회계기준</option>
                </select>
              </Field>
              <Field label="금액 단위">
                <select className="btn-sm" value={picked.moneyUnit}
                  onChange={(ev) => void updateEngagement(picked.id, { moneyUnit: ev.target.value as '천원' | '원' }).then(() => load(picked.id))}>
                  <option>천원</option><option>원</option>
                </select>
              </Field>
              <Field label="대상기간">
                <input className="btn-sm" type="date" value={picked.periodFrom ?? ''}
                  onChange={(ev) => void updateEngagement(picked.id, { periodFrom: ev.target.value }).then(() => load(picked.id))} />
              </Field>
              <Field label="~">
                <input className="btn-sm" type="date" value={picked.periodTo ?? ''}
                  onChange={(ev) => void updateEngagement(picked.id, { periodTo: ev.target.value }).then(() => load(picked.id))} />
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

/**
 * 새 작업 건 — **씨앗(무엇으로 주석 목록을 채울까)이 이 창의 핵심**이다.
 *
 * 빈 목록으로 만들면 결국 손으로 40줄을 넣게 된다. 첫 해에는 **작년 감사보고서 DSD** 를 넣는 것이
 * 가장 빠르고(파일에서 주석 목록이 그대로 읽힌다), 두 해째부터는 앞 해 건을 복제한다.
 */
function NewEngagementModal({ entities, auditIds, onClose, onDone, onError }: {
  entities: BizEntityFull[];
  auditIds: Set<string>;
  onClose: () => void;
  onDone: (id: string) => void | Promise<void>;
  onError: (m: string) => void;
}) {
  const [q, setQ] = useState('');
  const [auditOnly, setAuditOnly] = useState(true);
  const [entityId, setEntityId] = useState('');
  const [fy, setFy] = useState(defaultAuditFy());
  // 대상기간은 사업연도에서 따라오되 **손으로 고칠 수 있어야 한다** — 12월 결산이 아닌 회사도 있고,
  // 첫 사업연도는 기간이 짧다. 사업연도를 바꾸면 다시 그 해의 1/1~12/31 로 맞춘다.
  const [period, setPeriod] = useState(defaultPeriod(defaultAuditFy()));
  const [scope, setScope] = useState<'별도' | '연결'>('별도');
  const [basis, setBasis] = useState<Basis>('K-IFRS');
  const [moneyUnit, setMoneyUnit] = useState<'천원' | '원'>('천원');
  const [seed, setSeed] = useState<'previous' | 'file' | 'empty'>('file');
  const [prevFound, setPrevFound] = useState<number | null>(null);
  const [dsd, setDsd] = useState<DsdInfo | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  // **이 창 안에서 말한다.** 부모 쪽 오류 카드는 이 창 뒤에 가려 보이지 않는다 —
  // 그래서 「만들기를 눌러도 아무 반응이 없다」로 보였다(2026-09-12).
  const [say, setSay] = useState<string | null>(null);
  function tell(m: string) { setSay(m); onError(m); }

  // 감사계약(회계감사)이 있는 거래처만 — 이 시스템이 다루는 대상이다.
  const hits = useMemo(() => {
    const t = q.trim();
    let base = auditOnly ? entities.filter((e) => auditIds.has(e.id)) : entities;
    if (t) base = base.filter((e) => e.name.includes(t) || (e.code ?? '').includes(t));
    return base.slice(0, 60);
  }, [entities, auditIds, auditOnly, q]);

  useEffect(() => { setPeriod(defaultPeriod(fy)); }, [fy]);

  // 앞 해 건이 있으면 복제를 기본으로 — 그게 대응표가 쌓이는 길이다.
  useEffect(() => {
    let alive = true;
    if (!entityId) { setPrevFound(null); return; }
    void findEngagement(entityId, fy - 1, scope).then(async (prev) => {
      if (!alive) return;
      if (!prev) { setPrevFound(null); return; }
      setPrevFound((await listNotes(prev.id)).length);
      setSeed('previous');
      setBasis(prev.basis);
      setMoneyUnit(prev.moneyUnit);
    });
    return () => { alive = false; };
  }, [entityId, fy, scope]);

  async function takeFile(f: File | undefined) {
    if (!f) return;
    setReading(true);
    try {
      const info = await readDsd(f);
      setDsd(info);
      setSeed('file');
      if (!info.notes.length) tell('이 파일에서 주석을 찾지 못했습니다. 다른 씨앗을 고르거나 나중에 채우세요.');
    } catch (e) {
      setDsd(null);
      tell(e instanceof Error ? e.message : '파일을 읽지 못했습니다.');
    } finally {
      setReading(false);
    }
  }

  /** 파일에서 읽은 주석을 목록 줄로. */
  function rowsFromFile(): NoteRow[] {
    const used = new Set<string>();
    return (dsd?.notes ?? []).map((n, i) => {
      let code = suggestCode(n.title, basis);
      while (used.has(code)) code += '_2';
      used.add(code);
      return {
        code, no: n.no, title: n.title, sheet: `N${String(n.no).padStart(2, '0')}`,
        enabled: true, source: '감사인' as const, assignee: null,
        status: DEFAULT_STATUS, memo: null, sortOrder: (i + 1) * 10,
      };
    });
  }

  async function submit() {
    setSay(null);
    if (!entityId) return tell('먼저 거래처를 고르세요 — 아래 목록에서 한 줄을 누르면 됩니다.');
    if (seed === 'file' && !dsd) return tell('작년 감사보고서(.dsd) 파일을 고르거나, 다른 씨앗을 고르세요.');
    setBusy(true);
    try {
      const id = await createEngagement({
        entityId, fy, scope, termNo: null,
        periodFrom: period.from, periodTo: period.to,
        basis, moneyUnit, seed,
        seedRows: seed === 'file' ? rowsFromFile() : undefined,
      });
      await onDone(id);
    } catch (e) {
      const m = e instanceof Error ? e.message : '만들지 못했습니다.';
      tell(m.includes('duplicate') ? `같은 거래처의 FY${fy} ${scope} 건이 이미 있습니다.` : m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 400,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div className="card" style={{ maxWidth: 580, width: '100%', maxHeight: '88vh', overflowY: 'auto', marginBottom: 0 }}>
        <div className="chdr">새 작업 건</div>

        <div className="frow"><span className="fl">거래처<span className="req">*</span></span>
          <div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input className="btn-sm" style={{ flex: 1, textAlign: 'left' }} placeholder="이름이나 코드로 찾기"
                value={q} onChange={(e) => setQ(e.target.value)} />
              <label style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', whiteSpace: 'nowrap' }}
                title="회계감사 계약이 있는 거래처만 봅니다">
                <input type="checkbox" checked={auditOnly} onChange={(e) => setAuditOnly(e.target.checked)} />{' '}
                감사계약만 ({auditIds.size})
              </label>
            </div>
            <select className="btn-sm" style={{ width: '100%', marginTop: 4 }} size={6}
              value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              {hits.map((e) => (
                <option key={e.id} value={e.id}>{e.code ? `${e.code} · ` : ''}{e.name}</option>
              ))}
            </select>
            {hits.length === 0 && (
              <div style={{ fontSize: 'var(--fs-1)', color: 'var(--warn)', marginTop: 3 }}>
                조건에 맞는 거래처가 없습니다. 「감사계약만」을 꺼 보세요.
              </div>
            )}
            <div style={{ fontSize: 'var(--fs-1)', marginTop: 3, color: entityId ? 'var(--good)' : 'var(--warn)' }}>
              {entityId
                ? `고른 거래처 · ${entities.find((x) => x.id === entityId)?.name ?? ''}`
                : '아직 고르지 않았습니다 — 위 목록에서 한 줄을 누르세요.'}
            </div>
          </div>
        </div>

        <div className="frow"><span className="fl">사업연도<span className="req">*</span></span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="btn-sm" style={{ width: 78 }} type="number" value={fy}
              onChange={(e) => setFy(Number(e.target.value))} />
            <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>결산일이 속한 해</span>
            <select className="btn-sm" value={scope} onChange={(e) => setScope(e.target.value as '별도' | '연결')}>
              <option>별도</option><option>연결</option>
            </select>
          </div>
        </div>

        <div className="frow"><span className="fl">대상기간<span className="req">*</span></span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="btn-sm" type="date" value={period.from}
              onChange={(e) => setPeriod((v) => ({ ...v, from: e.target.value }))} />
            <span style={{ color: 'var(--ink-3)' }}>~</span>
            <input className="btn-sm" type="date" value={period.to}
              onChange={(e) => setPeriod((v) => ({ ...v, to: e.target.value }))} />
            <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
              12월 결산이 아니거나 첫 사업연도면 고치세요
            </span>
          </div>
        </div>

        <div className="frow"><span className="fl">회계기준 · 단위</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <select className="btn-sm" value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
              <option>K-IFRS</option><option>일반기업회계기준</option>
            </select>
            <select className="btn-sm" value={moneyUnit} onChange={(e) => setMoneyUnit(e.target.value as '천원' | '원')}>
              <option>천원</option><option>원</option>
            </select>
            <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', alignSelf: 'center' }}>
              원화 금액만 환산합니다
            </span>
          </div>
        </div>

        <div className="frow" style={{ alignItems: 'start' }}><span className="fl">주석 목록</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label style={{ fontSize: 'var(--fs-2)' }}>
              <input type="radio" checked={seed === 'file'} onChange={() => setSeed('file')} />{' '}
              <b>작년 감사보고서(.dsd)에서 읽기</b>
              <span style={{ color: 'var(--ink-3)' }}> — 첫 해에 가장 빠릅니다</span>
              <div style={{ marginTop: 4, marginLeft: 18 }}>
                <input type="file" accept=".dsd" style={{ fontSize: 'var(--fs-1)' }}
                  onChange={(e) => void takeFile(e.target.files?.[0])} />
                {reading && <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}> 읽는 중…</span>}
                {dsd && (
                  <div style={{ fontSize: 'var(--fs-1)', color: 'var(--good)', marginTop: 3 }}>
                    {dsd.docName || 'DSD'} · 주석 <b>{dsd.notes.length}개</b>
                    {dsd.period ? ` · 이 파일은 ${dsd.period.from.slice(0, 4)}년 보고서입니다` : ''}
                    <span style={{ color: 'var(--ink-3)' }}> — 틀로만 씁니다. 대상기간은 위에서 정한 값이 들어갑니다</span>
                  </div>
                )}
                <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-4)', marginTop: 2 }}>
                  파일은 브라우저 안에서만 열리고 서버로 올라가지 않습니다.
                </div>
              </div>
            </label>
            <label style={{ fontSize: 'var(--fs-2)' }}>
              <input type="radio" checked={seed === 'previous'} disabled={prevFound === null}
                onChange={() => setSeed('previous')} />{' '}
              앞 해(FY{fy - 1}) 것 복제
              <span style={{ color: 'var(--ink-3)' }}>
                {prevFound === null
                  ? ` — 앱에 FY${fy - 1} 작업 건이 아직 없습니다(두 해째부터 쓸 수 있습니다)`
                  : ` — 주석 ${prevFound}개. 코드·시트·담당이 그대로 옵니다`}
              </span>
            </label>
            <label style={{ fontSize: 'var(--fs-2)' }}>
              <input type="radio" checked={seed === 'empty'} onChange={() => setSeed('empty')} />{' '}
              비워 두기
            </label>
          </div>
        </div>

        {say && (
          <div style={{
            marginTop: 10, padding: '8px 11px', borderRadius: 'var(--r-sm)',
            background: 'var(--bad-bg)', color: 'var(--bad)', fontSize: 'var(--fs-2)',
          }}>{say}</div>
        )}

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn-s" onClick={onClose}>그만두기</button>
          <button className="btn-p" disabled={busy} onClick={() => void submit()}>
            {busy ? '만드는 중…' : '만들기'}
          </button>
        </div>
      </div>
    </div>
  );
}
