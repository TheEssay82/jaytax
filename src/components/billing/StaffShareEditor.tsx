// 청구 한 건의 담당직원·실적 배분 편집 — 담당직원 칸을 눌러 연다.
//
// 실적은 청구 시점에 정해진다. 기본은 주담당 100% 이고, 둘이 나눠 한 건이면 여기서 비율을 준다.
// 담당이 아예 바뀐 것이라면 '앞으로도' 를 켠다 — 매출계약의 담당 이력이 이 달부터 갈리고,
// 다음 달 청구예정부터 새 담당으로 잡힌다. 지난 달 청구는 그대로 남는다.
import { useState } from 'react';
import { useEscape } from '../../lib/useEscape';
import { setInvoiceStaff, type InvoiceStaffShare } from '../../lib/invoiceStaffApi';

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');

/** 배분을 한 줄로 요약 — 1명이면 이름만, 여럿이면 비율까지. */
export function shareLabel(list: InvoiceStaffShare[] | undefined, fallback: string): string {
  const l = (list ?? []).filter((s) => s.share > 0);
  if (!l.length) return fallback;
  if (l.length === 1) return l[0].staffName;
  return l.map((s) => `${s.staffName} ${Math.round(s.share)}%`).join(' · ');
}

export function StaffShareEditor({ requestId, amount, current, staffOptions, ym, contractId, placeId, company, onClose, onSaved }: {
  requestId: string; amount: number;
  current: InvoiceStaffShare[];
  staffOptions: string[];
  ym: string;
  contractId?: string | null;
  placeId?: string | null;
  company?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  useEscape(onClose);
  const [rows, setRows] = useState<InvoiceStaffShare[]>(
    current.length ? current.map((r, i) => ({ ...r, seq: i + 1 })) : [{ staffName: '', share: 100, seq: 1 }],
  );
  const [busy, setBusy] = useState(false);
  const [propagate, setPropagate] = useState(false);
  const before = current.filter((r) => r.share > 0).map((r) => r.staffName).join(',');
  const after = rows.filter((r) => r.staffName.trim() && r.share > 0).map((r) => r.staffName.trim()).join(',');
  const changed = after !== before;
  const total = rows.reduce((s, r) => s + (Number(r.share) || 0), 0);

  const set = (i: number, patch: Partial<InvoiceStaffShare>) =>
    setRows((p) => p.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  async function save() {
    setBusy(true);
    try {
      const { propagated } = await setInvoiceStaff(requestId, rows.filter((r) => r.staffName.trim()),
        { propagate, ym, contractId, placeId, company });
      if (propagated) alert(`매출계약의 담당직원도 ${ym}부터 ${after} 로 바뀌었습니다.`);
      onSaved(); onClose();
    }
    catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 60,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, width: '100%' }}>
        <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          👥 담당직원 · 실적 배분
          <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>공급가액 {won(amount)}</span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>
        <div className="alert-i" style={{ fontSize: 'var(--fs-1)' }}>
          이 청구 한 건의 <b>담당직원</b>과, 실적을 누구에게 얼마나 돌릴지 정합니다. 기본은 <b>주담당 100%</b>이고,
          둘이 나눠 한 일이면 비율을 주면 됩니다. <b>합이 100%</b>여야 저장됩니다.
        </div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 5 }}>
            <span style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)', width: 34 }}>{i === 0 ? '주담당' : `공동${i}`}</span>
            <input list="staff-opts" value={r.staffName} placeholder="직원명"
              onChange={(e) => set(i, { staffName: e.target.value })} style={{ flex: 1 }} />
            <datalist id="staff-opts">{staffOptions.map((n) => <option key={n} value={n} />)}</datalist>
            <input value={r.share} onChange={(e) => set(i, { share: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })}
              style={{ width: 62, textAlign: 'right' }} />
            <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', width: 12 }}>%</span>
            <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', width: 88, textAlign: 'right' }}>
              {won(amount * (Number(r.share) || 0) / 100)}
            </span>
            {rows.length > 1 && (
              <button className="btn-sm btn-sm-del" onClick={() => setRows((p) => p.filter((_, k) => k !== i))}>×</button>
            )}
          </div>
        ))}
        {changed && contractId && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 10, fontSize: 'var(--fs-1)', cursor: 'pointer' }}>
            <input type="checkbox" checked={propagate} onChange={(e) => setPropagate(e.target.checked)} style={{ marginTop: 2 }} />
            <span>
              <b>앞으로도 이 사람이 담당</b> — 매출계약의 담당직원을 <b>{ym}부터</b>{' '}
              {before || '(없음)'} → <b>{after}</b> 로 바꿉니다.
              <br /><span style={{ color: 'var(--ink-3)' }}>
                지난 달 청구 실적은 그대로 남고, 다음 달 청구예정부터 새 담당으로 잡힙니다.
                이번 건만 대신 처리한 것이라면 켜지 마세요.
              </span>
            </span>
          </label>
        )}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
          <button className="btn-sm" onClick={() => setRows((p) => [...p, { staffName: '', share: 0, seq: p.length + 1 }])}>
            ＋ 공동담당
          </button>
          <span style={{ fontSize: 'var(--fs-1)', color: Math.round(total) === 100 ? '#2a7' : '#c33', fontWeight: 700 }}>
            합계 {Math.round(total)}%
          </span>
          <button className="btn-p" style={{ marginLeft: 'auto' }} disabled={busy || Math.round(total) !== 100}
            onClick={() => void save()}>저장</button>
        </div>
      </div>
    </div>
  );
}
