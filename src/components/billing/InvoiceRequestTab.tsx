// 기장등청구관리 › 세금계산서 발행요청 (taxteam)
//
// 업무 순서가 화면 순서다.
//   ① 김민섭이 [당월 전개] → **전월 세금계산서가 그대로 복사**되어 청구예정 초안이 된다 + 3인에게 알림
//   ② 담당자가 각자 맡은 곳을 고치고 지우고 더한다. [매출계약 대사]로 계약과 맞춰 본다(참고자료)
//   ③ 김민섭이 확인하고 초안을 발행요청으로 등록한다 — 초안은 그때 사라진다
//   ④ ERP 발행내역 대사 → ⑤ 발행완료 처리
//
// 매출계약을 그때그때 전개하던 것이 예전 방식이다. 계약은 이제 **대사용 참고자료**다 —
// 실무는 전월을 복사해 고치는 것이고, 계약이 늘 최신인 것도 아니기 때문이다.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { listBizEntities, CPA_OPTIONS, type BizEntityFull } from '../../lib/bizRegistryApi';
import { todayYmd } from '../../lib/format';
import {
  listInvoiceCandidates, listInvoiceRequests, createInvoiceRequests,
  markIssued, cancelRequests, revertToRequested, updateInvoiceRequest,
  type InvoiceCandidate, type InvoiceRequest,
} from '../../lib/invoiceRequestApi';
import { listInvoiceStaff, type InvoiceStaffShare } from '../../lib/invoiceStaffApi';
import {
  listDrafts, openDrafts, addDrafts, updateDraft, deleteDrafts, clearDrafts,
  candidateFromDraft, draftFromCandidate, reconcileDrafts, listDraftLog, changeSummary,
  type InvoiceDraft, type ReconcileRow, type DraftLog,
} from '../../lib/invoiceDraftApi';
import { Grid, useGrid, type GridCol } from './grid';
import { ColumnSettings } from '../clients/tableKit';
import { CorrectionModal } from './CorrectionModal';
import { WorkflowManual } from './WorkflowManual';
import { VIEW_KEYS } from '../../lib/tableViewApi';
import { StaffShareEditor, shareLabel } from './StaffShareEditor';
import { listInternalStaff } from '../../lib/bizRegistryApi';
import {
  getMonthState, openMonth, resetMonth, notifyCheckers, markMyCheck, clearMyCheck, setFinalConfirm,
  issueDateOf, pastIssueDay, CHECKERS, FINAL_APPROVER, type MonthState,
} from '../../lib/invoiceMonthApi';

const won = (n: number) => n.toLocaleString('ko-KR');
const dash = <span style={{ color: '#CCC' }}>—</span>;
/**
 * 매출계약 대사 창 — 청구예정(초안)과 매출계약 전개분을 맞춰 본다.
 *
 * 계약은 **참고자료**다. 그래서 이 창은 "계약대로 고쳐라"가 아니라
 * "이만큼 다른데 어느 쪽이 맞나"를 보여 주고, 맞다고 판단한 쪽으로 반영하게 한다.
 */
