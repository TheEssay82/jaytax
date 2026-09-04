// 수정세금계산서 등록 — (−)되돌리기와 (+)되살리기.
//
// ERP 가 (−)수정으로 지운 청구가 우리 미수금에는 그대로 남는 일이 있었다
// (파인즈플래닝 2026-04·05·06 기장료 660,000). 담을 자리가 없어서였다.
// 반대 방향도 있다 — 예전에 끊어 둔 (−)크레딧이 소멸해 채권이 되살아나는 경우(제이엠스토리).
//
// 두 갈래로 쓴다.
//  ① 우리 장부에 원 건이 있을 때 — 그 행에서 열면 금액·거래처가 채워져 있다.
//  ② 원 건이 기초미수금에 묻혀 있을 때 — 거래처를 고르고 ERP 전표번호를 적는다.
// 금액은 **양수로 받아** 저장할 때 부호를 붙인다. 사람이 직접 (−)를 치면 빠뜨리기 때문이다.
import { useState } from 'react';
import Guide from '../common/Guide';
import { createCorrection, ERP_ACCOUNTS, type InvoiceRequest } from '../../lib/invoiceRequestApi';
import { corpDisplayName, type BizEntityFull } from '../../lib/bizRegistryApi';
import { todayYmd } from '../../lib/format';

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');

