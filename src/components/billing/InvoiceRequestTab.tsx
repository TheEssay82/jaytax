// 기장등청구관리 › 세금계산서 발행요청
// 왼쪽: 그 달 청구예정(매출계약에서 전개) → 체크해서 발행요청 생성
// 오른쪽: 그 달 요청 목록 → 발행완료(세계번호·발행일) / 취소 / 되돌리기
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { listBizEntities, type BizEntityFull } from '../../lib/bizRegistryApi';
import { pathLabel } from '../../lib/salesContractTaxonomy';
import { todayYmd } from '../../lib/format';
import {
  listInvoiceCandidates, listInvoiceRequests, createInvoiceRequests,
  markIssued, cancelRequests, revertToRequested, updateInvoiceRequest,
  type InvoiceCandidate, type InvoiceRequest, type InvoiceStatus,
} from '../../lib/invoiceRequestApi';

const won = (n: number) => n.toLocaleString('ko-KR');
const thisMonth = () => todayYmd().slice(0, 7);

export default function InvoiceRequestTab() {
  const { readonly, role } = useAuth();
  const canWrite = !readonly && role !== 'per_head_accountant';

  const [ym, setYm] = useState(thisMonth);
  const [entities, setEntities] = useState<BizEntityFull[]>([]);
  const [cands, setCands] = useState<InvoiceCandidate[]>([]);
  const [reqs, setReqs] = useState<InvoiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const [pick, setPick] = useState<Set<string>>(new Set());
  const [pickReq, setPickReq] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | ''>('');
  const [issuedDate, setIssuedDate] = useState(todayYmd);
  const [q, setQ] = useState('');

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setErr(null);
      const ents = entities.length ? entities : await listBizEntities();
      if (!entities.length) setEntities(ents);
      const [c, r] = await Promise.all([listInvoiceCandidates(ym, ents), listInvoiceRequests(ym)]);
      setCands(c); setReqs(r); setPick(new Set()); setPickReq(new Set());
    } catch (e) {
      setErr(e instanceof Error ? e.message : '불러오지 못했습니다.');
    } finally { setLoading(false); }
  }, [ym, entities]);
  useEffect(() => { void load(); }, [load]);

  const candView = useMemo(() => {
    if (!q.trim()) return cands;
    const k = q.trim().toLowerCase();
    return cands.filter((c) => (c.companyName + c.placeName + c.contractCode + c.cpa + c.staff).toLowerCase().includes(k));
  }, [cands, q]);
  const reqView = useMemo(() => {
    let list = reqs;
    if (statusFilter) list = list.filter((r) => r.status === statusFilter);
    if (q.trim()) {
      const k = q.trim().toLowerCase();
      list = list.filter((r) => (r.companyName + r.placeName + r.contractCode + r.invoiceNo).toLowerCase().includes(k));
    }
    return list;
  }, [reqs, statusFilter, q]);

  const picked = cands.filter((c) => pick.has(c.key));
  const pickedSupply = picked.reduce((s, c) => s + c.supplyAmount, 0);
  const pickedReqs = reqs.filter((r) => pickReq.has(r.id));

  const sum = (list: InvoiceRequest[]) => list.reduce((s, r) => s + r.total, 0);
  const stat = useMemo(() => ({
    요청: reqs.filter((r) => r.status === '요청'),
    발행완료: reqs.filter((r) => r.status === '발행완료'),
    취소: reqs.filter((r) => r.status === '취소'),
  }), [reqs]);

  async function doRequest() {
    if (!picked.length) return;
    if (!confirm(`${picked.length}건을 ${ym} 발행요청으로 등록합니다. 진행할까요?`)) return;
    setBusy(true);
    try { const n = await createInvoiceRequests(ym, picked); await load(); flash(`✓ ${n}건 발행요청 등록`); }
    catch (e) { alert('등록 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }
  async function doIssue() {
    const ids = pickedReqs.filter((r) => r.status === '요청').map((r) => r.id);
    if (!ids.length) return alert('발행완료로 바꿀 ‘요청’ 상태 건을 선택하세요.');
    const one = ids.length === 1;
    const no = one ? prompt('세금계산서 승인번호(선택 — 비우면 나중에 입력)') : null;
    if (one && no === null) return;                       // 취소 누름
    if (!one && !confirm(`${ids.length}건을 발행완료(${issuedDate})로 처리합니다. 승인번호는 건별로 나중에 입력하세요.`)) return;
    setBusy(true);
    try { await markIssued(ids, one ? (no ?? '') : null, issuedDate); await load(); flash(`✓ ${ids.length}건 발행완료`); }
    catch (e) { alert('처리 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }
  async function doCancel() {
    const ids = pickedReqs.filter((r) => r.status !== '취소').map((r) => r.id);
    if (!ids.length) return;
    if (!confirm(`${ids.length}건을 취소합니다. 취소하면 다시 청구예정 목록으로 돌아갑니다.`)) return;
    setBusy(true);
    try { await cancelRequests(ids); await load(); flash(`✓ ${ids.length}건 취소`); }
    catch (e) { alert('취소 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }
  async function doRevert() {
    const ids = pickedReqs.filter((r) => r.status === '발행완료').map((r) => r.id);
    if (!ids.length) return alert('되돌릴 ‘발행완료’ 건을 선택하세요.');
    if (!confirm(`${ids.length}건을 요청 상태로 되돌립니다. 승인번호·발행일이 지워집니다.`)) return;
    setBusy(true);
    try { await revertToRequested(ids); await load(); flash(`✓ ${ids.length}건 되돌림`); }
    catch (e) { alert('되돌리기 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }
  async function editNo(r: InvoiceRequest) {
    const no = prompt(`${r.companyName} — 세금계산서 승인번호`, r.invoiceNo);
    if (no === null) return;
    try { await updateInvoiceRequest(r.id, { invoiceNo: no }); await load(); }
    catch (e) { alert('저장 실패: ' + (e instanceof Error ? e.message : e)); }
  }

  const monthOpts = useMemo(() => {
    const base = thisMonth();
    const [y, m] = base.split('-').map(Number);
    return Array.from({ length: 15 }, (_, i) => {
      const d = new Date(Date.UTC(y, m - 1 - i + 2, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    });
  }, []);

  if (loading) return <div className="card">불러오는 중…</div>;

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        🧾 세금계산서 발행요청
        <select value={ym} onChange={(e) => setYm(e.target.value)} style={{ fontWeight: 700 }}>
          {monthOpts.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <span style={{ fontSize: 11, fontWeight: 400, color: '#888' }}>
          청구예정 {cands.length} · 요청 {stat.요청.length} · 발행완료 {stat.발행완료.length}
          {stat.취소.length > 0 && ` · 취소 ${stat.취소.length}`}
        </span>
        {msg && <span style={{ marginLeft: 'auto', fontSize: 12, color: '#2a7' }}>{msg}</span>}
      </div>
      {err && <div className="alert-w">{err}</div>}

      <div className="alert-i" style={{ fontSize: 11 }}>
        매출계약의 청구주기·분할회차에서 그 달 청구분을 펼쳐 보여줍니다. 체크해서 <b>발행요청</b>으로 등록하고,
        실제로 발행하면 <b>발행완료</b>로 바꿔 승인번호와 발행일을 남깁니다. 금액은 요청한 시점 기준으로 저장되어,
        나중에 계약금액이 바뀌어도 이미 나간 요청은 그대로 남습니다.
      </div>

      <div className="sbar">
        <input placeholder="🔍 거래처·사업장·계약코드·담당·승인번호" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as InvoiceStatus | '')}>
          <option value="">요청목록: 전체</option>
          <option value="요청">요청</option>
          <option value="발행완료">발행완료</option>
          <option value="취소">취소</option>
        </select>
      </div>

      {/* ── 청구예정 → 발행요청 ── */}
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 12.5, color: '#1A2B52' }}>① {ym} 청구예정 ({candView.length}건)</b>
          {canWrite && (
            <>
              <button className="btn-sm" onClick={() => setPick(new Set(candView.map((c) => c.key)))}>보이는 건 전체선택</button>
              <button className="btn-sm" onClick={() => setPick(new Set())}>선택해제</button>
              <span style={{ fontSize: 12, color: '#555' }}>선택 <b>{picked.length}</b>건 · 공급가액 {won(pickedSupply)}</span>
              <button className="btn-p" disabled={busy || !picked.length} onClick={() => void doRequest()}>
                {busy ? '처리 중…' : '발행요청 등록'}
              </button>
            </>
          )}
        </div>
        <div className="tbl-scroll" style={{ maxHeight: 300 }}>
          <table className="tbl" style={{ fontSize: 11.5 }}>
            <thead>
              <tr>
                {canWrite && <th style={{ width: 32 }}></th>}
                <th>거래처</th><th>사업장</th><th>매출유형</th><th>계약코드</th><th>회차</th>
                <th className="r">공급가액</th><th className="r">부가세</th><th className="r">합계</th><th>담당</th>
              </tr>
            </thead>
            <tbody>
              {candView.length === 0 && (
                <tr><td colSpan={canWrite ? 10 : 9} style={{ textAlign: 'center', padding: 20, color: '#BBB' }}>
                  {ym}에 청구예정인 계약이 없습니다.
                </td></tr>
              )}
              {candView.map((c) => {
                const vat = Math.round(c.supplyAmount * 0.1);
                return (
                  <tr key={c.key}>
                    {canWrite && (
                      <td>
                        <input type="checkbox" checked={pick.has(c.key)} onChange={() => setPick((p) => {
                          const n = new Set(p); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n;
                        })} />
                      </td>
                    )}
                    <td style={{ fontWeight: 700, color: '#1A2B52' }}>
                      {c.companyName}
                      {!c.confirmed && <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 700, color: '#92400E', background: '#FEF3C7', border: '1px solid #FCD34D', padding: '0 4px', borderRadius: 3 }}>미계약</span>}
                    </td>
                    <td>{c.placeName}</td>
                    <td style={{ fontSize: 11 }}>{pathLabel(c.typeLabel)}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 10.5 }}>{c.contractCode}</td>
                    <td>{c.label}</td>
                    <td className="r">{won(c.supplyAmount)}</td>
                    <td className="r" style={{ color: '#888' }}>{won(vat)}</td>
                    <td className="r" style={{ fontWeight: 700 }}>{won(c.supplyAmount + vat)}</td>
                    <td style={{ fontSize: 11 }}>{c.cpa}{c.staff && ` · ${c.staff}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 요청 목록 → 발행처리 ── */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 12.5, color: '#1A2B52' }}>② 발행요청 목록 ({reqView.length}건 · 합계 {won(sum(reqView))})</b>
          {canWrite && (
            <>
              <span style={{ fontSize: 11.5, color: '#666' }}>발행일</span>
              <input type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} style={{ fontSize: 12 }} />
              <button className="btn-p" disabled={busy || !pickedReqs.length} onClick={() => void doIssue()}>발행완료 처리</button>
              <button className="btn-sm" disabled={busy || !pickedReqs.length} onClick={() => void doRevert()}>요청으로 되돌리기</button>
              <button className="btn-sm btn-sm-del" disabled={busy || !pickedReqs.length} onClick={() => void doCancel()}>취소</button>
            </>
          )}
        </div>
        <div className="tbl-scroll" style={{ maxHeight: 340 }}>
          <table className="tbl" style={{ fontSize: 11.5 }}>
            <thead>
              <tr>
                {canWrite && <th style={{ width: 32 }}></th>}
                <th>상태</th><th>거래처</th><th>사업장</th><th>계약코드</th><th>비고</th>
                <th className="r">공급가액</th><th className="r">합계</th><th>승인번호</th><th>발행일</th>
              </tr>
            </thead>
            <tbody>
              {reqView.length === 0 && (
                <tr><td colSpan={canWrite ? 10 : 9} style={{ textAlign: 'center', padding: 20, color: '#BBB' }}>
                  발행요청이 없습니다. 위에서 청구예정을 골라 등록하세요.
                </td></tr>
              )}
              {reqView.map((r) => {
                const c = r.status === '발행완료' ? { bg: '#D1FAE5', fg: '#065F46' }
                  : r.status === '취소' ? { bg: '#F3F4F6', fg: '#6B7280' } : { bg: '#DBEAFE', fg: '#1E3A8A' };
                return (
                  <tr key={r.id} style={{ opacity: r.status === '취소' ? 0.55 : 1 }}>
                    {canWrite && (
                      <td>
                        <input type="checkbox" checked={pickReq.has(r.id)} onChange={() => setPickReq((p) => {
                          const n = new Set(p); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n;
                        })} />
                      </td>
                    )}
                    <td>
                      <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 9, fontSize: 10.5, fontWeight: 700, background: c.bg, color: c.fg, whiteSpace: 'nowrap' }}>{r.status}</span>
                    </td>
                    <td style={{ fontWeight: 700, color: '#1A2B52' }}>{r.companyName}</td>
                    <td>{r.placeName}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 10.5 }}>{r.contractCode}</td>
                    <td>{r.note}</td>
                    <td className="r">{won(r.supplyAmount)}</td>
                    <td className="r" style={{ fontWeight: 700 }}>{won(r.total)}</td>
                    <td>
                      {r.invoiceNo || <span style={{ color: '#CCC' }}>—</span>}
                      {canWrite && r.status === '발행완료' && (
                        <button className="btn-sm" style={{ marginLeft: 4 }} onClick={() => void editNo(r)}>✏️</button>
                      )}
                    </td>
                    <td style={{ fontSize: 11 }}>{r.issuedDate ?? <span style={{ color: '#CCC' }}>—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
