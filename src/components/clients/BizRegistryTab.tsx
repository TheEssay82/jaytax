// 거래처관리 › 거래처등록 (거래처관리 2.0.0 · step 1)
// 귀속주체(법인/개인) → 사업장(본사 강제) 등록 + 담당직원 배정 + 대표이사/공동사업자 + 민감정보 열람.
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import BizImportPanel from './BizImportPanel';
import {
  listBizEntities,
  listInternalStaff,
  createBizEntity,
  updateBizEntity,
  deleteBizEntity,
  createBizPlace,
  updateBizPlace,
  deleteBizPlace,
  setPlaceHometaxPw,
  setEntityResident,
  CPA_OPTIONS,
  createBizRepresentative,
  deleteBizRepresentative,
  createBizPartner,
  deleteBizPartner,
  assignStaff,
  unassignStaff,
  revealEntityResident,
  revealRepResident,
  revealPlaceHometaxPw,
  createBizRelation,
  deleteBizRelation,
  corpDisplayName,
  SALES_TEAMS,
  CORP_FORMS,
  RELATION_TYPES,
  type BizEntityFull,
  type BizKind,
  type BizNature,
  type BizPlace,
  type SalesTeam,
  type TaxType,
  type Withholding,
  type RepType,
  type CorpForm,
  type StaffProfile,
} from '../../lib/bizRegistryApi';

const TAX_TYPES: TaxType[] = ['과세', '겸영', '면세'];
const WITHHOLDINGS: Withholding[] = ['월별', '반기별', 'N/A'];
const REP_TYPES: RepType[] = ['단독', '공동대표', '각자대표'];

// ── 사업장 입력 draft ──────────────────────────────────────
interface PlaceDraft {
  placeName: string;
  branchType: '본점' | '지점';
  unitTaxation: boolean;
  filingPlaceId: string;
  bizRegNo: string;
  noBiz: boolean;
  address: string;
  nature: BizNature;
  salesTeams: SalesTeam[];
  taxType: TaxType | '';
  withholding: Withholding | '';
  openedDate: string;
  cpa: string;
  hometaxId: string;
  hometaxPw: string;
  note: string;
  staffIds: string[];
}
const emptyPlace = (branchType: '본점' | '지점' = '본점'): PlaceDraft => ({
  placeName: '', branchType, unitTaxation: false, filingPlaceId: '', bizRegNo: '', noBiz: false, address: '',
  nature: '매출', salesTeams: [], taxType: '', withholding: '', openedDate: '', cpa: '', hometaxId: '',
  hometaxPw: '', note: '', staffIds: [],
});
const placeToDraft = (p: BizPlace): PlaceDraft => ({
  placeName: p.placeName, branchType: p.branchType ?? '본점', unitTaxation: p.unitTaxation,
  filingPlaceId: p.filingPlaceId ?? '', bizRegNo: p.bizRegNo, noBiz: p.noBiz, address: p.address,
  nature: p.nature, salesTeams: p.salesTeams, taxType: p.taxType ?? '', withholding: p.withholding ?? '',
  openedDate: p.openedDate ?? '', cpa: p.cpa, hometaxId: p.hometaxId, hometaxPw: '', note: p.note, staffIds: [],
});

