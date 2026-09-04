// 기장등청구관리 › 세금계산서 발행요청 · 감사팀
//
// taxteam 과 구조가 다르다. 감사 용역은 계약금·중도금·잔금이 **건별로** 생기므로 월 마감이 없다.
// 엑셀 `세금계산서발행요청서.xlsx` 를 그대로 옮긴 **3층 구조**다.
//
//   1층 제안 — 매출계약의 분할회차 중 **청구기한이 지난 것**. 이것은 **알림**이지 요청이 아니다.
//             그대로 넘기지 않고 창을 열어 작성일·금액·적요를 고친 뒤 넘긴다.
//   2층 건별 발행요청 — 계약에 없는 건을 회계사가 한 줄 적는다(→ 김민섭에게 알림)
//   3층 처리 중 — 김민섭의 작업공간. 요청된 건을 발행완료로 바꾼다(→ 요청한 회계사에게 알림)
//   4층 이력 — 발행이 끝난 건을 기간으로 조회한다(기본 최근 3개월)
//
// 월 셀렉터는 두지 않는다 — 감사팀은 '이 달 것'이라는 개념이 약하고, 기한이 지난 건은
// 몇 달 전 것이라도 지금 청구한다. 기간은 3층의 조회 조건일 뿐이다.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Guide from '../common/Guide';
import { useAuth } from '../../context/AuthContext';
import { listBizEntities, corpDisplayName, type BizEntityFull } from '../../lib/bizRegistryApi';
import { listBizContacts, type BizContact } from '../../lib/bizContactApi';
import { todayYmd, withJosa } from '../../lib/format';
import { pathLabel } from '../../lib/salesContractTaxonomy';
import {
  listInvoiceRequests, createInvoiceRequests, createManualInvoiceRequest,
  markIssued, cancelRequests, revertToRequested, updateInvoiceRequest,
  ERP_ACCOUNTS, erpAccountOf,
  type InvoiceRequest, type DetailLine,
} from '../../lib/invoiceRequestApi';
import {
  listAuditProposals, notifyProposals, notifyRequested, notifyIssued, notifyCanceled, dismissProposals,
  AUDIT_TEAM, type AuditProposal,
} from '../../lib/auditInvoiceApi';
import { FINAL_APPROVER } from '../../lib/invoiceMonthApi';
import { Grid, useGrid, type GridCol } from './grid';
import { ProposalRequestModal, type ProposalEdit } from './ProposalRequestModal';
import { ColumnSettings } from '../clients/tableKit';
import { CorrectionModal } from './CorrectionModal';
import { WorkflowManual } from './WorkflowManual';
import { TaxEmailPicker, emptyEmailChoice, type EmailChoice } from './TaxEmailPicker';
import { DetailLinesEditor } from './DetailLinesEditor';
import { savePlaceTaxEmails, recordEmailUse, joinEmails, splitEmails } from '../../lib/taxEmailApi';
import { listSalesContracts, type SalesContract } from '../../lib/salesContractApi';
import { VIEW_KEYS } from '../../lib/tableViewApi';

const won = (n: number) => n.toLocaleString('ko-KR');
const dash = <span style={{ color: 'var(--ink-4)' }}>—</span>;
const TEAM = AUDIT_TEAM;
/** 발행체크 시트의 '구분' — 감사 용역은 계약금·중도금·잔금으로 나눠 청구한다. */
const PHASES = ['계약금', '중도금', '잔금', '총액'] as const;

/** 3층 조회 기간 — 다 보여주면 너무 많다. 기본은 최근 3개월. */
const RANGES = [
  { key: '3m', label: '최근 3개월', months: 3 },
  { key: '6m', label: '최근 6개월', months: 6 },
  { key: '12m', label: '최근 1년', months: 12 },
  { key: 'all', label: '전체', months: 0 },
] as const;

