// 거래처관리 › 거래처담당자등록 (거래처관리 2.0.0 · step 3)
// 거래처(법인/개인)의 외부 담당자(연락처) 관리 + 기존 doc_contacts 1회성 이관(최고관리자).
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { listBizEntities, corpDisplayName, type BizEntityFull } from '../../lib/bizRegistryApi';
import {
  listBizContacts, createBizContact, updateBizContact, deleteBizContact,
  previewContactImport, runContactImport,
  type BizContact, type ContactInput, type ContactImportRow, type ContactImportResult,
} from '../../lib/bizContactApi';
import { ColFilter, scrollBox, stickyTop, useColWidths, ResizeHandle, clip } from './tableKit';

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
  const { widthOf, startResize } = useColWidths();
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
  const entLabel = (e: BizEntityFull) => `${e.code} ${corpDisplayName(e.name, e.corpForm, e.corpFormPosition)}`;
  const placeName = (e: BizEntityFull | undefined, pid: string | null) => (pid && e ? e.places.find((p) => p.id === pid)?.placeName ?? '' : '');

  // 거래처별 그룹(담당자 있는 거래처만)
  const groups = useMemo(() => {
    const m = new Map<string, BizContact[]>();
    for (const c of contacts) (m.get(c.entityId) ?? m.set(c.entityId, []).get(c.entityId)!).push(c);
    let arr = [...m.entries()].map(([eid, cs]) => ({ entity: entMap.get(eid), contacts: cs }));
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      arr = arr.filter(({ entity, contacts: cs }) =>
        (entity && entLabel(entity).toLowerCase().includes(s)) ||
        cs.some((c) => c.contactName.toLowerCase().includes(s) || c.phone.includes(s) || c.email.toLowerCase().includes(s) || c.address.toLowerCase().includes(s)));
    }
    arr.sort((a, b) => (a.entity ? entLabel(a.entity) : '').localeCompare(b.entity ? entLabel(b.entity) : '', 'ko'));
    return arr;
  }, [contacts, entMap, q]); // eslint-disable-line react-hooks/exhaustive-deps

  // 표(list)형 — 담당자 1행 플랫. 컬럼 val 로 필터·정렬.
  type CRow = { c: BizContact; e: BizEntityFull | undefined };
  const CONTACT_COLS: { key: string; label: string; val: (r: CRow) => string; w?: number; opts?: readonly string[] }[] = [
    { key: 'code', label: '코드', val: (r) => r.e?.code ?? '', w: 60 },
    { key: 'name', label: '거래처', val: (r) => (r.e ? corpDisplayName(r.e.name, r.e.corpForm, r.e.corpFormPosition) : ''), w: 150 },
    { key: 'place', label: '사업장', val: (r) => placeName(r.e, r.c.placeId), w: 100 },
    { key: 'contact', label: '담당자', val: (r) => `${r.c.contactName} ${r.c.honorific}`.trim(), w: 110 },
    { key: 'position', label: '직책', val: (r) => r.c.position, w: 80 },
    { key: 'primary', label: '대표', val: (r) => (r.c.isPrimary ? '대표' : ''), w: 46, opts: ['대표'] },
    { key: 'phone', label: '연락처', val: (r) => r.c.phone, w: 120 },
    { key: 'email', label: '이메일', val: (r) => r.c.email, w: 150 },
    { key: 'address', label: '수령지', val: (r) => r.c.address, w: 190 },
    { key: 'note', label: '비고', val: (r) => r.c.note, w: 120 },
  ];
  const tableW = CONTACT_COLS.reduce((s, c) => s + widthOf(c.key, c.w), 0) + (canWrite ? 96 : 0);
  const flatContacts = useMemo<CRow[]>(() => contacts.map((c) => ({ c, e: entMap.get(c.entityId) })), [contacts, entMap]);
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
  async function del(c: BizContact) {
    if (!confirm(`담당자 '${c.contactName}' 을 삭제할까요?`)) return;
    try { await deleteBizContact(c.id); await load(); flash('삭제됨'); }
    catch (e) { alert('삭제 실패: ' + (e instanceof Error ? e.message : e)); }
  }

  if (loading) return <div className="card">불러오는 중…</div>;

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        👤 거래처담당자등록
        <span style={{ fontSize: 11, fontWeight: 400, color: '#888' }}>거래처 {groups.length} · 담당자 {contacts.length}</span>
        {msg && <span style={{ marginLeft: 'auto', fontSize: 12, color: '#2a7' }}>{msg}</span>}
      </div>
      {error && <div style={{ color: '#c33', fontSize: 12, marginBottom: 8 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <button className={viewMode === 'box' ? 'btn-p' : 'btn-sm'} onClick={() => setViewMode('box')}>▤ 박스</button>
          <button className={viewMode === 'table' ? 'btn-p' : 'btn-sm'} onClick={() => setViewMode('table')}>▦ 표</button>
        </span>
        <input placeholder="🔍 거래처·담당자명·연락처·이메일·수령지" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
        {viewMode === 'table' && Object.keys(colF).length > 0 && <button className="btn-sm" onClick={() => setColF({})}>필터 초기화</button>}
        {canWrite && <button className="btn-p" onClick={() => { setShowAdd((s) => !s); setEditId(null); }}>{showAdd ? '닫기' : '＋ 신규 담당자'}</button>}
      </div>

      {showAdd && canWrite && <ContactForm entities={entities} onSubmit={(i) => persist(i)} onCancel={() => setShowAdd(false)} />}

      {role === 'superuser' && <ImportPanel onImported={load} />}

      {viewMode === 'table' && (
        <div style={scrollBox()}>
          <table style={{ tableLayout: 'fixed', width: tableW, borderCollapse: 'separate', borderSpacing: 0, fontSize: 11.5 }}>
            <colgroup>
              {CONTACT_COLS.map((col) => <col key={col.key} style={{ width: widthOf(col.key, col.w) }} />)}
              {canWrite && <col style={{ width: 96 }} />}
            </colgroup>
            <thead>
              <tr>
                {CONTACT_COLS.map((col) => (
                  <th key={col.key} style={{ ...thc, ...clip, height: 26, cursor: 'pointer', userSelect: 'none', ...stickyTop(0, '#f4efe4') }} onClick={() => toggleSort(col.key)} title="클릭: 정렬 · 우측 끝 드래그: 너비 조절">
                    {col.label}{sort?.key === col.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                    <ResizeHandle onMouseDown={startResize(col.key, widthOf(col.key, col.w))} />
                  </th>
                ))}
                {canWrite && <th style={{ ...thc, ...stickyTop(0, '#f4efe4') }}></th>}
              </tr>
              <tr>
                {CONTACT_COLS.map((col) => (
                  <th key={col.key} style={{ padding: 2, ...stickyTop(26, '#faf7f0') }}>
                    <ColFilter opts={col.opts} value={colF[col.key] || ''} onChange={(v) => setColF((p) => ({ ...p, [col.key]: v }))} />
                  </th>
                ))}
                {canWrite && <th style={{ padding: 2, ...stickyTop(26, '#faf7f0') }}></th>}
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 && <tr><td colSpan={CONTACT_COLS.length + (canWrite ? 1 : 0)} style={{ ...tdc, color: '#999', padding: 12 }}>조건에 맞는 담당자가 없습니다.</td></tr>}
              {sortedRows.map(({ c, e }) => (
                <tr key={c.id}>
                  {CONTACT_COLS.map((col) => <td key={col.key} style={{ ...tdc, ...clip, fontWeight: col.key === 'name' || col.key === 'contact' ? 600 : 400, borderTop: '1px solid #eee' }} title={col.val({ c, e })}>{col.val({ c, e })}</td>)}
                  {canWrite && (
                    <td style={{ ...tdc, borderTop: '1px solid #eee' }}>
                      <span style={{ display: 'flex', gap: 3 }}>
                        <button className="btn-sm btn-sm-blue" onClick={() => { setViewMode('box'); setEditId(c.id); setShowAdd(false); }}>수정</button>
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
        {groups.length === 0 && <div style={{ color: '#999', fontSize: 12, padding: 12 }}>등록된 담당자가 없습니다.</div>}
        {groups.map(({ entity, contacts: cs }) => (
          <div key={entity?.id ?? Math.random()} style={{ border: '1px solid #e6e0d8', borderRadius: 6, padding: '8px 10px' }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#345', marginBottom: 4 }}>
              {entity ? entLabel(entity) : '(삭제된 거래처)'} <span style={{ fontSize: 10.5, fontWeight: 400, color: '#999' }}>담당자 {cs.length}</span>
            </div>
            {cs.map((c) => (
              <div key={c.id}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5, flexWrap: 'wrap', padding: '2px 0' }}>
                  <b>{c.contactName} {c.honorific}</b>
                  {c.position && <span style={{ color: '#888' }}>{c.position}</span>}
                  {c.isPrimary && <span style={{ fontSize: 9.5, background: '#2a8', color: '#fff', padding: '1px 5px', borderRadius: 3 }}>대표</span>}
                  {c.phone && <span>☎ {c.phone}</span>}
                  {c.email && <span>✉ {c.email}</span>}
                  {c.placeId && entity && <span style={{ color: '#77a' }}>[{placeName(entity, c.placeId)}]</span>}
                  {c.address && <span style={{ color: '#777' }}>📮 {c.address}</span>}
                  {c.note && <span style={{ color: '#999' }}>· {c.note}</span>}
                  {canWrite && (
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                      <button className="btn-sm btn-sm-blue" onClick={() => { setEditId(c.id); setShowAdd(false); }}>수정</button>
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
      <div style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 8 }}>{initial ? '✏️ 담당자 수정' : '＋ 새 거래처담당자'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
        <div className="frow"><span className="fl">거래처<span className="req">*</span></span>
          <>
            <input list="bc-entity" value={entityText} onChange={(e) => onEntityText(e.target.value)} placeholder="코드·거래처명 입력·선택" />
            <datalist id="bc-entity">{entities.map((e) => <option key={e.id} value={entLabel(e)} />)}</datalist>
          </></div>
        <div className="frow"><span className="fl">사업장(선택)</span>
          <select value={placeId} onChange={(e) => setPlaceId(e.target.value)} style={{ padding: '4px 7px', fontSize: 12 }} disabled={!entity}>
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
        <div className="frow"><span className="fl">이메일</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="(선택)" /></div>
        <div className="frow" style={{ gridColumn: '1 / -1' }}><span className="fl">수령지주소</span>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="(선택)" /></div>
        <div className="frow" style={{ gridColumn: '1 / -1' }}><span className="fl">비고 · 대표</span>
          <span style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%' }}>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="(선택)" style={{ flex: 1 }} />
            <label style={{ fontSize: 11.5, display: 'flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} /> 대표 연락처
            </label>
          </span></div>
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
        <button className="btn-p" onClick={() => onSubmit({ entityId, placeId: placeId || null, contactName: name, honorific, position, phone, email, address, isPrimary, note })}>{initial ? '저장' : '담당자 등록'}</button>
        <button className="btn-sm" onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}

// ── doc_contacts 1회성 이관 패널(최고관리자) ────────────────
function ImportPanel({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ContactImportRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ContactImportResult | null>(null);

  async function preview() {
    setLoading(true); setResult(null);
    try { setRows(await previewContactImport()); }
    catch (e) { alert('미리보기 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setLoading(false); }
  }
  async function run() {
    if (!rows) return;
    const target = rows.filter((r) => r.entityId && !r.exists);
    if (!target.length) return alert('이관할 신규 담당자가 없습니다.');
    if (!confirm(`${target.length}명을 거래처담당자로 이관합니다. 진행할까요?`)) return;
    setLoading(true);
    try { const r = await runContactImport(rows); setResult(r); onImported(); await preview(); }
    catch (e) { alert('이관 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setLoading(false); }
  }
  const newCnt = rows?.filter((r) => r.entityId && !r.exists).length ?? 0;
  const unmatched = rows?.filter((r) => !r.entityId).length ?? 0;

  return (
    <div style={{ border: '1px dashed #c9a54a', borderRadius: 6, background: '#fdfaf1', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#8a6d1f' }}>📥 문서발송 담당자 이관</span>
        <span style={{ fontSize: 11, color: '#a88' }}>최고관리자 · 1회성 (doc_contacts → 거래처담당자)</span>
        <span style={{ marginLeft: 'auto', fontSize: 12 }}>{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div style={{ padding: '0 10px 10px' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            <button className="btn-sm btn-sm-blue" disabled={loading} onClick={preview}>{loading ? '처리 중…' : '🔍 미리보기'}</button>
            {rows && <span style={{ fontSize: 12, color: '#555' }}>신규 <b>{newCnt}</b> · 미매칭 {unmatched} · 전체 {rows.length}</span>}
            {rows && <button className="btn-p" disabled={loading || newCnt === 0} onClick={run} style={{ marginLeft: 'auto' }}>신규 {newCnt}명 이관</button>}
          </div>
          {result && <div style={{ fontSize: 12, background: '#eef7ee', border: '1px solid #cbe3cb', borderRadius: 5, padding: '6px 8px', marginBottom: 8, color: '#256b25' }}>✓ 이관 — 생성 {result.created} · 건너뜀 {result.skipped} · 미매칭(제외) {result.unmatched}</div>}
          {rows && rows.length > 0 && (
            <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid #eee', borderRadius: 5 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead><tr style={{ background: '#f4efe4', position: 'sticky', top: 0 }}>
                  <th style={thc}>담당자</th><th style={thc}>회사(원본)</th><th style={thc}>매칭 거래처</th><th style={thc}>연락처</th><th style={thc}>상태</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} style={{ borderTop: '1px solid #eee', opacity: !r.entityId || r.exists ? 0.5 : 1 }}>
                      <td style={{ ...tdc, fontWeight: 600 }}>{r.contactName} {r.honorific}</td>
                      <td style={tdc}>{r.company}</td>
                      <td style={tdc}>{r.entityLabel}</td>
                      <td style={tdc}>{r.phone}</td>
                      <td style={tdc}>{!r.entityId ? <span style={{ color: '#c33' }}>미매칭</span> : r.exists ? <span style={{ color: '#999' }}>이미있음</span> : <span style={{ color: '#2a8', fontWeight: 700 }}>신규</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const thc: React.CSSProperties = { padding: '5px 6px', textAlign: 'left', fontWeight: 700, color: '#555', whiteSpace: 'nowrap' };
const tdc: React.CSSProperties = { padding: '4px 6px', whiteSpace: 'nowrap' };