export function CorrectionModal({ team, origin, entities, onClose, onSaved }: {
  team: string;
  /** 되돌릴 원 발행요청. 없으면 거래처를 직접 고른다. */
  origin: InvoiceRequest | null;
  entities: BizEntityFull[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [company, setCompany] = useState('');
  const [entityId, setEntityId] = useState(origin?.entityId ?? '');
  const [placeId, setPlaceId] = useState(origin?.placeId ?? '');
  const [amount, setAmount] = useState(origin ? String(Math.abs(origin.supplyAmount)) : '');
  const [count, setCount] = useState('1');
  const [reason, setReason] = useState('');
  const [invNo, setInvNo] = useState('');
  const [account, setAccount] = useState(origin?.erpAccount || '기장대리수입');
  const [ym, setYm] = useState(origin?.ym ?? todayYmd().slice(0, 7));
  const [issuedDate, setIssuedDate] = useState(todayYmd());
  const [sign, setSign] = useState<'-' | '+'>('-');
  const [busy, setBusy] = useState(false);

  const options = entities.map((e) => ({
    id: e.id, label: `${e.code} ${corpDisplayName(e.name, e.corpForm, e.corpFormPosition)}`, places: e.places,
  }));
  const chosen = options.find((o) => o.id === entityId);
  const amt = Number(amount.replace(/[^\d]/g, '')) || 0;
  const n = Math.max(1, Number(count.replace(/[^\d]/g, '')) || 1);
  const totalGross = Math.round(amt * 1.1) * n;
  const S = sign === '-' ? '−' : '+';

  function pick(label: string) {
    const o = options.find((x) => x.label === label);
    setCompany(label);
    if (!o) { setEntityId(''); setPlaceId(''); return; }
    setEntityId(o.id);
    setPlaceId((o.places.find((p) => p.isHeadquarters) ?? o.places[0])?.id ?? '');
  }

  async function save() {
    if (!entityId) return alert('거래처를 골라 주세요.');
    if (!amt) return alert('되돌릴 공급가액을 넣어 주세요(양수로).');
    if (!reason.trim()) return alert('수정 사유를 적어 주세요 — 나중에 왜 뺐는지 알 수 없게 됩니다.');
    if (!confirm(`(${S})수정세금계산서 ${n}건을 등록합니다.

· 거래처 ${origin?.companyName ?? company}
· 공급가액 ${S}${won(amt)}${n > 1 ? ` × ${n}건` : ''} · 합계(VAT포함) ${S}${won(totalGross)}
· 귀속월 ${ym} · 발행일 ${issuedDate}

미수금과 매출통계에서 그만큼 ${sign === '-' ? '빠집니다' : '늘어납니다'}. 진행할까요?`)) return;
    setBusy(true);
    try {
      const place = chosen?.places.find((p) => p.id === placeId);
      for (let i = 0; i < n; i++) {
        await createCorrection({
          ym, team,
          entityId, placeId: placeId || null, contractId: origin?.contractId ?? null,
          amount: amt, sign, reason: reason.trim(), issueDate: issuedDate, issuedDate,
          correctsRequestId: origin?.id ?? null,
          correctsInvoiceNo: invNo.trim(),
          erpAccount: account,
          companyName: origin?.companyName ?? (chosen?.label.replace(/^\S+\s/, '') ?? ''),
          placeName: origin?.placeName ?? place?.placeName ?? '',
          contractCode: origin?.contractCode ?? '',
          cpa: origin?.cpa ?? place?.cpa ?? '',
          staff: origin?.staff ?? (place?.staff ?? []).map((x) => x.staffName).join(','),
          summary: reason.trim(),
        });
      }
      onSaved(`✓ (${S})수정발행 ${n}건 등록 — 합계 ${S}${won(totalGross)}`);
      onClose();
    } catch (e) { alert('등록 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 60,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, width: '100%' }}>
        <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {sign === '-' ? '➖' : '➕'} 수정세금계산서
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          <button className={sign === '-' ? 'btn-p' : 'btn-sm'} onClick={() => setSign('-')}>➖ 되돌리기 (−)</button>
          <button className={sign === '+' ? 'btn-p' : 'btn-sm'} onClick={() => setSign('+')}>➕ 되살리기 (+)</button>
        </div>
        <Guide id="correction" label="(−)(+) 고르는 법"
          summary={<>금액은 언제나 <b>양수로</b> 넣으세요 — 저장할 때 부호를 붙입니다.</>}>
          · <b>되돌리기 (−)</b> — 이미 발행한 것을 무릅니다(계약 해지·과다청구). 미수금과 매출통계에서 <b>빠집니다</b>.
          <br />· <b>되살리기 (+)</b> — 덜 발행했거나, 예전에 끊어 둔 (−)크레딧이 소멸해 채권이 <b>되살아납니다</b>.
          <br />· 취소(요청을 없던 일로)와 다릅니다 — 이미 나간 세금계산서를 고친 사실을 남기는 것입니다.
          {!origin && (
            <><br />· 원 건이 우리 장부에 없다면(기초미수금에 묻힌 것) <b>ERP 전표번호</b>를 적어 두세요.</>
          )}
        </Guide>

        {origin ? (
          <div style={{ fontSize: 'var(--fs-2)', background: '#fdfaf3', border: '1px solid var(--rule)', borderRadius: 6, padding: '6px 8px', marginBottom: 8 }}>
            되돌릴 원 건 — <b>{origin.companyName}</b> {origin.placeName} · {origin.ym} ·
            공급가액 {won(origin.supplyAmount)} · {origin.status}
            {origin.invoiceNo && <> · 승인번호 {origin.invoiceNo}</>}
          </div>
        ) : (
          <Row label="거래처">
            <input list="corr-companies" value={company} placeholder="코드 또는 상호로 찾기"
              onChange={(e) => pick(e.target.value)} style={{ width: '100%' }} />
            <datalist id="corr-companies">
              {options.map((o) => <option key={o.id} value={o.label} />)}
            </datalist>
          </Row>
        )}
        {!origin && chosen && chosen.places.length > 1 && (
          <Row label="사업장">
            <select value={placeId} onChange={(e) => setPlaceId(e.target.value)} style={{ width: '100%' }}>
              {chosen.places.map((p) => <option key={p.id} value={p.id}>{p.placeName}</option>)}
            </select>
          </Row>
        )}

        <Row label={`${sign === '-' ? '되돌릴' : '되살릴'} 공급가액 (양수)`}>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="부가세 별도"
            style={{ width: 140, textAlign: 'right' }} />
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)' }}>
            × <input value={count} onChange={(e) => setCount(e.target.value)} style={{ width: 44, textAlign: 'right' }} />건
          </span>
          {amt > 0 && (
            <b style={{ fontSize: 'var(--fs-2)', color: sign === '-' ? '#c33' : '#2a7' }}>합계 {S}{won(totalGross)}</b>
          )}
        </Row>
        <Row label="귀속월 · 발행일">
          <input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} />
          <input type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} />
        </Row>
        {!origin && (
          <>
            <Row label="매출계정">
              <select value={account} onChange={(e) => setAccount(e.target.value)}>
                {ERP_ACCOUNTS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </Row>
            <Row label="원 전표번호(ERP)">
              <input value={invNo} onChange={(e) => setInvNo(e.target.value)}
                placeholder="예: 26-0425-0101 (여럿이면 쉼표)" style={{ width: '100%' }} />
            </Row>
          </>
        )}
        <Row label="수정 사유">
          <input value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="예: 계약 해지로 4~6월분 취소" style={{ width: '100%' }} />
        </Row>

        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button className="btn-p" disabled={busy} onClick={() => void save()}>
            {busy ? '등록 중…' : `(${S})수정발행 등록`}
          </button>
          <button className="btn-sm" disabled={busy} onClick={onClose}>취소</button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
      <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', width: 140, flexShrink: 0 }}>{label}</span>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1 }}>{children}</span>
    </div>
  );
}
