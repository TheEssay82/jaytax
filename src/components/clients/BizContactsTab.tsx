// 거래처관리 › 거래처담당자등록 (거래처관리 2.0.0 · step 3)
// 거래처(법인/개인)의 외부 담당자(연락처) 관리. 여기가 담당자 정보의 유일한 등록·수정 창구이며,
// 문서발송 발송요청·조회서등록은 0070 별칭 동기화로 이 데이터를 그대로 쓴다.
import { useEffect, useMemo, useState } from 'react';
import { displayName } from '../../lib/honorific';
import { EmptyRow } from '../common/Empty';
import Loading from '../common/Loading';
import { useAuth } from '../../context/AuthContext';
import { listBizEntities, corpDisplayName, type BizEntityFull } from '../../lib/bizRegistryApi';
import {
  listBizContacts, createBizContact, updateBizContact, deleteBizContact, setContactActive,
  type BizContact, type ContactInput,
} from '../../lib/bizContactApi';
import {
  exportContactTemplate, parseContactExcelFile, applyContactExcel, type ContactExcelResult,
} from '../../lib/bizContactExcel';
import { ColFilter, scrollBox, stickyTop, useTableView, ColumnSettings, ResizeHandle, clip } from './tableKit';
import { VIEW_KEYS } from '../../lib/tableViewApi';

