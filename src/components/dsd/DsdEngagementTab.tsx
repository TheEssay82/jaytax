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
  listNotes, replaceNotes, findEngagement, listAuditEntityIds,
  type Engagement, type NoteRow, type Basis,
} from '../../lib/dsdApi';
import {
  template, templateSize, suggestCode, renumber, progress,
  defaultAuditFy, defaultPeriod, DEFAULT_STATUS,
} from '../../lib/dsdNotes';
import { readDsd, type DsdInfo } from '../../lib/dsdFile';
import NoteSheetExport from './NoteSheetExport';
import NoteVerifyCard from './NoteVerifyCard';

const STATUS_COLOR: Record<string, string> = {
  미할당: 'var(--ink-3)', 작업중: 'var(--info)', 작업완료: 'var(--good)', 작성제외: 'var(--ink-4)',
};

export default function DsdEngagementTab() {
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

  async function load(keep?: string) {
    try {
      setErr(null);
      const [list, es, aud] = await Promise.all([listEngagements(), listBizEntities(), listAuditEntityIds()]);
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
                  FY{e.fy} · {e.scope}
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
                FY{picked.fy} · {picked.scope}
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

      {picked && notes.length > 0 && <NoteSheetExport eng={picked} notes={notes} />}
      {picked && notes.length > 0 && <NoteVerifyCard notes={notes} />}

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
  const [seed, setSeed] = useState<'template' | 'previous' | 'file' | 'empty'>('file');
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

  /** 파일에서 읽은 주석을 목록 줄로 — 코드는 표준 틀에서 짐작하고, 없으면 X_ 임시 코드다. */
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
              <input type="radio" checked={seed === 'template'} onChange={() => setSeed('template')} />{' '}
              사무소 표준 틀 <span style={{ color: 'var(--ink-3)' }}>— {basis} {templateSize(basis)}개</span>
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
