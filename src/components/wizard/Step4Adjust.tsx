// Step 4: 금액 조정 (+ 과거 청구기록 비교 모달) — 원본 rStep4 + showBillingHistory 포팅
import { useState } from 'react';
import { useWizard } from '../../context/WizardContext';
import { calcS, won } from '../../lib/calc';
import type { BillingRecord } from '../../types';
import type { WizardStepProps } from './stepProps';

const 억 = (n: number) => (n / 1e8).toFixed(2) + '억';
const 만 = (n: number) => (n ? Math.round(n / 1e4).toLocaleString('ko-KR') + '만' : '-');

export default function Step4Adjust({ records }: WizardStepProps) {
  const { S, setS } = useWizard();
  const [showHistory, setShowHistory] = useState(false);
  const c = calcS(S);

  const pastRecs: BillingRecord[] = records
    .filter((r) => (S.selClientId && r.selClientId === S.selClientId) || r.companyName === S.companyName)
    .sort((a, b) => Number(b.fiscalYear) - Number(a.fiscalYear));

  return (
    <>
      <div className="card">
        <div className="chdr">
          할인 / 추가금액 조정
          {pastRecs.length > 0 && (
            <button className="btn-sm btn-sm-blue" style={{ marginLeft: 'auto' }} onClick={() => setShowHistory(true)}>
              과거 청구기록 비교 ({pastRecs.length}건)
            </button>
          )}
        </div>
        <div className="fr2" style={{ padding: '9px 0' }}>
          <span className="fk" style={{ fontWeight: 700 }}>
            C) 산출 보수총계
          </span>
          <span style={{ fontWeight: 700, fontSize: 14, color: '#1A2B52' }}>{won(c.C)}</span>
        </div>
        <div style={{ height: 1, background: '#EDE9E2', margin: '0 0 9px' }} />
        <div className="frow">
          <span className="fl">할인/조정 사유</span>
          <input
            value={S.discContent}
            placeholder="예: 신규고객 할인"
            onChange={(e) => setS({ discContent: e.target.value })}
          />
        </div>
        <div className="frow">
          <span className="fl">할인금액 (원)</span>
          <input
            value={S.discAmt}
            placeholder="양수로 입력"
            onChange={(e) => setS({ discAmt: e.target.value })}
          />
        </div>
      </div>

      <div className="fee-grd">
        <div className="fr2">
          <span className="fk">C) 보수총계</span>
          <span className="fv">{won(c.C)}</span>
        </div>
        <div className="fr2">
          <span className="fk">⑧ 할인 ({S.discContent || '미입력'})</span>
          <span className="fv">- {won(c.disc)}</span>
        </div>
        <div className="fr2">
          <span className="fk">D) 총 보수 합계</span>
          <span className="fv">{won(c.D)}</span>
        </div>
        <div className="fr2">
          <span className="fk">⑨ VAT 10%</span>
          <span className="fv">{won(c.VAT)}</span>
        </div>
        <div className="fr2" style={{ borderTop: '1px solid rgba(255,255,255,.2)', paddingTop: 7, marginTop: 3 }}>
          <span className="fk" style={{ fontSize: 14, fontWeight: 600 }}>
            최종 청구금액
          </span>
          <span className="fv" style={{ fontSize: 20 }}>
            {won(c.grand)}
          </span>
        </div>
      </div>

      {showHistory && (
        <div className="modal-overlay" onClick={() => setShowHistory(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="chdr">
              📋 과거 청구기록 비교 ({S.companyName || pastRecs[0]?.companyName} · {pastRecs.length}건)
              <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setShowHistory(false)}>
                닫기 ✕
              </button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>귀속연도</th>
                    <th>구분</th>
                    <th className="r">매출액</th>
                    <th className="r">기본보수A</th>
                    <th className="r">추가보수B</th>
                    <th className="r">보수총계C</th>
                    <th className="r">할인⑧</th>
                    <th className="r">최종청구금액</th>
                  </tr>
                </thead>
                <tbody>
                  {pastRecs.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 700 }}>{r.fiscalYear}년</td>
                      <td>
                        <span className={`bdg ${r.bizType === '법인' ? 'b-law' : 'b-per'}`}>{r.bizType}</span>
                      </td>
                      <td className="r" style={{ fontFamily: 'monospace' }}>
                        {억(r.rev)}
                      </td>
                      <td className="r" style={{ fontFamily: 'monospace' }}>
                        {만(r.A)}
                      </td>
                      <td className="r" style={{ fontFamily: 'monospace' }}>
                        {만(r.Btot)}
                      </td>
                      <td className="r" style={{ fontFamily: 'monospace' }}>
                        {만(r.C)}
                      </td>
                      <td className="r" style={{ fontFamily: 'monospace', color: '#DC2626' }}>
                        {만(r.disc)}
                      </td>
                      <td className="r" style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1A2B52' }}>
                        {만(r.grand)}원
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: '#888' }}>※ 금액 단위: 억/만원 (요약 표시)</div>
          </div>
        </div>
      )}
    </>
  );
}
