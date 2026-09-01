// 기장등청구관리 › 세금계산서 발행요청 · 감사팀
//
// 엑셀 `세금계산서발행요청서.xlsx` › `발행체크` 시트를 대신한다.
// taxteam 과 달리 계약에서 자동으로 펼치지 않는다 — 감사는 계약금·중도금·잔금이 건별로 생긴다.
// 요청자가 한 줄 적으면 김민섭 화면에 바로 뜬다(지금은 적고 나서 구두로 알린다).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { listBizEntities, corpDisplayName, type BizEntityFull } from '../../lib/bizRegistryApi';
import { listBizContacts, type BizContact } from '../../lib/bizContactApi';
import { todayYmd } from '../../lib/format';
import { pathLabel } from '../../lib/salesContractTaxonomy';
import {
  listInvoiceCandidates, listInvoiceRequests, createInvoiceRequests, createManualInvoiceRequest,
  markIssued, cancelRequests, revertToRequested, updateInvoiceRequest,
  ERP_ACCOUNTS,
  type InvoiceCandidate, type InvoiceRequest,
} from '../../lib/invoiceRequestApi';
import { FINAL_APPROVER } from '../../lib/invoiceMonthApi';
import { Grid, useGrid, type GridCol } from './grid';
import { ColumnSettings } from '../clients/tableKit';
import { VIEW_KEYS } from '../../lib/tableViewApi';

const won = (n: number) => n.toLocaleString('ko-KR');
const dash = <span style={{ color: '#CCC' }}>—</span>;
const TEAM = '감사team';
/** 발행체크 시트의 '구분' — 감사 용역은 계약금·중도금·잔금으로 나눠 청구한다. */
const PHASES = ['계약금', '중도금', '잔금', '총액'] as const;

