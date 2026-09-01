// 기장등청구관리 › 세금계산서 발행요청 · 감사팀
//
// taxteam 과 구조가 다르다. 감사 용역은 계약금·중도금·잔금이 **건별로** 생기므로 월 마감이 없다.
// 엑셀 `세금계산서발행요청서.xlsx` 를 그대로 옮긴 **3층 구조**다.
//
//   1층 제안 — 매출계약의 분할회차 중 **청구기한이 지난 것**을 띄우고, 담당 회계사에게 알린다
//   2층 처리 — 회계사가 확인 한 번으로 발행요청(→ 김민섭에게 알림),
//              김민섭이 발행완료(→ 요청한 회계사에게 알림)
//   3층 이력 — 요청·발행완료를 기간으로 조회한다(기본 최근 3개월)
//
// 월 셀렉터는 두지 않는다 — 감사팀은 '이 달 것'이라는 개념이 약하고, 기한이 지난 건은
// 몇 달 전 것이라도 지금 청구한다. 기간은 3층의 조회 조건일 뿐이다.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { listBizEntities, corpDisplayName, type BizEntityFull } from '../../lib/bizRegistryApi';
import { listBizContacts, type BizContact } from '../../lib/bizContactApi';
import { todayYmd } from '../../lib/format';
import { pathLabel } from '../../lib/salesContractTaxonomy';
import {
  listInvoiceRequests, createInvoiceRequests, createManualInvoiceRequest,
  markIssued, cancelRequests, revertToRequested, updateInvoiceRequest,
  ERP_ACCOUNTS,
  type InvoiceRequest,
} from '../../lib/invoiceRequestApi';
import {
  listAuditProposals, notifyProposals, notifyRequested, notifyIssued, dismissProposals,
  AUDIT_TEAM, type AuditProposal,
} from '../../lib/auditInvoiceApi';
import { FINAL_APPROVER } from '../../lib/invoiceMonthApi';
import { Grid, useGrid, type GridCol } from './grid';
import { ColumnSettings } from '../clients/tableKit';
import { VIEW_KEYS } from '../../lib/tableViewApi';

