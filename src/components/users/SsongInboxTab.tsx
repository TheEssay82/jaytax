// 쏭비서 결재함 — 쏭비서가 올린 매출계약 등록·문서발송 의뢰를 승인·반려한다(0200).
//
// 쏭비서는 바로 쓰지 못한다. 여기서 [승인]을 눌러야 앱의 기존 등록 코드가 실제 행을 만든다.
// 최고관리자에게만 내놓는다(⚙ 관리).
import { useEffect, useMemo, useState } from 'react';
import Guide from '../common/Guide';
import { kstDateTime } from '../../lib/format';
import { pathLabel } from '../../lib/salesContractTaxonomy';
import { supabase } from '../../lib/supabase';
import {
  listSsongRequests, approveSsongRequest, rejectSsongRequest, checkContractPayload, checkDocSendPayload, checkInvoicePayload,
  SSONG_KIND_LABEL, type SsongRequest, type SsongContractPayload, type SsongDocSendPayload, type SsongInvoicePayload,
} from '../../lib/ssongApi';

const won = (n: unknown) => (typeof n === 'number' ? `${n.toLocaleString('ko-KR')}원` : '—');
const yn = (b: unknown) => (b ? '예' : '아니오');

type Names = { entity: Map<string, string>; place: Map<string, string>; client: Map<string, string>; contact: Map<string, string>; contract: Map<string, string> };

/** 결재 카드에 보여 줄 줄들 — id 대신 이름으로. */
function rowsOf(r: SsongRequest, n: Names): [string, string][] {
  if (r.kind === 'sales_contract') {
    const p = r.payload as unknown as SsongContractPayload;
    return [
      ['거래처', n.entity.get(p.entityId) ?? p.entityId],
      ['사업장', p.placeId ? (n.place.get(p.placeId) ?? p.placeId) : '—'],
      ['팀 · 매출유형', `${p.team} · ${pathLabel(p.categoryCode) || p.categoryCode}${p.categoryEtcName ? ` (${p.categoryEtcName})` : ''}`],
      ['발생단위 · 청구주기', `${p.occurrenceUnit} · ${p.billingCycle}${p.billingMonth ? ` · ${p.billingMonth}월 청구` : ''}`],
      ['금액', `${won(p.amount)}${p.includesVat ? ' (부가세 포함)' : ''}`],
      ['담당회계사(cpa)', p.cpa || '거래처에서 이어받음'],
      ['함께 하는 직원', p.staffNames?.length ? p.staffNames.join(', ') : '—'],
      ['귀속연도', p.fiscalYear ? String(p.fiscalYear) : '—'],
      ['계약일 · 기간', `${p.contractDate ?? '—'} · ${p.startDate ?? '?'} ~ ${p.endDate ?? '계속'}`],
      ['계약확정', p.confirmed === false ? '미계약(예정)' : '확정'],
      ['비고', p.note || '—'],
    ];
  }
  if (r.kind === 'invoice_request') {
    const p = r.payload as unknown as SsongInvoicePayload;
    const vat = Math.round((p.supplyAmount || 0) * 0.1);
    return [
      ['거래처', n.entity.get(p.entityId) ?? p.entityId],
      ['사업장', p.placeId ? (n.place.get(p.placeId) ?? p.placeId) : '본사(자동)'],
      ['팀 · 구분', `${p.team} · ${p.phase}`],
      ['공급가액 · 부가세 · 합계', `${won(p.supplyAmount)} · ${won(vat)} · ${won((p.supplyAmount || 0) + vat)}`],
      ['ERP 매출계정', p.erpAccount],
      ['적요', p.summary],
      ['발행일(귀속월)', `${p.issueDate} (${p.issueDate?.slice(0, 7)})`],
      ['매출계약', p.contractId ? (n.contract.get(p.contractId) ?? p.contractId) : '—'],
      ['청구서(서면)', yn(p.needsInvoiceDoc)],
      ['받는 메일', '승인할 때 거래처정보(세금계산서 메일) → 과거 발행 순으로 채움'],
      ['비고', p.note || '—'],
    ];
  }
  const p = r.payload as unknown as SsongDocSendPayload;
  return [
    ['의뢰일자 · 의뢰인', `${p.requestDate || '승인한 날'} · ${p.requester}`],
    ['업무구분 · 송부종류', `${p.workType} · ${p.sendKind}`],
    ['문서명', p.docName || '—'],
    ['발송부수 · 날인', `${p.copies || 1}부 · 날인 ${yn(p.sealRequired)}`],
    ['발송기한', p.deadline],
    ['기타요청', p.etcRequest || '—'],
    ['수신자', p.recipients.map((x) => `${n.client.get(x.clientId) ?? '?'} · ${n.contact.get(x.contactId) ?? '?'}`).join(' / ')],
  ];
}

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  대기: { background: '#FEF3C7', borderColor: '#FCD34D', color: 'var(--warn)' },
  처리중: { background: '#E0F2FE', borderColor: '#7DD3FC' },
  승인: { background: '#DCFCE7', borderColor: '#86EFAC', color: '#166534' },
  반려: { background: '#fee', borderColor: '#fbb', color: 'var(--bad)' },
};

