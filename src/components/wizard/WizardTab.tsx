// 청구서 작성 위저드 골격 — 스텝 인디케이터 + 본문 분기 + 이전/다음 (원본 renderWizard)
import { useWizard } from '../../context/WizardContext';
import { STEP_LABELS } from '../../lib/constants';
import { useClients } from '../../hooks/useClients';
import { useBillingData } from '../../hooks/useBillingData';
import { useProfiles } from '../../hooks/useProfiles';
import Step0SelectClient from './Step0SelectClient';
import Step1BasicInfo from './Step1BasicInfo';
import Step2Workload from './Step2Workload';
import Step3FeeReview from './Step3FeeReview';
import Step4Adjust from './Step4Adjust';
import Step5Invoice from './Step5Invoice';

export default function WizardTab() {
  const { step, wizNav, goStep } = useWizard();
  const { clients, loading: clLoading, refresh: refreshClients } = useClients();
  const { records, targets, loading: bdLoading, refresh: refreshBilling } = useBillingData();
  const profiles = useProfiles();

  const loading = clLoading || bdLoading;

  const data = { clients, records, targets, profiles, refreshClients, refreshBilling };

  let body: React.ReactNode;
  if (loading) {
    body = <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>불러오는 중…</div>;
  } else if (step === 1) {
    body = <Step0SelectClient {...data} />;
  } else if (step === 2) {
    body = <Step1BasicInfo {...data} />;
  } else if (step === 3) {
    body = <Step2Workload />;
  } else if (step === 4) {
    body = <Step3FeeReview {...data} />;
  } else if (step === 5) {
    body = <Step4Adjust {...data} />;
  } else {
    body = <Step5Invoice {...data} />;
  }

  return (
    <>
      <div className="steps no-print">
        {STEP_LABELS.map((lbl, i) => {
          const n = i + 1;
          const cls = step > n ? 'done' : step === n ? 'act' : 'idl';
          return (
            <div className="si" key={lbl}>
              <span className={`sn ${cls}`} onClick={() => (step > n ? goStep(n) : undefined)}>
                {step > n ? '✓' : n}
              </span>
              <span className={`sl ${step === n ? 'act' : 'idl'}`}>{lbl}</span>
              {i < STEP_LABELS.length - 1 && <div className="sline" />}
            </div>
          );
        })}
      </div>
      <div>{body}</div>
      <div className="navbar no-print">
        {step > 1 ? (
          <button className="btn-s" onClick={() => wizNav(-1)}>
            ← 이전
          </button>
        ) : (
          <div />
        )}
        {step < STEP_LABELS.length ? (
          <button className="btn-p" onClick={() => wizNav(1)}>
            다음 →
          </button>
        ) : (
          <div />
        )}
      </div>
    </>
  );
}