export default function AuditInvoiceTab() {
  const { readonly, role, profileName } = useAuth();
  const canWrite = !readonly && role !== 'per_head_accountant';
  const isApprover = canWrite && (profileName === FINAL_APPROVER || role === 'team_lead' || role === 'superuser');

  const [ym, setYm] = useState(() => todayYmd().slice(0, 7));
  const [entities, setEntities] = useState<BizEntityFull[]>([]);
  const [contacts, setContacts] = useState<BizContact[]>([]);
  const [reqs, setReqs] = useState<InvoiceRequest[]>([]);
  const [cands, setCands] = useState<InvoiceCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [issuedDate, setIssuedDate] = useState(todayYmd);
  const [q, setQ] = useState('');

  // 입력 폼
  const [f, setF] = useState({
    company: '', entityId: '', placeId: '', amount: '', account: '회계감사수입',
    phase: '잔금' as string, summary: '', issueDate: todayYmd(), email: '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setErr(null);
      const ents = entities.length ? entities : await listBizEntities();
      if (!entities.length) setEntities(ents);
      const [r, c, ct] = await Promise.all([
        listInvoiceRequests(ym, TEAM),
        listInvoiceCandidates(ym, ents, TEAM),
        contacts.length ? Promise.resolve(contacts) : listBizContacts(),
      ]);
      setReqs(r); setCands(c); if (!contacts.length) setContacts(ct);
      setPick(new Set());
    } catch (e) { setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, [ym, entities, contacts]);
  useEffect(() => { void load(); }, [load]);

  // 거래처 후보 — 이름·코드로 찾는다(감사팀은 법인이 대부분이라 목록이 길다).
  const options = useMemo(() => entities.map((e) => ({
    id: e.id, code: e.code,
    label: `${e.code} ${corpDisplayName(e.name, e.corpForm, e.corpFormPosition)}`,
    places: e.places,
  })), [entities]);
  const chosen = options.find((o) => o.id === f.entityId);

  function pickCompany(label: string) {
    const o = options.find((x) => x.label === label);
    set('company', label);
    if (!o) { set('entityId', ''); set('placeId', ''); return; }
    const hq = o.places.find((p) => p.isHeadquarters) ?? o.places[0];
    set('entityId', o.id);
    set('placeId', hq?.id ?? '');
    const cs = contacts.filter((c) => c.entityId === o.id && c.email.trim());
    const mail = cs.find((c) => c.placeId === hq?.id && c.isPrimary)?.email
      ?? cs.find((c) => c.isPrimary)?.email ?? cs[0]?.email ?? '';
    set('email', mail);
  }

  async function add() {
    const amt = Number(f.amount.replace(/[^\d-]/g, ''));
    if (!f.entityId) return alert('거래처를 목록에서 골라 주세요.');
    if (!amt) return alert('공급가액을 입력해 주세요.');
    if (!f.summary.trim()) return alert('발행 시 적요를 적어 주세요. (예: 2026년 회계감사 착수금)');
    const o = options.find((x) => x.id === f.entityId)!;
    const place = o.places.find((p) => p.id === f.placeId);
    // 청구 시점의 담당을 함께 굳힌다 — 나중에 담당이 바뀌어도 이 기록은 그대로여야 한다.
    const cpa = place?.cpa ?? '';
    const staff = (place?.staff ?? []).map((x) => x.staffName).join(',');
    setBusy(true);
    try {
      await createManualInvoiceRequest({
        ym, team: TEAM, entityId: f.entityId, placeId: f.placeId || null,
        supplyAmount: amt, erpAccount: f.account, phase: f.phase,
        summary: f.summary.trim(), issueDate: f.issueDate, docEmail: f.email.trim(),
        cpa, staff,
        companyName: o.label.replace(/^\S+\s/, ''), placeName: place?.placeName ?? '',
      });
      setF((p) => ({ ...p, company: '', entityId: '', placeId: '', amount: '', summary: '', email: '' }));
      await load(); flash('✓ 발행요청 등록 — 김민섭 담당자 화면에 뜹니다');
    } catch (e) { alert('등록 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }

  const picked = reqs.filter((r) => pick.has(r.id));
  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try { await fn(); await load(); flash(ok); }
    catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const live = reqs.filter((r) => r.status !== '취소');
  const liveView = (l: InvoiceRequest[]) => l.filter((r) => r.status !== '취소');
  /** 지금 보이는 목록에서 아직 '요청'인 건 — 발행완료 일괄처리 대상. */
  const issuable = (l: InvoiceRequest[]) => l.filter((r) => r.status === '요청');
  const searched = useMemo(() => {
    if (!q.trim()) return reqs;
    const k = q.trim().toLowerCase();
    return reqs.filter((r) => (r.companyName + r.summary + r.erpAccount + r.phase + r.invoiceNo).toLowerCase().includes(k));
  }, [reqs, q]);

  const monthOpts = useMemo(() => {
    const [y, mm] = todayYmd().slice(0, 7).split('-').map(Number);
    return Array.from({ length: 15 }, (_, i) => {
      const d = new Date(Date.UTC(y, mm - 1 - i + 2, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    });
  }, []);

  // ── 표 열 정의 — 제목행 정렬 · 열별 필터 · 너비 조절 ──
  const cols: GridCol<InvoiceRequest>[] = [
    { key: 'status', label: '상태', width: 74, value: (r) => r.status, opts: ['요청', '발행완료', '취소', '수정발행'],
      cell: (r) => {
        const c = r.status === '발행완료' ? { bg: '#D1FAE5', fg: '#065F46' }
          : r.status === '취소' ? { bg: '#F3F4F6', fg: '#6B7280' }
            : r.status === '수정발행' ? { bg: '#FEE2E2', fg: '#991B1B' } : { bg: '#DBEAFE', fg: '#1E3A8A' };
        return <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 9, fontSize: 10.5, fontWeight: 700, background: c.bg, color: c.fg, whiteSpace: 'nowrap' }}>{r.status}</span>;
      } },
    { key: 'team', label: '팀', width: 46, value: (r) => (r.team === 'taxteam' ? 'tax' : '감사'), opts: ['tax', '감사'], style: { color: '#667' } },
    { key: 'company', label: '거래처', width: 150, value: (r) => r.companyName, style: { fontWeight: 700, color: '#1A2B52' } },
    { key: 'place', label: '사업장', width: 110, value: (r) => r.placeName },
    { key: 'erp', label: '매출계정', width: 120, value: (r) => r.erpAccount, opts: ERP_ACCOUNTS, cell: (r) => r.erpAccount || dash },
    { key: 'phase', label: '구분', width: 66, value: (r) => r.phase, opts: PHASES, cell: (r) => r.phase || dash },
    { key: 'cpa', label: '담당회계사', width: 80, value: (r) => r.cpa, cell: (r) => r.cpa || dash },
    { key: 'staff', label: '담당직원', width: 84, value: (r) => r.staff, style: { fontWeight: 600, color: '#1A2B52' }, cell: (r) => r.staff || dash },
    { key: 'code', label: '계약코드', width: 100, value: (r) => r.contractCode, style: { fontFamily: 'monospace', fontSize: 10.5 } },
    { key: 'supply', label: '공급가액', width: 104, num: true, value: (r) => r.supplyAmount,
      cell: (r) => won(r.supplyAmount), sum: (r) => (r.status === '취소' ? 0 : r.supplyAmount) },
    { key: 'vat', label: 'VAT', width: 90, num: true, value: (r) => r.vat,
      cell: (r) => won(r.vat), sum: (r) => (r.status === '취소' ? 0 : r.vat), style: { color: '#888' } },
    { key: 'total', label: '합계', width: 104, num: true, value: (r) => r.total,
      cell: (r) => won(r.total), sum: (r) => (r.status === '취소' ? 0 : r.total), style: { fontWeight: 700 } },
    { key: 'summary', label: '발행 시 적요', width: 140, value: (r) => r.summary || r.note },
    { key: 'issueDate', label: '작성일', width: 88, value: (r) => r.issueDate ?? '', cell: (r) => r.issueDate ?? dash },
    { key: 'requestedBy', label: '요청자', width: 76, value: (r) => r.requestedByName, cell: (r) => r.requestedByName || dash },
    { key: 'invoiceNo', label: '승인번호', width: 110, value: (r) => r.invoiceNo,
      cell: (r) => (
        <>
          {r.invoiceNo || dash}
          {canWrite && r.status === '발행완료' && (
            <button className="btn-sm" style={{ marginLeft: 4 }} onClick={() => {
              const no = prompt(`${r.companyName} — 세금계산서 승인번호`, r.invoiceNo);
              if (no !== null) void run(() => updateInvoiceRequest(r.id, { invoiceNo: no }), '저장했습니다');
            }}>✏️</button>
          )}
        </>
      ) },
    { key: 'issuedBy', label: '처리자', width: 76, value: (r) => r.issuedByName, cell: (r) => r.issuedByName || dash,
      style: { color: '#666' } },
  ];
  const grid = useGrid(VIEW_KEYS.auditInvoiceRequest, cols, searched, { key: 'company', dir: 'asc' });
  const view = grid.rowsView;

  if (loading) return <div className="card">불러오는 중…</div>;

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        🧾 세금계산서 발행요청 · 감사팀
        <select value={ym} onChange={(e) => setYm(e.target.value)} style={{ fontWeight: 700 }}>
          {monthOpts.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <span style={{ fontSize: 11, fontWeight: 400, color: '#888' }}>
          {live.length}건 · 공급가액 {won(live.reduce((s, r) => s + r.supplyAmount, 0))}
        </span>
        {msg && <span style={{ marginLeft: 'auto', fontSize: 12, color: '#2a7' }}>{msg}</span>}
      </div>
      {err && <div className="alert-w">{err}</div>}

      <div className="alert-i" style={{ fontSize: 11 }}>
        감사 용역은 계약금·중도금·잔금이 <b>건별로</b> 생기므로 한 줄씩 적습니다(엑셀 <b>발행체크</b> 시트를 대신합니다).
        등록하면 <b>김민섭 담당자 화면에 바로 뜹니다</b> — 따로 알리지 않으셔도 됩니다.
        실제 발행은 지금처럼 ERP에서 하고, 발행 후 <b>발행완료</b>로 바뀝니다.
      </div>

      {/* ── 건별 등록 ── */}
      {canWrite && (
        <div style={{ border: '1px solid #e2d9c6', background: '#fdfaf3', borderRadius: 6, padding: 10, marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="거래처" width={230}>
              <input list="audit-companies" value={f.company} placeholder="코드 또는 상호로 찾기"
                onChange={(e) => pickCompany(e.target.value)} style={{ width: '100%' }} />
              <datalist id="audit-companies">
                {options.map((o) => <option key={o.id} value={o.label} />)}
              </datalist>
            </Field>
            {chosen && chosen.places.length > 1 && (
              <Field label="사업장" width={140}>
                <select value={f.placeId} onChange={(e) => set('placeId', e.target.value)} style={{ width: '100%' }}>
                  {chosen.places.map((p) => <option key={p.id} value={p.id}>{p.placeName}</option>)}
                </select>
              </Field>
            )}
            <Field label="매출계정" width={130}>
              <select value={f.account} onChange={(e) => set('account', e.target.value)} style={{ width: '100%' }}>
                {ERP_ACCOUNTS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            <Field label="구분" width={86}>
              <select value={f.phase} onChange={(e) => set('phase', e.target.value)} style={{ width: '100%' }}>
                {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="공급가액" width={120}>
              <input value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="부가세 별도"
                style={{ width: '100%', textAlign: 'right' }} />
            </Field>
            <Field label="작성일(발행기준일)" width={130}>
              <input type="date" value={f.issueDate} onChange={(e) => set('issueDate', e.target.value)} style={{ width: '100%' }} />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 6 }}>
            <Field label="발행 시 적요" width={320}>
              <input value={f.summary} onChange={(e) => set('summary', e.target.value)}
                placeholder="예: 2026년 회계감사 착수금 / BW평가용역: 반기" style={{ width: '100%' }} />
            </Field>
            <Field label="공급받는자 이메일" width={230}>
              <input value={f.email} onChange={(e) => set('email', e.target.value)}
                placeholder="거래처담당자에서 자동" style={{ width: '100%' }} />
            </Field>
            <button className="btn-p" disabled={busy} onClick={() => void add()}>＋ 발행요청 등록</button>
            {f.amount && <span style={{ fontSize: 11.5, color: '#666' }}>
              합계 {won(Math.round(Number(f.amount.replace(/[^\d-]/g, '') || 0) * 1.1))}
            </span>}
          </div>
        </div>
      )}

      {/* ── 계약에서 가져오기 ── */}
      {cands.length > 0 && (
        <div style={{ border: '1px solid #cfe0f5', background: '#f5f9ff', borderRadius: 6, padding: 8, marginBottom: 10 }}>
          <div style={{ fontSize: 11.5, color: '#1E3A8A', marginBottom: 5 }}>
            <b>{ym} 매출계약에서 청구예정 {cands.length}건</b>이 있습니다 — 분할회차가 등록된 감사 계약입니다. 골라서 한 번에 등록할 수 있습니다.
          </div>
          {cands.map((c) => (
            <label key={c.key} style={{ display: 'block', fontSize: 11.5, padding: '1px 0' }}>
              <input type="checkbox" checked={pick.has(c.key)} onChange={() => setPick((p) => {
                const n = new Set(p); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n;
              })} />
              {' '}<b>{c.companyName}</b> · {pathLabel(c.typeLabel)} · {c.label} · {won(c.supplyAmount)}
            </label>
          ))}
          {canWrite && (
            <button className="btn-p" style={{ marginTop: 6 }} disabled={busy || !pick.size}
              onClick={() => void run(async () => {
                const rows = cands.filter((c) => pick.has(c.key));
                await createInvoiceRequests(ym, rows, { team: TEAM });
              }, '✓ 계약에서 등록했습니다')}>
              선택 {[...pick].length}건 발행요청 등록
            </button>
          )}
        </div>
      )}

      <div className="sbar">
        <input placeholder="🔍 거래처·적요·계정·승인번호" value={q} onChange={(e) => setQ(e.target.value)} />
        {canWrite && (
          <>
            <button className="btn-sm" onClick={() => setPick(new Set(issuable(view).map((r) => r.id)))}
              title="보이는 목록에서 아직 '요청' 상태인 건을 모두 고릅니다">
              요청 전체선택 ({issuable(view).length})
            </button>
            <button className="btn-sm" onClick={() => setPick(new Set())}>선택해제</button>
            <span style={{ fontSize: 12, color: '#555' }}>선택 <b>{picked.length}</b>건</span>
            <span style={{ fontSize: 11.5, color: '#666' }}>발행일</span>
            <input type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} style={{ fontSize: 12 }} />
            <button className="btn-p" disabled={busy || !picked.length || !isApprover}
              title={isApprover ? '' : `발행완료는 ${FINAL_APPROVER}(부재 시 기장팀장·최고관리자)만 처리합니다`}
              onClick={() => void run(async () => {
                const ids = picked.filter((r) => r.status === '요청').map((r) => r.id);
                if (!ids.length) throw new Error('‘요청’ 상태 건을 골라 주세요.');
                await markIssued(ids, null, issuedDate);
              }, '✓ 발행완료')}>발행완료 처리</button>
            <button className="btn-sm" disabled={busy || !picked.length}
              onClick={() => void run(() => revertToRequested(picked.filter((r) => r.status === '발행완료').map((r) => r.id)), '되돌렸습니다')}>요청으로 되돌리기</button>
            <button className="btn-sm btn-sm-del" disabled={busy || !picked.length}
              onClick={() => { if (confirm(`${picked.length}건을 취소합니다.`)) void run(() => cancelRequests(picked.map((r) => r.id)), '취소했습니다'); }}>취소</button>
          </>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {grid.filterCount > 0 && <button className="btn-sm" onClick={grid.clearFilters}>필터 초기화 ({grid.filterCount})</button>}
          <ColumnSettings cols={grid.ordered} view={grid.view} onMessage={flash} />
        </span>
      </div>

      <Grid grid={grid} rowKey={(r) => r.id} maxHeight={460}
        empty={`${ym} 감사팀 발행요청이 없습니다. 위에서 한 줄 등록해 보세요.`}
        footerLabel={`합계 ${liveView(view).length}건 (취소 제외)`}
        rowStyle={(r) => ({ opacity: r.status === '취소' ? 0.55 : 1 })}
        select={canWrite ? {
          picked: pick, toggle: (k) => setPick((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; }),
          selectableKeys: view.map((r) => r.id),
          headerKeys: issuable(view).map((r) => r.id),
          setAll: (keys) => setPick(new Set(keys ?? [])),
        } : undefined} />
    </div>
  );
}

function Field({ label, width, children }: { label: string; width: number; children: React.ReactNode }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, width }}>
      <span style={{ fontSize: 10.5, color: '#888' }}>{label}</span>
      {children}
    </span>
  );
}
