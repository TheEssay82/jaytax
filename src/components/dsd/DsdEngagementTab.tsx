// 주석·DSD 관리 › ① 대상 거래처와 사업연도
//
// 이 화면이 하는 일은 둘뿐이다 — **「어느 회사의 어느 해를 다루는가」를 정하고, 그 해에 쓰는
// 주석 목록을 관리한다.** 검증(②)과 DSD 생성(③)은 이 목록을 읽어 돌아간다.
//
// ⚠️ 재무제표 파일은 여기로 올리지 않는다. 엑셀도 DSD 도 브라우저 안에서 열고 끝낸다.
//
// 주석 목록에서 가장 중요한 칸은 **코드**다. 주석 번호는 하나가 빠지면 통째로 밀리므로
// (올해 17번 무형자산이 내년엔 16번) 「엑셀 칸 ↔ DSD 칸」 대응표를 번호에 매달 수 없다.
import { useEffect, useMemo, useState } from 'react';
import Empty from '../common/Empty';
import { confirmDanger } from '../common/DangerConfirm';
import { listBizEntities, type BizEntityFull } from '../../lib/bizRegistryApi';
import {
  listEngagements, createEngagement, updateEngagement, deleteEngagement,
  listNotes, replaceNotes, findEngagement,
  type Engagement, type NoteRow, type Basis,
} from '../../lib/dsdApi';
import { template, templateSize, suggestCode, renumber, progress, termLabel } from '../../lib/dsdNotes';

const STATUS_COLOR: Record<string, string> = {
  미할당: 'var(--ink-3)', 작업중: 'var(--info)', 작업완료: 'var(--good)', 작성제외: 'var(--ink-4)',
};

