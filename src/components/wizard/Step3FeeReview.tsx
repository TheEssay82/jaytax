// Step 3: 수수료 확인 + 전년 비교 — 원본 rStep3 포팅
import { useWizard } from '../../context/WizardContext';
import { useConfig } from '../../context/ConfigContext';
import { calcS, won, pct } from '../../lib/calc';
import { getRevForYear } from '../../lib/format';
import type { WizardStepProps } from './stepProps';

export default function Step3FeeReview({ clients, records }: WizardStepProps) {
  const { S } = useWizard();
  const { config, activeLabel } = useConfig();
  const c = calcS(S, config);

  const prevYear = Number(S.fiscalYear) - 1;
  const prev = records.find(
    (r) =>
      (S.selClientId ? r.selClientId === S.selClientId : r.companyName === S.companyName) &&
      String(r.fiscalYear) === String(prevYear),
  );
  const prevCl = S.selClientId ? clients.find((x) => x.id === S.selClientId) : undefined;
  const prevRevFallback = prevCl ? getRevForYear(prevCl, prevYear) : 0;

  return (
    <>
      {prev ? (
        (() => {
          const diff = c.grand - (prev.grand || 0);
          const dp = prev.grand ? ((diff / prev.grand) * 100).toFixed(1) : 'N/A';
          return (
            <div className="cmp-box">
              <div className="cmp-title">
                📊 전년도({prev.fiscalYear}년) vs 당기({S.fiscalYear}년) 비교
              </div>
              <div className="cmp-grid">
                <div>
                  <div className="cmp-hdr">▶ {prev.fiscalYear}년</div>
                  <div className="cmp-row">
                    <span>매출액</span>
                    <span>{won(prev.rev || prevRevFallback || 0)}</span>
                  </div>
                  <div className="cmp-row">
                    <span>기본업무보수</span>
                    <span>{won(prev.A || 0)}</span>
                  </div>
                  <div className="cmp-row">
                    <span>최종청구금액</span>
                    <span>
                      <strong>{won(prev.grand || 0)}</strong>
                    </span>
                  </div>
                </div>
                <div>
                  <div className="cmp-hdr">▶ {S.fiscalYear}년</div>
                  <div className="cmp-row">
                    <span>매출액</span>
                    <span>{won(c.rev)}</span>
                  </div>
                  <div className="cmp-row">
                    <span>기본업무보수</span>
                    <span>{won(c.A)}</span>
                  </div>
                  <div className="cmp-row">
                    <span>최종청구금액</span>
                    <span>
                      <strong>{won(c.grand)}</strong>
                    </span>
                  </div>
                  <div className={`cmp-diff ${diff >= 0 ? 'diff-up' : 'diff-dn'}`}>
                    전년 대비: {diff >= 0 ? '+' : ''}
                    {won(diff)} ({dp}%)
                  </div>
                </div>
              </div>
            </div>
          );
        })()
      ) : prevRevFallback ? (
        <div className="cmp-box">
          <div className="cmp-title">📊 {prevYear}년 매출액 참고</div>
          <div className="cmp-grid">
            <div>
              <div className="cmp-hdr">▶ {prevYear}년 (청구기록 없음)</div>
              <div className="cmp-row">
                <span>매출액 (거래처 DB)</span>
                <span>{won(prevRevFallback)}</span>
              </div>
            </div>
            <div>
              <div className="cmp-hdr">▶ {S.fiscalYear}년</div>
              <div className="cmp-row">
                <span>매출액</span>
                <span>{won(c.rev)}</span>
              </div>
              <div className="cmp-row">
                <span>최종청구금액</span>
                <span>
                  <strong>{won(c.grand)}</strong>
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="alert-i" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span>
          수수료는 <strong>천원 단위 반올림</strong> 후 최종 확정됩니다.
        </span>
        <span style={{ marginLeft: 'auto' }}>
          적용 설정: <span className="ver-badge">{activeLabel}</span>
        </span>
      </div>

      <div className="fee-blk">
        <div className="fee-t">A — 기본업무보수</div>
        <div className="fr2">
          <span className="fk">① 기본보수</span>
          <span className="fv">{won(c.baseFee)}</span>
        </div>
        <div className="fr2">
          <span className="fk">② 규모가산</span>
          <span className="fv">{won(c.scale)}</span>
        </div>
        <div className="fr2" style={{ borderTop: '2px solid #E0DCD4', marginTop: 2, paddingTop: 5 }}>
          <span className="fk" style={{ fontWeight: 700 }}>
            A) 기본업무보수
          </span>
          <span className="fv big">{won(c.A)}</span>
        </div>
      </div>

      <div className="fee-blk">
        <div className="fee-t">B — 추가업무보수</div>
        {S.isModel && (
          <div className="fr2">
            <span className="fk">③ 성실신고수수료</span>
            <span className="fv">{won(c.modelFee)}</span>
          </div>
        )}
        <div className="fr2">
          <span className="fk">
            ④ 기장·결산·상담 <small style={{ color: '#AAA' }}>(A × {pct(c.r4)})</small>
          </span>
          <span className="fv">{won(c.f4)}</span>
        </div>
        <div className="fr2">
          <span className="fk">
            ⑤ 원가계산 <small style={{ color: '#AAA' }}>(A × {pct(c.r5)})</small>
          </span>
          <span className="fv">{won(c.f5)}</span>
        </div>
        <div className="fr2">
          <span className="fk">
            ⑥ 세무조정 <small style={{ color: '#AAA' }}>(A × {pct(c.r6)})</small>
          </span>
          <span className="fv">{won(c.f6)}</span>
        </div>
        <div className="fr2" style={{ borderTop: '2px solid #E0DCD4', marginTop: 2, paddingTop: 5 }}>
          <span className="fk" style={{ fontWeight: 700 }}>
            B) 추가업무보수
          </span>
          <span className="fv big">{won(c.Btot)}</span>
        </div>
      </div>

      <div className="fee-blk">
        <div className="fee-t">⑦ — 증빙 및 기타</div>
        <div className="fr2">
          <span className="fk">증빙 ({S.evCount})</span>
          <span className="fv">{won(c.evFee)}</span>
        </div>
        {!!c.otherFee && (
          <div className="fr2">
            <span className="fk">기타 ({S.otherContent || '기타'})</span>
            <span className="fv">{won(c.otherFee)}</span>
          </div>
        )}
        <div className="fr2" style={{ borderTop: '2px solid #E0DCD4', marginTop: 2, paddingTop: 5 }}>
          <span className="fk" style={{ fontWeight: 700 }}>
            ⑦) 소계
          </span>
          <span className="fv big">{won(c.f7)}</span>
        </div>
      </div>

      <div className="fee-tot">
        <div className="fr2">
          <span className="fk" style={{ fontWeight: 700 }}>
            C) 보수총계 (A+B+⑦) — 천원 반올림
          </span>
          <span className="fv big">{won(c.C)}</span>
        </div>
      </div>

      <div className="fee-grd">
        <div className="fr2">
          <span className="fk">C) 보수총계</span>
          <span className="fv">{won(c.C)}</span>
        </div>
        <div className="fr2">
          <span className="fk">⑧ 할인금액</span>
          <span className="fv">- {won(c.disc)}</span>
        </div>
        <div className="fr2">
          <span className="fk">⑨ 협의조정금액</span>
          <span className="fv">- {won(c.penFee)}</span>
        </div>
        <div className="fr2">
          <span className="fk">D) 총 보수 합계</span>
          <span className="fv">{won(c.D)}</span>
        </div>
        <div className="fr2">
          <span className="fk">⑩ 부가가치세 (10%)</span>
          <span className="fv">{won(c.VAT)}</span>
        </div>
        <div
          className="fr2"
          style={{ borderTop: '1px solid rgba(255,255,255,.2)', paddingTop: 7, marginTop: 3 }}
        >
          <span className="fk" style={{ fontSize: 13, fontWeight: 600 }}>
            최종 청구금액
          </span>
          <span className="fv" style={{ fontSize: 19 }}>
            {won(c.grand)}
          </span>
        </div>
      </div>
    </>
  );
}
