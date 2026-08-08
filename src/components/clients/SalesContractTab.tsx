// 거래처관리 › 매출계약등록 (거래처관리 2.0.0 · step 2)
// 매출유형 트리 선택(cascade) + leaf 플래그 조건입력 + 발생/청구단위 + 청구주기·분할 + 담당 + 날짜 + 무료/할인.
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { listBizEntities, corpDisplayName, type BizEntityFull } from '../../lib/bizRegistryApi';
import {
  TAXONOMY, findNode, isLeaf, leafOf, pathLabel, type Team, type TaxNode,
} from '../../lib/salesContractTaxonomy';
import {
  listSalesContracts, createSalesContract, updateSalesContract, deleteSalesContract,
  saveInstallments, saveDiscounts, saveContractStaff, listContractStaffProfiles,
  staffCandidatesForTeam, BILLING_CYCLES, CPA_LIST,
  type SalesContract, type ContractInput, type Installment, type Discount,
  type OccurrenceUnit, type BillingUnit, type BillingCycle, type AdvisoryType, type StaffProfileLite,
} from '../../lib/salesContractApi';

const won = (n: number) => n.toLocaleString('ko-KR');
const UNITS: OccurrenceUnit[] = ['사업장', '법인', '개인'];
const BILL_UNITS: BillingUnit[] = ['사업장', '법인', '개인', '건'];

interface FormState {
  entityId: string; placeId: string;
  team: Team; categoryCode: string; categoryEtcName: string;
  includesVat: boolean; includesWht: boolean; advisoryType: AdvisoryType | '';
  occurrenceUnit: OccurrenceUnit; billingUnit: BillingUnit | '';
  fiscalYear: string; billingCycle: BillingCycle; isInstallment: boolean; amount: string;
  cpa: string; staffIds: string[];
  contractDate: string; startDate: string; endDate: string;
  parentContractId: string; note: string;
  installments: Installment[]; discounts: Discount[];
}
const emptyForm = (): FormState => ({
  entityId: '', placeId: '', team: '감사team', categoryCode: '', categoryEtcName: '',
  includesVat: false, includesWht: false, advisoryType: '', occurrenceUnit: '사업장', billingUnit: '',
  fiscalYear: '', billingCycle: '월', isInstallment: false, amount: '', cpa: '', staffIds: [],
  contractDate: '', startDate: '', endDate: '', parentContractId: '', note: '', installments: [], discounts: [],
});

