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

const won = (n: number) => n.toLocaleString('ko-KR');
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
    setBusy(true);
    try {
      await createManualInvoiceRequest({
        ym, team: TEAM, entityId: f.entityId, placeId: f.placeId || null,
        supplyAmount: amt, erpAccount: f.account, phase: f.phase,
        summary: f.summary.trim(), issueDate: f.issueDate, docEmail: f.email.trim(),
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
  const view = useMemo(() => {
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
      </div>

      <div className="tbl-scroll" style={{ maxHeight: 460 }}>
        <table className="tbl" style={{ fontSize: 11.5 }}>
          <thead>
            <tr>
              {canWrite && <th style={{ width: 32 }}></th>}
              <th>상태</th><th>거래처</th><th>매출계정</th><th>구분</th>
              <th className="r">공급가액</th><th className="r">합계</th>
              <th>발행 시 적요</th><th>작성일</th><th>요청자</th><th>승인번호</th><th>처리자</th>
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && (
              <tr><td colSpan={canWrite ? 12 : 11} style={{ textAlign: 'center', padding: 20, color: '#BBB' }}>
                {ym} 감사팀 발행요청이 없습니다. 위에서 한 줄 등록해 보세요.
              </td></tr>
            )}
            {view.map((r) => {
              const c = r.status === '발행완료' ? { bg: '#D1FAE5', fg: '#065F46' }
                : r.status === '취소' ? { bg: '#F3F4F6', fg: '#6B7280' }
                  : r.status === '수정발행' ? { bg: '#FEE2E2', fg: '#991B1B' } : { bg: '#DBEAFE', fg: '#1E3A8A' };
              return (
                <tr key={r.id} style={{ opacity: r.status === '취소' ? 0.55 : 1 }}>
                  {canWrite && (
                    <td><input type="checkbox" checked={pick.has(r.id)} onChange={() => setPick((p) => {
                      const n = new Set(p); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n;
                    })} /></td>
                  )}
                  <td><span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 9, fontSize: 10.5, fontWeight: 700, background: c.bg, color: c.fg, whiteSpace: 'nowrap' }}>{r.status}</span></td>
                  <td style={{ fontWeight: 700, color: '#1A2B52' }}>{r.companyName}{r.placeName && <span style={{ fontWeight: 400, color: '#888' }}> {r.placeName}</span>}</td>
                  <td style={{ fontSize: 11 }}>{r.erpAccount || <span style={{ color: '#CCC' }}>—</span>}</td>
                  <td>{r.phase || <span style={{ color: '#CCC' }}>—</span>}</td>
                  <td className="r">{won(r.supplyAmount)}</td>
                  <td className="r" style={{ fontWeight: 700 }}>{won(r.total)}</td>
                  <td style={{ fontSize: 11 }}>{r.summary || r.note}</td>
                  <td style={{ fontSize: 11 }}>{r.issueDate ?? <span style={{ color: '#CCC' }}>—</span>}</td>
                  <td style={{ fontSize: 11 }}>{r.requestedByName || <span style={{ color: '#CCC' }}>—</span>}</td>
                  <td style={{ fontSize: 11 }}>
                    {r.invoiceNo || <span style={{ color: '#CCC' }}>—</span>}
                    {canWrite && r.status === '발행완료' && (
                      <button className="btn-sm" style={{ marginLeft: 4 }} onClick={() => {
                        const no = prompt(`${r.companyName} — 세금계산서 승인번호`, r.invoiceNo);
                        if (no !== null) void run(() => updateInvoiceRequest(r.id, { invoiceNo: no }), '저장했습니다');
                      }}>✏️</button>
                    )}
                  </td>
                  <td style={{ fontSize: 11, color: r.issuedByName === FINAL_APPROVER ? '#666' : '#a15', fontWeight: r.issuedByName && r.issuedByName !== FINAL_APPROVER ? 700 : 400 }}>
                    {r.issuedByName || <span style={{ color: '#CCC' }}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
