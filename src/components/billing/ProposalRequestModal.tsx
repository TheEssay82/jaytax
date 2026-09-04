// 감사팀 › 제안을 **고쳐서** 발행요청으로 넘기는 창.
//
// 1층 제안은 **알림**이다 — "이 계약, 청구할 때가 됐다"고 알려 줄 뿐 그대로 넘기면 안 된다.
// 기한이 한참 지난 건은 계약에 적힌 날짜가 아니라 **지금 발행할 날짜**로 나가야 하고,
// 금액도 그 사이 조정되었을 수 있다. 그래서 넘기기 전에 한 번 손볼 자리를 둔다.
import { useEffect, useState } from 'react';
import { ERP_ACCOUNTS } from '../../lib/invoiceRequestApi';
import { listEmailCandidates, isEmail, joinEmails, splitEmails } from '../../lib/taxEmailApi';
import type { AuditProposal } from '../../lib/auditInvoiceApi';

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const PHASES = ['계약금', '중도금', '잔금', '총액'] as const;

export interface ProposalEdit {
  key: string;
  supplyAmount: number;
  erpAccount: string;
  phase: string;
  summary: string;
  /** 전자세금계산서 발송 e-mail. 여러 개면 쉼표. 비면 넘길 수 없다. */
  docEmail: string;
  /** 청구서(서면)도 보내야 하는가. */
  needsInvoiceDoc: boolean;
}