export default function SalesContractTab() {
  const { readonly } = useAuth();
  const canWrite = !readonly;
  const [entities, setEntities] = useState<BizEntityFull[]>([]);
  const [staff, setStaff] = useState<StaffProfileLite[]>([]);
  const [contracts, setContracts] = useState<SalesContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [teamFilter, setTeamFilter] = useState<'' | Team>('');
  const [q, setQ] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      const [ents, stf, cons] = await Promise.all([listBizEntities(), listContractStaffProfiles(), listSalesContracts()]);
      setEntities(ents); setStaff(stf); setContracts(cons);
    } catch (e) { setError(e instanceof Error ? e.message : '불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(''), 2500); }

  const entMap = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const entName = (id: string) => { const e = entMap.get(id); return e ? `${e.code} ${corpDisplayName(e.name, e.corpForm, e.corpFormPosition)}` : '(삭제됨)'; };
  const placeName = (eid: string, pid: string | null) => { if (!pid) return ''; const e = entMap.get(eid); return e?.places.find((p) => p.id === pid)?.placeName ?? ''; };

  const view = useMemo(() => {
    let list = contracts;
    if (teamFilter) list = list.filter((c) => c.team === teamFilter);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter((c) => entName(c.entityId).toLowerCase().includes(s) || pathLabel(c.categoryCode).toLowerCase().includes(s) || (c.cpa || '').toLowerCase().includes(s));
    }
    return list;
  }, [contracts, teamFilter, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const total = contracts.length;
    const aud = contracts.filter((c) => c.team === '감사team').length;
    const tax = contracts.filter((c) => c.team === 'taxteam').length;
    return { total, aud, tax };
  }, [contracts]);

  async function persist(form: FormState, existingId?: string) {
    const leaf = leafOf(form.categoryCode);
    if (!form.entityId) return alert('거래처를 선택하세요.');
    if (!leaf) return alert('매출유형(최종 항목)을 선택하세요.');
    if (form.occurrenceUnit === '사업장' && !form.placeId) return alert('발생단위가 사업장이면 사업장을 선택하세요.');
    const input: ContractInput = {
      entityId: form.entityId, placeId: form.occurrenceUnit === '사업장' ? form.placeId : null,
      occurrenceUnit: form.occurrenceUnit, billingUnit: form.billingUnit || null,
      team: form.team, categoryCode: form.categoryCode,
      categoryEtcName: leaf.needsEtcName ? form.categoryEtcName.trim() : '',
      includesVat: leaf.jangbuOptions ? form.includesVat : false,
      includesWht: leaf.jangbuOptions ? form.includesWht : false,
      advisoryType: leaf.advisoryType ? (form.advisoryType || null) : null,
      parentContractId: form.parentContractId || null,
      fiscalYear: form.fiscalYear ? Number(form.fiscalYear) : null,
      billingCycle: form.billingCycle, isInstallment: form.isInstallment,
      amount: form.amount ? Number(form.amount.replace(/,/g, '')) : 0, cpa: form.cpa.trim(),
      contractDate: form.contractDate || null, startDate: form.startDate || null, endDate: form.endDate || null,
      note: form.note.trim(),
    };
    try {
      const id = existingId ? (await updateSalesContract(existingId, input), existingId) : await createSalesContract(input);
      await saveInstallments(id, form.isInstallment ? form.installments : []);
      await saveDiscounts(id, form.discounts);
      await saveContractStaff(id, form.staffIds.map((sid) => ({ staffId: sid, staffName: staff.find((s) => s.id === sid)?.name ?? '' })));
      setShowAdd(false); setEditId(null); await load();
      flash(existingId ? '✓ 매출계약 수정됨' : '✓ 매출계약 등록됨');
    } catch (e) { alert('저장 실패: ' + (e instanceof Error ? e.message : e)); }
  }
  async function del(c: SalesContract) {
    if (!confirm('이 매출계약을 삭제할까요? (분할·할인·담당 함께 삭제)')) return;
    try { await deleteSalesContract(c.id); await load(); flash('삭제됨'); }
    catch (e) { alert('삭제 실패: ' + (e instanceof Error ? e.message : e)); }
  }

  if (loading) return <div className="card">불러오는 중…</div>;

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        📄 매출계약등록
        <span style={{ fontSize: 11, fontWeight: 400, color: '#888' }}>총 {stats.total} · 감사 {stats.aud} · tax {stats.tax}</span>
        {msg && <span style={{ marginLeft: 'auto', fontSize: 12, color: '#2a7' }}>{msg}</span>}
      </div>
      {error && <div style={{ color: '#c33', fontSize: 12, marginBottom: 8 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value as '' | Team)} style={selStyle}>
          <option value="">팀 전체</option><option value="감사team">감사team</option><option value="taxteam">taxteam</option>
        </select>
        <input placeholder="🔍 거래처·매출유형·CPA" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        {canWrite && <button className="btn-p" onClick={() => { setShowAdd((s) => !s); setEditId(null); }}>{showAdd ? '닫기' : '＋ 신규 매출계약'}</button>}
      </div>

      {showAdd && canWrite && (
        <ContractForm entities={entities} staff={staff} contracts={contracts} onSubmit={(f) => persist(f)} onCancel={() => setShowAdd(false)} />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {view.length === 0 && <div style={{ color: '#999', fontSize: 12, padding: 12 }}>매출계약이 없습니다.</div>}
        {view.map((c) => {
          const leaf = leafOf(c.categoryCode);
          return (
            <div key={c.id} style={{ border: '1px solid #e6e0d8', borderRadius: 6, padding: '8px 10px', marginLeft: c.parentContractId ? 24 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {c.parentContractId && <span style={{ fontSize: 10, color: '#a80' }}>↳종속</span>}
                <span style={teamBadge(c.team)}>{c.team}</span>
                <b style={{ fontSize: 12.5 }}>{entName(c.entityId)}</b>
                {c.placeId && <span style={{ fontSize: 11, color: '#777' }}>· {placeName(c.entityId, c.placeId)}</span>}
                <span style={{ fontSize: 11.5, color: '#456' }}>{pathLabel(c.categoryCode)}{c.categoryEtcName && ` (${c.categoryEtcName})`}</span>
                {leaf?.jangbuOptions && (c.includesVat || c.includesWht) && <span style={{ fontSize: 10.5, color: '#a66' }}>{[c.includesVat && '부가', c.includesWht && '원천'].filter(Boolean).join('·')} 포함</span>}
                {c.advisoryType && <span style={{ fontSize: 10.5, color: '#a66' }}>{c.advisoryType}</span>}
                <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: '#245' }}>{won(c.amount)}원</span>
                <span style={{ fontSize: 10.5, color: '#888' }}>/{c.billingCycle}{c.isInstallment ? '·분할' : ''}</span>
              </div>
              <div style={{ fontSize: 11, color: '#777', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {c.fiscalYear && <span>귀속 {c.fiscalYear}</span>}
                {c.cpa && <span>CPA {c.cpa}</span>}
                {c.staff.length > 0 && <span>담당 {c.staff.map((s) => s.staffName).join('·')}</span>}
                <span>{c.startDate || '개시일?'} ~ {c.endDate || '계속'}</span>
                {c.discounts.length > 0 && <span style={{ color: '#c80' }}>무료/할인 {c.discounts.length}</span>}
                {canWrite && (
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    <button className="btn-sm btn-sm-blue" onClick={() => { setEditId(c.id); setShowAdd(false); }}>수정</button>
                    <button className="btn-sm btn-sm-del" onClick={() => del(c)}>삭제</button>
                  </span>
                )}
              </div>
              {editId === c.id && canWrite && (
                <div style={{ marginTop: 8 }}>
                  <ContractForm entities={entities} staff={staff} contracts={contracts} initial={c} onSubmit={(f) => persist(f, c.id)} onCancel={() => setEditId(null)} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 등록/수정 폼 ────────────────────────────────────────────
function ContractForm({ entities, staff, contracts, initial, onSubmit, onCancel }: {
  entities: BizEntityFull[]; staff: StaffProfileLite[]; contracts: SalesContract[];
  initial?: SalesContract; onSubmit: (f: FormState) => void; onCancel: () => void;
}) {
  const [f, setF] = useState<FormState>(() => initial ? fromContract(initial) : emptyForm());
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));
  const entity = entities.find((e) => e.id === f.entityId);
  const leaf = leafOf(f.categoryCode);
  const staffCands = staff.filter((s) => (staffCandidatesForTeam(f.team) as readonly string[]).includes(s.name));

  // 유형 선택 시 발생단위 기본 제시 + CPA/담당직원 기본 상속
  function pickCategory(code: string) {
    const lf = leafOf(code);
    setF((p) => {
      const next = { ...p, categoryCode: code };
      if (lf?.defaultUnit) next.occurrenceUnit = lf.defaultUnit;
      return next;
    });
  }
  // 거래처/사업장 선택 시 CPA·담당직원 상속
  function pickPlace(pid: string) {
    const pl = entity?.places.find((x) => x.id === pid);
    setF((p) => ({ ...p, placeId: pid, cpa: p.cpa || pl?.cpa || '', }));
  }
  // 계약일 → 개시일 자동 동일(개시일 비었을 때)
  function pickContractDate(v: string) {
    setF((p) => ({ ...p, contractDate: v, startDate: p.startDate || v }));
  }

  const instSum = f.installments.reduce((s, x) => s + (x.amount || 0), 0);
  const amountNum = f.amount ? Number(f.amount.replace(/,/g, '')) : 0;

  return (
    <div className="card" style={{ background: '#F5F1EB', marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 8 }}>{initial ? '✏️ 매출계약 수정' : '＋ 새 매출계약'}</div>

      {/* 거래처 · 사업장 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
        <div className="frow"><span className="fl">거래처<span className="req">*</span></span>
          <select value={f.entityId} onChange={(e) => setF((p) => ({ ...p, entityId: e.target.value, placeId: '' }))} style={selStyle}>
            <option value="">선택</option>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.code} {corpDisplayName(e.name, e.corpForm, e.corpFormPosition)}</option>)}
          </select></div>
        <div className="frow"><span className="fl">발생단위</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <select value={f.occurrenceUnit} onChange={(e) => set('occurrenceUnit', e.target.value as OccurrenceUnit)} style={selStyle}>
              {UNITS.map((u) => <option key={u}>{u}</option>)}
            </select>
            {f.occurrenceUnit === '사업장' && (
              <select value={f.placeId} onChange={(e) => pickPlace(e.target.value)} style={selStyle} disabled={!entity}>
                <option value="">사업장 선택</option>
                {entity?.places.map((pl) => <option key={pl.id} value={pl.id}>{pl.placeName}</option>)}
              </select>
            )}
          </span></div>
      </div>

      {/* 매출유형 트리 */}
      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#345', margin: '10px 0 4px' }}>· 매출유형</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['감사team', 'taxteam'] as Team[]).map((t) => (
          <button key={t} type="button" onClick={() => setF((p) => ({ ...p, team: t, categoryCode: '' }))} className={f.team === t ? 'btn-p' : 'btn-sm'}>{t}</button>
        ))}
        <TaxonomyPicker team={f.team} code={f.categoryCode} onPick={pickCategory} />
      </div>
      {leaf && <div style={{ fontSize: 11, color: '#2a6', marginTop: 3 }}>선택: {pathLabel(f.categoryCode)}</div>}

      {/* leaf 플래그 조건입력 */}
      {leaf?.needsEtcName && (
        <div className="frow" style={{ marginTop: 6 }}><span className="fl">신고대상명칭<span className="req">*</span></span>
          <input value={f.categoryEtcName} onChange={(e) => set('categoryEtcName', e.target.value)} placeholder="기타 항목 명칭 입력" /></div>
      )}
      {leaf?.jangbuOptions && (
        <div className="frow" style={{ marginTop: 6 }}><span className="fl">기장 포함</span>
          <span style={{ display: 'flex', gap: 12 }}>
            <label style={{ fontSize: 11.5, display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={f.includesVat} onChange={(e) => set('includesVat', e.target.checked)} /> 부가가치세</label>
            <label style={{ fontSize: 11.5, display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={f.includesWht} onChange={(e) => set('includesWht', e.target.checked)} /> 원천세</label>
          </span></div>
      )}
      {leaf?.advisoryType && (
        <div className="frow" style={{ marginTop: 6 }}><span className="fl">자문구분</span>
          <span style={{ display: 'flex', gap: 12 }}>
            {(['일반', '전문'] as AdvisoryType[]).map((a) => (
              <label key={a} style={{ fontSize: 11.5, display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="radio" name="adv" checked={f.advisoryType === a} onChange={() => set('advisoryType', a)} /> {a}자문{a === '전문' ? '(letter)' : ''}
              </label>
            ))}
          </span></div>
      )}
      {leaf?.filingAgentEligible && (
        <div style={{ fontSize: 10.5, color: '#a80', marginTop: 4 }}>※ 기장 없이 이 신고만 하면 '신고대리'입니다. (기장 계약이 별도로 없으면 신고대리로 봅니다)</div>
      )}
      {leaf?.linksConfirmation && (
        <div style={{ fontSize: 10.5, color: '#47a', marginTop: 4 }}>※ 회계감사 계약은 조회서발송관리에서 발송대상으로 참조됩니다.</div>
      )}

      {/* 청구단위 · 귀속연도 · 청구주기 · 계약금액 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px', marginTop: 8 }}>
        <div className="frow"><span className="fl">청구단위</span>
          <select value={f.billingUnit} onChange={(e) => set('billingUnit', e.target.value as BillingUnit | '')} style={selStyle}>
            <option value="">(선택)</option>{BILL_UNITS.map((u) => <option key={u}>{u}</option>)}
          </select></div>
        <div className="frow"><span className="fl">귀속연도</span>
          <input value={f.fiscalYear} onChange={(e) => set('fiscalYear', e.target.value.replace(/\D/g, ''))} placeholder="신고류만 (예: 2025)" maxLength={4} /></div>
        <div className="frow"><span className="fl">청구주기</span>
          <select value={f.billingCycle} onChange={(e) => set('billingCycle', e.target.value as BillingCycle)} style={selStyle}>
            {BILLING_CYCLES.map((c) => <option key={c}>{c}</option>)}
          </select></div>
        <div className="frow"><span className="fl">{f.isInstallment ? '계약금액(총액)' : '계약금액(1회)'}</span>
          <input value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="숫자만 (예: 150000)" /></div>
        <div className="frow" style={{ gridColumn: '1 / -1' }}><span className="fl">분할청구</span>
          <label style={{ fontSize: 11.5, display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={f.isInstallment} onChange={(e) => set('isInstallment', e.target.checked)} /> 계약금/중도금/잔금으로 분할
          </label></div>
      </div>

      {f.isInstallment && <InstallmentsEditor rows={f.installments} onChange={(r) => set('installments', r)} sum={instSum} target={amountNum} />}

      {/* 담당 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px', marginTop: 8 }}>
        <div className="frow"><span className="fl">담당CPA</span>
          <>
            <input list="sc-cpa" value={f.cpa} onChange={(e) => set('cpa', e.target.value)} placeholder="거래처 CPA 상속·수정" />
            <datalist id="sc-cpa">{CPA_LIST.map((c) => <option key={c} value={c} />)}</datalist>
          </></div>
        <div className="frow"><span className="fl">담당직원 <span style={{ fontSize: 10, color: '#999' }}>({f.team})</span></span>
          <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {staffCands.map((s) => {
              const on = f.staffIds.includes(s.id);
              return <button key={s.id} type="button" onClick={() => set('staffIds', on ? f.staffIds.filter((x) => x !== s.id) : [...f.staffIds, s.id])} style={chip(on)}>{s.name}</button>;
            })}
            {staffCands.length === 0 && <span style={{ fontSize: 11, color: '#999' }}>후보 계정 없음</span>}
          </span></div>
      </div>

      {/* 날짜 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 14px', marginTop: 8 }}>
        <div className="frow"><span className="fl">매출계약일</span>
          <input type="date" value={f.contractDate} onChange={(e) => pickContractDate(e.target.value)} /></div>
        <div className="frow"><span className="fl">매출개시일</span>
          <input type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></div>
        <div className="frow"><span className="fl">종료일(비움=계속)</span>
          <input type="date" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} /></div>
      </div>

      {/* 무료/할인 */}
      <DiscountsEditor rows={f.discounts} onChange={(r) => set('discounts', r)} />

      {/* 메인/종속 · 비고 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px', marginTop: 8 }}>
        <div className="frow"><span className="fl">메인계약(종속 시)</span>
          <select value={f.parentContractId} onChange={(e) => set('parentContractId', e.target.value)} style={selStyle}>
            <option value="">없음(단독/메인)</option>
            {contracts.filter((c) => c.id !== initial?.id && c.entityId === f.entityId && !c.parentContractId).map((c) => (
              <option key={c.id} value={c.id}>{pathLabel(c.categoryCode)} ({won(c.amount)})</option>
            ))}
          </select></div>
        <div className="frow"><span className="fl">비고</span>
          <input value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="(선택)" /></div>
      </div>

      <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
        <button className="btn-p" onClick={() => onSubmit(f)}>{initial ? '저장' : '매출계약 등록'}</button>
        <button className="btn-sm" onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}

// ── 매출유형 cascade 선택 ───────────────────────────────────
function TaxonomyPicker({ team, code, onPick }: { team: Team; code: string; onPick: (code: string) => void }) {
  const entry = code ? findNode(code) : null;
  const path = entry && entry.team === team ? entry.path : [];
  const levels: TaxNode[][] = [TAXONOMY[team]];
  for (const n of path) if (n.children) levels.push(n.children);
  return (
    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {levels.map((opts, li) => (
        <select key={li} value={path[li]?.code ?? ''} onChange={(e) => onPick(e.target.value)} style={selStyle}>
          <option value="">{li === 0 ? '대분류' : '선택'}</option>
          {opts.map((o) => <option key={o.code} value={o.code}>{o.label}{isLeaf(o) ? '' : ' ▸'}</option>)}
        </select>
      ))}
    </span>
  );
}

// ── 분할 회차 편집 ─────────────────────────────────────────
function InstallmentsEditor({ rows, onChange, sum, target }: { rows: Installment[]; onChange: (r: Installment[]) => void; sum: number; target: number }) {
  const upd = (i: number, patch: Partial<Installment>) => onChange(rows.map((r, j) => j === i ? { ...r, ...patch } : r));
  return (
    <div style={{ background: '#fbf7ee', borderRadius: 5, padding: 8, marginTop: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#845', marginBottom: 4 }}>분할 회차 (합계 {won(sum)} / 계약금액 {won(target)} {sum === target ? '✓' : '⚠불일치'})</div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 3, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={r.label} onChange={(e) => upd(i, { label: e.target.value })} placeholder="명칭(계약금/중도금1차/잔금)" style={{ width: 160 }} />
          <input value={r.amount ? String(r.amount) : ''} onChange={(e) => upd(i, { amount: Number(e.target.value.replace(/\D/g, '')) })} placeholder="금액" style={{ width: 110 }} />
          <input type="date" value={r.dueDate ?? ''} onChange={(e) => upd(i, { dueDate: e.target.value || null })} />
          <input value={r.conditionNote} onChange={(e) => upd(i, { conditionNote: e.target.value })} placeholder="조건메모(착수 시 등)" style={{ width: 150 }} />
          <button type="button" className="btn-sm btn-sm-del" onClick={() => onChange(rows.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="btn-sm" onClick={() => onChange([...rows, { seq: rows.length + 1, label: '', amount: 0, dueDate: null, conditionNote: '' }])}>＋회차</button>
    </div>
  );
}

// ── 무료/할인 편집 ─────────────────────────────────────────
function DiscountsEditor({ rows, onChange }: { rows: Discount[]; onChange: (r: Discount[]) => void }) {
  const upd = (i: number, patch: Partial<Discount>) => onChange(rows.map((r, j) => j === i ? { ...r, ...patch } : r));
  return (
    <div style={{ background: '#f6f0f8', borderRadius: 5, padding: 8, marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#658', marginBottom: 4 }}>무료 / 할인 구간</div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 3, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={r.discType} onChange={(e) => upd(i, { discType: e.target.value as '무료' | '할인' })} style={selStyle}><option>무료</option><option>할인</option></select>
          <input type="date" value={r.startDate ?? ''} onChange={(e) => upd(i, { startDate: e.target.value || null })} />
          <span style={{ fontSize: 11 }}>~</span>
          <input type="date" value={r.endDate ?? ''} onChange={(e) => upd(i, { endDate: e.target.value || null })} />
          {r.discType === '할인' && <input value={r.rate != null ? String(r.rate) : ''} onChange={(e) => upd(i, { rate: e.target.value ? Number(e.target.value) : null })} placeholder="할인율%" style={{ width: 70 }} />}
          {r.discType === '할인' && <input value={r.amount != null ? String(r.amount) : ''} onChange={(e) => upd(i, { amount: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null })} placeholder="또는 할인액" style={{ width: 100 }} />}
          <input value={r.note} onChange={(e) => upd(i, { note: e.target.value })} placeholder="메모" style={{ width: 120 }} />
          <button type="button" className="btn-sm btn-sm-del" onClick={() => onChange(rows.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="btn-sm" onClick={() => onChange([...rows, { discType: '무료', startDate: null, endDate: null, rate: null, amount: null, note: '' }])}>＋구간</button>
    </div>
  );
}

// FormState ← 기존 계약
function fromContract(c: SalesContract): FormState {
  return {
    entityId: c.entityId, placeId: c.placeId ?? '', team: c.team, categoryCode: c.categoryCode, categoryEtcName: c.categoryEtcName,
    includesVat: c.includesVat, includesWht: c.includesWht, advisoryType: c.advisoryType ?? '', occurrenceUnit: c.occurrenceUnit,
    billingUnit: c.billingUnit ?? '', fiscalYear: c.fiscalYear ? String(c.fiscalYear) : '', billingCycle: c.billingCycle,
    isInstallment: c.isInstallment, amount: c.amount ? String(c.amount) : '', cpa: c.cpa, staffIds: c.staff.map((s) => s.staffId),
    contractDate: c.contractDate ?? '', startDate: c.startDate ?? '', endDate: c.endDate ?? '', parentContractId: c.parentContractId ?? '',
    note: c.note, installments: c.installments.length ? c.installments : [], discounts: c.discounts,
  };
}

const selStyle: React.CSSProperties = { padding: '4px 7px', fontSize: 12 };
const teamBadge = (t: Team): React.CSSProperties => ({ fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 4, color: '#fff', background: t === '감사team' ? '#4a6fa5' : '#7a9a4a' });
const chip = (on: boolean): React.CSSProperties => ({ fontSize: 10.5, padding: '2px 7px', borderRadius: 10, cursor: 'pointer', border: '1px solid', borderColor: on ? '#2a7' : '#ccc', background: on ? '#e3f5ec' : '#fff', color: on ? '#175' : '#888' });