const won = (n: number) => n.toLocaleString('ko-KR');
const dash = <span style={{ color: '#CCC' }}>—</span>;
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
  const canWrite = !readonly && role !== 'per_head_accountant';
  const isApprover = canWrite && (profileName === FINAL_APPROVER || role === 'team_lead' || role === 'superuser');

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
  const [range, setRange] = useState<string>('3m');
  const [year, setYear] = useState('');           // 연도로 좁혀 볼 때
  const [q, setQ] = useState('');

  // 건별 등록 폼
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
      const [r, ct, pr] = await Promise.all([
        listInvoiceRequests(undefined, TEAM),
        contacts.length ? Promise.resolve(contacts) : listBizContacts(),
        listAuditProposals(ents, todayYmd(), soon ? 30 : 0),
      ]);
      setReqs(r); setProps(pr); if (!contacts.length) setContacts(ct);
      setPickP(new Set()); setPickR(new Set());
    } catch (e) { setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, [entities, contacts, soon]);
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
        ? <span style={{ color: '#991B1B', fontWeight: 700 }}>{p.overdueDays}일 지남</span>
        : <span style={{ color: '#888' }}>{-p.overdueDays}일 뒤</span>) },
    { key: 'company', label: '거래처', width: 160, value: (p) => p.companyName, style: { fontWeight: 700, color: '#1A2B52' } },
    { key: 'place', label: '사업장', width: 110, value: (p) => p.placeName },
    { key: 'type', label: '매출유형', width: 120, value: (p) => pathLabel(p.typeLabel) },
    { key: 'round', label: '회차', width: 84, value: (p) => p.label },
    { key: 'code', label: '계약코드', width: 100, value: (p) => p.contractCode, style: { fontFamily: 'monospace', fontSize: 10.5 } },
    { key: 'supply', label: '공급가액', width: 108, num: true, value: (p) => p.supplyAmount,
      cell: (p) => won(p.supplyAmount), sum: (p) => p.supplyAmount },
    { key: 'cpa', label: '담당회계사', width: 82, value: (p) => p.cpa, cell: (p) => p.cpa || dash },
    { key: 'staff', label: '담당직원', width: 82, value: (p) => p.staff, cell: (p) => p.staff || dash },
    { key: 'notified', label: '알림', width: 60, value: (p) => (p.notified ? '보냄' : '아직'),
      opts: ['보냄', '아직'],
      cell: (p) => (p.notified
        ? <span style={{ color: '#2a7' }}>✓ 보냄</span>
        : <span style={{ color: '#C99' }}>아직</span>) },
  ];
  const propGrid = useGrid(VIEW_KEYS.auditProposal, propCols, propView, { key: 'due', dir: 'asc' });

  /** 제안을 발행요청으로 — 회계사가 확인 한 번으로 넘기는 자리다. */
  async function requestPicked() {
    const rows = props.filter((p) => pickP.has(p.key));
    if (!rows.length) return;
    const total = rows.reduce((s, p) => s + p.supplyAmount, 0);
    if (!confirm(`${rows.length}건을 발행요청합니다.

${rows.slice(0, 6).map((p) => `· ${p.companyName} ${p.label} ${won(p.supplyAmount)}`).join('\n')}${rows.length > 6 ? '\n · 외 ' + (rows.length - 6) + '건' : ''}

공급가액 합계 ${won(total)} · 작성일 ${issuedDate}
${FINAL_APPROVER}에게 바로 알림이 갑니다. 진행할까요?`)) return;
    setBusy(true);
    try {
      // 귀속월은 '지금 발행하는 달'로 둔다 — ERP 발행내역과 맞춰 보기 위해서다.
      const ym = issuedDate.slice(0, 7);
      await createInvoiceRequests(ym, rows, { team: TEAM, issueDate: issuedDate });
      const sent = await notifyRequested(FINAL_APPROVER, rows, profileName);
      await load();
      flash(`✓ ${rows.length}건 발행요청${sent ? ` · ${FINAL_APPROVER}에게 알림` : ''}`);
    } catch (e) { alert('요청 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
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
    return <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 9, fontSize: 10.5, fontWeight: 700, background: c.bg, color: c.fg, whiteSpace: 'nowrap' }}>{r.status}</span>;
  };
  const reqCols = (withStatus: boolean): GridCol<InvoiceRequest>[] => [
    ...(withStatus ? [{
      key: 'status', label: '상태', width: 74, value: (r: InvoiceRequest) => r.status,
      opts: ['요청', '발행완료', '취소', '수정발행'], cell: statusCell,
    } as GridCol<InvoiceRequest>] : []),
    { key: 'ym', label: '귀속월', width: 74, value: (r) => r.ym },
    { key: 'company', label: '거래처', width: 160, value: (r) => r.companyName, style: { fontWeight: 700, color: '#1A2B52' } },
    { key: 'place', label: '사업장', width: 110, value: (r) => r.placeName },
    { key: 'erp', label: '매출계정', width: 118, value: (r) => r.erpAccount, opts: ERP_ACCOUNTS, cell: (r) => r.erpAccount || dash },
    { key: 'phase', label: '구분', width: 66, value: (r) => r.phase, opts: PHASES, cell: (r) => r.phase || dash },
    { key: 'cpa', label: '담당회계사', width: 82, value: (r) => r.cpa, cell: (r) => r.cpa || dash },
    { key: 'supply', label: '공급가액', width: 108, num: true, value: (r) => r.supplyAmount,
      cell: (r) => won(r.supplyAmount), sum: (r) => (r.status === '취소' ? 0 : r.supplyAmount) },
    { key: 'vat', label: 'VAT', width: 92, num: true, value: (r) => r.vat,
      cell: (r) => won(r.vat), sum: (r) => (r.status === '취소' ? 0 : r.vat), style: { color: '#888' } },
    { key: 'total', label: '합계', width: 108, num: true, value: (r) => r.total,
      cell: (r) => won(r.total), sum: (r) => (r.status === '취소' ? 0 : r.total), style: { fontWeight: 700 } },
    { key: 'summary', label: '발행 시 적요', width: 150, value: (r) => r.summary || r.note },
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
    { key: 'issuedBy', label: '처리자', width: 76, value: (r) => r.issuedByName, cell: (r) => r.issuedByName || dash, style: { color: '#666' } },
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
    const cs = contacts.filter((c) => c.entityId === o.id && c.email.trim());
    set('email', cs.find((c) => c.placeId === hq?.id && c.isPrimary)?.email
      ?? cs.find((c) => c.isPrimary)?.email ?? cs[0]?.email ?? '');
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
    const companyName = o.label.replace(/^\S+\s/, '');
    setBusy(true);
    try {
      await createManualInvoiceRequest({
        ym: f.issueDate.slice(0, 7), team: TEAM, entityId: f.entityId, placeId: f.placeId || null,
        supplyAmount: amt, erpAccount: f.account, phase: f.phase,
        summary: f.summary.trim(), issueDate: f.issueDate, docEmail: f.email.trim(),
        cpa, staff, companyName, placeName: place?.placeName ?? '',
      });
      await notifyRequested(FINAL_APPROVER, [{ companyName, supplyAmount: amt }], profileName);
      setF((p) => ({ ...p, company: '', entityId: '', placeId: '', amount: '', summary: '', email: '' }));
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
        <span style={{ fontSize: 11, fontWeight: 400, color: '#888' }}>
          제안 {overdue.length} · 처리 중 {working.length} · 발행완료 {reqs.filter((r) => r.status === '발행완료').length}
        </span>
        {amCpa && (
          <label style={{ fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}
            title="담당 회계사가 나인 건만 봅니다">
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
            내 담당만
          </label>
        )}
        {msg && <span style={{ marginLeft: 'auto', fontSize: 12, color: '#2a7' }}>{msg}</span>}
      </div>
      {err && <div className="alert-w">{err}</div>}

      <div className="alert-i" style={{ fontSize: 11 }}>
        감사 용역은 계약금·중도금·잔금이 <b>건별로</b> 생기므로 달로 묶지 않습니다. 세 층으로 나뉩니다.
        <br />① <b>제안</b> — 매출계약의 분할회차 중 <b>청구기한이 지난 것</b>을 띄웁니다. 담당 회계사에게 알림이 갑니다.
        <br />② <b>처리 중</b> — 회계사가 <b>확인 한 번으로 발행요청</b>하면 {FINAL_APPROVER}에게 알림이 가고,
        {FINAL_APPROVER}가 ERP에서 발행한 뒤 <b>발행완료</b>를 누르면 요청한 회계사에게 알림이 갑니다.
        <br />③ <b>이력</b> — 지난 요청·발행을 기간으로 조회합니다(기본 최근 3개월).
        <br />계약에 없는 건은 ②의 <b>＋ 건별 등록</b>으로 한 줄 적으면 됩니다.
      </div>

      {/* ══ 1층 — 제안 ══════════════════════════════ */}
      <div style={{ marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 12.5, color: '#1A2B52' }}>
            ① 청구할 때가 된 계약 ({propGrid.rowsView.length}건 · 공급가액 {won(propGrid.rowsView.reduce((s, p) => s + p.supplyAmount, 0))})
          </b>
          <label style={{ fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}
            title="아직 기한이 오지 않았지만 30일 안에 다가오는 것도 함께 봅니다">
            <input type="checkbox" checked={soon} onChange={(e) => setSoon(e.target.checked)} />
            30일 내 다가오는 것도
          </label>
          {canWrite && (
            <>
              <span style={{ fontSize: 11.5, color: '#666' }}>작성일</span>
              <input type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} style={{ fontSize: 12 }} />
              <button className="btn-p" disabled={busy || !pickP.size} onClick={() => void requestPicked()}
                title="고른 건을 발행요청으로 넘깁니다 — 김민섭에게 바로 알림이 갑니다">
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

      {/* ══ 2층 — 처리 중 ═══════════════════════════ */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 12.5, color: '#1A2B52' }}>
            ② 처리 중 ({workGrid.rowsView.length}건 · 공급가액 {won(workGrid.rowsView.reduce((s, r) => s + r.supplyAmount, 0))})
          </b>
          {canWrite && (
            <>
              <button className="btn-sm" onClick={() => setShowForm((v) => !v)}>
                {showForm ? '닫기' : '＋ 건별 등록'}
              </button>
              <button className="btn-sm" onClick={() => setPickR(new Set(workGrid.rowsView.map((r) => r.id)))}>전체선택</button>
              <button className="btn-sm" onClick={() => setPickR(new Set())}>선택해제</button>
              <span style={{ fontSize: 12, color: '#555' }}>선택 <b>{pickedR.length}</b>건</span>
              <span style={{ fontSize: 11.5, color: '#666' }}>발행일</span>
              <input type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} style={{ fontSize: 12 }} />
              <button className="btn-p" disabled={busy || !pickedR.length || !isApprover} onClick={() => void issuePicked()}
                title={isApprover ? '' : `발행완료는 ${FINAL_APPROVER}(부재 시 기장팀장·최고관리자)만 처리합니다`}>
                발행완료 처리
              </button>
              <button className="btn-sm btn-sm-del" disabled={busy || !pickedR.length}
                onClick={() => { if (confirm(`${pickedR.length}건을 취소합니다.`)) void run(() => cancelRequests(pickedR.map((r) => r.id)), '취소했습니다'); }}>
                취소
              </button>
            </>
          )}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {workGrid.filterCount > 0 && <button className="btn-sm" onClick={workGrid.clearFilters}>필터 초기화</button>}
            <ColumnSettings cols={workGrid.ordered} view={workGrid.view} onMessage={flash} />
          </span>
        </div>

        {showForm && canWrite && (
          <div style={{ border: '1px solid #e2d9c6', background: '#fdfaf3', borderRadius: 6, padding: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
              계약에 없는 건, 또는 분할회차를 등록해 두지 않은 건을 한 줄로 적습니다.
              등록하면 {FINAL_APPROVER}에게 바로 알림이 갑니다.
            </div>
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

      {/* ══ 3층 — 이력 ══════════════════════════════ */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 12.5, color: '#1A2B52' }}>
            ③ 발행 이력 ({histGrid.rowsView.length}건)
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
          <span style={{ fontSize: 11.5, color: '#666' }}>
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