export function ProposalRequestModal({ rows, approver, issueDate, onClose, onSubmit }: {
  rows: AuditProposal[];
  /** 발행요청이 도착할 사람(김민섭). 안내에만 쓴다. */
  approver: string;
  issueDate: string;
  onClose: () => void;
  onSubmit: (issueDate: string, edits: Map<string, ProposalEdit>) => Promise<void>;
}) {
  const [date, setDate] = useState(issueDate);
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Map<string, ProposalEdit>>(
    () => new Map(rows.map((r) => [r.key, {
      key: r.key,
      supplyAmount: r.supplyAmount,
      erpAccount: r.erpAccount,
      phase: r.label.includes('착수') || r.label.includes('계약') ? '계약금'
        : r.label.includes('중도') ? '중도금' : r.label.includes('잔') ? '잔금' : '총액',
      summary: `${r.companyName} ${r.label}`.trim(),
      docEmail: r.docEmail ?? '',
      needsInvoiceDoc: false,
    }])),
  );

  // 거래처정보·과거 이력에서 발송 e-mail 후보를 끌어와 미리 채운다.
  // 세금계산서가 어디로 갈지는 넘기기 전에 정해져야 한다.
  useEffect(() => {
    let alive = true;
    void Promise.all(rows.map(async (r) => {
      const c = await listEmailCandidates(r.entityId, r.placeId, r.companyName).catch(() => []);
      return [r.key, c] as const;
    })).then((pairs) => {
      if (!alive) return;
      setEdits((prev) => {
        const next = new Map(prev);
        for (const [k, c] of pairs) {
          const e = next.get(k); if (!e || e.docEmail.trim()) continue;
          // 거래처정보에 적힌 것이 있으면 전부, 없으면 가장 많이 쓴 하나.
          const own = c.filter((x) => x.source === '거래처정보').map((x) => x.email);
          const best = own.length ? own : c.slice(0, 1).map((x) => x.email);
          next.set(k, { ...e, docEmail: joinEmails(best) });
        }
        return next;
      });
    });
    return () => { alive = false; };
  }, [rows]);
  const set = (key: string, patch: Partial<ProposalEdit>) =>
    setEdits((p) => new Map(p).set(key, { ...p.get(key)!, ...patch }));

  const total = [...edits.values()].reduce((s, e) => s + e.supplyAmount, 0);
  /** 기한이 많이 지난 건은 계약 날짜를 그대로 쓰면 안 된다 — 그 사실을 눈에 띄게 알린다. */
  const stale = rows.filter((r) => r.overdueDays > 60);

  async function go() {
    if ([...edits.values()].some((e) => e.supplyAmount <= 0)) {
      return alert('공급가액이 0인 건이 있습니다. 고치거나 목록에서 빼 주세요.');
    }
    const noMail = rows.filter((r) => !splitEmails(edits.get(r.key)?.docEmail ?? '').length);
    if (noMail.length) {
      return alert(`전자세금계산서 발송 e-mail 이 빈 건이 있습니다 — ${noMail.map((r) => r.companyName).join(', ')}\n`
        + '세금계산서가 어디로 갈지 정해야 넘길 수 있습니다.');
    }
    const badMail = [...edits.values()].flatMap((e) => splitEmails(e.docEmail)).filter((x) => !isEmail(x));
    if (badMail.length) return alert(`이메일 형식이 아닙니다 — ${badMail.join(', ')}`);
    if (!confirm(`${rows.length}건을 발행요청합니다.

· 공급가액 합계 ${won(total)}
· 작성일(발행기준일) ${date}

${approver}에게 바로 알림이 갑니다. 진행할까요?`)) return;
    setBusy(true);
    try { await onSubmit(date, edits); onClose(); }
    catch (e) { alert('요청 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 60,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 980, width: '100%' }}>
        <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          ✅ 발행요청으로 넘기기
          <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>
            {rows.length}건 · 공급가액 {won(total)}
          </span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>

        <div className="alert-i" style={{ fontSize: 'var(--fs-1)' }}>
          제안은 <b>알림</b>입니다 — 계약에 적힌 대로 그대로 나가면 안 됩니다.
          넘기기 전에 <b>작성일·금액·적요</b>를 이 자리에서 고치세요.
          <br /><b>작성일(발행기준일)</b>이 실제 세금계산서 날짜입니다. 계약의 청구기한이 아니라
          <b> 지금 발행할 날</b>을 넣으세요.
          <br /><b>발송 e-mail</b>은 거래처정보와 과거 발행 이력에서 미리 채웁니다 — 비어 있으면 넘길 수 없습니다.
          여러 곳이면 쉼표로 이으세요. <b>청구서</b>는 서면 청구서를 따로 보내야 하는 건에 체크합니다.
        </div>
        {stale.length > 0 && (
          <div className="alert-w" style={{ fontSize: 'var(--fs-1)' }}>
            ⚠️ 청구기한이 <b>60일 넘게 지난 건이 {stale.length}건</b> 있습니다
            ({stale.slice(0, 3).map((r) => `${r.companyName} ${r.overdueDays}일`).join(', ')}{stale.length > 3 ? ' 외' : ''}).
            작성일을 오늘 날짜로 두는 것이 맞는지 확인해 주세요.
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <b style={{ fontSize: 'var(--fs-2)', color: 'var(--navy)' }}>작성일(발행기준일)</b>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ fontSize: 'var(--fs-2)' }} />
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>고른 건 모두에 같은 날짜로 들어갑니다.</span>
        </div>

        <div style={{ maxHeight: '50vh', overflow: 'auto' }}>
          <table className="tbl" style={{ fontSize: 'var(--fs-1)' }}>
            <thead>
              <tr>
                <th>거래처</th><th>회차</th><th>청구기한</th>
                <th className="r" style={{ minWidth: 120 }}>공급가액</th>
                <th style={{ minWidth: 120 }}>매출계정</th><th style={{ minWidth: 80 }}>구분</th>
                <th style={{ minWidth: 180 }}>발행 시 적요</th>
                <th style={{ minWidth: 190 }}>발송 e-mail <span style={{ color: 'var(--bad)' }}>*</span></th>
                <th style={{ width: 56 }}>청구서</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const e = edits.get(r.key)!;
                const changed = Math.round(e.supplyAmount) !== Math.round(r.supplyAmount);
                return (
                  <tr key={r.key}>
                    <td style={{ fontWeight: 700, color: 'var(--navy)' }}>
                      {r.companyName}
                      <div style={{ fontSize: 'var(--fs-0)', fontWeight: 400, color: 'var(--ink-3)' }}>{r.placeName}</div>
                    </td>
                    <td>{r.label}</td>
                    <td style={{ color: r.overdueDays > 60 ? '#c33' : '#888', whiteSpace: 'nowrap' }}>
                      {r.dueDate}
                      <div style={{ fontSize: 'var(--fs-0)' }}>{r.overdueDays >= 0 ? `${r.overdueDays}일 지남` : `${-r.overdueDays}일 뒤`}</div>
                    </td>
                    <td className="r">
                      <input value={String(Math.round(e.supplyAmount))}
                        onChange={(ev) => set(r.key, { supplyAmount: Number(ev.target.value.replace(/[^\d]/g, '')) || 0 })}
                        style={{ width: '100%', textAlign: 'right', fontWeight: changed ? 700 : 400, color: changed ? '#c33' : undefined }} />
                      {changed && (
                        <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)' }}>계약 {won(r.supplyAmount)}</div>
                      )}
                    </td>
                    <td>
                      <select value={e.erpAccount} onChange={(ev) => set(r.key, { erpAccount: ev.target.value })}
                        style={{ width: '100%', fontSize: 'var(--fs-1)' }}>
                        {ERP_ACCOUNTS.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={e.phase} onChange={(ev) => set(r.key, { phase: ev.target.value })}
                        style={{ width: '100%', fontSize: 'var(--fs-1)' }}>
                        {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td>
                      <input value={e.summary} onChange={(ev) => set(r.key, { summary: ev.target.value })}
                        style={{ width: '100%', fontSize: 'var(--fs-1)' }} />
                    </td>
                    <td>
                      <input value={e.docEmail} onChange={(ev) => set(r.key, { docEmail: ev.target.value })}
                        placeholder="여러 개면 쉼표로"
                        style={{
                          width: '100%', fontSize: 'var(--fs-0)',
                          borderColor: e.docEmail.trim() ? undefined : '#c33',
                          background: e.docEmail.trim() ? undefined : '#fff5f5',
                        }} />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={e.needsInvoiceDoc}
                        title="청구서(서면)도 보내야 하는 건"
                        onChange={(ev) => set(r.key, { needsInvoiceDoc: ev.target.checked })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: '#f5efdd', fontWeight: 700 }}>
                <td colSpan={3}>합계 {rows.length}건</td>
                <td className="r">{won(total)}</td>
                <td colSpan={5}></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button className="btn-p" disabled={busy} onClick={() => void go()}>
            {busy ? '요청 중…' : `✅ ${rows.length}건 발행요청`}
          </button>
          <button className="btn-sm" disabled={busy} onClick={onClose}>취소</button>
        </div>
      </div>
    </div>
  );
}