export default function DsdEngagementTab() {
  const [engs, setEngs] = useState<Engagement[]>([]);
  const [ents, setEnts] = useState<BizEntityFull[]>([]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function load(keep?: string) {
    try {
      setErr(null);
      const [list, es] = await Promise.all([listEngagements(), listBizEntities()]);
      setEngs(list);
      setEnts(es);
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
      source: '감사인', assignee: null, status: '미할당', memo: null,
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
            ① 대상 거래처와 사업연도
          </span>
          <button className="btn-sm btn-sm-navy" style={{ marginLeft: 'auto' }} onClick={() => setAdding(true)}>
            + 새 건 만들기
          </button>
        </div>
        <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7 }}>
          여기서 정한 <b>주석 목록</b>을 ② 엑셀 검증과 ③ DSD 생성이 읽습니다.
          주석마다 붙는 <b>코드</b>는 해가 바뀌어도 변하지 않는 열쇠라, 다음 해에 「앞 해 복제」로
          대응표가 통째로 승계됩니다.
          <span style={{ color: 'var(--ink-3)' }}> 재무제표 파일은 저장하지 않습니다 — 브라우저 안에서만 열립니다.</span>
        </div>
      </div>

      {err && <div className="card" style={{ color: 'var(--bad)', background: 'var(--bad-bg)' }}>{err}</div>}
      {msg && (
        <div className="card" style={{ color: 'var(--good)', background: 'var(--good-bg)', display: 'flex' }}>
          {msg}
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setMsg(null)}>닫기</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 320px) minmax(0, 1fr)', gap: 10, alignItems: 'start' }}>
        {/* ── 작업 건 목록 ─────────────────────────── */}
        <div className="card" style={{ padding: '10px 10px 12px' }}>
          <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginBottom: 7, letterSpacing: '.04em' }}>
            작업 건 {engs.length}
          </div>
          {engs.length === 0 && <Empty text="아직 없습니다. 「새 건 만들기」로 시작하세요." />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {engs.map((e) => (
              <button
                key={e.id}
                onClick={() => void pick(e.id)}
                style={{
                  textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                  border: `1px solid ${e.id === pickedId ? 'var(--navy)' : 'var(--rule)'}`,
                  background: e.id === pickedId ? 'var(--navy-bg)' : '#fff',
                  borderRadius: 'var(--r-sm)', padding: '8px 10px',
                }}
              >
                <div style={{ fontSize: 'var(--fs-3)', fontWeight: 700, color: 'var(--navy)' }}>
                  {e.entityName}
                </div>
                <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', marginTop: 2 }}>
                  FY{e.fy} · {e.scope}{e.termNo ? ` · ${termLabel(e.termNo)}` : ''}
                </div>
                <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginTop: 2 }}>
                  {e.basis} · {e.moneyUnit} · 주석 {e.noteCount}
                  <span style={{ marginLeft: 6, color: e.status === '완료' ? 'var(--good)' : 'var(--ink-3)' }}>
                    {e.status}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── 고른 건의 주석 목록 ───────────────────── */}
        {!picked ? (
          <div className="card"><Empty text="왼쪽에서 작업 건을 고르세요." /></div>
        ) : (
          <div className="card">
            <div className="chdr">
              {picked.entityName}
              <span style={{ fontSize: 'var(--fs-2)', fontWeight: 400, color: 'var(--ink-2)' }}>
                FY{picked.fy} · {picked.scope} {picked.termNo ? `· ${termLabel(picked.termNo)}` : ''}
                {picked.periodFrom ? ` · ${picked.periodFrom} ~ ${picked.periodTo}` : ''}
              </span>
              <button className="btn-sm btn-sm-del" style={{ marginLeft: 'auto' }} onClick={() => void removeEng(picked)}>
                건 지우기
              </button>
            </div>

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
                    <th style={{ width: 150 }}>코드 <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(불변)</span></th>
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
                        <input className="btn-sm"
                          style={{ width: '100%', textAlign: 'left', fontFamily: 'var(--font-num, monospace)',
                            color: n.code.startsWith('X_') ? 'var(--warn)' : 'var(--ink-2)' }}
                          title={n.code.startsWith('X_') ? '표준 틀에 없는 주석이라 임시 코드입니다 — 알아보기 쉬운 코드로 고쳐 두세요.' : ''}
                          value={n.code} onChange={(ev) => edit(n.code, { code: ev.target.value.trim() })} />
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
              {notes.length === 0 && (
                <button className="btn-sm" onClick={() => { setNotes(template(picked.basis)); setDirty(true); }}>
                  표준 틀 채우기 ({templateSize(picked.basis)}개)
                </button>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-1)', color: dirty ? 'var(--warn)' : 'var(--ink-4)' }}>
                {dirty ? '저장하지 않은 변경이 있습니다' : '저장됨'}
              </span>
              <button className="btn-sm btn-sm-navy" disabled={!dirty} onClick={() => void save()}>저장</button>
            </div>
          </div>
        )}
      </div>

      {adding && (
        <NewEngagementModal
          entities={ents}
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

/** 새 작업 건 — 씨앗(무엇으로 주석 목록을 채울까)이 이 창의 핵심이다. */
function NewEngagementModal({ entities, onClose, onDone, onError }: {
  entities: BizEntityFull[];
  onClose: () => void;
  onDone: (id: string) => void | Promise<void>;
  onError: (m: string) => void;
}) {
  const thisYear = new Date().getFullYear();
  const [q, setQ] = useState('');
  const [entityId, setEntityId] = useState('');
  const [fy, setFy] = useState(thisYear - 1);
  const [scope, setScope] = useState<'별도' | '연결'>('별도');
  const [termNo, setTermNo] = useState('');
  const [basis, setBasis] = useState<Basis>('K-IFRS');
  const [moneyUnit, setMoneyUnit] = useState<'천원' | '원'>('천원');
  const [seed, setSeed] = useState<'template' | 'previous' | 'empty'>('template');
  const [prevFound, setPrevFound] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const hits = useMemo(() => {
    const t = q.trim();
    const base = t ? entities.filter((e) => e.name.includes(t) || (e.code ?? '').includes(t)) : entities;
    return base.slice(0, 40);
  }, [entities, q]);

  // 앞 해 건이 있으면 복제를 기본으로 — 그게 이 시스템의 값어치가 쌓이는 길이다.
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

  async function submit() {
    if (!entityId) return onError('거래처를 고르세요.');
    setBusy(true);
    try {
      const id = await createEngagement({
        entityId, fy, scope,
        termNo: termNo.trim() ? Number(termNo) : null,
        periodFrom: `${fy}-01-01`, periodTo: `${fy}-12-31`,
        basis, moneyUnit, seed,
      });
      await onDone(id);
    } catch (e) {
      const m = e instanceof Error ? e.message : '만들지 못했습니다.';
      onError(m.includes('duplicate') ? '같은 거래처·연도·구분의 건이 이미 있습니다.' : m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 400,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div className="card" style={{ maxWidth: 560, width: '100%', maxHeight: '86vh', overflowY: 'auto', marginBottom: 0 }}>
        <div className="chdr">새 작업 건</div>

        <div className="frow"><span className="fl">거래처<span className="req">*</span></span>
          <div>
            <input className="btn-sm" style={{ width: '100%', textAlign: 'left' }} placeholder="이름이나 코드로 찾기"
              value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="btn-sm" style={{ width: '100%', marginTop: 4 }} size={6}
              value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              {hits.map((e) => (
                <option key={e.id} value={e.id}>{e.code ? `${e.code} · ` : ''}{e.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="frow"><span className="fl">사업연도<span className="req">*</span></span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input className="btn-sm" style={{ width: 78 }} type="number" value={fy}
              onChange={(e) => setFy(Number(e.target.value))} />
            <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>결산일이 속한 해</span>
            <select className="btn-sm" value={scope} onChange={(e) => setScope(e.target.value as '별도' | '연결')}>
              <option>별도</option><option>연결</option>
            </select>
            <input className="btn-sm" style={{ width: 62 }} placeholder="기수" value={termNo}
              onChange={(e) => setTermNo(e.target.value.replace(/[^0-9]/g, ''))} />
          </div>
        </div>

        <div className="frow"><span className="fl">회계기준 · 단위</span>
          <div style={{ display: 'flex', gap: 6 }}>
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

        <div className="frow"><span className="fl">주석 목록</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 'var(--fs-2)' }}>
              <input type="radio" checked={seed === 'previous'} disabled={prevFound === null}
                onChange={() => setSeed('previous')} />{' '}
              <b>앞 해(FY{fy - 1}) 것 복제</b>
              <span style={{ color: 'var(--ink-3)' }}>
                {prevFound === null ? ' — 앞 해 건이 없습니다' : ` — 주석 ${prevFound}개. 코드·시트·담당이 그대로 옵니다`}
              </span>
            </label>
            <label style={{ fontSize: 'var(--fs-2)' }}>
              <input type="radio" checked={seed === 'template'} onChange={() => setSeed('template')} />{' '}
              표준 틀 <span style={{ color: 'var(--ink-3)' }}>— {basis} {templateSize(basis)}개</span>
            </label>
            <label style={{ fontSize: 'var(--fs-2)' }}>
              <input type="radio" checked={seed === 'empty'} onChange={() => setSeed('empty')} />{' '}
              비워 두기 <span style={{ color: 'var(--ink-3)' }}>— 나중에 DSD 에서 읽어 채웁니다</span>
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn-s" onClick={onClose}>그만두기</button>
          <button className="btn-p" disabled={busy || !entityId} onClick={() => void submit()}>
            {busy ? '만드는 중…' : '만들기'}
          </button>
        </div>
      </div>
    </div>
  );
}
