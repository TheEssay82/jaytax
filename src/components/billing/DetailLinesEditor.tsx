// 세금계산서 한 장의 <세부내역> — 용역료와 제경비를 나눠 적는다.
//
// 엑셀 '발행 요구서' 양식에 있던 표를 그대로 옮겼다. 한 장으로 합산해 청구하더라도
// **무엇으로 이루어졌는지**는 남아야 한다 — 나중에 "이 500만원에 출장비가 얼마였나"를
// 되짚을 일이 반드시 생긴다.
//
// 합계는 공급가액이 되고, 줄을 쓰지 않으면 예전처럼 금액 한 칸으로 끝난다.
import type { DetailLine } from '../../lib/invoiceRequestApi';

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
/** 거래종류 후보 — 마지막 '제경비'가 이 화면을 만든 이유다. */
const KINDS = ['회계감사', '세무조정', '기업진단', '경영자문', '기타용역', '제경비'] as const;

export function DetailLinesEditor({ lines, onChange, baseKind }: {
  lines: DetailLine[];
  onChange: (l: DetailLine[]) => void;
  /** 첫 줄의 기본 거래종류(매출계정에서 짐작). */
  baseKind?: string;
}) {
  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const set = (i: number, patch: Partial<DetailLine>) =>
    onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  if (!lines.length) {
    return (
      <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)' }}>
        <button className="btn-sm" onClick={() => onChange([
          { kind: baseKind || '기타용역', desc: '', amount: 0 },
          { kind: '제경비', desc: '', amount: 0 },
        ])}>
          ＋ 세부내역 나눠 적기 (제경비 합산청구)
        </button>
        <span style={{ marginLeft: 6, color: 'var(--ink-3)' }}>
          용역료와 제경비를 나눠 청구할 때 씁니다. 쓰지 않으면 위 공급가액 한 줄로 나갑니다.
        </span>
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid var(--rule)', borderRadius: 6, padding: '6px 8px', background: '#fffdf8' }}>
      <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginBottom: 4 }}>
        &lt;세부내역&gt; — 합계가 <b>공급가액</b>이 됩니다. 제경비는 거래종류를 <b>제경비</b>로 두세요.
      </div>
      <table className="tbl" style={{ fontSize: 'var(--fs-1)' }}>
        <thead>
          <tr><th style={{ width: 110 }}>거래종류</th><th>세부내역</th>
            <th className="r" style={{ width: 110 }}>공급가액</th>
            <th className="r" style={{ width: 90 }}>부가세</th><th style={{ width: 30 }}></th></tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>
                <select value={l.kind} onChange={(e) => set(i, { kind: e.target.value })}
                  style={{ width: '100%', fontSize: 'var(--fs-1)' }}>
                  {[...new Set([...KINDS, l.kind].filter(Boolean))].map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </td>
              <td>
                <input value={l.desc} onChange={(e) => set(i, { desc: e.target.value })}
                  placeholder={l.kind === '제경비' ? '예: 출장비·인지대' : '예: 2026년 회계감사 착수금'}
                  style={{ width: '100%', fontSize: 'var(--fs-1)' }} />
              </td>
              <td className="r">
                <input value={String(Math.round(Number(l.amount) || 0))}
                  onChange={(e) => set(i, { amount: Number(e.target.value.replace(/[^\d]/g, '')) || 0 })}
                  style={{ width: '100%', textAlign: 'right', fontSize: 'var(--fs-1)' }} />
              </td>
              <td className="r" style={{ color: 'var(--ink-3)' }}>{won(Math.round((Number(l.amount) || 0) * 0.1))}</td>
              <td>
                <button className="btn-sm btn-sm-del" onClick={() => onChange(lines.filter((_, k) => k !== i))}>−</button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ background: '#f5efdd', fontWeight: 700 }}>
            <td colSpan={2}>계</td>
            <td className="r">{won(total)}</td>
            <td className="r">{won(Math.round(total * 0.1))}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
      <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
        <button className="btn-sm" onClick={() => onChange([...lines, { kind: '제경비', desc: '', amount: 0 }])}>
          ＋ 줄 추가
        </button>
        <button className="btn-sm" onClick={() => onChange([])}>세부내역 없애기</button>
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', marginLeft: 'auto' }}>
          공급대가(VAT포함) <b>{won(total + Math.round(total * 0.1))}</b>
        </span>
      </div>
    </div>
  );
}