export default function BizContactsTab() {
  const { readonly, role } = useAuth();
  const canWrite = !readonly && role !== 'per_head_accountant'; // 인당회계사는 조회 전용
  const [entities, setEntities] = useState<BizEntityFull[]>([]);
  const [contacts, setContacts] = useState<BizContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'box' | 'table'>('table');
  const tv = useTableView(VIEW_KEYS.bizContacts);
  const { widthOf, startResize } = tv;
  const [colF, setColF] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  async function load() {
    try {
      setError(null);
      const [ents, cts] = await Promise.all([listBizEntities(), listBizContacts()]);
      setEntities(ents); setContacts(cts);
    } catch (e) { setError(e instanceof Error ? e.message : '불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(''), 2500); }

  const entMap = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  /** 이직·퇴사로 접어 둔 담당자까지 볼지. 기본은 유효한 사람만 본다. */
  const [showLeft, setShowLeft] = useState(false);
  /**
   * 표에서 '수정'을 누르면 박스 화면으로 넘어가는데, 화면이 맨 위로 올라가 그 거래처를 다시 찾아야 했다.
   * 넘어간 뒤 그 행으로 내려가 준다.
   */
  useEffect(() => {
    if (viewMode !== 'box' || !editId) return;
    // 목록이 길면(계약 266건) 한 번만 불러서는 아직 그려지기 전이라 그냥 지나간다.
    // 그려진 뒤 다시 한 번 더 부른다. smooth 는 재렌더에 끊겨서 쓰지 않는다.
    const jump = () => document.getElementById(`contact-${editId}`)?.scrollIntoView({ block: 'center' });
    const raf = requestAnimationFrame(jump);
    const t = setTimeout(jump, 250);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [viewMode, editId]);
  const leftCount = contacts.filter((c) => !c.active).length;
  /** 목록의 바탕이 되는 담당자 — 접힌 사람은 기본으로 뺀다. */
  const liveContacts = useMemo(
    () => (showLeft ? contacts : contacts.filter((c) => c.active)),
    [contacts, showLeft],
  );
  const entLabel = (e: BizEntityFull) => `${e.code} ${corpDisplayName(e.name, e.corpForm, e.corpFormPosition)}`;
  const placeName = (e: BizEntityFull | undefined, pid: string | null) => (pid && e ? e.places.find((p) => p.id === pid)?.placeName ?? '' : '');

  // 거래처별 그룹(담당자 있는 거래처만)
  const groups = useMemo(() => {
    const m = new Map<string, BizContact[]>();
    for (const c of liveContacts) (m.get(c.entityId) ?? m.set(c.entityId, []).get(c.entityId)!).push(c);
    let arr = [...m.entries()].map(([eid, cs]) => ({ entity: entMap.get(eid), contacts: cs }));
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      arr = arr.filter(({ entity, contacts: cs }) =>
        (entity && entLabel(entity).toLowerCase().includes(s)) ||
        cs.some((c) => c.contactName.toLowerCase().includes(s) || c.phone.includes(s) || c.email.toLowerCase().includes(s) || c.address.toLowerCase().includes(s)));
    }
    arr.sort((a, b) => (a.entity ? entLabel(a.entity) : '').localeCompare(b.entity ? entLabel(b.entity) : '', 'ko'));
    return arr;
  }, [liveContacts, entMap, q]); // eslint-disable-line react-hooks/exhaustive-deps

  // 표(list)형 — 담당자 1행 플랫. 컬럼 val 로 필터·정렬.
  type CRow = { c: BizContact; e: BizEntityFull | undefined };
  const CONTACT_COLS: { key: string; label: string; val: (r: CRow) => string; w?: number; opts?: readonly string[] }[] = [
    { key: 'code', label: '코드', val: (r) => r.e?.code ?? '', w: 60 },
    { key: 'name', label: '거래처', val: (r) => (r.e ? corpDisplayName(r.e.name, r.e.corpForm, r.e.corpFormPosition) : ''), w: 150 },
    { key: 'place', label: '사업장', val: (r) => placeName(r.e, r.c.placeId), w: 100 },
    { key: 'contact', label: '담당자', val: (r) => displayName(r.c.contactName, r.c.honorific), w: 110 },
    { key: 'position', label: '직책', val: (r) => r.c.position, w: 80 },
    { key: 'primary', label: '대표', val: (r) => (r.c.isPrimary ? '대표' : ''), w: 46, opts: ['대표'] },
    { key: 'phone', label: '연락처', val: (r) => r.c.phone, w: 120 },
    { key: 'fax', label: '팩스', val: (r) => r.c.fax, w: 110 },
    { key: 'email', label: '이메일', val: (r) => r.c.email, w: 150 },
    { key: 'address', label: '수령지', val: (r) => r.c.address, w: 190 },
    { key: 'note', label: '비고', val: (r) => r.c.note, w: 120 },
    {
      key: 'active', label: '상태', w: 96, opts: ['유효', '이직·퇴사'],
      val: (r) => (r.c.active ? '유효' : `이직·퇴사${r.c.leftAt ? ` ${r.c.leftAt}` : ''}${r.c.leftNote ? ` (${r.c.leftNote})` : ''}`),
    },
  ];
  // 숨긴 열은 표에서만 뺀다 — 필터·정렬은 전체 열 기준 그대로다.
  const orderedCols = tv.orderCols(CONTACT_COLS);       // 개인 표시순서 적용
  const shownCols = orderedCols.filter((c) => !tv.isHidden(c.key));
  const tableW = shownCols.reduce((s, c) => s + widthOf(c.key, c.w), 0) + (canWrite ? 96 : 0);
  const flatContacts = useMemo<CRow[]>(() => liveContacts.map((c) => ({ c, e: entMap.get(c.entityId) })), [liveContacts, entMap]);
  const tableRows = useMemo(() => flatContacts.filter(({ c, e }) => {
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      const hit = (e && entLabel(e).toLowerCase().includes(s)) || c.contactName.toLowerCase().includes(s) || c.phone.includes(s) || c.email.toLowerCase().includes(s) || c.address.toLowerCase().includes(s);
      if (!hit) return false;
    }
    return CONTACT_COLS.every((col) => { const fv = (colF[col.key] || '').trim().toLowerCase(); return !fv || col.val({ c, e }).toLowerCase().includes(fv); });
  }), [flatContacts, q, colF]); // eslint-disable-line react-hooks/exhaustive-deps
  const sortedRows = useMemo(() => {
    if (!sort) return tableRows;
    const col = CONTACT_COLS.find((c) => c.key === sort.key);
    if (!col) return tableRows;
    return [...tableRows].sort((a, b) => { const cmp = col.val(a).localeCompare(col.val(b), 'ko'); return sort.dir === 'asc' ? cmp : -cmp; });
  }, [tableRows, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleSort = (key: string) => setSort((s) => (s?.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' }));

  async function persist(input: ContactInput, existingId?: string) {
    if (!input.entityId) return alert('거래처를 선택하세요.');
    if (!input.contactName.trim()) return alert('담당자명을 입력하세요.');
    try {
      if (existingId) await updateBizContact(existingId, input); else await createBizContact(input);
      setShowAdd(false); setEditId(null); await load();
      flash(existingId ? '✓ 담당자 수정됨' : '✓ 담당자 등록됨');
    } catch (e) { alert('저장 실패: ' + (e instanceof Error ? e.message : e)); }
  }
  /**
   * 이직·퇴사 처리 — 지우지 않고 접는다.
   * 지난 문서발송·세금계산서가 그 사람 앞으로 나간 기록이라 지우면 되짚을 수 없다.
   */
  async function toggleActive(c: BizContact) {
    if (c.active) {
      const note = prompt(`'${c.contactName}' 을 더 이상 쓰지 않는 연락처로 접습니다.\n\n사유(퇴사·이직·담당변경 등)`, '퇴사');
      if (note === null) return;
      try {
        await setContactActive(c.id, false, { leftNote: note });
        await load(); flash(`✓ ${c.contactName} — 이직·퇴사 처리`);
      } catch (e) { alert('처리 실패: ' + (e instanceof Error ? e.message : e)); }
    } else {
      if (!confirm(`'${c.contactName}' 을 다시 유효한 담당자로 되돌릴까요?`)) return;
      try { await setContactActive(c.id, true); await load(); flash(`✓ ${c.contactName} — 되살림`); }
      catch (e) { alert('처리 실패: ' + (e instanceof Error ? e.message : e)); }
    }
  }
  async function del(c: BizContact) {
    if (!confirm(`담당자 '${c.contactName}' 을 삭제할까요?`)) return;
    try { await deleteBizContact(c.id); await load(); flash('삭제됨'); }
    catch (e) { alert('삭제 실패: ' + (e instanceof Error ? e.message : e)); }
  }

  if (loading) return <Loading title="👤 거래처담당자등록" rows={9} />;

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        👤 거래처담당자등록
        <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>
          거래처 {groups.length} · 담당자 {liveContacts.length}
          {leftCount > 0 && <span style={{ color: 'var(--ink-4)' }}> (이직·퇴사 {leftCount} 제외)</span>}
        </span>
        {msg && <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-2)', color: 'var(--good)' }}>{msg}</span>}
      </div>
      {error && <div style={{ color: 'var(--bad)', fontSize: 'var(--fs-2)', marginBottom: 8 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <button className={viewMode === 'box' ? 'btn-p' : 'btn-sm'} onClick={() => setViewMode('box')}>▤ 박스</button>
          <button className={viewMode === 'table' ? 'btn-p' : 'btn-sm'} onClick={() => setViewMode('table')}>▦ 표</button>
        </span>
        <input placeholder="🔍 거래처·담당자명·연락처·이메일·수령지" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
        {leftCount > 0 && (
          <label style={{ fontSize: 'var(--fs-1)', whiteSpace: 'nowrap', cursor: 'pointer' }}
            title="이직·퇴사로 접어 둔 연락처까지 함께 봅니다">
            <input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} />
            {' '}이직·퇴사 포함 ({leftCount})
          </label>
        )}
        {viewMode === 'table' && Object.keys(colF).length > 0 && <button className="btn-sm" onClick={() => setColF({})}>필터 초기화</button>}
        {viewMode === 'table' && <ColumnSettings cols={orderedCols} view={tv} onMessage={flash} />}
        {canWrite && <button className="btn-p" onClick={() => { setShowAdd((s) => !s); setEditId(null); }}>{showAdd ? '닫기' : '＋ 신규 담당자'}</button>}
      </div>

      {showAdd && canWrite && <ContactForm entities={entities} onSubmit={(i) => persist(i)} onCancel={() => setShowAdd(false)} />}

      {role === 'superuser' && <ContactImportPanel entities={entities} contacts={contacts} onImported={load} />}

      {viewMode === 'table' && (
        <div className="tbl-scroll" style={scrollBox()}>
          <table style={{ tableLayout: 'fixed', width: tableW, borderCollapse: 'separate', borderSpacing: 0, fontSize: 'var(--fs-1)' }}>
            <colgroup>
              {shownCols.map((col) => <col key={col.key} style={{ width: widthOf(col.key, col.w) }} />)}
              {canWrite && <col style={{ width: 96 }} />}
            </colgroup>
            <thead>
              <tr>
                {shownCols.map((col) => (
                  <th key={col.key} style={{ ...thc, ...clip, height: 26, cursor: 'pointer', userSelect: 'none', ...stickyTop(0, '#f4efe4') }} onClick={() => toggleSort(col.key)} title="클릭: 정렬 · 우측 끝 드래그: 너비 조절">
                    {col.label}{sort?.key === col.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                    <ResizeHandle onMouseDown={startResize(col.key, widthOf(col.key, col.w))} onAutoFit={(px) => tv.setWidth(col.key, px)} />
                  </th>
                ))}
                {canWrite && <th style={{ ...thc, ...stickyTop(0, '#f4efe4') }}></th>}
              </tr>
              <tr>
                {shownCols.map((col) => (
                  <th key={col.key} style={{ padding: 2, ...stickyTop(26, '#faf7f0') }}>
                    <ColFilter opts={col.opts} value={colF[col.key] || ''} onChange={(v) => setColF((p) => ({ ...p, [col.key]: v }))} />
                  </th>
                ))}
                {canWrite && <th style={{ padding: 2, ...stickyTop(26, '#faf7f0') }}></th>}
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 && (
                <EmptyRow colSpan={shownCols.length + (canWrite ? 1 : 0)}
                  text="조건에 맞는 담당자가 없습니다"
                  hint="열 아래 칸에 넣은 값으로 걸러서 비었을 수 있습니다."
                  action={{ label: '필터 초기화', onClick: () => setColF({}) }} />
              )}
              {sortedRows.map(({ c, e }) => (
                <tr key={c.id} style={{ opacity: c.active ? 1 : 0.5 }}>
                  {shownCols.map((col) => <td key={col.key} style={{ ...tdc, ...clip, fontWeight: col.key === 'name' || col.key === 'contact' ? 600 : 400, borderTop: '1px solid var(--rule-2)' }} title={col.val({ c, e })}>{col.val({ c, e })}</td>)}
                  {canWrite && (
                    <td style={{ ...tdc, borderTop: '1px solid var(--rule-2)' }}>
                      <span style={{ display: 'flex', gap: 3 }}>
                        <button className="btn-sm btn-sm-blue" onClick={() => { setViewMode('box'); setEditId(c.id); setShowAdd(false); }}>수정</button>
                        <button className="btn-sm" title={c.active ? '이직·퇴사로 더 이상 쓰지 않는 연락처로 접습니다(기록은 남습니다)' : '다시 유효한 담당자로'}
                          onClick={() => void toggleActive(c)}>{c.active ? '이직·퇴사' : '되살리기'}</button>
                        <button className="btn-sm btn-sm-del" onClick={() => del(c)}>삭제</button>
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewMode === 'box' && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {groups.length === 0 && <div style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-2)', padding: 12 }}>등록된 담당자가 없습니다.</div>}
        {groups.map(({ entity, contacts: cs }) => (
          <div key={entity?.id ?? Math.random()} style={{ border: '1px solid var(--rule)', borderRadius: 6, padding: '8px 10px' }}>
            <div style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: '#345', marginBottom: 4 }}>
              {entity ? entLabel(entity) : '(삭제된 거래처)'} <span style={{ fontSize: 'var(--fs-0)', fontWeight: 400, color: 'var(--ink-3)' }}>담당자 {cs.length}</span>
            </div>
            {cs.map((c) => (
              <div key={c.id} id={`contact-${c.id}`}
                style={editId === c.id ? { outline: '2px solid #c9a54a', borderRadius: 4 } : undefined}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--fs-1)', flexWrap: 'wrap', padding: '2px 0' }}>
                  <b style={{ textDecoration: c.active ? undefined : 'line-through' }}>{displayName(c.contactName, c.honorific)}</b>
                  {!c.active && (
                    <span style={{ fontSize: 9.5, background: 'var(--ink-3)', color: '#fff', padding: '1px 5px', borderRadius: 3 }}
                      title={`${c.leftAt ?? ''} ${c.leftNote ?? ''}`.trim()}>이직·퇴사</span>
                  )}
                  {c.position && <span style={{ color: 'var(--ink-3)' }}>{c.position}</span>}
                  {c.isPrimary && <span style={{ fontSize: 9.5, background: '#2a8', color: '#fff', padding: '1px 5px', borderRadius: 3 }}>대표</span>}
                  {c.phone && <span>☎ {c.phone}</span>}
                  {c.fax && <span>📠 {c.fax}</span>}
                  {c.email && <span>✉ {c.email}</span>}
                  {c.placeId && entity && <span style={{ color: '#77a' }}>[{placeName(entity, c.placeId)}]</span>}
                  {c.address && <span style={{ color: '#777' }}>📮 {c.address}</span>}
                  {c.note && <span style={{ color: 'var(--ink-3)' }}>· {c.note}</span>}
                  {canWrite && (
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                      <button className="btn-sm btn-sm-blue" onClick={() => { setEditId(c.id); setShowAdd(false); }}>수정</button>
                      <button className="btn-sm" onClick={() => void toggleActive(c)}>{c.active ? '이직·퇴사' : '되살리기'}</button>
                      <button className="btn-sm btn-sm-del" onClick={() => del(c)}>삭제</button>
                    </span>
                  )}
                </div>
                {editId === c.id && canWrite && (
                  <ContactForm entities={entities} initial={c} onSubmit={(i) => persist(i, c.id)} onCancel={() => setEditId(null)} />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

// ── 담당자 등록/수정 폼 ─────────────────────────────────────
function ContactForm({ entities, initial, onSubmit, onCancel }: {
  entities: BizEntityFull[]; initial?: BizContact; onSubmit: (i: ContactInput) => void; onCancel: () => void;
}) {
  const entLabel = (e: BizEntityFull) => `${e.code} ${corpDisplayName(e.name, e.corpForm, e.corpFormPosition)}`;
  const [entityId, setEntityId] = useState(initial?.entityId ?? '');
  const [entityText, setEntityText] = useState(() => { const e = entities.find((x) => x.id === initial?.entityId); return e ? entLabel(e) : ''; });
  const [placeId, setPlaceId] = useState(initial?.placeId ?? '');
  const [name, setName] = useState(initial?.contactName ?? '');
  const [honorific, setHonorific] = useState(initial?.honorific ?? '님');
  const [position, setPosition] = useState(initial?.position ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [fax, setFax] = useState(initial?.fax ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [isPrimary, setIsPrimary] = useState(initial?.isPrimary ?? false);
  const [note, setNote] = useState(initial?.note ?? '');
  const entity = entities.find((e) => e.id === entityId);

  function onEntityText(v: string) {
    setEntityText(v);
    const t = v.trim(); const code = t.split(/\s+/)[0];
    const m = entities.find((e) => entLabel(e) === t || e.code === code);
    setEntityId(m?.id ?? ''); setPlaceId('');
  }

  return (
    <div className="card" style={{ background: '#F5F1EB', marginBottom: 10 }}>
      <div style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--ink-2)', marginBottom: 8 }}>{initial ? '✏️ 담당자 수정' : '＋ 새 거래처담당자'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
        <div className="frow"><span className="fl">거래처<span className="req">*</span></span>
          <>
            <input list="bc-entity" value={entityText} onChange={(e) => onEntityText(e.target.value)} placeholder="코드·거래처명 입력·선택" />
            <datalist id="bc-entity">{entities.map((e) => <option key={e.id} value={entLabel(e)} />)}</datalist>
          </></div>
        <div className="frow"><span className="fl">사업장(선택)</span>
          <select value={placeId} onChange={(e) => setPlaceId(e.target.value)} style={{ padding: '4px 7px', fontSize: 'var(--fs-2)' }} disabled={!entity}>
            <option value="">전체(거래처 단위)</option>
            {entity?.places.map((p) => <option key={p.id} value={p.id}>{p.placeName}</option>)}
          </select></div>
        <div className="frow"><span className="fl">담당자명<span className="req">*</span></span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 홍길동" /></div>
        <div className="frow"><span className="fl">호칭 · 직책</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <input value={honorific} onChange={(e) => setHonorific(e.target.value)} placeholder="님" style={{ width: 60 }} />
            <input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="직책(선택)" />
          </span></div>
        <div className="frow"><span className="fl">연락처</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000" /></div>
        <div className="frow"><span className="fl">팩스</span>
          <input value={fax} onChange={(e) => setFax(e.target.value)} placeholder="02-000-0000" /></div>
        <div className="frow"><span className="fl">이메일</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="(선택)" /></div>
        <div className="frow" style={{ gridColumn: '1 / -1' }}><span className="fl">수령지주소</span>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="(선택)" /></div>
        <div className="frow" style={{ gridColumn: '1 / -1' }}><span className="fl">비고 · 대표</span>
          <span style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%' }}>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="(선택)" style={{ flex: 1 }} />
            <label style={{ fontSize: 'var(--fs-1)', display: 'flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} /> 대표 연락처
            </label>
          </span></div>
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
        <button className="btn-p" onClick={() => onSubmit({ entityId, placeId: placeId || null, contactName: name, honorific, position, phone, fax, email, address, isPrimary, note })}>{initial ? '저장' : '담당자 등록'}</button>
        <button className="btn-sm" onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}

const thc: React.CSSProperties = { padding: '5px 6px', textAlign: 'left', fontWeight: 700, color: 'var(--ink-2)', whiteSpace: 'nowrap' };
const tdc: React.CSSProperties = { padding: '4px 6px', whiteSpace: 'nowrap' };

// ── 거래처담당자 일괄등록 패널(최고관리자) ──────────────────
function ContactImportPanel({ entities, contacts, onImported }: { entities: BizEntityFull[]; contacts: BizContact[]; onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ContactExcelResult | null>(null);

  async function doExport() {
    try { await exportContactTemplate(entities, contacts); }
    catch (e) { alert('내보내기 실패: ' + (e instanceof Error ? e.message : e)); }
  }
  async function onFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    if (!confirm('업로드한 Excel로 거래처담당자를 일괄 등록합니다. (담당자명이 채워진 행만 · 같은 거래처에 담당자명+연락처가 같은 건은 스킵) 진행할까요?')) return;
    setBusy(true); setResult(null);
    try {
      const rows = await parseContactExcelFile(file);
      const r = await applyContactExcel(rows, entities);
      setResult(r);
      onImported();
    } catch (e) { alert('업로드 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ border: '1px dashed #c9a54a', borderRadius: 6, background: '#fdfaf1', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <span style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: '#8a6d1f' }}>📥 거래처담당자 일괄등록 (Excel)</span>
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>최고관리자 · 거래처코드로 매칭</span>
        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-2)' }}>{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div style={{ padding: '0 10px 10px' }}>
          <div style={{ fontSize: 'var(--fs-1)', color: '#777', marginBottom: 8 }}>
            <b>양식 내보내기</b> → <b>회색 열</b>=담당자ID·거래처코드·거래처명(키/참고, 수정금지),
            <b>노란 칸</b>=입력·수정(담당자명·호칭·직책·연락처·이메일·수령지 등) → <b>업로드</b>.
            <b>담당자ID 있는 행</b>=그 담당자 <b>수정</b>, <b>없는 행</b>=신규(한 거래처에 여럿이면 행 복사·ID 는 비움).
            <b>담당자명 빈 행 제외</b>, 신규 중 같은 거래처에 담당자명+연락처가 같은 건은 <b>스킵</b>.
            사업장명을 비우면 거래처 전체 담당자로 등록됩니다.
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn-sm btn-sm-blue" onClick={doExport} disabled={busy || entities.length === 0}>
              📤 양식 내보내기 (거래처 {entities.length} · 담당자 {contacts.length})
            </button>
            <label className="btn-p" style={{ cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
              {busy ? '처리 중…' : '📥 Excel 업로드'}
              <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} disabled={busy} onChange={onFile} />
            </label>
          </div>
          {result && (
            <div style={{ fontSize: 'var(--fs-2)', background: result.failed.length ? '#fbf0ee' : '#eef7ee', border: `1px solid ${result.failed.length ? '#e3cbcb' : '#cbe3cb'}`, borderRadius: 5, padding: '6px 8px', marginTop: 8, color: '#256b25' }}>
              <div>✓ 완료 — 신규 {result.created} · 수정 {result.updated} · 스킵(중복) {result.skipped} {result.failed.length > 0 && <span style={{ color: 'var(--bad)' }}>· 실패 {result.failed.length}</span>}</div>
              {result.failed.length > 0 && (
                <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: 'var(--bad)' }}>
                  {result.failed.slice(0, 12).map((f, i) => <li key={i}><b>{f.ref}</b>: {f.error}</li>)}
                  {result.failed.length > 12 && <li>… 외 {result.failed.length - 12}건</li>}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