export default function SsongInboxTab() {
  const [rows, setRows] = useState<SsongRequest[]>([]);
  const [names, setNames] = useState<Names>({ entity: new Map(), place: new Map(), client: new Map(), contact: new Map(), contract: new Map() });
  const [show, setShow] = useState<'대기' | '전체'>('대기');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rejecting, setRejecting] = useState<{ id: string; note: string } | null>(null);
  // 승인 확인은 카드 안에서 한 번 더 누르게 한다 — window.confirm 은 앱 안 브라우저 등에서
  // 창이 뜨지 않고 바로 '취소'로 끝나 승인이 조용히 안 되는 일이 있었다(2026-11-20 시험).
  const [confirming, setConfirming] = useState<string | null>(null);

  async function load() {
    try {
      const list = await listSsongRequests();
      setRows(list);
      // id → 이름(카드 표시용)
      const ent = new Set<string>(), pl = new Set<string>(), cl = new Set<string>(), ct = new Set<string>(), co = new Set<string>();
      for (const r of list) {
        const p = r.payload as Record<string, unknown>;
        if (r.kind === 'sales_contract' || r.kind === 'invoice_request') {
          if (p.entityId) ent.add(String(p.entityId));
          if (p.placeId) pl.add(String(p.placeId));
          if (p.contractId) co.add(String(p.contractId));
        }
        else for (const x of (p.recipients as { clientId: string; contactId: string }[]) ?? []) { cl.add(x.clientId); ct.add(x.contactId); }
      }
      const q = async (t: string, col: string, ids: Set<string>) => {
        if (!ids.size) return new Map<string, string>();
        const { data } = await supabase.from(t).select(`id, ${col}`).in('id', [...ids]);
        return new Map(((data ?? []) as unknown as Record<string, string>[]).map((d) => [d.id, d[col]]));
      };
      const [e, p, c, k, s] = await Promise.all([
        q('biz_entity', 'name', ent), q('biz_place', 'place_name', pl), q('doc_clients', 'company_name', cl), q('doc_contacts', 'contact_name', ct),
        q('biz_sales_contract', 'contract_code', co),
      ]);
      setNames({ entity: e, place: p, client: c, contact: k, contract: s });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
  }
  useEffect(() => { void load(); }, []);

  const view = useMemo(() => (show === '대기' ? rows.filter((r) => r.status === '대기' || r.status === '처리중') : rows), [rows, show]);
  const pending = rows.filter((r) => r.status === '대기').length;

  async function approve(r: SsongRequest) {
    setConfirming(null); setBusy(r.id); setMsg(null);
    try {
      const made = await approveSsongRequest(r.id);
      setMsg({ ok: !made.warn, text: `✅ 승인 — ${made.ids.length}건 만들었습니다.${made.warn ? ` ⚠️ ${made.warn}` : ''}` });
    } catch (e) { setMsg({ ok: false, text: `승인 실패(결재는 대기로 남음): ${e instanceof Error ? e.message : String(e)}` }); }
    finally { setBusy(null); void load(); }
  }
  async function reject() {
    if (!rejecting) return;
    setBusy(rejecting.id); setMsg(null);
    try { await rejectSsongRequest(rejecting.id, rejecting.note); setMsg({ ok: true, text: '반려했습니다. 쏭비서가 사유를 봅니다.' }); setRejecting(null); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(null); void load(); }
  }

  return (
    <div className="card">
      <div className="chdr">🤖 쏭비서 결재함</div>
      <Guide id="ssong-inbox" label="어떻게 도는지"
        summary={<>쏭비서는 <b>결재만 올립니다</b>. [승인]을 누르면 그때 매출계약·발송요청·발행요청이 만들어집니다.</>}>
        · 쏭비서가 할 수 있는 일은 <b>매출계약 등록</b>·<b>문서발송 의뢰</b>·<b>세금계산서 발행의뢰</b> 요청 세 가지뿐입니다. 고치기·지우기·취소는 못 합니다.
        <br />· 승인하면 매출계약등록·문서발송관리 화면과 <b>같은 코드</b>로 등록됩니다(계약코드·알림·감사로그 동일). 등록한 사람은 승인한 분으로 남습니다.
        <br />· 고칠 게 있으면 <b>반려</b>하고 사유를 적어 주세요. 쏭비서가 사유를 보고 다시 올립니다.
        <br />· 세금계산서 발행의뢰는 감사팀 「건별 등록」과 같은 코드로 들어가고, 받는 메일은 승인할 때 거래처정보에서 채웁니다(없으면 승인이 멈춥니다).
        <br />· 문서발송 수신자의 주소·전화는 쏭비서에게 주지 않고, 승인할 때 연락처에서 채웁니다. 첨부파일은 승인 뒤 문서발송관리에서 붙입니다.
        <br />· 쏭비서의 조회·요청과 대표님의 승인·반려는 모두 <b>접속기록</b>에 남습니다.
      </Guide>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '10px 0' }}>
        <button className={show === '대기' ? 'btn-p' : 'btn-sm'} onClick={() => setShow('대기')}>결재 대기 {pending}</button>
        <button className={show === '전체' ? 'btn-p' : 'btn-sm'} onClick={() => setShow('전체')}>전체 기록</button>
        <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => void load()}>새로고침</button>
      </div>

      {msg && <div className={msg.ok ? 'alert-s' : 'alert-e'} style={{ fontSize: 'var(--fs-1)' }}>{msg.text}</div>}

      {view.length === 0 && <div style={{ color: 'var(--ink-3)', padding: 14, textAlign: 'center' }}>{show === '대기' ? '결재할 것이 없습니다.' : '기록이 없습니다.'}</div>}

      {view.map((r) => {
        const problems = r.status === '대기'
          ? (r.kind === 'sales_contract' ? checkContractPayload(r.payload as unknown as SsongContractPayload)
            : r.kind === 'invoice_request' ? checkInvoicePayload(r.payload as unknown as SsongInvoicePayload)
            : checkDocSendPayload(r.payload as unknown as SsongDocSendPayload))
          : [];
        return (
          <div key={r.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, margin: '8px 0' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="bdg" style={STATUS_STYLE[r.status]}>{r.status}</span>
              <span className="bdg b-on">{SSONG_KIND_LABEL[r.kind]}</span>
              <b>{r.title}</b>
              <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-0)', color: 'var(--ink-3)' }}>올림 {kstDateTime(r.submittedAt)}{r.keyLabel ? ` · ${r.keyLabel}` : ''}</span>
            </div>
            {r.reason && <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', margin: '6px 0' }}>💬 {r.reason}</div>}
            <table className="tbl" style={{ fontSize: 'var(--fs-1)', margin: '6px 0' }}>
              <tbody>
                {rowsOf(r, names).map(([k, v]) => <tr key={k}><th style={{ width: 150, textAlign: 'left' }}>{k}</th><td>{v}</td></tr>)}
              </tbody>
            </table>
            {problems.length > 0 && <div className="alert-e" style={{ fontSize: 'var(--fs-1)' }}>⚠️ {problems.join(' · ')}</div>}
            {r.lastError && <div className="alert-e" style={{ fontSize: 'var(--fs-1)' }}>지난 승인 실패: {r.lastError}</div>}
            {(r.status === '승인' || r.status === '반려') && (
              <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)' }}>
                {r.status} · {r.decidedByName} · {kstDateTime(r.decidedAt)}
                {r.decisionNote && <> · {r.decisionNote}</>}
                {r.createdIds.length > 0 && <> · 만든 행 {r.createdIds.length}건 ({r.createdTable === 'biz_sales_contract' ? '매출계약' : r.createdTable === 'biz_invoice_request' ? '발행요청' : '발송요청'})</>}
              </div>
            )}
            {r.status === '처리중' && <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>승인 처리 중입니다. 10분 넘게 이대로면 다시 승인할 수 있습니다.</div>}
            {(r.status === '대기' || r.status === '처리중') && (
              rejecting?.id === r.id ? (
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <input autoFocus value={rejecting.note} onChange={(e) => setRejecting({ id: r.id, note: e.target.value })}
                    placeholder="반려 사유(쏭비서가 보고 다시 올립니다)" style={{ flex: 1 }} />
                  <button className="btn-sm" disabled={!rejecting.note.trim() || busy === r.id} onClick={() => void reject()}>반려하기</button>
                  <button className="btn-sm" onClick={() => setRejecting(null)}>그만</button>
                </div>
              ) : confirming === r.id ? (
                <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 'var(--fs-1)', fontWeight: 700 }}>승인하면 바로 {SSONG_KIND_LABEL[r.kind]}이(가) 만들어집니다.</span>
                  <button className="btn-p" disabled={busy !== null} onClick={() => void approve(r)}>
                    {busy === r.id ? '등록 중…' : '승인 확정'}
                  </button>
                  <button className="btn-sm" disabled={busy !== null} onClick={() => setConfirming(null)}>그만</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button className="btn-p" disabled={busy !== null || problems.length > 0} onClick={() => setConfirming(r.id)}>
                    {busy === r.id ? '등록 중…' : '✅ 승인'}
                  </button>
                  <button className="btn-sm" disabled={busy !== null || r.status !== '대기'} onClick={() => setRejecting({ id: r.id, note: '' })}>반려</button>
                </div>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