const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export default function AuditInvoiceTab() {
  const { readonly, role, profileName } = useAuth();
  // 인당회계사도 담당 회계사로서 자기 건을 요청해야 한다 — **이 화면만** 쓰기를 연다(2026-09-03).
  // 서버도 team='감사team' 으로 좁혀 허용한다(마이그 0122). 발행완료는 여전히 승인자만.
  const canWrite = !readonly;
  const isApprover = canWrite && role !== 'per_head_accountant'
    && (profileName === FINAL_APPROVER || role === 'team_lead' || role === 'superuser');

  const [entities, setEntities] = useState<BizEntityFull[]>([]);
  const [contacts, setContacts] = useState<BizContact[]>([]);
  const [reqs, setReqs] = useState<InvoiceRequest[]>([]);
  const [props, setProps] = useState<AuditProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const [pickP, setPickP] = useState<Set<string>>(new Set());   // 1층 선택
  const [pickR, setPickR] = useState<Set<string>>(new Set());   // 2층 선택
  const [issuedDate, setIssuedDate] = useState(todayYmd);
  const [soon, setSoon] = useState(false);        // 다가오는 것(30일)도 볼까
  const [mineOnly, setMineOnly] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [correct, setCorrect] = useState<{ origin: InvoiceRequest | null } | null>(null);
  /** 제안을 고쳐서 넘기는 창. 제안은 알림이지 요청이 아니므로 한 번 손볼 자리를 둔다. */
  const [proposeOpen, setProposeOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [email, setEmail] = useState<EmailChoice>(emptyEmailChoice);
  const [detail, setDetail] = useState<DetailLine[]>([]);
  const [needsDoc, setNeedsDoc] = useState(false);
  const [contracts, setContracts] = useState<SalesContract[]>([]);
  const [range, setRange] = useState<string>('3m');
  const [year, setYear] = useState('');           // 연도로 좁혀 볼 때
  const [q, setQ] = useState('');

  // 건별 등록 폼
  /**
   * 화면을 셋으로 나눈다 — 네 단계를 한 화면에 쌓으니 무엇을 볼 자리인지 흐려졌다.
   *   요청  = ① 제안 + ② 세금계산서 발행요청  (회계사가 올리는 자리)
   *   발행  = ③ 발행 처리                      (김민섭이 끊는 자리)
   *   이력  = ④ 발행 이력                      (끝난 것을 보는 자리)
   */
  const [pane, setPane] = useState<'request' | 'issue' | 'history'>('request');

  const [f, setF] = useState({
    company: '', entityId: '', placeId: '', amount: '', account: '회계감사수입',
    phase: '잔금' as string, summary: '', issueDate: todayYmd(), email: '',
    /** 어느 매출계약의 건인가. 분할회차가 없는 계약은 여기에 **누적**으로 붙는다. */
    contractId: '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setErr(null);
      const ents = entities.length ? entities : await listBizEntities();
      if (!entities.length) setEntities(ents);
      const [r, ct, pr, cons] = await Promise.all([
        listInvoiceRequests(undefined, TEAM),
        contacts.length ? Promise.resolve(contacts) : listBizContacts(),
        listAuditProposals(ents, todayYmd(), soon ? 30 : 0),
        contracts.length ? Promise.resolve(contracts) : listSalesContracts(),
      ]);
      setReqs(r); setProps(pr); if (!contacts.length) setContacts(ct);
      if (!contracts.length) setContracts(cons);
      setPickP(new Set()); setPickR(new Set());
    } catch (e) { setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, [entities, contacts, contracts, soon]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try { await fn(); await load(); flash(ok); }
    catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const isMine = useCallback((cpa: string) => cpa.trim() === profileName, [profileName]);
  /** 내가 담당 회계사로 잡히는 사람인가 — 제안에 내 이름이 있으면 그렇다. */
  const amCpa = props.some((p) => isMine(p.cpa)) || reqs.some((r) => isMine(r.cpa));

  // ── 1층: 제안 ───────────────────────────────────────
  const propView = useMemo(
    () => (mineOnly ? props.filter((p) => isMine(p.cpa)) : props),
    [props, mineOnly, isMine],
  );
  const propCols: GridCol<AuditProposal>[] = [
    { key: 'due', label: '청구기한', width: 92, value: (p) => p.dueDate,
      cell: (p) => (
        <span style={{ fontWeight: 700, color: p.overdueDays >= 0 ? '#991B1B' : '#666' }}>
          {p.dueDate}
        </span>
      ) },
    { key: 'over', label: '경과', width: 68, num: true, value: (p) => p.overdueDays,
      cell: (p) => (p.overdueDays >= 0
        ? <span style={{ color: 'var(--bad)', fontWeight: 700 }}>{p.overdueDays}일 지남</span>
        : <span style={{ color: 'var(--ink-3)' }}>{-p.overdueDays}일 뒤</span>) },
    { key: 'company', label: '거래처', width: 160, value: (p) => p.companyName, style: { fontWeight: 700, color: 'var(--navy)' } },
    { key: 'place', label: '사업장', width: 110, value: (p) => p.placeName },
    { key: 'type', label: '매출유형', width: 120, value: (p) => pathLabel(p.typeLabel) },
    { key: 'round', label: '회차', width: 84, value: (p) => p.label },
    { key: 'code', label: '계약코드', width: 100, value: (p) => p.contractCode, style: { fontFamily: 'monospace', fontSize: 'var(--fs-0)' } },
    { key: 'supply', label: '공급가액', width: 108, num: true, value: (p) => p.supplyAmount,
      cell: (p) => won(p.supplyAmount), sum: (p) => p.supplyAmount },
    { key: 'cpa', label: '담당회계사', width: 82, value: (p) => p.cpa, cell: (p) => p.cpa || dash },
    { key: 'staff', label: '담당직원', width: 82, value: (p) => p.staff, cell: (p) => p.staff || dash },
    { key: 'notified', label: '알림', width: 60, value: (p) => (p.notified ? '보냄' : '아직'),
      opts: ['보냄', '아직'],
      cell: (p) => (p.notified
        ? <span style={{ color: 'var(--good)' }}>✓ 보냄</span>
        : <span style={{ color: '#C99' }}>아직</span>) },
  ];
  const propGrid = useGrid(VIEW_KEYS.auditProposal, propCols, propView, { key: 'due', dir: 'asc' });

  /** 제안을 발행요청으로 — 회계사가 확인 한 번으로 넘기는 자리다. */
  /**
   * 고른 제안을 **창에서 고친 값 그대로** 발행요청으로 넘긴다.
   * 제안 자체를 그대로 옮기지 않는 이유 — 기한이 한참 지난 건은 계약에 적힌 날짜가 아니라
   * 지금 발행할 날짜로 나가야 하고, 금액도 그 사이 조정되었을 수 있다.
   */
  async function submitProposals(date: string, edits: Map<string, ProposalEdit>) {
    const rows = props.filter((p) => pickP.has(p.key));
    if (!rows.length) return;
    // 귀속월은 '지금 발행하는 달'로 둔다 — ERP 발행내역과 맞춰 보기 위해서다.
    const ym = date.slice(0, 7);
    const edited = rows.map((r) => {
      const e = edits.get(r.key);
      return e ? {
        ...r, supplyAmount: e.supplyAmount, erpAccount: e.erpAccount as typeof r.erpAccount,
        docEmail: e.docEmail, needsInvoiceDoc: e.needsInvoiceDoc,
      } : r;
    });
    await createInvoiceRequests(ym, edited, { team: TEAM, issueDate: date });
    // 이번에 쓴 이메일을 이력에 남긴다 — 다음 요청에서 후보로 뜨게.
    for (const r of edited) {
      await recordEmailUse(r.companyName, splitEmails(r.docEmail), r.entityId, r.placeId, date);
    }
    const sent = await notifyRequested(FINAL_APPROVER, edited, profileName);
    await load();
    flash(`✓ ${rows.length}건 발행요청${sent ? ` · ${FINAL_APPROVER}에게 알림` : ''}`);
  }

  /** 제안에서 뺀다 — 계약의 그 회차를 '청구했음'으로 닫는다. */
  async function dismissPicked() {
    const rows = props.filter((p) => pickP.has(p.key) && p.installmentId);
    if (!rows.length) return alert('회차가 등록된 건만 뺄 수 있습니다.');
    if (!confirm(`${rows.length}건을 제안에서 뺍니다.

${rows.slice(0, 6).map((p) => `· ${p.companyName} ${p.label} ${won(p.supplyAmount)}`).join('\n')}${rows.length > 6 ? '\n · 외 ' + (rows.length - 6) + '건' : ''}

매출계약의 그 회차를 '청구했음'으로 표시합니다 — 발행요청은 만들지 않습니다.
이미 ERP에서 발행했거나 건별로 등록해 둔 것일 때 씁니다. 진행할까요?`)) return;
    setBusy(true);
    try {
      await dismissProposals(rows.map((p) => p.installmentId!));
      await load();
      flash(`✓ ${rows.length}건을 제안에서 뺐습니다`);
    } catch (e) { alert('실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }

  /** 기한이 지난 회차를 담당 회계사에게 알린다. 이미 알린 회차는 다시 보내지 않는다. */
  async function alertCpas() {
    const fresh = props.filter((p) => !p.notified && p.cpa.trim());
    if (!fresh.length) return alert('아직 알리지 않은 제안이 없습니다.');
    const people = [...new Set(fresh.map((p) => p.cpa))];
    if (!confirm(`청구기한이 지난 ${fresh.length}건을 담당 회계사에게 알립니다.
(${people.join('·')})

같은 회차로 두 번 알리지는 않습니다. 진행할까요?`)) return;
    setBusy(true);
    try {
      const { sent, people: got } = await notifyProposals(fresh);
      await load();
      flash(sent ? `✓ ${got.join('·')} 에게 알림을 보냈습니다` : '보낼 대상을 찾지 못했습니다');
    } catch (e) { alert('알림 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }

  // ── 2층: 처리 중 ─────────────────────────────────────
  const working = useMemo(
    () => reqs.filter((r) => r.status === '요청' || r.status === '수정발행'),
    [reqs],
  );
  const workView = useMemo(
    () => (mineOnly ? working.filter((r) => isMine(r.cpa)) : working),
    [working, mineOnly, isMine],
  );
  const pickedR = reqs.filter((r) => pickR.has(r.id));

  /**
   * 발행요청을 물린다. **사유를 받아 요청자에게 알린다** —
   * 요청자는 그 사유를 보고 고쳐서 다시 내야 하는데, 말해 주지 않으면 알 길이 없다.
   */
  async function cancelPicked() {
    const rows = pickedR.filter((r) => r.status !== '취소');
    if (!rows.length) return alert('취소할 건을 골라 주세요.');
    const reason = prompt(`${rows.length}건을 취소합니다.\n\n`
      + `${rows.slice(0, 5).map((r) => `· ${r.companyName} ${won(r.supplyAmount)}`).join('\n')}`
      + `${rows.length > 5 ? `\n · 외 ${rows.length - 5}건` : ''}\n\n`
      + '취소 사유를 적어 주세요 — 요청자에게 그대로 전달됩니다.', '');
    if (reason === null) return;
    if (!reason.trim()) return alert('사유 없이는 취소할 수 없습니다.');
    setBusy(true);
    try {
      await cancelRequests(rows.map((r) => r.id), reason);
      const sent = await notifyCanceled(rows, reason, profileName);
      await load();
      flash(`✓ ${rows.length}건 취소${sent ? ' · 요청자에게 알림' : ''}`);
    } catch (e) { alert('취소 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }

  /** 취소된 건을 고쳐서 다시 낸다 — 값이 채워진 채로 건별 등록 폼이 열린다. */
  function reRequest(r: InvoiceRequest) {
    const o = options.find((x) => x.id === r.entityId);
    setShowForm(true);
    setF({
      company: o?.label ?? r.companyName, entityId: r.entityId, placeId: r.placeId ?? '',
      amount: String(Math.round(r.supplyAmount)), account: r.erpAccount || '회계감사수입',
      phase: r.phase || '잔금', summary: r.summary || r.note || '', issueDate: todayYmd(), email: '',
      // 계약 연결을 그대로 물려준다 — 취소한 건을 다시 낼 때 연결이 끊기면
      // '청구했는데 계약엔 안 붙은' 건이 또 생긴다(감사팀 착수금 3건이 그랬다).
      contractId: r.contractId ?? '',
    });
    setDetail(r.detailLines ?? []);
    setNeedsDoc(r.needsInvoiceDoc);
    setEmail({ ...emptyEmailChoice, emails: splitEmails(r.docEmail) });
    setTimeout(() => document.getElementById('audit-newform')?.scrollIntoView({ block: 'center' }), 80);
  }

  async function issuePicked() {
    const rows = pickedR.filter((r) => r.status === '요청' || r.status === '수정발행');
    if (!rows.length) return alert('‘요청’ 상태 건을 골라 주세요.');
    if (!confirm(`${rows.length}건을 발행완료(${issuedDate})로 처리합니다.
요청한 담당 회계사에게 알림이 갑니다. 진행할까요?`)) return;
    setBusy(true);
    try {
      await markIssued(rows.map((r) => r.id), null, issuedDate);
      const sent = await notifyIssued(rows);
      await load();
      flash(`✓ ${rows.length}건 발행완료${sent ? ' · 담당 회계사에게 알림' : ''}`);
    } catch (e) { alert('처리 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }

  // ── 3층: 이력 ───────────────────────────────────────
  const history = useMemo(() => {
    let l = reqs;
    if (year) l = l.filter((r) => r.ym.startsWith(year));
    else {
      const m = RANGES.find((x) => x.key === range)?.months ?? 3;
      if (m > 0) {
        const from = shiftMonth(todayYmd().slice(0, 7), -(m - 1));
        l = l.filter((r) => r.ym >= from);
      }
    }
    if (mineOnly) l = l.filter((r) => isMine(r.cpa));
    if (q.trim()) {
      const k = q.trim().toLowerCase();
      l = l.filter((r) => (r.companyName + r.summary + r.erpAccount + r.phase + r.invoiceNo + r.cpa).toLowerCase().includes(k));
    }
    return l;
  }, [reqs, range, year, mineOnly, isMine, q]);

  const yearOpts = useMemo(
    () => [...new Set(reqs.map((r) => r.ym.slice(0, 4)))].sort().reverse(),
    [reqs],
  );

  const statusCell = (r: InvoiceRequest) => {
    const c = r.status === '발행완료' ? { bg: '#D1FAE5', fg: '#065F46' }
      : r.status === '취소' ? { bg: '#F3F4F6', fg: '#6B7280' }
        : r.status === '수정발행' ? { bg: '#FEE2E2', fg: '#991B1B' } : { bg: '#DBEAFE', fg: '#1E3A8A' };
    return <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 9, fontSize: 'var(--fs-0)', fontWeight: 700, background: c.bg, color: c.fg, whiteSpace: 'nowrap' }}>{r.status}</span>;
  };
  const reqCols = (withStatus: boolean): GridCol<InvoiceRequest>[] => [
    ...(withStatus ? [{
      key: 'status', label: '상태', width: 74, value: (r: InvoiceRequest) => r.status,
      opts: ['요청', '발행완료', '취소', '수정발행'], cell: statusCell,
    } as GridCol<InvoiceRequest>] : []),
    { key: 'ym', label: '귀속월', width: 74, value: (r) => r.ym },
    { key: 'company', label: '거래처', width: 160, value: (r) => r.companyName, style: { fontWeight: 700, color: 'var(--navy)' } },
    { key: 'place', label: '사업장', width: 110, value: (r) => r.placeName },
    { key: 'erp', label: '매출계정', width: 118, value: (r) => r.erpAccount, opts: ERP_ACCOUNTS, cell: (r) => r.erpAccount || dash },
    { key: 'phase', label: '구분', width: 66, value: (r) => r.phase, opts: PHASES, cell: (r) => r.phase || dash },
    { key: 'cpa', label: '담당회계사', width: 82, value: (r) => r.cpa, cell: (r) => r.cpa || dash },
    { key: 'supply', label: '공급가액', width: 108, num: true, value: (r) => r.supplyAmount,
      cell: (r) => won(r.supplyAmount), sum: (r) => (r.status === '취소' ? 0 : r.supplyAmount) },
    { key: 'vat', label: 'VAT', width: 92, num: true, value: (r) => r.vat,
      cell: (r) => won(r.vat), sum: (r) => (r.status === '취소' ? 0 : r.vat), style: { color: 'var(--ink-3)' } },
    { key: 'total', label: '합계', width: 108, num: true, value: (r) => r.total,
      cell: (r) => won(r.total), sum: (r) => (r.status === '취소' ? 0 : r.total), style: { fontWeight: 700 } },
    { key: 'summary', label: '발행 시 적요', width: 150, value: (r) => r.summary || r.note,
      cell: (r) => (
        <>
          {r.summary || r.note}
          {r.detailLines.length > 0 && (
            <span title={r.detailLines.map((d) => `${d.kind} ${d.desc} ${won(d.amount)}`).join('\n')}
              style={{ marginLeft: 4, fontSize: 9.5, fontWeight: 700, color: '#5B21B6', background: '#EDE9FE', border: '1px solid #C4B5FD', padding: '0 4px', borderRadius: 3 }}>
              세부 {r.detailLines.length}
            </span>
          )}
        </>
      ) },
    { key: 'doc', label: '청구서', width: 60, value: (r) => (r.needsInvoiceDoc ? '필요' : ''),
      opts: ['필요'],
      cell: (r) => (r.needsInvoiceDoc
        ? <span style={{ fontSize: 'var(--fs-0)', fontWeight: 700, color: 'var(--warn)', background: '#FEF3C7', border: '1px solid #FCD34D', padding: '0 4px', borderRadius: 3 }}>필요</span>
        : dash) },
    { key: 'email', label: '발송 e-mail', width: 170, value: (r) => r.docEmail, cell: (r) => r.docEmail || dash,
      style: { fontSize: 'var(--fs-0)', color: 'var(--ink-2)' } },
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
    { key: 'issuedDate', label: '발행일', width: 88, value: (r) => r.issuedDate ?? '', cell: (r) => r.issuedDate ?? dash },
    { key: 'issuedBy', label: '처리자', width: 76, value: (r) => r.issuedByName, cell: (r) => r.issuedByName || dash, style: { color: 'var(--ink-2)' } },
    ...(withStatus ? [{
      key: 'cancel', label: '취소 사유 · 다시요청', width: 200,
      value: (r: InvoiceRequest) => r.cancelReason,
      cell: (r: InvoiceRequest) => (r.status === '취소' ? (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 'var(--fs-0)', color: 'var(--bad)', flex: 1 }} title={r.cancelReason}>
            {r.cancelReason || '(사유 없음)'}
          </span>
          {canWrite && (
            <button className="btn-sm btn-sm-blue" onClick={() => reRequest(r)}
              title="이 건을 고쳐서 다시 요청합니다 — 건별 발행요청 폼에 값이 채워집니다">다시 요청</button>
          )}
        </span>
      ) : dash),
    } as GridCol<InvoiceRequest>] : []),
  ];
  const workGrid = useGrid(VIEW_KEYS.auditInvoiceRequest, reqCols(false), workView, { key: 'ym', dir: 'desc' });
  const histGrid = useGrid(VIEW_KEYS.auditHistory, reqCols(true), history, { key: 'ym', dir: 'desc' });

  // ── 건별 등록 ───────────────────────────────────────
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
    setEmail(emptyEmailChoice);   // 거래처가 바뀌면 이메일도 다시 고른다
    // 적요는 그 거래처의 매출계약에서 추천한다 — 무슨 계약 건인지 적히게.
    const cs = contracts.filter((c) => c.entityId === o.id && c.team === TEAM);
    // 계약이 하나뿐이면 그것으로 정한다 — 고르는 수고를 없애고, 무엇보다 **빠뜨리지 않게**.
    set('contractId', cs.length === 1 ? cs[0].id : '');
    if (cs.length && !f.summary.trim()) {
      const c = cs[0];
      set('summary', `${new Date().getFullYear()}년 ${pathLabel(c.categoryCode)}`.trim());
      set('account', erpAccountOf(c.categoryCode));
    }
  }

  /** 고를 수 있는 매출계약 — 그 거래처의 감사팀 계약. */
  const pickable = useMemo(
    () => contracts.filter((c) => c.entityId === f.entityId && c.team === TEAM),
    [contracts, f.entityId]);

  /**
   * 고른 계약의 **누적청구**. 분할회차를 등록하지 않는 계약(회계사가 회차 정보를 주지
   * 않는 경우)은 회차로 추적할 수 없어, 계약에 붙은 발행요청을 **더해서** 본다
   * (사용자 확정 2026-09-03). 취소된 것은 세지 않는다.
   */
  const cum = useMemo(() => {
    const c = pickable.find((x) => x.id === f.contractId);
    if (!c) return null;
    const billed = reqs
      .filter((r) => r.contractId === c.id && r.status !== '취소')
      .reduce((t, r) => t + r.supplyAmount, 0);
    const now = Number(f.amount.replace(/[^\d-]/g, '')) || 0;
    return { amount: c.amount, billed, rest: c.amount - billed, after: c.amount - billed - now,
             hasInstallments: c.installments.length > 0, code: c.contractCode };
  }, [pickable, f.contractId, f.amount, reqs]);

  /** 그 거래처의 감사팀 매출계약 — 적요 추천 단추로 쓴다. */
  const suggestions = useMemo(() => {
    if (!f.entityId) return [] as { label: string; summary: string; account: string }[];
    return contracts
      .filter((c) => c.entityId === f.entityId && c.team === TEAM)
      .flatMap((c) => {
        const base = pathLabel(c.categoryCode);
        const rounds = c.installments.length
          ? c.installments.map((it) => it.label || `${it.seq}회차`)
          : ['총액'];
        return rounds.map((r) => ({
          label: `${c.contractCode} · ${base} ${r}`,
          summary: `${(c.fiscalYear ?? new Date().getFullYear())}년 ${base} ${r}`.trim(),
          account: erpAccountOf(c.categoryCode),
        }));
      })
      .slice(0, 8);
  }, [contracts, f.entityId]);

  async function add() {
    const amt = Number(f.amount.replace(/[^\d-]/g, ''));
    if (!f.entityId) return alert('거래처를 목록에서 골라 주세요.');
    if (!amt) return alert('공급가액을 입력해 주세요.');
    if (!f.summary.trim()) return alert('발행 시 적요를 적어 주세요 — 무슨 계약 건인지 알 수 있게. (예: 2026년 회계감사 착수금)');
    if (!email.emails.length) return alert('전자세금계산서 발송 e-mail 을 한 곳 이상 골라 주세요. 세금계산서가 어디로 갈지 정해야 합니다.');
    if (detail.length) {
      const sum = detail.reduce((t, x) => t + (Number(x.amount) || 0), 0);
      if (Math.round(sum) !== Math.round(amt)) return alert(`세부내역 합계(${won(sum)})와 공급가액(${won(amt)})이 다릅니다.`);
      if (detail.some((x) => !x.desc.trim())) return alert('세부내역의 내용을 적어 주세요.');
    }
    const o = options.find((x) => x.id === f.entityId)!;
    const place = o.places.find((p) => p.id === f.placeId);
    // 청구 시점의 담당을 함께 굳힌다 — 나중에 담당이 바뀌어도 이 기록은 그대로여야 한다.
    const cpa = place?.cpa ?? '';
    const staff = (place?.staff ?? []).map((x) => x.staffName).join(',');
    const companyName = o.label.replace(/^\S+\s/, '');
    setBusy(true);
    try {
      const picked = pickable.find((x) => x.id === f.contractId);
      await createManualInvoiceRequest({
        ym: f.issueDate.slice(0, 7), team: TEAM, entityId: f.entityId, placeId: f.placeId || null,
        contractId: picked?.id ?? null, contractCode: picked?.contractCode ?? '',
        supplyAmount: amt, erpAccount: f.account, phase: f.phase,
        summary: f.summary.trim(), issueDate: f.issueDate,
        docEmail: joinEmails(email.emails),
        detailLines: detail.length ? detail : undefined,
        needsInvoiceDoc: needsDoc,
        cpa, staff, companyName, placeName: place?.placeName ?? '',
      });
      // 고른 이메일을 이력에 남기고, 원하면 거래처정보에도 반영한다.
      await recordEmailUse(companyName, email.emails, f.entityId, f.placeId || null, f.issueDate);
      if (email.saveToPlace && f.placeId) await savePlaceTaxEmails(f.placeId, email.emails, email.mode);
      await notifyRequested(FINAL_APPROVER, [{ companyName, supplyAmount: amt }], profileName);
      setF((p) => ({ ...p, company: '', entityId: '', placeId: '', amount: '', summary: '', email: '' }));
      setEmail(emptyEmailChoice); setDetail([]); setNeedsDoc(false);
      await load();
      flash(`✓ 발행요청 등록 — ${FINAL_APPROVER}에게 알림이 갔습니다`);
    } catch (e) { alert('등록 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="card">불러오는 중…</div>;

  const overdue = props.filter((p) => p.overdueDays >= 0);
  const notYetAlerted = props.filter((p) => !p.notified && p.cpa.trim()).length;

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        🧾 세금계산서 발행요청 · 감사팀
        <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>
          제안 {overdue.length} · 처리 중 {working.length} · 발행완료 {reqs.filter((r) => r.status === '발행완료').length}
        </span>
        {amCpa && (
          <label style={{ fontSize: 'var(--fs-1)', display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}
            title="담당 회계사가 나인 건만 봅니다">
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
            내 담당만
          </label>
        )}
        <button className="btn-sm" onClick={() => setManual(true)}
          title="내 자리에서 무엇을 언제 하는지 — 김민섭·담당직원·회계사별로">📖 업무 매뉴얼</button>
        {msg && <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-2)', color: 'var(--good)' }}>{msg}</span>}
      </div>
      {err && <div className="alert-w">{err}</div>}

      {/* 세 자리로 나눈다 — 회계사가 올리고, {FINAL_APPROVER}이 끊고, 끝난 것을 본다. */}
      <div style={{ display: 'flex', gap: 6, margin: '8px 0' }}>
        {([
          ['request', '🧾 발행요청', overdue.length],
          ['issue', '🖨️ 발행 처리', working.length],
          ['history', '📜 발행 이력', reqs.filter((r) => r.status === '발행완료').length],
        ] as const).map(([k, label, n]) => (
          <button key={k} className={pane === k ? 'btn-p' : 'btn-sm'} onClick={() => setPane(k)}>
            {label}{n > 0 && <span style={{ fontWeight: 400, opacity: .8 }}> {n}</span>}
          </button>
        ))}
      </div>

      {pane === 'request' && (
        <Guide id="audit-invoice-request" label="①②가 무엇인지"
          summary={<>감사 용역은 계약금·중도금·잔금이 <b>건별로</b> 생기므로 달로 묶지 않습니다. 이 자리는 <b>회계사가 청구를 올리는 곳</b>입니다.</>}>
          · ① <b>제안</b> — 매출계약의 분할회차 중 <b>청구기한이 지난 것</b>입니다. <b>알림일 뿐</b>이라 그대로 넘어가지 않습니다 —
          {' '}고른 뒤 창에서 <b>작성일·금액·적요를 고쳐</b> 발행요청으로 보냅니다.
          <br />· ② <b>세금계산서 발행요청</b> — 계약에 없거나 분할회차를 등록해 두지 않은 건을 한 줄 적습니다.
          <br />· 올린 건은 <b>🖨️ 발행 처리</b> 로 넘어갑니다.
        </Guide>
      )}
      {pane === 'issue' && (
        <div className="alert-i" style={{ fontSize: 'var(--fs-1)' }}>
          {withJosa(FINAL_APPROVER, '이', '가')} <b>세금계산서를 끊는 자리</b>입니다. 발행요청에서 올라온 건이 여기 모입니다.
          ERP에서 발행한 뒤 <b>발행완료</b>를 누르면 요청한 회계사에게 알림이 갑니다.
        </div>
      )}
      {pane === 'history' && (
        <div className="alert-i" style={{ fontSize: 'var(--fs-1)' }}>
          발행이 끝난 건을 기간으로 조회합니다(기본 최근 3개월). 잘못 나간 건은 여기서 <b>수정발행</b>으로 되돌립니다.
        </div>
      )}

      {/* ══ 요청 탭 — ① 제안 + ② 세금계산서 발행요청 ══ */}
      {pane === 'request' && (<>
      <div style={{ marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 'var(--fs-2)', color: 'var(--navy)' }}>
            ① 청구할 때가 된 계약 — 알림 ({propGrid.rowsView.length}건 · 공급가액 {won(propGrid.rowsView.reduce((s, p) => s + p.supplyAmount, 0))})
          </b>
          <label style={{ fontSize: 'var(--fs-1)', display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}
            title="아직 기한이 오지 않았지만 30일 안에 다가오는 것도 함께 봅니다">
            <input type="checkbox" checked={soon} onChange={(e) => setSoon(e.target.checked)} />
            30일 내 다가오는 것도
          </label>
          {canWrite && (
            <>
              <button className="btn-p" disabled={busy || !pickP.size} onClick={() => setProposeOpen(true)}
                title="고른 건을 창에서 고친 뒤 발행요청으로 넘깁니다 — 작성일·금액·적요를 그 자리에서 바꿉니다">
                ✅ 확인 · 발행요청 ({pickP.size})
              </button>
            </>
          )}
          {canWrite && (
            <button className="btn-sm" disabled={busy || !pickP.size} onClick={() => void dismissPicked()}
              title="예전에 ERP에서 직접 발행했거나 계약과 연결하지 않고 등록한 회차를 제안에서 뺍니다">
              이미 청구함 · 제안에서 빼기 ({pickP.size})
            </button>
          )}
          {isApprover && (
            <button className="btn-sm btn-sm-blue" disabled={busy || !notYetAlerted} onClick={() => void alertCpas()}
              title="아직 알리지 않은 제안을 담당 회계사에게 보냅니다. 같은 회차로 두 번 보내지 않습니다.">
              🔔 담당 회계사에게 알림 ({notYetAlerted})
            </button>
          )}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {propGrid.filterCount > 0 && <button className="btn-sm" onClick={propGrid.clearFilters}>필터 초기화</button>}
            <ColumnSettings cols={propGrid.ordered} view={propGrid.view} onMessage={flash} />
          </span>
        </div>
        <Grid grid={propGrid} rowKey={(p) => p.key} maxHeight={260}
          empty="청구기한이 지난 감사 계약이 없습니다. (분할회차에 청구기한이 적힌 계약만 여기 올라옵니다)"
          footerLabel={`합계 ${propGrid.rowsView.length}건`}
          rowStyle={(p) => (p.overdueDays >= 0 ? {} : { opacity: 0.7 })}
          select={canWrite ? {
            picked: pickP,
            toggle: (k) => setPickP((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; }),
            selectableKeys: propGrid.rowsView.map((p) => p.key),
            setAll: (keys) => setPickP(new Set(keys ?? [])),
          } : undefined} />
      </div>

      {/* ══ 2층 — 건별 발행요청 ═════════════════════ */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 'var(--fs-2)', color: 'var(--navy)' }}>② 세금계산서 발행요청</b>
          {canWrite && (
            // 이 화면에서 가장 자주 누르는 단추다 — 제목 바로 옆에, 눈에 띄는 색으로 둔다.
            <button onClick={() => setShowForm((v) => !v)}
              style={showForm ? undefined : {
                background: 'var(--gold)', color: '#fff', border: 'none', borderRadius: 5,
                padding: '5px 14px', fontWeight: 700, fontSize: 'var(--fs-2)', cursor: 'pointer',
                boxShadow: '0 1px 3px rgba(0,0,0,.18)',
              }}
              className={showForm ? 'btn-sm' : undefined}>
              {showForm ? '닫기' : '＋ 건별 발행요청'}
            </button>
          )}
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
            계약에 없거나 분할회차를 등록해 두지 않은 건을 한 줄로 적습니다 —
            등록하면 {FINAL_APPROVER}에게 바로 알림이 갑니다.
          </span>
        </div>
        {showForm && canWrite && (
          <div id="audit-newform" style={{ border: '1px solid var(--rule)', background: '#fdfaf3', borderRadius: 6, padding: 10, marginBottom: 10 }}>
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
              {f.entityId && (
                <Field label="매출계약 — 이 건이 어느 계약인지" width={250}>
                  <select value={f.contractId} onChange={(e) => set('contractId', e.target.value)}
                    style={{ width: '100%' }}>
                    <option value="">(계약 없음 — 일회성)</option>
                    {pickable.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.contractCode} · {won(c.amount)}
                      </option>
                    ))}
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
            {cum && (
              <div style={{
                marginTop: 6, fontSize: 'var(--fs-1)', padding: '6px 9px', borderRadius: 4,
                background: cum.after < 0 ? '#FDECEA' : '#F2F6F2',
                color: cum.after < 0 ? '#9B3527' : '#33553F',
              }}>
                <b>{cum.code}</b> 누적청구 — 계약금액 {won(cum.amount)} · 지금까지 {won(cum.billed)} ·
                {' '}남은 금액 <b>{won(cum.rest)}</b>
                {!!f.amount && <> → 이 건({won(Number(f.amount.replace(/[^\d-]/g, '')) || 0)}) 반영 후 <b>{won(cum.after)}</b></>}
                {cum.after < 0 && <> · <b>계약금액을 넘습니다</b> — 금액이나 계약을 다시 보세요.</>}
                {!cum.hasInstallments && (
                  <><br /><span style={{ color: 'var(--ink-2)' }}>
                    이 계약에는 분할회차가 없습니다 — 회차 대신 <b>누적</b>으로 따집니다.
                  </span></>
                )}
              </div>
            )}
            <div style={{ marginTop: 6 }}>
              <Field label="발행 시 적요 — 무슨 계약 건인지 적습니다" width={640}>
                <input value={f.summary} onChange={(e) => set('summary', e.target.value)}
                  placeholder="예: 2026년 회계감사 착수금 / 2026년 BW평가용역 반기" style={{ width: '100%' }} />
              </Field>
              {suggestions.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4, alignItems: 'center' }}>
                  <span style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)' }}>매출계약에서 추천 —</span>
                  {suggestions.map((g, i) => (
                    <button key={i} className="btn-sm" title={g.label}
                      onClick={() => { set('summary', g.summary); set('account', g.account); }}>
                      {g.summary}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ marginTop: 8 }}>
              <DetailLinesEditor lines={detail} baseKind={f.account.replace('수입', '')}
                onChange={(l) => {
                  setDetail(l);
                  // 세부내역을 쓰면 공급가액은 그 합계가 정본이다.
                  if (l.length) set('amount', String(l.reduce((t, x) => t + (Number(x.amount) || 0), 0)));
                }} />
            </div>

            <div style={{ marginTop: 8 }}>
              <TaxEmailPicker entityId={f.entityId || null} placeId={f.placeId || null}
                clientName={(chosen?.label ?? '').replace(/^\S+\s/, '')}
                value={email} onChange={setEmail} />
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
              <label style={{ fontSize: 'var(--fs-1)', display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={needsDoc} onChange={(e) => setNeedsDoc(e.target.checked)} />
                <b>청구서(서면)도 보내야 함</b> — 목록에 표시되어 빠뜨리지 않습니다.
              </label>
              <button className="btn-p" style={{ marginLeft: 'auto' }} disabled={busy}
                onClick={() => void add()}>＋ 발행요청 등록</button>
              {f.amount && <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)' }}>
                합계 {won(Math.round(Number(f.amount.replace(/[^\d-]/g, '') || 0) * 1.1))}
              </span>}
            </div>
          </div>
        )}

      </div>

      </>)}

      {/* ══ 발행 탭 — ③ 발행 처리 ═══════════════════ */}
      {pane === 'issue' && (
      <div style={{ marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 'var(--fs-2)', color: 'var(--navy)' }}>
            ③ 발행 처리 — {withJosa(FINAL_APPROVER, '이', '가')} 끊을 건 ({workGrid.rowsView.length}건 · 공급가액 {won(workGrid.rowsView.reduce((s, r) => s + r.supplyAmount, 0))})
          </b>
          {canWrite && (
            <>
              <button className="btn-sm" onClick={() => setPickR(new Set(workGrid.rowsView.map((r) => r.id)))}>전체선택</button>
              <button className="btn-sm" onClick={() => setPickR(new Set())}>선택해제</button>
              <span style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)' }}>선택 <b>{pickedR.length}</b>건</span>
              <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)' }}>발행일</span>
              <input type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} style={{ fontSize: 'var(--fs-2)' }} />
              <button className="btn-p" disabled={busy || !pickedR.length || !isApprover} onClick={() => void issuePicked()}
                title={isApprover ? '' : `발행완료는 ${FINAL_APPROVER}(부재 시 기장팀장·최고관리자)만 처리합니다`}>
                발행완료 처리
              </button>
              <button className="btn-sm btn-sm-del" disabled={busy || !pickedR.length}
                onClick={() => void cancelPicked()}
                title="취소 사유를 남기고, 요청한 회계사에게 알립니다">
                취소
              </button>
              <button className="btn-sm" disabled={busy}
                title="이미 발행한 세금계산서를 되돌립니다. 한 건을 고르면 그 건을, 고르지 않으면 거래처를 직접 골라 등록합니다."
                onClick={() => setCorrect({ origin: pickedR.length === 1 ? pickedR[0] : null })}>
                ➖ 수정발행 (−/+)
              </button>
            </>
          )}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {workGrid.filterCount > 0 && <button className="btn-sm" onClick={workGrid.clearFilters}>필터 초기화</button>}
            <ColumnSettings cols={workGrid.ordered} view={workGrid.view} onMessage={flash} />
          </span>
        </div>

        <Grid grid={workGrid} rowKey={(r) => r.id} maxHeight={300}
          empty="발행을 기다리는 건이 없습니다."
          footerLabel={`합계 ${workGrid.rowsView.length}건`}
          select={canWrite ? {
            picked: pickR,
            toggle: (k) => setPickR((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; }),
            selectableKeys: workGrid.rowsView.map((r) => r.id),
            setAll: (keys) => setPickR(new Set(keys ?? [])),
          } : undefined} />
      </div>

      )}

      {/* ══ 이력 탭 — ④ 발행 이력 ═══════════════════ */}
      {pane === 'history' && (
      <div style={{ marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 'var(--fs-2)', color: 'var(--navy)' }}>
            ④ 발행 이력 ({histGrid.rowsView.length}건)
          </b>
          <select value={year ? '' : range} onChange={(e) => { setRange(e.target.value); setYear(''); }}
            disabled={!!year} style={{ fontWeight: 700 }}>
            {RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">연도 지정 안 함</option>
            {yearOpts.map((y) => <option key={y} value={y}>{y}년</option>)}
          </select>
          <input placeholder="🔍 거래처·적요·계정·승인번호·회계사" value={q} onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: 220, flex: '0 1 300px' }} />
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)' }}>
            공급가액 {won(histGrid.rowsView.filter((r) => r.status !== '취소').reduce((s, r) => s + r.supplyAmount, 0))}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {histGrid.filterCount > 0 && <button className="btn-sm" onClick={histGrid.clearFilters}>필터 초기화</button>}
            <ColumnSettings cols={histGrid.ordered} view={histGrid.view} onMessage={flash} />
          </span>
        </div>
        <Grid grid={histGrid} rowKey={(r) => r.id} maxHeight={420}
          empty="이 기간에 감사팀 발행요청이 없습니다. 기간을 넓혀 보세요."
          footerLabel={`합계 ${histGrid.rowsView.filter((r) => r.status !== '취소').length}건 (취소 제외)`}
          rowStyle={(r) => ({ opacity: r.status === '취소' ? 0.55 : 1 })}
          select={isApprover ? {
            picked: pickR,
            toggle: (k) => setPickR((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; }),
            selectableKeys: histGrid.rowsView.filter((r) => r.status === '발행완료').map((r) => r.id),
            headerKeys: [],
            setAll: (keys) => setPickR(new Set(keys ?? [])),
          } : undefined} />
        {isApprover && pickedR.some((r) => r.status === '발행완료') && (
          <div style={{ marginTop: 6 }}>
            <button className="btn-sm" disabled={busy}
              onClick={() => void run(() => revertToRequested(pickedR.filter((r) => r.status === '발행완료').map((r) => r.id)), '되돌렸습니다')}>
              선택한 발행완료 건을 요청으로 되돌리기 ({pickedR.filter((r) => r.status === '발행완료').length})
            </button>
          </div>
        )}
      </div>
      )}

      {manual && (
        <WorkflowManual initial={isApprover ? 'approver' : 'cpa'} onClose={() => setManual(false)} />
      )}
      {proposeOpen && (
        <ProposalRequestModal
          rows={props.filter((x) => pickP.has(x.key))}
          approver={FINAL_APPROVER}
          issueDate={issuedDate}
          onClose={() => setProposeOpen(false)}
          onSubmit={submitProposals} />
      )}
      {correct && (
        <CorrectionModal team={TEAM} origin={correct.origin} entities={entities}
          onClose={() => setCorrect(null)}
          onSaved={(m) => { flash(m); void load(); }} />
      )}
    </div>
  );
}

function Field({ label, width, children }: { label: string; width: number; children: React.ReactNode }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, width }}>
      <span style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)' }}>{label}</span>
      {children}
    </span>
  );
}
