// 기장등청구관리 › 세금계산서 발행요청
// 왼쪽: 그 달 청구예정(매출계약에서 전개) → 체크해서 발행요청 생성
// 오른쪽: 그 달 요청 목록 → 발행완료(세계번호·발행일) / 취소 / 되돌리기
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { listBizEntities, CPA_OPTIONS, type BizEntityFull } from '../../lib/bizRegistryApi';
import { pathLabel } from '../../lib/salesContractTaxonomy';
import { todayYmd } from '../../lib/format';
import {
  listInvoiceCandidates, listInvoiceRequests, createInvoiceRequests,
  markIssued, cancelRequests, revertToRequested, updateInvoiceRequest,
  type InvoiceCandidate, type InvoiceRequest,
} from '../../lib/invoiceRequestApi';
import { listInvoiceStaff, type InvoiceStaffShare } from '../../lib/invoiceStaffApi';
import { Grid, useGrid, type GridCol } from './grid';
import { ColumnSettings } from '../clients/tableKit';
import { VIEW_KEYS } from '../../lib/tableViewApi';
import { StaffShareEditor, shareLabel } from './StaffShareEditor';
import { listInternalStaff } from '../../lib/bizRegistryApi';
import {
  getMonthState, openMonth, resetMonth, notifyCheckers, markMyCheck, clearMyCheck, setFinalConfirm,
  issueDateOf, pastIssueDay, CHECKERS, FINAL_APPROVER, type MonthState,
} from '../../lib/invoiceMonthApi';