export default function BizRegistryTab() {
  const { readonly, role } = useAuth();
  const canWrite = !readonly;
  const [entities, setEntities] = useState<BizEntityFull[]>([]);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const [kindFilter, setKindFilter] = useState<'' | BizKind>('');
  const [natureFilter, setNatureFilter] = useState<'' | BizNature>('');
  const [noBizOnly, setNoBizOnly] = useState(false);
  const [q, setQ] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [addPlaceFor, setAddPlaceFor] = useState<BizEntityFull | null>(null);
  const [editEntity, setEditEntity] = useState<BizEntityFull | null>(null);
  const [editPlace, setEditPlace] = useState<{ place: BizPlace; entity: BizEntityFull } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function load() {
    try {
      setError(null);
      const [ents, stf] = await Promise.all([listBizEntities(), listInternalStaff()]);
      setEntities(ents);
      setStaff(stf);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);
  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(''), 2500); }
  function toggleExpand(id: string) {
    setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  const staffName = (id: string) => staff.find((s) => s.id === id)?.name ?? '';

  const view = useMemo(() => {
    let list = entities;
    if (kindFilter) list = list.filter((e) => e.kind === kindFilter);
    if (natureFilter) list = list.filter((e) => e.places.some((p) => p.nature === natureFilter));
    if (noBizOnly) list = list.filter((e) => e.places.some((p) => p.noBiz) || e.places.length === 0);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter((e) =>
        e.name.toLowerCase().includes(s) ||
        e.code.toLowerCase().includes(s) ||
        e.corpRegNo.includes(s) ||
        e.places.some((p) => p.placeName.toLowerCase().includes(s) || p.bizRegNo.includes(s)),
      );
    }
    return list;
  }, [entities, kindFilter, natureFilter, noBizOnly, q]);

  const stats = useMemo(() => {
    const corp = entities.filter((e) => e.kind === '법인').length;
    const person = entities.filter((e) => e.kind === '개인').length;
    const places = entities.reduce((n, e) => n + e.places.length, 0);
    const sales = entities.reduce((n, e) => n + e.places.filter((p) => p.nature === '매출').length, 0);
    return { corp, person, places, sales };
  }, [entities]);

  // ── 액션 ───────────────────────────────────────────────
  async function handleRegister(
    ent: { kind: BizKind; name: string; corpForm: CorpForm | ''; corpFormPosition: '앞' | '뒤'; corpRegNo: string; establishedDate: string; note: string; residentNo: string },
    hq: PlaceDraft,
  ) {
    try {
      const entityId = await createBizEntity({
        kind: ent.kind, name: ent.name.trim(),
        corpForm: ent.kind === '법인' ? (ent.corpForm || null) : null,
        corpFormPosition: ent.kind === '법인' && ent.corpForm ? ent.corpFormPosition : null,
        corpRegNo: ent.kind === '법인' ? ent.corpRegNo.trim() : undefined,
        establishedDate: ent.kind === '법인' ? ent.establishedDate || null : null,
        note: ent.note.trim(), residentNo: ent.kind === '개인' ? ent.residentNo.trim() : undefined,
      });
      const placeId = await createBizPlace(placeInput(entityId, hq, true));
      for (const sid of hq.staffIds) await assignStaff(placeId, sid, staffName(sid));
      setShowAdd(false);
      await load();
      flash('✓ 거래처 등록됨 (본사 사업장 포함)');
    } catch (e) {
      alert('등록 실패: ' + (e instanceof Error ? e.message : e));
    }
  }
  async function handleAddPlace(entityId: string, d: PlaceDraft) {
    try {
      const placeId = await createBizPlace(placeInput(entityId, d, false));
      for (const sid of d.staffIds) await assignStaff(placeId, sid, staffName(sid));
      setAddPlaceFor(null);
      await load();
      flash('✓ 사업장 추가됨');
    } catch (e) {
      alert('추가 실패: ' + (e instanceof Error ? e.message : e));
    }
  }
  async function handleEditEntity(e: BizEntityFull, p: { name: string; corpForm: CorpForm | ''; corpFormPosition: '앞' | '뒤'; corpRegNo: string; establishedDate: string; note: string; residentNo: string }) {
    try {
      await updateBizEntity(e.id, {
        name: p.name.trim(),
        corpForm: e.kind === '법인' ? (p.corpForm || null) : null,
        corpFormPosition: e.kind === '법인' && p.corpForm ? p.corpFormPosition : null,
        corpRegNo: e.kind === '법인' ? p.corpRegNo.trim() : undefined,
        establishedDate: e.kind === '법인' ? (p.establishedDate || null) : null,
        note: p.note.trim(),
      });
      if (e.kind === '개인' && p.residentNo.trim()) await setEntityResident(e.id, p.residentNo.trim());
      setEditEntity(null);
      await load();
      flash('✓ 거래처 수정됨');
    } catch (er) { alert('수정 실패: ' + (er instanceof Error ? er.message : er)); }
  }
  async function handleEditPlace(place: BizPlace, d: PlaceDraft) {
    try {
      await updateBizPlace(place.id, placeInput(place.entityId, d, place.isHeadquarters));
      if (d.hometaxPw.trim()) await setPlaceHometaxPw(place.id, d.hometaxPw.trim());
      for (const sid of d.staffIds) if (!place.staff.some((s) => s.staffId === sid)) await assignStaff(place.id, sid, staffName(sid));
      setEditPlace(null);
      await load();
      flash('✓ 사업장 수정됨');
    } catch (er) { alert('수정 실패: ' + (er instanceof Error ? er.message : er)); }
  }
  async function handleDeleteEntity(e: BizEntityFull) {
    if (!confirm(`[${e.code}] ${e.name} — 귀속주체와 사업장·담당자·대표이사·공동사업자가 모두 삭제됩니다. 진행할까요?`)) return;
    try { await deleteBizEntity(e.id); await load(); flash('삭제됨'); }
    catch (er) { alert('삭제 실패: ' + (er instanceof Error ? er.message : er)); }
  }
  async function handleDeletePlace(p: BizPlace) {
    if (!confirm(`사업장 '${p.placeName}' 을 삭제할까요?`)) return;
    try { await deleteBizPlace(p.id); await load(); flash('사업장 삭제됨'); }
    catch (er) { alert('삭제 실패: ' + (er instanceof Error ? er.message : er)); }
  }
  async function toggleStaff(place: BizPlace, sid: string) {
    try {
      const existing = place.staff.find((s) => s.staffId === sid);
      if (existing) await unassignStaff(existing.id);
      else await assignStaff(place.id, sid, staffName(sid));
      await load();
    } catch (e) { alert('담당직원 변경 실패: ' + (e instanceof Error ? e.message : e)); }
  }
  async function reveal(kind: 'entity' | 'rep' | 'hometax', id: string, label: string) {
    try {
      const v = kind === 'entity' ? await revealEntityResident(id)
        : kind === 'rep' ? await revealRepResident(id)
        : await revealPlaceHometaxPw(id);
      alert(`${label}: ${v ?? '(없음)'}`);
    } catch (e) { alert('열람 권한이 없거나 오류입니다: ' + (e instanceof Error ? e.message : e)); }
  }

  if (loading) return <div className="card">불러오는 중…</div>;

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        🏢 거래처등록
        <span style={{ fontSize: 11, fontWeight: 400, color: '#888' }}>
          법인 {stats.corp} · 개인 {stats.person} · 사업장 {stats.places}(매출 {stats.sales})
        </span>
        <button className="btn-sm btn-sm-blue" onClick={() => setShowHelp(true)} style={{ marginLeft: 8 }}>❓ 도움말</button>
        {msg && <span style={{ marginLeft: 'auto', fontSize: 12, color: '#2a7' }}>{msg}</span>}
      </div>

      {error && <div style={{ color: '#c33', fontSize: 12, marginBottom: 8 }}>{error}</div>}

      {/* 필터 바 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as '' | BizKind)} style={selStyle}>
          <option value="">구분 전체</option><option value="법인">법인</option><option value="개인">개인</option>
        </select>
        <select value={natureFilter} onChange={(e) => setNatureFilter(e.target.value as '' | BizNature)} style={selStyle}>
          <option value="">성격 전체</option><option value="매출">매출</option><option value="일반">일반(비매출)</option>
        </select>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={noBizOnly} onChange={(e) => setNoBizOnly(e.target.checked)} /> 사업자없음만
        </label>
        <input placeholder="🔍 코드·법인명·성명·사업장·사업자번호" value={q} onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 200 }} />
        {canWrite && (
          <button className="btn-p" onClick={() => setShowAdd((s) => !s)}>{showAdd ? '닫기' : '＋ 신규 거래처'}</button>
        )}
      </div>

      {showAdd && canWrite && <RegisterForm staff={staff} onSubmit={handleRegister} onCancel={() => setShowAdd(false)} />}

      {role === 'superuser' && <BizImportPanel onImported={load} />}

      {/* 목록 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {view.length === 0 && <div style={{ color: '#999', fontSize: 12, padding: 12 }}>거래처가 없습니다.</div>}
        {view.map((e) => (
          <div key={e.id} style={{ border: '1px solid #e6e0d8', borderRadius: 6, padding: '8px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="btn-sm" onClick={() => toggleExpand(e.id)} style={{ minWidth: 26 }}>
                {expanded.has(e.id) ? '▾' : '▸'}
              </button>
              <span style={codeBadge(e.kind)}>{e.code}</span>
              <b style={{ fontSize: 13 }}>{corpDisplayName(e.name, e.corpForm, e.corpFormPosition)}</b>
              <span style={{ fontSize: 11, color: '#888' }}>
                {e.kind === '법인' ? (e.corpRegNo ? `법인번호 ${e.corpRegNo}` : '법인번호 미입력') : (e.hasResidentNo ? '주민번호 등록됨' : '주민번호 미입력')}
              </span>
              <span style={{ fontSize: 11, color: '#aaa' }}>· 사업장 {e.places.length}</span>
              {canWrite && (
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  <button className="btn-sm btn-sm-blue" onClick={() => setEditEntity(e)}>수정</button>
                  <button className="btn-sm" onClick={() => setAddPlaceFor(e)}>＋사업장</button>
                  <button className="btn-sm btn-sm-del" onClick={() => handleDeleteEntity(e)}>삭제</button>
                </span>
              )}
            </div>

            {expanded.has(e.id) && (
              <div style={{ marginTop: 8, paddingLeft: 34, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* 사업장들 */}
                {e.places.map((p) => (
                  <div key={p.id} style={{ background: '#faf8f4', borderRadius: 5, padding: '6px 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={placeCodeBadge}>{e.code}-{String(p.placeNo).padStart(2, '0')}</span>
                      {p.isHeadquarters && <span style={hqBadge}>본사</span>}
                      {p.branchType && <span style={branchBadge(p.branchType)}>{p.branchType}</span>}
                      <b style={{ fontSize: 12 }}>{p.placeName}</b>
                      {p.unitTaxation && <span style={unitBadge} title={p.filingPlaceId ? '사업자단위과세(지점)' : '사업자단위과세'}>단위과세</span>}
                      <span style={natureBadge(p.nature)}>{p.nature}</span>
                      {p.nature === '매출' && p.salesTeams.map((t) => <span key={t} style={teamBadge}>{t}</span>)}
                      <span style={{ fontSize: 11, color: '#888' }}>
                        {p.noBiz ? '🚫 사업자없음' : p.bizRegNo || '사업자번호 미입력'}
                        {p.status === '폐업' && ' · 폐업'}
                      </span>
                      {p.salesTeams.includes('taxteam') && (p.taxType || p.withholding) && (
                        <span style={{ fontSize: 11, color: '#a66' }}>
                          {p.taxType}{p.taxType && p.withholding ? ' · ' : ''}{p.withholding && `원천 ${p.withholding}`}
                        </span>
                      )}
                      {canWrite && (
                        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                          {p.hasHometaxPw && <button className="btn-sm btn-sm-blue" onClick={() => reveal('hometax', p.id, '홈텍스PW')}>PW보기</button>}
                          <button className="btn-sm btn-sm-blue" onClick={() => setEditPlace({ place: p, entity: e })}>수정</button>
                          <button className="btn-sm btn-sm-del" onClick={() => handleDeletePlace(p)}>삭제</button>
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: '#777', marginTop: 3 }}>
                      {p.address && <span>📮 {p.address} · </span>}
                      {p.cpa && <span>CPA {p.cpa} · </span>}
                      {p.hometaxId && <span>홈텍스 {p.hometaxId} · </span>}
                      {p.openedDate && <span>개업 {p.openedDate}</span>}
                    </div>
                    {/* 담당직원 배정 */}
                    <div style={{ marginTop: 5, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 10.5, color: '#999' }}>담당직원:</span>
                      {staff.map((s) => {
                        const on = p.staff.some((x) => x.staffId === s.id);
                        return (
                          <button key={s.id} disabled={!canWrite} onClick={() => toggleStaff(p, s.id)}
                            style={staffChip(on)}>{s.name}</button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {e.places.length === 0 && (
                  <div style={{ fontSize: 11, color: '#c80' }}>⚠️ 사업장이 없습니다 — 법인/개인 본체만 등록된 상태입니다.</div>
                )}

                {/* 대표이사(법인) / 공동사업자·개인관계(개인) */}
                {e.kind === '법인' ? (
                  <RepSection entity={e} allEntities={entities} canWrite={canWrite} onChanged={load} onReveal={reveal} />
                ) : (
                  <>
                    <PartnerSection entity={e} allEntities={entities} canWrite={canWrite} onChanged={load} />
                    <RelationSection entity={e} allEntities={entities} canWrite={canWrite} onChanged={load} />
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {showHelp && (
        <Modal title="❓ 거래처등록 도움말" onClose={() => setShowHelp(false)}>
          <BizHelpContent />
        </Modal>
      )}
      {addPlaceFor && (
        <Modal title={`＋ 사업장 추가 — [${addPlaceFor.code}] ${addPlaceFor.name}`} onClose={() => setAddPlaceFor(null)}>
          <PlaceFields staff={staff} siblings={addPlaceFor.places} submitLabel="사업장 추가"
            onSubmit={(d) => handleAddPlace(addPlaceFor.id, d)} onCancel={() => setAddPlaceFor(null)} />
        </Modal>
      )}
      {editEntity && (
        <Modal title={`✏️ 거래처 수정 — [${editEntity.code}] ${editEntity.name}`} onClose={() => setEditEntity(null)}>
          <EntityEditForm entity={editEntity} onSave={(p) => handleEditEntity(editEntity, p)} onCancel={() => setEditEntity(null)} />
        </Modal>
      )}
      {editPlace && (
        <Modal title={`✏️ 사업장 수정 — ${editPlace.place.placeName}`} onClose={() => setEditPlace(null)}>
          <PlaceFields staff={staff} siblings={editPlace.entity.places.filter((x) => x.id !== editPlace.place.id)}
            initial={placeToDraft(editPlace.place)} submitLabel="저장"
            onSubmit={(d) => handleEditPlace(editPlace.place, d)} onCancel={() => setEditPlace(null)} />
        </Modal>
      )}
    </div>
  );
}

// placeDraft → PlaceInput
function placeInput(entityId: string, d: PlaceDraft, isHq: boolean) {
  const isTax = d.nature === '매출' && d.salesTeams.includes('taxteam');
  return {
    entityId, placeName: d.placeName.trim(), branchType: d.branchType,
    unitTaxation: d.unitTaxation, filingPlaceId: d.branchType === '지점' && d.unitTaxation ? (d.filingPlaceId || null) : null,
    bizRegNo: d.noBiz ? '' : d.bizRegNo.trim(), noBiz: d.noBiz,
    address: d.address.trim(), isHeadquarters: isHq, nature: d.nature,
    salesTeams: d.nature === '매출' ? d.salesTeams : [],
    taxType: isTax ? (d.taxType || null) : null, withholding: isTax ? (d.withholding || null) : null,
    openedDate: d.openedDate || null, cpa: d.cpa.trim(), hometaxId: d.hometaxId.trim(),
    hometaxPw: d.hometaxPw.trim(), note: d.note.trim(),
  };
}

// ── 신규 등록 폼 (귀속주체 + 본사 사업장) ─────────────────────
function RegisterForm({
  staff, onSubmit, onCancel,
}: {
  staff: StaffProfile[];
  onSubmit: (ent: { kind: BizKind; name: string; corpForm: CorpForm | ''; corpFormPosition: '앞' | '뒤'; corpRegNo: string; establishedDate: string; note: string; residentNo: string }, hq: PlaceDraft) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<BizKind>('법인');
  const [name, setName] = useState('');
  const [corpForm, setCorpForm] = useState<CorpForm | ''>('주식회사');
  const [corpFormPosition, setCorpFormPosition] = useState<'앞' | '뒤'>('앞');
  const [corpRegNo, setCorpRegNo] = useState('');
  const [establishedDate, setEstablishedDate] = useState('');
  const [residentNo, setResidentNo] = useState('');
  const [note, setNote] = useState('');
  const [hq, setHq] = useState<PlaceDraft>(emptyPlace());

  function submit() {
    if (!name.trim()) return alert(kind === '법인' ? '법인명(상호)은 필수입니다.' : '성명은 필수입니다.');
    if (!hq.placeName.trim()) return alert('본사 사업장명은 필수입니다. (법인·개인 모두 최소 1개 사업장 등록)');
    onSubmit({ kind, name, corpForm, corpFormPosition, corpRegNo, establishedDate, note, residentNo }, hq);
  }

  return (
    <div className="card" style={{ background: '#F5F1EB', marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 8 }}>＋ 새 거래처 등록</div>
      {/* 구분 토글 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {(['법인', '개인'] as BizKind[]).map((k) => (
          <button key={k} onClick={() => setKind(k)} className={kind === k ? 'btn-p' : 'btn-sm'}>{k}</button>
        ))}
      </div>
      {/* 귀속주체 필드 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
        <div className="frow">
          <span className="fl">{kind === '법인' ? '상호(법인격 제외)' : '성명'}<span className="req">*</span></span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === '법인' ? '예: 오톰 (㈜는 아래 법인격에서)' : '예: 홍길동'} />
        </div>
        {kind === '법인' ? (
          <>
            <div className="frow"><span className="fl">법인격</span>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select value={corpForm} onChange={(e) => setCorpForm(e.target.value as CorpForm | '')} style={selStyle}>
                  <option value="">없음</option>{CORP_FORMS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <select value={corpFormPosition} onChange={(e) => setCorpFormPosition(e.target.value as '앞' | '뒤')} style={selStyle} disabled={!corpForm}>
                  <option value="앞">앞</option><option value="뒤">뒤</option>
                </select>
                {corpForm && name && <span style={{ fontSize: 11, color: '#2a6' }}>→ {corpDisplayName(name, corpForm, corpFormPosition)}</span>}
              </span></div>
            <div className="frow"><span className="fl">법인등록번호</span>
              <input value={corpRegNo} onChange={(e) => setCorpRegNo(e.target.value)} placeholder="000000-0000000" /></div>
            <div className="frow"><span className="fl">설립일</span>
              <input type="date" value={establishedDate} onChange={(e) => setEstablishedDate(e.target.value)} /></div>
          </>
        ) : (
          <div className="frow"><span className="fl">주민등록번호 🔒</span>
            <input value={residentNo} onChange={(e) => setResidentNo(e.target.value)} placeholder="암호화 저장 (선택)" /></div>
        )}
        <div className="frow" style={{ gridColumn: '1 / -1' }}><span className="fl">비고</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="(선택)" /></div>
      </div>

      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#345', margin: '12px 0 6px' }}>
        · 본사 사업장 (필수 — 법인·개인 모두 최소 1개 사업장을 함께 등록합니다)
      </div>
      <PlaceFieldsInline d={hq} setD={setHq} staff={staff} />

      <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
        <button className="btn-p" onClick={submit}>거래처 등록</button>
        <button className="btn-sm" onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}

// ── 사업장 필드 (인라인, 등록폼용) ──────────────────────────
function PlaceFieldsInline({ d, setD, staff, siblings = [] }: { d: PlaceDraft; setD: (f: (p: PlaceDraft) => PlaceDraft) => void; staff: StaffProfile[]; siblings?: BizPlace[] }) {
  const isTax = d.nature === '매출' && d.salesTeams.includes('taxteam');
  const toggleTeam = (t: SalesTeam) =>
    setD((p) => ({ ...p, salesTeams: p.salesTeams.includes(t) ? p.salesTeams.filter((x) => x !== t) : [...p.salesTeams, t] }));
  const toggleStaff = (id: string) =>
    setD((p) => ({ ...p, staffIds: p.staffIds.includes(id) ? p.staffIds.filter((x) => x !== id) : [...p.staffIds, id] }));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
      <div className="frow"><span className="fl">사업장명<span className="req">*</span></span>
        <input value={d.placeName} onChange={(e) => setD((p) => ({ ...p, placeName: e.target.value }))} placeholder="예: 본점 / ○○지점" /></div>
      <div className="frow"><span className="fl">본점/지점</span>
        <select value={d.branchType} onChange={(e) => setD((p) => ({ ...p, branchType: e.target.value as '본점' | '지점' }))} style={selStyle}>
          <option value="본점">본점</option><option value="지점">지점</option>
        </select></div>
      <div className="frow"><span className="fl">사업자번호</span>
        <input value={d.bizRegNo} disabled={d.noBiz} onChange={(e) => setD((p) => ({ ...p, bizRegNo: e.target.value }))} placeholder={d.noBiz ? '사업자없음' : '000-00-00000'} /></div>
      <div className="frow"><span className="fl">사업자단위과세</span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 11.5, display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={d.unitTaxation} onChange={(e) => setD((p) => ({ ...p, unitTaxation: e.target.checked }))} /> 적용
          </label>
          {d.unitTaxation && d.branchType === '지점' && (
            siblings.length ? (
              <select value={d.filingPlaceId} onChange={(e) => setD((p) => ({ ...p, filingPlaceId: e.target.value }))} style={selStyle}>
                <option value="">신고기준(본점) 선택</option>
                {siblings.map((s) => <option key={s.id} value={s.id}>{s.placeName}</option>)}
              </select>
            ) : <span style={{ fontSize: 10.5, color: '#a80' }}>신고기준(본점)은 사업장 추가/수정에서 선택</span>
          )}
        </span></div>
      <div className="frow" style={{ gridColumn: '1 / -1' }}>
        <span className="fl"> </span>
        <label style={{ fontSize: 11.5, display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={d.noBiz} onChange={(e) => setD((p) => ({ ...p, noBiz: e.target.checked }))} />
          사업자없음(무사업자·폐업) — 개인은 주민번호가 식별값이 됩니다
        </label>
      </div>
      <div className="frow" style={{ gridColumn: '1 / -1' }}><span className="fl">사업장주소</span>
        <input value={d.address} onChange={(e) => setD((p) => ({ ...p, address: e.target.value }))} placeholder="(선택)" /></div>
      <div className="frow"><span className="fl">성격</span>
        <select value={d.nature} onChange={(e) => setD((p) => ({ ...p, nature: e.target.value as BizNature }))} style={selStyle}>
          <option value="매출">매출거래처</option><option value="일반">일반(비매출)</option>
        </select></div>
      <div className="frow"><span className="fl">매출팀</span>
        <span style={{ display: 'flex', gap: 8 }}>
          {SALES_TEAMS.map((t) => (
            <label key={t} style={{ fontSize: 11.5, display: 'flex', gap: 3, alignItems: 'center', opacity: d.nature === '매출' ? 1 : 0.4 }}>
              <input type="checkbox" disabled={d.nature !== '매출'} checked={d.salesTeams.includes(t)} onChange={() => toggleTeam(t)} />{t}
            </label>
          ))}
        </span></div>
      {isTax && (
        <>
          <div className="frow"><span className="fl">과세유형</span>
            <select value={d.taxType} onChange={(e) => setD((p) => ({ ...p, taxType: e.target.value as TaxType | '' }))} style={selStyle}>
              <option value="">선택</option>{TAX_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select></div>
          <div className="frow"><span className="fl">원천세</span>
            <select value={d.withholding} onChange={(e) => setD((p) => ({ ...p, withholding: e.target.value as Withholding | '' }))} style={selStyle}>
              <option value="">선택</option>{WITHHOLDINGS.map((w) => <option key={w} value={w}>{w}</option>)}
            </select></div>
        </>
      )}
      <div className="frow"><span className="fl">개업일</span>
        <input type="date" value={d.openedDate} onChange={(e) => setD((p) => ({ ...p, openedDate: e.target.value }))} /></div>
      <div className="frow"><span className="fl">담당 CPA</span>
        <>
          <input list="biz-cpa-options" value={d.cpa} onChange={(e) => setD((p) => ({ ...p, cpa: e.target.value }))} placeholder="입력·선택 (정우철/조현규/김준성)" />
          <datalist id="biz-cpa-options">{CPA_OPTIONS.map((c) => <option key={c} value={c} />)}</datalist>
        </>
      </div>
      <div className="frow"><span className="fl">홈텍스 ID</span>
        <input value={d.hometaxId} onChange={(e) => setD((p) => ({ ...p, hometaxId: e.target.value }))} placeholder="(선택)" /></div>
      <div className="frow"><span className="fl">홈텍스 PW 🔒</span>
        <input value={d.hometaxPw} onChange={(e) => setD((p) => ({ ...p, hometaxPw: e.target.value }))} placeholder="암호화 저장 (선택)" /></div>
      <div className="frow" style={{ gridColumn: '1 / -1' }}><span className="fl">비고</span>
        <input value={d.note} onChange={(e) => setD((p) => ({ ...p, note: e.target.value }))} placeholder="(선택)" /></div>
      <div className="frow" style={{ gridColumn: '1 / -1' }}><span className="fl">담당직원</span>
        <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {staff.map((s) => (
            <button key={s.id} type="button" onClick={() => toggleStaff(s.id)} style={staffChip(d.staffIds.includes(s.id))}>{s.name}</button>
          ))}
          {staff.length === 0 && <span style={{ fontSize: 11, color: '#999' }}>내부 직원 없음</span>}
        </span></div>
    </div>
  );
}

// PlaceFields as standalone modal form (사업장 추가/수정)
function PlaceFields({ staff, siblings = [], initial, submitLabel, onSubmit, onCancel }: {
  staff: StaffProfile[]; siblings?: BizPlace[]; initial?: PlaceDraft; submitLabel: string;
  onSubmit: (d: PlaceDraft) => void; onCancel: () => void;
}) {
  const [d, setD] = useState<PlaceDraft>(initial ?? emptyPlace('지점'));
  return (
    <div>
      <PlaceFieldsInline d={d} setD={setD} staff={staff} siblings={siblings} />
      <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
        <button className="btn-p" onClick={() => { if (!d.placeName.trim()) return alert('사업장명은 필수입니다.'); onSubmit(d); }}>{submitLabel}</button>
        <button className="btn-sm" onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}

// 귀속주체 수정 폼
function EntityEditForm({ entity, onSave, onCancel }: { entity: BizEntityFull; onSave: (p: { name: string; corpForm: CorpForm | ''; corpFormPosition: '앞' | '뒤'; corpRegNo: string; establishedDate: string; note: string; residentNo: string }) => void; onCancel: () => void }) {
  const [name, setName] = useState(entity.name);
  const [corpForm, setCorpForm] = useState<CorpForm | ''>(entity.corpForm ?? '');
  const [corpFormPosition, setCorpFormPosition] = useState<'앞' | '뒤'>(entity.corpFormPosition ?? '앞');
  const [corpRegNo, setCorpRegNo] = useState(entity.corpRegNo);
  const [establishedDate, setEstablishedDate] = useState(entity.establishedDate ?? '');
  const [note, setNote] = useState(entity.note);
  const [residentNo, setResidentNo] = useState('');
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
        <div className="frow"><span className="fl">{entity.kind === '법인' ? '상호(법인격 제외)' : '성명'}<span className="req">*</span></span>
          <input value={name} onChange={(e) => setName(e.target.value)} /></div>
        {entity.kind === '법인' ? (
          <>
            <div className="frow"><span className="fl">법인격</span>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select value={corpForm} onChange={(e) => setCorpForm(e.target.value as CorpForm | '')} style={selStyle}>
                  <option value="">없음</option>{CORP_FORMS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <select value={corpFormPosition} onChange={(e) => setCorpFormPosition(e.target.value as '앞' | '뒤')} style={selStyle} disabled={!corpForm}>
                  <option value="앞">앞</option><option value="뒤">뒤</option>
                </select>
                {corpForm && name && <span style={{ fontSize: 11, color: '#2a6' }}>→ {corpDisplayName(name, corpForm, corpFormPosition)}</span>}
              </span></div>
            <div className="frow"><span className="fl">법인등록번호</span>
              <input value={corpRegNo} onChange={(e) => setCorpRegNo(e.target.value)} placeholder="000000-0000000" /></div>
            <div className="frow"><span className="fl">설립일</span>
              <input type="date" value={establishedDate} onChange={(e) => setEstablishedDate(e.target.value)} /></div>
          </>
        ) : (
          <div className="frow"><span className="fl">주민등록번호 🔒</span>
            <input value={residentNo} onChange={(e) => setResidentNo(e.target.value)} placeholder={entity.hasResidentNo ? '변경 시에만 입력(등록됨)' : '암호화 저장 (선택)'} /></div>
        )}
        <div className="frow" style={{ gridColumn: '1 / -1' }}><span className="fl">비고</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
        <button className="btn-p" onClick={() => { if (!name.trim()) return alert('필수 항목입니다.'); onSave({ name, corpForm, corpFormPosition, corpRegNo, establishedDate, note, residentNo }); }}>저장</button>
        <button className="btn-sm" onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}

// ── 대표이사 섹션 (법인) ────────────────────────────────────
function RepSection({ entity, allEntities, canWrite, onChanged, onReveal }: {
  entity: BizEntityFull; allEntities: BizEntityFull[]; canWrite: boolean; onChanged: () => Promise<void> | void;
  onReveal: (kind: 'entity' | 'rep' | 'hometax', id: string, label: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [repName, setRepName] = useState('');
  const [repType, setRepType] = useState<RepType>('단독');
  const [residentNo, setResidentNo] = useState('');
  const [linkedEntityId, setLinkedEntityId] = useState('');
  const persons = allEntities.filter((e) => e.kind === '개인');

  async function add() {
    if (!repName.trim()) return alert('대표이사명은 필수입니다.');
    try {
      await createBizRepresentative({ entityId: entity.id, repName: repName.trim(), repType, residentNo: residentNo.trim(), linkedEntityId: linkedEntityId || null });
      setAdding(false); setRepName(''); setResidentNo(''); setLinkedEntityId(''); setRepType('단독');
      await onChanged();
    } catch (e) { alert('추가 실패: ' + (e instanceof Error ? e.message : e)); }
  }
  async function del(id: string) { if (confirm('대표이사를 삭제할까요?')) { try { await deleteBizRepresentative(id); await onChanged(); } catch (e) { alert(e instanceof Error ? e.message : String(e)); } } }

  return (
    <div style={{ borderTop: '1px dashed #ddd', paddingTop: 6 }}>
      <div style={{ fontSize: 10.5, color: '#999', marginBottom: 3 }}>대표이사</div>
      {entity.representatives.map((r) => (
        <div key={r.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginBottom: 2 }}>
          <b>{r.repName}</b><span style={{ fontSize: 10.5, color: '#888' }}>{r.repType}</span>
          {r.linkedEntityId && <span style={{ fontSize: 10.5, color: '#47a' }}>🔗 개인거래처 연결</span>}
          {r.hasResidentNo && canWrite && <button className="btn-sm btn-sm-blue" onClick={() => onReveal('rep', r.id, '주민번호')}>주민번호</button>}
          {canWrite && <button className="btn-sm btn-sm-del" onClick={() => del(r.id)}>삭제</button>}
        </div>
      ))}
      {canWrite && !adding && <button className="btn-sm" onClick={() => setAdding(true)}>＋대표이사</button>}
      {adding && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
          <input placeholder="대표이사명" value={repName} onChange={(e) => setRepName(e.target.value)} style={{ width: 120 }} />
          <select value={repType} onChange={(e) => setRepType(e.target.value as RepType)} style={selStyle}>{REP_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          <input placeholder="주민번호🔒(선택)" value={residentNo} onChange={(e) => setResidentNo(e.target.value)} style={{ width: 130 }} />
          <select value={linkedEntityId} onChange={(e) => setLinkedEntityId(e.target.value)} style={selStyle}>
            <option value="">개인거래처 연결(선택)</option>
            {persons.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
          </select>
          <button className="btn-p" onClick={add}>추가</button>
          <button className="btn-sm" onClick={() => setAdding(false)}>취소</button>
        </div>
      )}
    </div>
  );
}

// ── 공동사업자 섹션 (개인) ──────────────────────────────────
function PartnerSection({ entity, allEntities, canWrite, onChanged }: {
  entity: BizEntityFull; allEntities: BizEntityFull[]; canWrite: boolean; onChanged: () => Promise<void> | void;
}) {
  const [placeId, setPlaceId] = useState(entity.places[0]?.id ?? '');
  const [partnerId, setPartnerId] = useState('');
  const [share, setShare] = useState('');
  const persons = allEntities.filter((e) => e.kind === '개인' && e.id !== entity.id);

  async function add() {
    if (!placeId || !partnerId) return alert('사업장과 공동사업자(개인)를 선택하세요.');
    try {
      await createBizPartner(placeId, partnerId, share ? Number(share) : null);
      setPartnerId(''); setShare('');
      await onChanged();
    } catch (e) { alert('추가 실패: ' + (e instanceof Error ? e.message : e)); }
  }
  async function del(id: string) { if (confirm('공동사업자를 삭제할까요?')) { try { await deleteBizPartner(id); await onChanged(); } catch (e) { alert(e instanceof Error ? e.message : String(e)); } } }

  return (
    <div style={{ borderTop: '1px dashed #ddd', paddingTop: 6 }}>
      <div style={{ fontSize: 10.5, color: '#999', marginBottom: 3 }}>공동사업자 (개인 귀속 → 소득세 매출단위 연결)</div>
      {entity.partners.map((pt) => {
        const person = allEntities.find((e) => e.id === pt.partnerEntityId);
        return (
          <div key={pt.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginBottom: 2 }}>
            <b>{person ? `${person.code} ${person.name}` : '(삭제된 개인)'}</b>
            {pt.sharePct != null && <span style={{ fontSize: 10.5, color: '#888' }}>지분 {pt.sharePct}%</span>}
            {canWrite && <button className="btn-sm btn-sm-del" onClick={() => del(pt.id)}>삭제</button>}
          </div>
        );
      })}
      {canWrite && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
          <select value={placeId} onChange={(e) => setPlaceId(e.target.value)} style={selStyle}>
            {entity.places.map((p) => <option key={p.id} value={p.id}>{p.placeName}</option>)}
          </select>
          <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} style={selStyle}>
            <option value="">공동사업자(개인) 선택</option>
            {persons.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
          </select>
          <input placeholder="지분%" value={share} onChange={(e) => setShare(e.target.value)} style={{ width: 60 }} />
          <button className="btn-p" onClick={add}>추가</button>
        </div>
      )}
    </div>
  );
}

// ── 개인 관계 섹션 (개인 ↔ 개인: 가족·동업) ─────────────────
function RelationSection({ entity, allEntities, canWrite, onChanged }: {
  entity: BizEntityFull; allEntities: BizEntityFull[]; canWrite: boolean; onChanged: () => Promise<void> | void;
}) {
  const [toId, setToId] = useState('');
  const [type, setType] = useState<string>(RELATION_TYPES[0]);
  const [note, setNote] = useState('');
  const persons = allEntities.filter((e) => e.kind === '개인' && e.id !== entity.id);

  async function add() {
    if (!toId) return alert('관계 대상(개인)을 선택하세요.');
    try {
      await createBizRelation(entity.id, toId, type, note.trim() || undefined);
      setToId(''); setNote('');
      await onChanged();
    } catch (e) { alert('추가 실패: ' + (e instanceof Error ? e.message : e)); }
  }
  async function del(id: string) { if (confirm('관계를 삭제할까요?')) { try { await deleteBizRelation(id); await onChanged(); } catch (e) { alert(e instanceof Error ? e.message : String(e)); } } }

  return (
    <div style={{ borderTop: '1px dashed #ddd', paddingTop: 6 }}>
      <div style={{ fontSize: 10.5, color: '#999', marginBottom: 3 }}>개인 관계 (가족·동업 — 예: 이도현 → 이소미 의 부)</div>
      {entity.relations.map((r) => {
        const to = allEntities.find((e) => e.id === r.toEntityId);
        return (
          <div key={r.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginBottom: 2 }}>
            <span><b>{entity.name}</b> → <b>{to ? `${to.code} ${to.name}` : '(삭제된 개인)'}</b> 의 <span style={{ color: '#a55' }}>{r.relationType}</span></span>
            {r.note && <span style={{ fontSize: 10.5, color: '#888' }}>({r.note})</span>}
            {canWrite && <button className="btn-sm btn-sm-del" onClick={() => del(r.id)}>삭제</button>}
          </div>
        );
      })}
      {canWrite && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
          <span style={{ fontSize: 11, color: '#777' }}>이 사람은</span>
          <select value={toId} onChange={(e) => setToId(e.target.value)} style={selStyle}>
            <option value="">대상 개인 선택</option>
            {persons.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
          </select>
          <span style={{ fontSize: 11, color: '#777' }}>의</span>
          <select value={type} onChange={(e) => setType(e.target.value)} style={selStyle}>{RELATION_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          <input placeholder="비고(선택)" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: 120 }} />
          <button className="btn-p" onClick={add}>관계 추가</button>
        </div>
      )}
    </div>
  );
}

// ── 공용 모달 ──────────────────────────────────────────────
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 100, padding: 20, overflow: 'auto' }} onClick={onClose}>
      <div className="card" style={{ maxWidth: 720, width: '100%', marginTop: 30 }} onClick={(e) => e.stopPropagation()}>
        <div className="chdr" style={{ display: 'flex', alignItems: 'center' }}>{title}
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button></div>
        {children}
      </div>
    </div>
  );
}

// ── 도움말 내용 ────────────────────────────────────────────
function BizHelpContent() {
  const h: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: '#2a4d69', margin: '12px 0 5px' };
  const li: React.CSSProperties = { fontSize: 12, lineHeight: 1.7, color: '#444' };
  const b: React.CSSProperties = { color: '#c8541e' };
  return (
    <div style={{ maxHeight: '68vh', overflow: 'auto', padding: '2px 4px' }}>
      <div style={{ fontSize: 12, color: '#666', background: '#f5f1eb', padding: '8px 10px', borderRadius: 6 }}>
        거래처는 <b style={b}>귀속주체(법인/개인)</b> 아래 <b style={b}>사업장</b>이 매달리는 2계층 구조입니다.
        법인·개인 모두 <b style={b}>최소 1개 사업장(본사)</b>을 함께 등록해야 하며, 매출·담당자·향후 매출계약은 사업장 단위로 연결됩니다.
      </div>

      <div style={h}>1. 신규 거래처 등록 (법인)</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        <li style={li}><b>＋ 신규 거래처</b> → <b>법인</b> 선택</li>
        <li style={li}>법인명(필수)·법인등록번호·설립일 입력</li>
        <li style={li}><b>본사 사업장(필수)</b>: 사업장명·<b>본점/지점</b>·사업자번호. 폐업/무사업자면 <b>사업자없음</b> 체크</li>
        <li style={li}><b>사업자단위과세</b>면 체크하고, 지점이면 신고기준(본점) 사업장을 선택</li>
        <li style={li}><b>성격</b> 매출/일반 선택 → 매출이면 매출팀(감사/tax) 체크. <b style={b}>taxteam 체크 시에만</b> 과세유형·원천세 입력칸이 나타납니다</li>
        <li style={li}>개업일·담당CPA(입력하면 자동완성)·홈텍스ID/PW(🔒 암호화 저장)·담당직원 칩 선택 → <b>거래처 등록</b></li>
        <li style={li}>등록되면 코드가 자동 부여됩니다 (법인 <b>L0001</b> / 개인 <b>I0001</b>, 사업장은 <b>L0001-01</b>)</li>
      </ul>

      <div style={h}>2. 신규 거래처 등록 (개인)</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        <li style={li}>개인 선택 → 성명·주민등록번호(🔒 암호화) 입력</li>
        <li style={li}>무사업자면 사업장에서 <b>사업자없음</b> 체크 — 주민번호가 식별값이 됩니다</li>
        <li style={li}>공동사업자는 등록 후 행을 펼쳐 추가(지분율 입력 가능)</li>
      </ul>

      <div style={h}>3. 등록 후 관리 (행 왼쪽 ▸ 펼치기)</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        <li style={li}><b>담당직원</b> 칩을 눌러 배정/해제 (정남지·김민섭·김동주·송현주)</li>
        <li style={li}><b>＋사업장</b>으로 지점 추가, <b>대표이사</b>(법인)/<b>공동사업자</b>(개인) 추가</li>
        <li style={li}><b>수정</b> 버튼으로 거래처·사업장 정보 변경</li>
        <li style={li}>🔒 <b>PW보기 / 주민번호</b>는 회계사·팀장·최고관리자만 열람됩니다</li>
      </ul>

      <div style={h}>4. 성격 구분</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        <li style={li}><b>매출거래처</b>: 매출이 발생하는 곳 (감사team / taxteam)</li>
        <li style={li}><b>일반(비매출)</b>: 문서발송 등 정보관리만 하는 곳도 등록 가능</li>
      </ul>

      <div style={h}>주의</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        <li style={li}>같은 거래처 안에서 <b>사업장명 중복 불가</b>, <b>본사는 1개</b>, 사업자번호는 전역 중복 불가</li>
        <li style={li}>거래처 삭제 시 사업장·담당자·대표이사·공동사업자가 <b>함께 삭제</b>됩니다</li>
        <li style={li}>과세유형·원천세는 <b>taxteam 계약</b>에만 필요합니다</li>
      </ul>
    </div>
  );
}

// ── 스타일 헬퍼 ────────────────────────────────────────────
const selStyle: React.CSSProperties = { padding: '4px 7px', fontSize: 12 };
const codeBadge = (k: BizKind): React.CSSProperties => ({
  fontSize: 10.5, fontWeight: 700, padding: '1px 6px', borderRadius: 4, color: '#fff',
  background: k === '법인' ? '#4a6fa5' : '#7a9a4a',
});
const hqBadge: React.CSSProperties = { fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: '#c8541e', color: '#fff' };
const placeCodeBadge: React.CSSProperties = { fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: '#eef', color: '#446', border: '1px solid #ccd' };
const branchBadge = (b: '본점' | '지점'): React.CSSProperties => ({ fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: b === '본점' ? '#3a5' : '#68a', color: '#fff' });
const unitBadge: React.CSSProperties = { fontSize: 9.5, padding: '1px 5px', borderRadius: 3, background: '#f3e6c8', color: '#85630f' };
const teamBadge: React.CSSProperties = { fontSize: 9.5, padding: '1px 5px', borderRadius: 3, background: '#eee4d4', color: '#845' };
const natureBadge = (n: BizNature): React.CSSProperties => ({
  fontSize: 9.5, padding: '1px 5px', borderRadius: 3, color: '#fff', background: n === '매출' ? '#2a8' : '#999',
});
const staffChip = (on: boolean): React.CSSProperties => ({
  fontSize: 10.5, padding: '2px 7px', borderRadius: 10, cursor: 'pointer', border: '1px solid',
  borderColor: on ? '#2a7' : '#ccc', background: on ? '#e3f5ec' : '#fff', color: on ? '#175' : '#888',
});