function ReconcileModal({ rows, ym, busy, canWrite, me, isMine, onClose, onAdd, onDelete, onApplyAmount }: {
  rows: ReconcileRow[];
  ym: string;
  busy: boolean;
  canWrite: boolean;
  /** 내 이름(담당직원일 때만). 비어 있으면 '내 담당만'을 내놓지 않는다. */
  me: string;
  isMine: (staff: string) => boolean;
  onClose: () => void;
  onAdd: (cands: InvoiceCandidate[]) => Promise<void>;
  onDelete: (draftIds: string[]) => Promise<void>;
  onApplyAmount: (pairs: [string, number][]) => Promise<void>;
}) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [mineOnly, setMineOnly] = useState(false);
  // 걸러도 원본 번호(i)로 고르므로, 필터를 껐다 켜도 선택이 흐트러지지 않는다.
  const shown = rows.map((r, i) => [r, i] as const).filter(([r]) => !mineOnly || isMine(r.staff));
  const toggle = (i: number) => setSel((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const pickKind = (kind: ReconcileRow['kind']) =>
    setSel(new Set(shown.filter(([r]) => r.kind === kind).map(([, i]) => i)));
  const chosen = [...sel].map((i) => rows[i]).filter(Boolean);
  const addable = chosen.filter((r) => r.kind === '계약에만' && r.cand).map((r) => r.cand!);
  const delible = chosen.filter((r) => r.kind === '초안에만' && r.draftId).map((r) => r.draftId!);
  const amtable = chosen.filter((r) => r.kind === '금액다름' && r.draftId)
    .map((r) => [r.draftId!, r.candAmount] as [string, number]);
  const count = (k: ReconcileRow['kind']) => shown.filter(([r]) => r.kind === k).length;

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 60,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 940, width: '100%' }}>
        <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          🔍 매출계약 대사 · {ym}
          <span style={{ fontSize: 11, fontWeight: 400, color: '#888' }}>
            청구예정 ↔ 매출계약등록{shown.length !== rows.length && ` · ${shown.length}/${rows.length} 보는 중`}
          </span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>

        {rows.length === 0 ? (
          <div className="alert-i" style={{ fontSize: 12 }}>
            ✓ 청구예정과 매출계약이 <b>모두 일치</b>합니다. 고칠 것이 없습니다.
          </div>
        ) : (
          <>
            <div className="alert-i" style={{ fontSize: 11 }}>
              <b>매출계약은 참고자료</b>입니다 — 청구의 기준은 청구예정입니다.
              그러니 계약이 맞을 때만 반영하세요.
              <br />· <b>계약에만</b> ({count('계약에만')}) — 계약엔 있는데 청구예정에 없습니다. 새로 시작한 곳이면 <b>추가</b>합니다.
              <br />· <b>초안에만</b> ({count('초안에만')}) — 청구예정엔 있는데 계약이 없거나 끝났습니다. 해지면 <b>삭제</b>, 계속이면 매출계약을 등록·연장하세요.
              <br />· <b>금액다름</b> ({count('금액다름')}) — 계약금액이 바뀌었습니다. 계약이 맞으면 <b>계약금액으로 맞춤</b>, 이번 달만 다른 것이면 표에서 직접 고치세요.
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
              {me && (
                <label style={{ fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}
                  title="담당직원이 나인 건만 봅니다">
                  <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
                  내 담당만 ({rows.filter((r) => isMine(r.staff)).length})
                </label>
              )}
              <span style={{ fontSize: 11.5, color: '#666' }}>골라서:</span>
              <button className="btn-sm" onClick={() => pickKind('계약에만')}>계약에만 전체</button>
              <button className="btn-sm" onClick={() => pickKind('초안에만')}>초안에만 전체</button>
              <button className="btn-sm" onClick={() => pickKind('금액다름')}>금액다름 전체</button>
              <button className="btn-sm" onClick={() => setSel(new Set())}>선택해제</button>
              <span style={{ fontSize: 12, color: '#555' }}>선택 <b>{chosen.length}</b>건</span>
              {canWrite && (
                <>
                  <button className="btn-p" disabled={busy || !addable.length} onClick={() => void onAdd(addable)}>
                    ＋ 청구예정에 추가 ({addable.length})
                  </button>
                  <button className="btn-p" disabled={busy || !amtable.length} onClick={() => void onApplyAmount(amtable)}>
                    계약금액으로 맞춤 ({amtable.length})
                  </button>
                  <button className="btn-sm btn-sm-del" disabled={busy || !delible.length} onClick={() => void onDelete(delible)}>
                    청구예정에서 삭제 ({delible.length})
                  </button>
                </>
              )}
            </div>
            <div style={{ maxHeight: '52vh', overflow: 'auto' }}>
              <table className="tbl" style={{ fontSize: 11.5 }}>
                <thead>
                  <tr>
                    <th style={{ width: 28 }}></th>
                    <th style={{ width: 84 }}>구분</th><th>거래처</th><th>사업장</th><th>담당직원</th><th>계약코드</th>
                    <th className="r">청구예정</th><th className="r">매출계약</th><th className="r">차이</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(([r, i]) => {
                    const c = r.kind === '계약에만' ? { bg: '#DBEAFE', fg: '#1E3A8A' }
                      : r.kind === '초안에만' ? { bg: '#FEE2E2', fg: '#991B1B' } : { bg: '#FEF3C7', fg: '#92400E' };
                    return (
                      <tr key={i}>
                        <td><input type="checkbox" checked={sel.has(i)} onChange={() => toggle(i)} /></td>
                        <td><span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 9, fontSize: 10.5, fontWeight: 700, background: c.bg, color: c.fg, whiteSpace: 'nowrap' }}>{r.kind}</span></td>
                        <td style={{ fontWeight: 700, color: '#1A2B52' }}>{r.company}</td>
                        <td>{r.place}</td>
                        <td style={{ fontSize: 11, fontWeight: 600, color: '#1A2B52' }}>{r.staff || dash}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 10.5 }}>{r.contractCode}</td>
                        <td className="r">{r.draftAmount ? won(r.draftAmount) : dash}</td>
                        <td className="r">{r.candAmount ? won(r.candAmount) : dash}</td>
                        <td className="r" style={{ fontWeight: 700, color: r.candAmount - r.draftAmount >= 0 ? '#2a7' : '#c33' }}>
                          {r.candAmount - r.draftAmount > 0 ? '+' : ''}{won(r.candAmount - r.draftAmount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 작은 딱지. */
function Tag({ children, bg, fg, bd }: { children: React.ReactNode; bg: string; fg: string; bd: string }) {
  return (
    <span style={{
      marginLeft: 4, fontSize: 10, fontWeight: 700, padding: '0 4px', borderRadius: 3,
      color: fg, background: bg, border: `1px solid ${bd}`, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

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
  const [manual, setManual] = useState(false);
  const [drafts, setDrafts] = useState<InvoiceDraft[]>([]);
  const [recon, setRecon] = useState(false);          // 매출계약 대사 창
  const [correct, setCorrect] = useState<{ origin: InvoiceRequest | null } | null>(null);
  const [logs, setLogs] = useState<DraftLog[]>([]);  // 이번 달 초안 변경 기록
  const [showLog, setShowLog] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);   // 내 담당만 보기
  const [noStaffOnly, setNoStaffOnly] = useState(false);   // 담당 미지정만 보기

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setErr(null);
      const ents = entities.length ? entities : await listBizEntities();
      if (!entities.length) setEntities(ents);
      const [c, d, r, p, mst, lg] = await Promise.all([
        listInvoiceCandidates(ym, ents, 'taxteam'),   // 대사용 참고자료
        listDrafts(ym, 'taxteam'),
        listInvoiceRequests(ym, 'taxteam'),
        listInvoiceRequests(prevMonthOf(ym), 'taxteam'),
        getMonthState(ym),
        listDraftLog(ym, 'taxteam'),
      ]);
      setCands(c); setDrafts(d); setReqs(r); setPrev(p); setMonth(mst); setLogs(lg);
      setShares(await listInvoiceStaff(r.map((x) => x.id)));
      if (!staffOpts.length) setStaffOpts((await listInternalStaff()).map((x) => x.name));
      setPick(new Set()); setPickReq(new Set());
    } catch (e) {
      setErr(e instanceof Error ? e.message : '불러오지 못했습니다.');
    } finally { setLoading(false); }
  }, [ym, entities, staffOpts.length]);
  useEffect(() => { void load(); }, [load]);

  /** 이 사람이 담당인가 — 담당직원은 쉼표로 여럿일 수 있다. */
  const isMine = useCallback(
    (staff: string) => staff.split(',').map((x) => x.trim()).includes(profileName),
    [profileName],
  );
  /** 내가 담당직원 명단에 있는 사람인가(회계사·팀장은 '내 담당' 개념이 없다). */
  const amStaff = staffOpts.includes(profileName);
  const myDrafts = useMemo(() => drafts.filter((d) => isMine(d.staff)), [drafts, isMine]);
  /** 담당직원이 비어 있는 건 — 아무도 보지 않고 지나갈 위험이 있다. */
  const noStaff = useMemo(() => drafts.filter((d) => !d.staff.trim()), [drafts]);

  const draftSearched = useMemo(() => {
    let l = drafts;
    if (mineOnly) l = l.filter((d) => isMine(d.staff));
    if (noStaffOnly) l = l.filter((d) => !d.staff.trim());
    if (!q.trim()) return l;
    const k = q.trim().toLowerCase();
    return l.filter((d) => (d.companyName + d.placeName + d.contractCode + d.cpa + d.staff).toLowerCase().includes(k));
  }, [drafts, q, mineOnly, noStaffOnly, isMine]);
  const reqSearched = useMemo(() => {
    if (!q.trim()) return reqs;
    const k = q.trim().toLowerCase();
    return reqs.filter((r) => (r.companyName + r.placeName + r.contractCode + r.invoiceNo + r.cpa + r.staff).toLowerCase().includes(k));
  }, [reqs, q]);

  const picked = drafts.filter((d) => pick.has(d.id));
  const pickedSupply = picked.reduce((s, d) => s + d.supplyAmount, 0);
  /** 계약 대사 결과 — 초안과 매출계약을 맞춰 본 차이. */
  const reconRows = useMemo(() => reconcileDrafts(drafts, cands), [drafts, cands]);
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
    for (const d of drafts) put(d.contractId, d.companyName, d.placeName, d.supplyAmount);
    for (const r of reqs) if (r.status !== '취소') put(r.contractId, r.companyName, r.placeName, r.supplyAmount);
    // 전월엔 있었는데 이번 달엔 없는 것 = 해지 의심(엑셀의 'X')
    const dropped = [...prevBy.values()].filter((p) => !nowIds.has(p.contractId!));
    for (const d of dropped) rows.push({ kind: '없어짐', company: d.companyName, place: d.placeName, prev: d.supplyAmount, now: 0 });
    rows.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.company.localeCompare(b.company, 'ko'));
    return { mark, dropped, rows };
  }, [prev, drafts, reqs]);

  const checkedNames = new Set((month?.checks ?? []).map((c) => c.name));
  const allChecked = CHECKERS.every((n) => checkedNames.has(n));
  const iChecked = checkedNames.has(profileName);

  /**
   * 당월 전개 — **전월 세금계산서를 그대로 복사**해 청구예정 초안을 만들고 확인 알림을 보낸다.
   * 엑셀에서 전월 열을 복사해 붙이던 그 일이다. 전월이 비어 있으면(첫 달) 매출계약에서 채운다.
   */
  async function doOpenMonth() {
    const pm = prevMonthOf(ym);
    const base = prev.filter((r) => r.status !== '취소').length;
    if (!confirm(`${ym} 을 엽니다.

· ${base ? `전월(${pm}) 세금계산서 ${base}건을 그대로 복사해` : `전월(${pm})이 비어 있어 매출계약 ${cands.length}건으로`} 청구예정을 만듭니다
· ${CHECKERS.join('·')} 에게 확인 요청 알림을 보냅니다

담당자가 청구예정을 고치고 확인하면, 그 뒤에 발행요청으로 등록합니다.

진행할까요?`)) return;
    setBusy(true);
    try {
      await openMonth(ym);
      const { created, from } = await openDrafts(ym, pm, cands, 'taxteam');
      const sent = await notifyCheckers(ym);
      await load();
      flash(`✓ ${ym} 전개 완료 — ${from} ${created}건 · 알림 ${sent}명`);
    } catch (e) { alert('전개 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }
  /** 이 달을 되돌린다 — 잘못 열었거나 시험 삼아 연 달을 치운다. */
  async function doResetMonth() {
    const n = reqs.length;
    const dn = drafts.length;
    const done = reqs.filter((r) => r.status === '발행완료' || r.status === '수정발행').length;
    if (done) {
      alert(`이미 발행완료된 건이 ${done}건 있어 초기화할 수 없습니다.

`
        + `그 건을 먼저 ‘요청으로 되돌리기’ 하거나 취소한 뒤 다시 시도하세요.`);
      return;
    }
    if (!confirm(`${ym} 을 처음 상태로 되돌립니다.

· 청구예정 초안 ${dn}건을 지웁니다
· 발행요청 ${n}건을 지웁니다(실적 배분도 함께)
· 전개 기록과 ${CHECKERS.join('·')} 확인 표시를 지웁니다

지운 것은 되살릴 수 없습니다. 다만 청구예정은 매출계약에서 다시 계산되므로,
‘당월 전개’를 누르면 처음부터 다시 시작할 수 있습니다.

진행할까요?`)) return;
    if ((n > 0 || dn > 0) && !confirm(`정말 ${ym} 청구예정 ${dn}건과 발행요청 ${n}건을 지울까요? 마지막 확인입니다.`)) return;
    setBusy(true);
    try {
      const { deleted } = await resetMonth(ym, 'taxteam');
      await clearDrafts(ym, 'taxteam');
      await load();
      flash(`✓ ${ym} 초기화 — 초안 ${dn}건 · 요청 ${deleted}건 삭제`);
    } catch (e) { alert('초기화 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }
  async function doCheck() {
    setBusy(true);
    try {
      if (iChecked) await clearMyCheck(ym);
      // '확인했다'만으로는 무엇을 손댔는지 알 수 없다 — 이번 달 내 변경을 요약해 함께 남긴다.
      else await markMyCheck(ym, changeSummary(logs, profileName));
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

  /** 초안을 발행요청으로 옮긴다 — 옮긴 초안은 지운다(같은 건이 두 곳에 있으면 안 된다). */
  async function doRequest() {
    if (!picked.length) return;
    // 담당자 확인을 보고 등록하는 것이 3단계다 — 아직 안 본 사람이 있으면 짚어 준다.
    const notYet = CHECKERS.filter((n) => !checkedNames.has(n));
    if (notYet.length && !confirm(`아직 확인하지 않은 담당자가 있습니다.
(${notYet.join('·')})

담당자 확인을 받고 등록하는 것이 원래 순서입니다. 그래도 등록할까요?`)) return;
    const noContract = picked.filter((d) => !d.contractId).length;
    if (!confirm(`${picked.length}건을 ${ym} 발행요청으로 등록합니다(작성일 ${issueDateOf(ym)}).
${noContract ? `
※ 매출계약이 연결되지 않은 건이 ${noContract}건 있습니다 — 등록은 되지만 나중에 계약을 등록해 주세요.
` : ''}
등록한 건은 청구예정에서 사라집니다. 진행할까요?`)) return;
    setBusy(true);
    try {
      const n = await createInvoiceRequests(ym, picked.map(candidateFromDraft),
        { team: 'taxteam', issueDate: issueDateOf(ym) });
      await deleteDrafts(picked.map((d) => d.id));
      await load();
      flash(`✓ ${n}건 발행요청 등록`);
    } catch (e) { alert('등록 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }

  /** 초안 한 줄 고치기 — 금액·담당직원·적요는 담당자가 그 자리에서 바꾼다. */
  async function saveDraft(id: string, patch: Partial<InvoiceDraft>, before?: InvoiceDraft) {
    try { await updateDraft(id, patch, before); await load(); }
    catch (e) { alert('저장 실패: ' + (e instanceof Error ? e.message : e)); }
  }
  async function removeDrafts(ids: string[]) {
    if (!ids.length) return;
    if (!confirm(`청구예정에서 ${ids.length}건을 지웁니다. (계약이나 지난 실적은 그대로입니다)`)) return;
    setBusy(true);
    try { await deleteDrafts(ids, drafts); await load(); flash(`✓ ${ids.length}건 삭제`); }
    catch (e) { alert('삭제 실패: ' + (e instanceof Error ? e.message : e)); }
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
  const draftCols: GridCol<InvoiceDraft>[] = [
    { key: 'company', label: '거래처', width: 150, value: (d) => d.companyName,
      style: { fontWeight: 700, color: '#1A2B52' },
      cell: (d) => (
        <>
          {d.companyName}
          {d.source === '수동추가' && <Tag bg="#EDE9FE" fg="#5B21B6" bd="#C4B5FD">직접</Tag>}
          {!d.contractId && <Tag bg="#FEF3C7" fg="#92400E" bd="#FCD34D">계약없음</Tag>}
          <DiffBadge d={diff.mark.get(d.contractId ?? '')} amount={d.supplyAmount} />
        </>
      ) },
    { key: 'place', label: '사업장', width: 110, value: (d) => d.placeName },
    { key: 'erp', label: '매출계정', width: 118, value: (d) => d.erpAccount, cell: (d) => d.erpAccount || dash, style: { color: '#666' } },
    { key: 'code', label: '계약코드', width: 100, value: (d) => d.contractCode, style: { fontFamily: 'monospace', fontSize: 10.5 } },
    { key: 'round', label: '회차', width: 64, value: (d) => d.label },
    { key: 'supply', label: '공급가액', width: 104, num: true, value: (d) => d.supplyAmount,
      sum: (d) => d.supplyAmount,
      cell: (d) => (canWrite ? (
        <input defaultValue={String(Math.round(d.supplyAmount))} key={`${d.id}:${d.supplyAmount}`}
          onBlur={(e) => {
            const v = Number(e.target.value.replace(/[^\d-]/g, '')) || 0;
            if (v !== Math.round(d.supplyAmount)) void saveDraft(d.id, { supplyAmount: v }, d);
          }}
          style={{ width: '100%', textAlign: 'right', fontSize: 11.5, padding: '1px 3px', boxSizing: 'border-box' }} />
      ) : won(d.supplyAmount)) },
    { key: 'vat', label: '부가세', width: 84, num: true, value: (d) => Math.round(d.supplyAmount * 0.1),
      cell: (d) => won(Math.round(d.supplyAmount * 0.1)), sum: (d) => Math.round(d.supplyAmount * 0.1), style: { color: '#888' } },
    { key: 'total', label: '합계', width: 96, num: true, value: (d) => d.supplyAmount + Math.round(d.supplyAmount * 0.1),
      cell: (d) => won(d.supplyAmount + Math.round(d.supplyAmount * 0.1)),
      sum: (d) => d.supplyAmount + Math.round(d.supplyAmount * 0.1), style: { fontWeight: 700 } },
    { key: 'cpa', label: '담당회계사', width: 80, value: (d) => d.cpa, opts: cpaOpts, cell: (d) => d.cpa || dash },
    { key: 'staff', label: '담당직원', width: 96, value: (d) => d.staff, opts: staffOpts,
      style: { fontWeight: 600, color: '#1A2B52' },
      cell: (d) => (canWrite ? (
        <select value={d.staff} onChange={(e) => void saveDraft(d.id, { staff: e.target.value }, d)}
          style={{ width: '100%', fontSize: 11, padding: '1px 2px', boxSizing: 'border-box' }}>
          <option value="">(미지정)</option>
          {[...new Set([...staffOpts, ...(d.staff ? [d.staff] : [])])].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      ) : (d.staff || dash)) },
    { key: 'summary', label: '적요', width: 130, value: (d) => d.summary,
      cell: (d) => (canWrite ? (
        <input defaultValue={d.summary} key={`${d.id}:s:${d.summary}`}
          onBlur={(e) => { if (e.target.value !== d.summary) void saveDraft(d.id, { summary: e.target.value }, d); }}
          style={{ width: '100%', fontSize: 11, padding: '1px 3px', boxSizing: 'border-box' }} />
      ) : d.summary) },
    { key: 'source', label: '출처', width: 70, value: (d) => d.source, opts: ['전월복사', '계약추가', '수동추가'],
      style: { color: '#888', fontSize: 10.5 } },
    { key: 'del', label: '삭제', width: 48, value: () => '',
      cell: (d) => (canWrite ? (
        <button className="btn-sm btn-sm-del" title="이 건을 청구예정에서 뺍니다"
          onClick={() => void removeDrafts([d.id])}>−</button>
      ) : null) },
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

  const candGrid = useGrid(VIEW_KEYS.invoiceCandidate, draftCols, draftSearched, { key: 'company', dir: 'asc' });
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
          청구예정 {drafts.length} · 요청 {stat.요청.length} · 발행완료 {stat.발행완료.length}
          {stat.취소.length > 0 && ` · 취소 ${stat.취소.length}`}
        </span>
        <button className="btn-sm" onClick={() => setManual(true)}
          title="내 자리에서 무엇을 언제 하는지 — 김민섭·담당직원·회계사별로">📖 업무 매뉴얼</button>
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
                  // 확인해 놓고 그 뒤에 또 고쳤으면 그 확인은 낡은 것이다 — 김민섭이 알아야 한다.
                  const stale = !!c && logs.some((l) => l.actor === n && l.at > c.checkedAt);
                  return (
                    <span key={n} title={c
                      ? `${c.checkedAt.slice(0, 16).replace('T', ' ')}${c.note ? ` · ${c.note}` : ''}${stale ? ' · 확인 뒤에 또 고쳤습니다' : ''}`
                      : '아직 확인 전'}
                      style={{
                        padding: '1px 7px', borderRadius: 9, fontSize: 11, fontWeight: 700,
                        background: stale ? '#FEF3C7' : c ? '#D1FAE5' : '#F3F4F6',
                        color: stale ? '#92400E' : c ? '#065F46' : '#9CA3AF',
                        border: '1px solid ' + (stale ? '#FCD34D' : c ? '#6EE7B7' : '#E5E7EB'),
                      }}>{stale ? '⚠ ' : c ? '✓ ' : '○ '}{n}{c?.note ? ` · ${c.note}` : ''}</span>
                  );
                })}
              </span>
              {isChecker && (
                <>
                  {amStaff && (
                    <span style={{ fontSize: 11.5, color: '#666' }}>
                      내 담당 <b style={{ color: '#1A2B52' }}>{myDrafts.length}</b>건
                      {myDrafts.length > 0 && ` · ${won(myDrafts.reduce((t, d) => t + d.supplyAmount, 0))}`}
                    </span>
                  )}
                  <button className={iChecked ? 'btn-sm' : 'btn-p'} disabled={busy} onClick={() => void doCheck()}
                    title="이번 달 내가 고친 내용이 확인 기록에 함께 남습니다">
                    {iChecked ? '확인 해제' : `✅ 확인했습니다 (${changeSummary(logs, profileName)})`}
                  </button>
                </>
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
        {month?.opened && diff.rows.length > 0 && (
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

      {month?.opened && noStaff.length > 0 && (
        <div className="alert-w" style={{ fontSize: 11.5 }}>
          ⚠️ <b>담당직원이 비어 있는 건이 {noStaff.length}건</b> 있습니다
          ({won(noStaff.reduce((t, d) => t + d.supplyAmount, 0))}) — 아무도 보지 않고 지나갈 수 있습니다.
          <button className="btn-sm" style={{ marginLeft: 6 }}
            onClick={() => { setMineOnly(false); setQ(''); setNoStaffOnly((v) => !v); }}>
            {noStaffOnly ? '전체 보기' : '이 건들만 보기'}
          </button>
          <span style={{ color: '#999' }}>
            {' '}{noStaff.slice(0, 5).map((d) => d.companyName).join(', ')}{noStaff.length > 5 ? ' 외' : ''}
          </span>
        </div>
      )}
      {month?.opened && logs.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <button className="btn-sm" onClick={() => setShowLog((v) => !v)}>
            {showLog ? '▾' : '▸'} 이번 달 변경 이력 ({logs.length}) — {CHECKERS.map((n) => `${n} ${changeSummary(logs, n)}`).join(' / ')}
          </button>
          {showLog && (
            <div style={{ maxHeight: 240, overflow: 'auto', marginTop: 6, border: '1px solid #eee', borderRadius: 6 }}>
              <table className="tbl" style={{ fontSize: 11.5 }}>
                <thead>
                  <tr><th>한 일</th><th>거래처</th><th>항목</th><th>이전</th><th>이후</th><th>사람</th><th>시각</th></tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td style={{ fontWeight: 700, color: l.action === '삭제' ? '#c33' : l.action === '추가' ? '#1E3A8A' : '#92400E' }}>{l.action}</td>
                      <td style={{ fontWeight: 700, color: '#1A2B52' }}>{l.company}</td>
                      <td>{l.field || (l.amount ? won(l.amount) : '')}</td>
                      <td style={{ color: '#888' }}>{l.before || dash}</td>
                      <td style={{ fontWeight: 600 }}>{l.after || dash}</td>
                      <td>{l.actor || dash}</td>
                      <td style={{ color: '#888' }}>{l.at.slice(5, 16).replace('T', ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="alert-i" style={{ fontSize: 11 }}>
<b>업무 순서</b> — ① 김민섭이 <b>당월 전개</b>를 누르면 <b>전월 세금계산서가 그대로 복사</b>되어 청구예정이 됩니다(엑셀에서 전월 열을 복사하던 그 일).
        ② 담당자 3인이 각자 맡은 곳을 고치고 지우고 더한 뒤 <b>확인</b>을 누릅니다 — 이때 <b>🔍 매출계약 대사</b>로 계약과 맞춰 봅니다.
        ③ 김민섭이 확인하고 <b>발행요청 등록</b>을 누르면 그 건은 ①에서 ②로 넘어갑니다.
        ④ ERP 발행내역 대사 → ⑤ <b>발행완료</b> 처리.
        <br />금액·담당직원·적요는 ① 표에서 그 자리에서 고칩니다. <b>매출계약은 참고자료</b>이고, 청구의 기준은 이 청구예정입니다. 체크해서 <b>발행요청</b>으로 등록하고,
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
          <b style={{ fontSize: 12.5, color: '#1A2B52' }}>① {ym} 청구예정 ({candView.length}건 · 공급가액 {won(candView.reduce((s, d) => s + d.supplyAmount, 0))})</b>
          {amStaff && (
            <label style={{ fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}
              title="담당직원이 나인 건만 봅니다">
              <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
              내 담당만 ({myDrafts.length})
            </label>
          )}
          <button className="btn-sm btn-sm-blue" onClick={() => setRecon(true)}
            title="청구예정을 매출계약과 맞춰 봅니다 — 계약에만 있는 것, 초안에만 있는 것, 금액이 다른 것">
            🔍 매출계약 대사{reconRows.length ? ` (${reconRows.length})` : ' ✓'}
          </button>
          {ym > thisMonth() && (
            <span title="아직 오지 않은 달입니다. 계약에서 계산한 예상일 뿐, 등록된 것은 없습니다."
              style={{ fontSize: 10.5, fontWeight: 700, color: '#5B21B6', background: '#EDE9FE', border: '1px solid #C4B5FD', padding: '1px 6px', borderRadius: 9 }}>
              미리보기 — 아직 오지 않은 달
            </span>
          )}
          {canWrite && (
            <>
              <button className="btn-sm" onClick={() => setPick(new Set(candView.map((d) => d.id)))}>보이는 건 전체선택</button>
              <button className="btn-sm" onClick={() => setPick(new Set())}>선택해제</button>
              <span style={{ fontSize: 12, color: '#555' }}>선택 <b>{picked.length}</b>건 · 공급가액 {won(pickedSupply)}</span>
              <button className="btn-sm btn-sm-del" disabled={busy || !picked.length}
                onClick={() => void removeDrafts(picked.map((d) => d.id))}>선택 삭제</button>
              <button className="btn-p" disabled={busy || !picked.length || !isApprover} onClick={() => void doRequest()}
                title={isApprover ? '' : `발행요청 등록은 ${FINAL_APPROVER}(부재 시 기장팀장·최고관리자)가 담당자 확인을 본 뒤 누릅니다`}>
                {busy ? '처리 중…' : '발행요청 등록'}
              </button>
            </>
          )}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {candGrid.filterCount > 0 && <button className="btn-sm" onClick={candGrid.clearFilters}>필터 초기화 ({candGrid.filterCount})</button>}
            <ColumnSettings cols={candGrid.ordered} view={candGrid.view} onMessage={flash} />
          </span>
        </div>
        <Grid grid={candGrid} rowKey={(d) => d.id} maxHeight={340}
          empty={month?.opened ? '청구예정이 비어 있습니다. 🔍 매출계약 대사에서 채울 수 있습니다.'
            : `아직 ${ym}을 열지 않았습니다. 위 [📂 당월 전개]를 누르면 전월 세금계산서가 복사됩니다.`}
          footerLabel={`합계 ${candView.length}건`}
          select={canWrite ? {
            picked: pick, toggle: (k) => setPick((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; }),
            selectableKeys: candView.map((d) => d.id),
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
              <button className="btn-sm" disabled={busy}
                title="이미 발행한 세금계산서를 되돌립니다. 한 건을 고르면 그 건을, 고르지 않으면 거래처를 직접 골라 등록합니다."
                onClick={() => setCorrect({ origin: pickedReqs.length === 1 ? pickedReqs[0] : null })}>
                ➖ 수정발행 (−/+)
              </button>
            </>
          )}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {reqGrid.filterCount > 0 && <button className="btn-sm" onClick={reqGrid.clearFilters}>필터 초기화 ({reqGrid.filterCount})</button>}
            <ColumnSettings cols={reqGrid.ordered} view={reqGrid.view} onMessage={flash} />
          </span>
        </div>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
          다음 단계 — 여기 등록된 대로 ERP에서 발행한 뒤, <b>ERP 발행내역 대사</b> 메뉴에서 거래전표와 맞춰 봅니다.
          맞으면 이 목록에서 <b>발행완료 처리</b>를 누릅니다(승인번호·발행일이 남습니다).
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
      {recon && (
        <ReconcileModal rows={reconRows} ym={ym} busy={busy}
          canWrite={canWrite} me={amStaff ? profileName : ''} isMine={isMine}
          onClose={() => setRecon(false)}
          onAdd={async (cs) => {
            setBusy(true);
            try { await addDrafts(ym, cs.map((c) => draftFromCandidate(c)), 'taxteam'); await load(); flash(`✓ ${cs.length}건 추가`); }
            catch (e) { alert('추가 실패: ' + (e instanceof Error ? e.message : e)); }
            finally { setBusy(false); }
          }}
          onDelete={async (ids) => {
            setBusy(true);
            try { await deleteDrafts(ids); await load(); flash(`✓ ${ids.length}건 삭제`); }
            catch (e) { alert('삭제 실패: ' + (e instanceof Error ? e.message : e)); }
            finally { setBusy(false); }
          }}
          onApplyAmount={async (pairs) => {
            setBusy(true);
            try {
              for (const [id, amt] of pairs) await updateDraft(id, { supplyAmount: amt });
              await load(); flash(`✓ ${pairs.length}건 금액을 계약에 맞췄습니다`);
            } catch (e) { alert('반영 실패: ' + (e instanceof Error ? e.message : e)); }
            finally { setBusy(false); }
          }} />
      )}
      {manual && (
        <WorkflowManual initial={isApprover ? 'approver' : 'staff'} onClose={() => setManual(false)} />
      )}
      {correct && (
        <CorrectionModal team="taxteam" origin={correct.origin} entities={entities}
          onClose={() => setCorrect(null)}
          onSaved={(m) => { flash(m); void load(); }} />
      )}
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