const won = (n: number) => n.toLocaleString('ko-KR');
const dash = <span style={{ color: '#CCC' }}>—</span>;
/** 전월 대비 차이 한 줄. */
interface DiffRow { kind: '신규' | '변동' | '없어짐'; company: string; place: string; prev: number; now: number }
const KIND_ORDER: Record<DiffRow['kind'], number> = { 없어짐: 0, 변동: 1, 신규: 2 };
const cpaOpts = CPA_OPTIONS;
const thisMonth = () => todayYmd().slice(0, 7);
const prevMonthOf = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export default function InvoiceRequestTab() {
  const { readonly, role, profileName } = useAuth();
  const canWrite = !readonly && role !== 'per_head_accountant';
  // 발행완료·최종확인은 김민섭이 원칙. 부재 시 기장팀장·최고관리자도 누를 수 있고, 누른 사람이 기록된다.
  const isApprover = canWrite && (profileName === FINAL_APPROVER || role === 'team_lead' || role === 'superuser');
  const isChecker = canWrite && (CHECKERS as readonly string[]).includes(profileName);

  const [ym, setYm] = useState(thisMonth);
  const [entities, setEntities] = useState<BizEntityFull[]>([]);
  const [cands, setCands] = useState<InvoiceCandidate[]>([]);
  const [reqs, setReqs] = useState<InvoiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const [month, setMonth] = useState<MonthState | null>(null);
  const [prev, setPrev] = useState<InvoiceRequest[]>([]);   // 전월 요청(비교용)
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [pickReq, setPickReq] = useState<Set<string>>(new Set());
  const [issuedDate, setIssuedDate] = useState(todayYmd);
  const [shares, setShares] = useState<Map<string, InvoiceStaffShare[]>>(new Map());
  const [staffOpts, setStaffOpts] = useState<string[]>([]);
  const [editShare, setEditShare] = useState<InvoiceRequest | null>(null);
  const [q, setQ] = useState('');
  const [showDiff, setShowDiff] = useState(false);

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setErr(null);
      const ents = entities.length ? entities : await listBizEntities();
      if (!entities.length) setEntities(ents);
      const [c, r, p, mst] = await Promise.all([
        listInvoiceCandidates(ym, ents, 'taxteam'),
        listInvoiceRequests(ym, 'taxteam'),
        listInvoiceRequests(prevMonthOf(ym), 'taxteam'),
        getMonthState(ym),
      ]);
      setCands(c); setReqs(r); setPrev(p); setMonth(mst);
      setShares(await listInvoiceStaff(r.map((x) => x.id)));
      if (!staffOpts.length) setStaffOpts((await listInternalStaff()).map((x) => x.name));
      setPick(new Set()); setPickReq(new Set());
    } catch (e) {
      setErr(e instanceof Error ? e.message : '불러오지 못했습니다.');
    } finally { setLoading(false); }
  }, [ym, entities, staffOpts.length]);
  useEffect(() => { void load(); }, [load]);

  const candSearched = useMemo(() => {
    if (!q.trim()) return cands;
    const k = q.trim().toLowerCase();
    return cands.filter((c) => (c.companyName + c.placeName + c.contractCode + c.cpa + c.staff).toLowerCase().includes(k));
  }, [cands, q]);
  const reqSearched = useMemo(() => {
    if (!q.trim()) return reqs;
    const k = q.trim().toLowerCase();
    return reqs.filter((r) => (r.companyName + r.placeName + r.contractCode + r.invoiceNo + r.cpa + r.staff).toLowerCase().includes(k));
  }, [reqs, q]);

  const picked = cands.filter((c) => pick.has(c.key));
  const pickedSupply = picked.reduce((s, c) => s + c.supplyAmount, 0);
  const pickedReqs = reqs.filter((r) => pickReq.has(r.id));

  // 합계는 **취소를 뺀** 살아있는 건만 더한다 — 취소분이 섞이면 엑셀·ERP 대조가 그대로 어긋난다.
  const live = (list: InvoiceRequest[]) => list.filter((r) => r.status !== '취소');
  const sum = (list: InvoiceRequest[]) => live(list).reduce((s, r) => s + r.total, 0);
  const sumSupply = (list: InvoiceRequest[]) => live(list).reduce((s, r) => s + r.supplyAmount, 0);
  /** 지금 보이는 목록에서 아직 '요청'인 건 — 발행완료 일괄처리 대상. */
  const issuable = (list: InvoiceRequest[]) => list.filter((r) => r.status === '요청');
  const stat = useMemo(() => ({
    요청: reqs.filter((r) => r.status === '요청'),
    발행완료: reqs.filter((r) => r.status === '발행완료'),
    취소: reqs.filter((r) => r.status === '취소'),
  }), [reqs]);

  /**
   * 전월 대비 비교 — 엑셀에서 '전월 열을 복사한 뒤 눈으로 훑던' 일을 대신한다.
   * 계약(contractId)으로 맞춘다. 계약이 없는 건은 비교 대상이 아니다.
   */
  const diff = useMemo(() => {
    const prevBy = new Map<string, InvoiceRequest>();
    for (const r of prev) if (r.status !== '취소' && r.contractId) prevBy.set(r.contractId, r);
    const nowIds = new Set<string>();
    const mark = new Map<string, { kind: '신규' | '변동'; prevAmount: number }>();
    // 요약 옆에서 바로 펼쳐 볼 상세 — 어느 거래처가 어떻게 달라졌는지.
    const rows: DiffRow[] = [];
    const put = (contractId: string | null, company: string, place: string, amount: number) => {
      if (!contractId || nowIds.has(contractId)) return;
      nowIds.add(contractId);
      const p = prevBy.get(contractId);
      if (!p) {
        mark.set(contractId, { kind: '신규', prevAmount: 0 });
        rows.push({ kind: '신규', company, place, prev: 0, now: amount });
      } else if (p.supplyAmount !== amount) {
        mark.set(contractId, { kind: '변동', prevAmount: p.supplyAmount });
        rows.push({ kind: '변동', company, place, prev: p.supplyAmount, now: amount });
      }
    };
    for (const c of cands) put(c.contractId, c.companyName, c.placeName, c.supplyAmount);
    for (const r of reqs) if (r.status !== '취소') put(r.contractId, r.companyName, r.placeName, r.supplyAmount);
    // 전월엔 있었는데 이번 달엔 없는 것 = 해지 의심(엑셀의 'X')
    const dropped = [...prevBy.values()].filter((p) => !nowIds.has(p.contractId!));
    for (const d of dropped) rows.push({ kind: '없어짐', company: d.companyName, place: d.placeName, prev: d.supplyAmount, now: 0 });
    rows.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.company.localeCompare(b.company, 'ko'));
    return { mark, dropped, rows };
  }, [prev, cands, reqs]);

  const checkedNames = new Set((month?.checks ?? []).map((c) => c.name));
  const allChecked = CHECKERS.every((n) => checkedNames.has(n));
  const iChecked = checkedNames.has(profileName);

  /** 당월 전개 — 청구예정을 전부 요청으로 등록하고 담당자에게 확인 알림을 보낸다. */
  async function doOpenMonth() {
    const n = cands.length;
    if (!confirm(`${ym} 을 엽니다.

· 청구예정 ${n}건을 발행요청으로 등록합니다(작성일 ${issueDateOf(ym)})
· ${CHECKERS.join('·')} 에게 확인 요청 알림을 보냅니다

진행할까요?`)) return;
    setBusy(true);
    try {
      await openMonth(ym);
      if (n) await createInvoiceRequests(ym, cands, { team: 'taxteam', issueDate: issueDateOf(ym) });
      const sent = await notifyCheckers(ym);
      await load();
      flash(`✓ ${ym} 전개 완료 — 요청 ${n}건 · 알림 ${sent}명`);
    } catch (e) { alert('전개 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }
  /** 이 달을 되돌린다 — 잘못 열었거나 시험 삼아 연 달을 치운다. */
  async function doResetMonth() {
    const n = reqs.length;
    const done = reqs.filter((r) => r.status === '발행완료' || r.status === '수정발행').length;
    if (done) {
      alert(`이미 발행완료된 건이 ${done}건 있어 초기화할 수 없습니다.

`
        + `그 건을 먼저 ‘요청으로 되돌리기’ 하거나 취소한 뒤 다시 시도하세요.`);
      return;
    }
    if (!confirm(`${ym} 을 처음 상태로 되돌립니다.

· 발행요청 ${n}건을 지웁니다(실적 배분도 함께)
· 전개 기록과 ${CHECKERS.join('·')} 확인 표시를 지웁니다

지운 것은 되살릴 수 없습니다. 다만 청구예정은 매출계약에서 다시 계산되므로,
‘당월 전개’를 누르면 처음부터 다시 시작할 수 있습니다.

진행할까요?`)) return;
    if (n > 0 && !confirm(`정말 ${ym} 발행요청 ${n}건을 지울까요? 마지막 확인입니다.`)) return;
    setBusy(true);
    try {
      const { deleted } = await resetMonth(ym, 'taxteam');
      await load();
      flash(`✓ ${ym} 초기화 — 요청 ${deleted}건 삭제`);
    } catch (e) { alert('초기화 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }
  async function doCheck() {
    setBusy(true);
    try {
      if (iChecked) await clearMyCheck(ym);
      else await markMyCheck(ym, diff.mark.size || diff.dropped.length ? '' : '변경 없음');
      await load();
      flash(iChecked ? '확인을 해제했습니다' : '✓ 확인했습니다');
    } catch (e) { alert('처리 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }
  async function doFinal() {
    const on = !month?.finalConfirmedAt;
    if (on && !allChecked && !confirm(`아직 확인하지 않은 담당자가 있습니다.
(${CHECKERS.filter((n) => !checkedNames.has(n)).join('·')})

그래도 최종확인할까요?`)) return;
    setBusy(true);
    try { await setFinalConfirm(ym, on); await load(); flash(on ? '✓ 최종확인' : '최종확인을 해제했습니다'); }
    catch (e) { alert('처리 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }

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

  // ── 표 열 정의 ────────────────────────────────────────
  // 제목행을 누르면 정렬, 아래 칸에 값을 넣으면 그 열만 걸러진다. 너비는 끝을 끌어 조절(더블클릭=내용맞춤).
  const candCols: GridCol<InvoiceCandidate>[] = [
    { key: 'company', label: '거래처', width: 150, value: (c) => c.companyName,
      style: { fontWeight: 700, color: '#1A2B52' },
      cell: (c) => (
        <>
          {c.companyName}
          {!c.confirmed && <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 700, color: '#92400E', background: '#FEF3C7', border: '1px solid #FCD34D', padding: '0 4px', borderRadius: 3 }}>미계약</span>}
          <DiffBadge d={diff.mark.get(c.contractId)} amount={c.supplyAmount} />
        </>
      ) },
    { key: 'place', label: '사업장', width: 110, value: (c) => c.placeName },
    { key: 'type', label: '매출유형', width: 130, value: (c) => pathLabel(c.typeLabel) },
    { key: 'code', label: '계약코드', width: 100, value: (c) => c.contractCode, style: { fontFamily: 'monospace', fontSize: 10.5 } },
    { key: 'round', label: '회차', width: 64, value: (c) => c.label },
    { key: 'supply', label: '공급가액', width: 96, num: true, value: (c) => c.supplyAmount,
      cell: (c) => won(c.supplyAmount), sum: (c) => c.supplyAmount },
    { key: 'vat', label: '부가세', width: 84, num: true, value: (c) => Math.round(c.supplyAmount * 0.1),
      cell: (c) => won(Math.round(c.supplyAmount * 0.1)), sum: (c) => Math.round(c.supplyAmount * 0.1), style: { color: '#888' } },
    { key: 'total', label: '합계', width: 96, num: true, value: (c) => c.supplyAmount + Math.round(c.supplyAmount * 0.1),
      cell: (c) => won(c.supplyAmount + Math.round(c.supplyAmount * 0.1)),
      sum: (c) => c.supplyAmount + Math.round(c.supplyAmount * 0.1), style: { fontWeight: 700 } },
    { key: 'cpa', label: '담당회계사', width: 80, value: (c) => c.cpa, opts: cpaOpts, cell: (c) => c.cpa || dash },
    { key: 'staff', label: '담당직원', width: 84, value: (c) => c.staff, opts: staffOpts,
      style: { fontWeight: 600, color: '#1A2B52' }, cell: (c) => c.staff || dash },
  ];

  const reqCols: GridCol<InvoiceRequest>[] = [
    { key: 'status', label: '상태', width: 74, value: (r) => r.status, opts: ['요청', '발행완료', '취소', '수정발행'],
      cell: (r) => {
        const c = r.status === '발행완료' ? { bg: '#D1FAE5', fg: '#065F46' }
          : r.status === '취소' ? { bg: '#F3F4F6', fg: '#6B7280' } : { bg: '#DBEAFE', fg: '#1E3A8A' };
        return <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 9, fontSize: 10.5, fontWeight: 700, background: c.bg, color: c.fg, whiteSpace: 'nowrap' }}>{r.status}</span>;
      } },
    { key: 'company', label: '거래처', width: 150, value: (r) => r.companyName,
      style: { fontWeight: 700, color: '#1A2B52' },
      cell: (r) => <>{r.companyName}<DiffBadge d={diff.mark.get(r.contractId ?? '')} amount={r.supplyAmount} /></> },
    { key: 'place', label: '사업장', width: 110, value: (r) => r.placeName },
    { key: 'erp', label: '매출계정', width: 120, value: (r) => r.erpAccount, cell: (r) => r.erpAccount || dash, style: { color: '#666' } },
    { key: 'code', label: '계약코드', width: 100, value: (r) => r.contractCode, style: { fontFamily: 'monospace', fontSize: 10.5 } },
    { key: 'cpa', label: '담당회계사', width: 80, value: (r) => r.cpa, opts: cpaOpts, cell: (r) => r.cpa || dash },
    { key: 'staff', label: '담당직원', width: 96, value: (r) => shareLabel(shares.get(r.id), r.staff), opts: staffOpts,
      style: { fontWeight: 600, color: '#1A2B52' },
      cell: (r) => (canWrite ? (
        <button className="btn-sm" style={{ fontWeight: 600 }} onClick={() => setEditShare(r)}
          title="담당직원을 바꾸거나, 둘이 나눠 한 일이면 비율을 정합니다">
          {shareLabel(shares.get(r.id), r.staff || '지정')}
        </button>
      ) : (shareLabel(shares.get(r.id), r.staff) || dash)) },
    { key: 'summary', label: '비고', width: 130, value: (r) => r.summary || r.note, style: { color: '#666' } },
    { key: 'supply', label: '공급가액', width: 96, num: true, value: (r) => r.supplyAmount,
      cell: (r) => won(r.supplyAmount), sum: (r) => (r.status === '취소' ? 0 : r.supplyAmount) },
    { key: 'vat', label: 'VAT', width: 84, num: true, value: (r) => r.vat,
      cell: (r) => won(r.vat), sum: (r) => (r.status === '취소' ? 0 : r.vat), style: { color: '#888' } },
    { key: 'total', label: '합계', width: 96, num: true, value: (r) => r.total,
      cell: (r) => won(r.total), sum: (r) => (r.status === '취소' ? 0 : r.total), style: { fontWeight: 700 } },
    { key: 'invoiceNo', label: '승인번호', width: 110, value: (r) => r.invoiceNo,
      cell: (r) => (
        <>
          {r.invoiceNo || dash}
          {canWrite && r.status === '발행완료' && (
            <button className="btn-sm" style={{ marginLeft: 4 }} onClick={() => void editNo(r)}>✏️</button>
          )}
        </>
      ) },
    { key: 'issuedDate', label: '발행일', width: 88, value: (r) => r.issuedDate ?? '', cell: (r) => r.issuedDate ?? dash },
    { key: 'issuedBy', label: '처리자', width: 76, value: (r) => r.issuedByName,
      cell: (r) => r.issuedByName || dash,
      style: { color: '#666' } },
  ];

  const candGrid = useGrid(VIEW_KEYS.invoiceCandidate, candCols, candSearched, { key: 'company', dir: 'asc' });
  const reqGrid = useGrid(VIEW_KEYS.invoiceRequest, reqCols, reqSearched, { key: 'company', dir: 'asc' });
  const candView = candGrid.rowsView;
  const reqView = reqGrid.rowsView;

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

      {/* ── 이번 달 진행 상태 — 엑셀의 '전월 복사 → 3인 확인 → 마감'을 그대로 옮긴 자리 ── */}
      <div style={{
        border: '1px solid #e2d9c6', background: '#fdfaf3', borderRadius: 6,
        padding: '8px 10px', marginBottom: 10, fontSize: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ color: '#1A2B52' }}>{ym} 진행</b>
          {!month?.opened ? (
            <>
              <span style={{ color: '#a15' }}>아직 열지 않았습니다.</span>
              {pastIssueDay(ym, todayYmd()) && (
                <span style={{ color: '#a15', fontWeight: 700 }}>· 작성일({issueDateOf(ym)})이 지났습니다</span>
              )}
              {canWrite && (
                <button className="btn-p" disabled={busy} onClick={() => void doOpenMonth()}>
                  📂 당월 전개 + 확인요청
                </button>
              )}
              {isApprover && reqs.length > 0 && (
                <button className="btn-sm btn-sm-del" disabled={busy} onClick={() => void doResetMonth()}
                  title="전개 기록은 없는데 발행요청만 남아 있습니다 — 이 달을 처음 상태로 되돌립니다.">
                  ↺ 이 달 초기화 ({reqs.length}건)
                </button>
              )}
            </>
          ) : (
            <>
              <span style={{ color: '#666' }}>
                전개 {month.openedAt?.slice(0, 10)}{month.openedBy && ` · ${month.openedBy}`} · 작성일 {issueDateOf(ym)}
              </span>
              <span style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 4 }}>
                {CHECKERS.map((n) => {
                  const c = month.checks.find((x) => x.name === n);
                  return (
                    <span key={n} title={c ? `${c.checkedAt.slice(0, 16).replace('T', ' ')}${c.note ? ` · ${c.note}` : ''}` : '아직 확인 전'}
                      style={{
                        padding: '1px 7px', borderRadius: 9, fontSize: 11, fontWeight: 700,
                        background: c ? '#D1FAE5' : '#F3F4F6', color: c ? '#065F46' : '#9CA3AF',
                        border: '1px solid ' + (c ? '#6EE7B7' : '#E5E7EB'),
                      }}>{c ? '✓ ' : '○ '}{n}</span>
                  );
                })}
              </span>
              {isChecker && (
                <button className={iChecked ? 'btn-sm' : 'btn-p'} disabled={busy} onClick={() => void doCheck()}>
                  {iChecked ? '확인 해제' : '✅ 확인했습니다'}
                </button>
              )}
              {month.finalConfirmedAt ? (
                <span style={{ marginLeft: 4, padding: '1px 8px', borderRadius: 9, fontSize: 11, fontWeight: 700, background: '#1A2B52', color: '#fff' }}>
                  최종확인 {month.finalConfirmedAt.slice(0, 10)}{month.finalConfirmedBy && ` · ${month.finalConfirmedBy}`}
                </span>
              ) : (
                isApprover && (
                  <button className="btn-p" disabled={busy} onClick={() => void doFinal()}
                    title={allChecked ? '' : '아직 확인하지 않은 담당자가 있습니다'}>
                    🔒 최종확인{allChecked ? '' : ' (미확인 있음)'}
                  </button>
                )
              )}
              {month.finalConfirmedAt && isApprover && (
                <button className="btn-sm" disabled={busy} onClick={() => void doFinal()}>해제</button>
              )}
              {isApprover && (
                <button className="btn-sm btn-sm-del" style={{ marginLeft: 'auto' }} disabled={busy}
                  onClick={() => void doResetMonth()}
                  title="이 달을 처음 상태로 되돌립니다 — 발행요청·전개기록·확인표시를 지웁니다. 발행완료 건이 있으면 막힙니다.">
                  ↺ 이 달 초기화
                </button>
              )}
            </>
          )}
        </div>
        {diff.rows.length > 0 && (
          <div style={{ marginTop: 5, fontSize: 11.5, color: '#7a5' }}>
            전월({prevMonthOf(ym)}) 대비 — 🆕신규·⚠️금액변동 <b>{diff.mark.size}</b>건
            {diff.dropped.length > 0 && <> · ❌전월에 있었는데 이번 달 없음 <b style={{ color: '#c33' }}>{diff.dropped.length}</b>건</>}
            <button className="btn-sm" style={{ marginLeft: 6 }} onClick={() => setShowDiff((v) => !v)}>
              {showDiff ? '▾ 상세 닫기' : `▸ 차이 상세 (${diff.rows.length}건)`}
            </button>
            {showDiff && (
              <div style={{ marginTop: 6, background: '#fff', border: '1px solid #e6ddc8', borderRadius: 5, padding: 6 }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 5 }}>
                  전월 요청과 이번 달을 <b>계약 단위로</b> 맞춰 본 것입니다.
                  <b> 없어짐</b>은 해지·중단인지 확인하고, <b>변동</b>은 계약금액이 바뀐 게 맞는지 봅니다.
                </div>
                <div style={{ maxHeight: 220, overflow: 'auto' }}>
                  <table className="tbl" style={{ fontSize: 11.5 }}>
                    <thead>
                      <tr><th>구분</th><th>거래처</th><th>사업장</th>
                        <th className="r">전월</th><th className="r">이번 달</th><th className="r">차이</th></tr>
                    </thead>
                    <tbody>
                      {diff.rows.map((d, i) => (
                        <tr key={i}>
                          <td style={{ whiteSpace: 'nowrap', fontWeight: 700, color: d.kind === '없어짐' ? '#c33' : d.kind === '신규' ? '#1E3A8A' : '#92400E' }}>
                            {d.kind === '없어짐' ? '❌ 없어짐' : d.kind === '신규' ? '🆕 신규' : '⚠️ 변동'}
                          </td>
                          <td style={{ fontWeight: 700, color: '#1A2B52' }}>{d.company}</td>
                          <td>{d.place}</td>
                          <td className="r" style={{ color: '#888' }}>{d.prev ? won(d.prev) : dash}</td>
                          <td className="r" style={{ fontWeight: 700 }}>{d.now ? won(d.now) : dash}</td>
                          <td className="r" style={{ color: d.now - d.prev >= 0 ? '#2a7' : '#c33', fontWeight: 700 }}>
                            {d.now - d.prev > 0 ? '+' : ''}{won(d.now - d.prev)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="alert-i" style={{ fontSize: 11 }}>
        <b>① 청구예정</b>은 저장된 자료가 아니라 <b>매출계약에서 그때그때 계산한 예상</b>입니다 —
        그래서 아직 손대지 않은 달도, 앞으로 올 달도 계약이 있으면 그대로 보입니다.
        여기서 체크해 <b>② 발행요청</b>으로 등록하면 그 건은 ①에서 빠지고, 그 달을 다 등록하면 ①이 0건이 됩니다. 체크해서 <b>발행요청</b>으로 등록하고,
        실제로 발행하면 <b>발행완료</b>로 바꿔 승인번호와 발행일을 남깁니다. 금액은 요청한 시점 기준으로 저장되어,
        나중에 계약금액이 바뀌어도 이미 나간 요청은 그대로 남습니다.
        <br />표의 <b>제목행을 누르면 정렬</b>, 그 아래 칸에 값을 넣으면 <b>그 열만 걸러</b> 봅니다.
        머리글 오른쪽 끝을 끌면 <b>너비</b>가 바뀌고, 더블클릭하면 내용에 맞춰집니다. <b>⚙️ 열 설정</b>에서 숨김·순서를 정해 저장하면 다음에도 그대로 열립니다.
        <br />연 1회 계약(세무조정 등)은 <b>요청한 달이 곧 그 계약의 청구월</b>이 됩니다 — 계약에 적힌 청구월은
        지난 실적에서 잡은 예상치라, 실제로 요청하면 그 달로 맞춰집니다.
      </div>

      <div className="sbar">
        <input placeholder="🔍 거래처·사업장·계약코드·담당·승인번호" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {/* ── 청구예정 → 발행요청 ── */}
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 12.5, color: '#1A2B52' }}>① {ym} 청구예정 ({candView.length}건 · 공급가액 {won(candView.reduce((s, c) => s + c.supplyAmount, 0))})</b>
          {ym > thisMonth() && (
            <span title="아직 오지 않은 달입니다. 계약에서 계산한 예상일 뿐, 등록된 것은 없습니다."
              style={{ fontSize: 10.5, fontWeight: 700, color: '#5B21B6', background: '#EDE9FE', border: '1px solid #C4B5FD', padding: '1px 6px', borderRadius: 9 }}>
              미리보기 — 아직 오지 않은 달
            </span>
          )}
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
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {candGrid.filterCount > 0 && <button className="btn-sm" onClick={candGrid.clearFilters}>필터 초기화 ({candGrid.filterCount})</button>}
            <ColumnSettings cols={candGrid.ordered} view={candGrid.view} onMessage={flash} />
          </span>
        </div>
        <Grid grid={candGrid} rowKey={(c) => c.key} maxHeight={320}
          empty={`${ym}에 청구예정인 계약이 없습니다.`}
          footerLabel={`합계 ${candView.length}건`}
          select={canWrite ? {
            picked: pick, toggle: (k) => setPick((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; }),
            selectableKeys: candView.map((c) => c.key),
            setAll: (keys) => setPick(new Set(keys ?? [])),
          } : undefined} />
      </div>

      {/* ── 요청 목록 → 발행처리 ── */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 12.5, color: '#1A2B52' }}>
            ② 발행요청 목록 ({live(reqView).length}건{reqView.length !== live(reqView).length && <span style={{ fontWeight: 400, color: '#999' }}> (+취소 {reqView.length - live(reqView).length})</span>} · <span title="부가세 별도 — 엑셀·ERP의 공급가액과 맞춰 보는 기준. 취소분은 빠집니다">공급가액 {won(sumSupply(reqView))}</span>
            {' · '}<span style={{ fontWeight: 400, color: '#666' }}>합계(VAT포함) {won(sum(reqView))}</span>)
          </b>
          {canWrite && (
            <>
              <button className="btn-sm" onClick={() => setPickReq(new Set(issuable(reqView).map((r) => r.id)))}
                title="보이는 목록에서 아직 '요청' 상태인 건을 모두 고릅니다">
                요청 전체선택 ({issuable(reqView).length})
              </button>
              <button className="btn-sm" onClick={() => setPickReq(new Set())}>선택해제</button>
              <span style={{ fontSize: 12, color: '#555' }}>선택 <b>{pickedReqs.length}</b>건</span>
              <span style={{ fontSize: 11.5, color: '#666' }}>발행일</span>
              <input type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} style={{ fontSize: 12 }} />
              <button className="btn-p" disabled={busy || !pickedReqs.length || !isApprover} onClick={() => void doIssue()}
                title={isApprover ? '' : `발행완료는 ${FINAL_APPROVER}(부재 시 기장팀장·최고관리자)만 처리합니다`}>
                발행완료 처리
              </button>
              <button className="btn-sm" disabled={busy || !pickedReqs.length} onClick={() => void doRevert()}>요청으로 되돌리기</button>
              <button className="btn-sm btn-sm-del" disabled={busy || !pickedReqs.length} onClick={() => void doCancel()}>취소</button>
            </>
          )}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {reqGrid.filterCount > 0 && <button className="btn-sm" onClick={reqGrid.clearFilters}>필터 초기화 ({reqGrid.filterCount})</button>}
            <ColumnSettings cols={reqGrid.ordered} view={reqGrid.view} onMessage={flash} />
          </span>
        </div>
        <Grid grid={reqGrid} rowKey={(r) => r.id} maxHeight={380}
          empty="발행요청이 없습니다. 위에서 청구예정을 골라 등록하세요."
          footerLabel={`합계 ${live(reqView).length}건 (취소 제외)`}
          rowStyle={(r) => ({ opacity: r.status === '취소' ? 0.55 : 1 })}
          select={canWrite ? {
            picked: pickReq, toggle: (k) => setPickReq((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; }),
            selectableKeys: reqView.map((r) => r.id),
            headerKeys: issuable(reqView).map((r) => r.id),
            setAll: (keys) => setPickReq(new Set(keys ?? [])),
          } : undefined} />
      </div>
      {editShare && (
        <StaffShareEditor
          requestId={editShare.id} amount={editShare.supplyAmount}
          ym={editShare.ym} contractId={editShare.contractId} placeId={editShare.placeId}
          company={editShare.companyName}
          current={shares.get(editShare.id) ?? (editShare.staff
            ? editShare.staff.split(',').map((n, i) => ({ staffName: n.trim(), share: i === 0 ? 100 : 0, seq: i + 1 }))
            : [])}
          staffOptions={staffOpts}
          onClose={() => setEditShare(null)}
          onSaved={() => void load()} />
      )}
    </div>
  );
}

/** 전월 대비 표시 — 🆕 신규 / ⚠️ 금액변동(전월 → 당월). */
function DiffBadge({ d, amount }: { d?: { kind: '신규' | '변동'; prevAmount: number }; amount: number }) {
  if (!d) return null;
  const isNew = d.kind === '신규';
  return (
    <span title={isNew ? '전월에는 없던 건입니다' : `전월 ${won(d.prevAmount)} → 이번 달 ${won(amount)}`}
      style={{
        marginLeft: 4, fontSize: 10, fontWeight: 700, padding: '0 4px', borderRadius: 3,
        color: isNew ? '#1E3A8A' : '#92400E',
        background: isNew ? '#DBEAFE' : '#FEF3C7',
        border: '1px solid ' + (isNew ? '#93C5FD' : '#FCD34D'),
      }}>
      {isNew ? '🆕신규' : `⚠️${won(d.prevAmount)}→${won(amount)}`}
    </span>
  );
}
