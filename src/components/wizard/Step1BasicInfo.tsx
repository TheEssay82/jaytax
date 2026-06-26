// Step 1: 기본정보 — 원본 rStep1 + discardDraft 포팅
import type { BizType } from '../../types';
import { useWizard } from '../../context/WizardContext';
import { makeWizardState } from '../../lib/constants';
import { clearDraft, hasDraft } from '../../lib/draft';
import {
  autoPayDatePatch,
  getManagerForYear,
  isModelForYear,
} from '../../lib/wizardHelpers';
import { getRevForYear } from '../../lib/format';
import type { WizardStepProps } from './stepProps';

export default function Step1BasicInfo({ clients }: WizardStepProps) {
  const { S, setS, replaceS } = useWizard();
  const hasDft = !!(S.selClientId && hasDraft(S.selClientId, S.fiscalYear));

  function changeBizType(bt: BizType) {
    const next = { ...S, bizType: bt, payMonth: '', payDay: '' };
    setS({ bizType: bt, payMonth: '', payDay: '', ...autoPayDatePatch(next) });
  }

  function changeModel(v: boolean) {
    const next = { ...S, isModel: v, payMonth: '', payDay: '' };
    setS({ isModel: v, payMonth: '', payDay: '', ...autoPayDatePatch(next) });
  }

  // 처음부터: 임시저장 삭제 + 거래처 정보 재로드 + 업무량 초기화 (원본 discardDraft)
  function discardDraft() {
    if (!S.selClientId) return;
    clearDraft(S.selClientId, S.fiscalYear);
    const c = clients.find((x) => x.id === S.selClientId);
    if (!c) return;
    const yr = S.fiscalYear;
    const fresh = makeWizardState();
    const rv = getRevForYear(c, yr);
    replaceS({
      ...fresh,
      selClientId: c.id,
      fiscalYear: yr,
      bizType: c.bizType,
      companyName: c.companyName,
      tradeName: c.tradeName,
      taxId: c.taxId,
      repName: c.repName,
      manager: getManagerForYear(c, yr),
      bankAccount: c.bankAccount,
      isModel: isModelForYear(c, yr),
      revenue: rv ? String(rv) : '',
      issuedDate: S.issuedDate,
    });
  }

  const revDisplay = S.revenue ? Number(String(S.revenue).replace(/,/g, '')).toLocaleString('ko-KR') : '';

  return (
    <>
      {hasDft && (
        <div className="draft-banner">
          <span>
            <strong>이전에 입력한 업무량 내용이 복원됐습니다.</strong> 이어서 진행하거나 처음부터 다시
            입력하세요.
          </span>
          <button className="btn-sm" onClick={discardDraft} style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
            🗑 처음부터
          </button>
        </div>
      )}

      <div className="card">
        <div className="chdr">
          사업자 기본정보
          {S.selClientId && (
            <span className="bdg b-on" style={{ marginLeft: 'auto' }}>
              DB에서 불러옴 ({S.fiscalYear}년 귀속)
            </span>
          )}
        </div>
        <div className="frow">
          <span className="fl">
            구분<span className="req">*</span>
          </span>
          <div className="pills">
            <span className={`pill${S.bizType === '법인' ? ' on' : ''}`} onClick={() => changeBizType('법인')}>
              법인
            </span>
            <span className={`pill${S.bizType === '개인' ? ' on' : ''}`} onClick={() => changeBizType('개인')}>
              개인
            </span>
          </div>
        </div>
        <div className="frow">
          <span className="fl">
            담당자<span className="req">*</span>
          </span>
          <input value={S.manager} placeholder="담당자 이름" onChange={(e) => setS({ manager: e.target.value })} />
        </div>
        <div className="frow">
          <span className="fl">귀속연도</span>
          <strong style={{ fontSize: 14, color: '#1A2B52' }}>{S.fiscalYear}년</strong>
        </div>
        <div className="frow">
          <span className="fl">발송일</span>
          <input type="date" value={S.issuedDate} onChange={(e) => setS({ issuedDate: e.target.value })} />
        </div>
      </div>

      <div className="card">
        <div className="chdr">거래처 정보</div>
        <div className="frow">
          <span className="fl">
            회사명<span className="req">*</span>
          </span>
          <input value={S.companyName} placeholder="예: 주식회사 인덕" onChange={(e) => setS({ companyName: e.target.value })} />
        </div>
        <div className="frow">
          <span className="fl">상호명</span>
          <input value={S.tradeName} onChange={(e) => setS({ tradeName: e.target.value })} />
        </div>
        <div className="frow">
          <span className="fl">사업자번호</span>
          <input value={S.taxId} placeholder="000-00-00000" onChange={(e) => setS({ taxId: e.target.value })} />
        </div>
        <div className="frow">
          <span className="fl">
            대표자명<span className="req">*</span>
          </span>
          <input value={S.repName} onChange={(e) => setS({ repName: e.target.value })} />
        </div>
      </div>

      <div className="card">
        <div className="chdr">매출 및 신고 정보</div>
        <div className="frow">
          <span className="fl">
            당기 매출액<span className="req">*</span>
            <br />
            <small style={{ color: '#999' }}>{S.fiscalYear}년 귀속</small>
          </span>
          <input
            value={revDisplay}
            placeholder="숫자만 입력 (예: 500,000,000)"
            onChange={(e) => setS({ revenue: e.target.value.replace(/[^0-9]/g, '') })}
          />
        </div>
        <div className="frow">
          <span className="fl">성실신고</span>
          <div className="pills">
            <span className={`pill${S.isModel ? ' on' : ''}`} onClick={() => changeModel(true)}>
              O 해당
            </span>
            <span className={`pill${!S.isModel ? ' on' : ''}`} onClick={() => changeModel(false)}>
              X 미해당
            </span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="chdr">청구서 발급 정보</div>
        <div className="frow">
          <span className="fl">입금계좌</span>
          <input
            value={S.bankAccount}
            placeholder="신한은행 000-000-000000"
            onChange={(e) => setS({ bankAccount: e.target.value })}
          />
        </div>
        <div className="frow">
          <span className="fl">납부기한</span>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <input
              type="number"
              style={{ width: 52 }}
              value={S.payMonth}
              min={1}
              max={12}
              placeholder="월"
              onChange={(e) => setS({ payMonth: e.target.value })}
            />
            <span style={{ fontSize: 11, color: '#888' }}>월</span>
            <input
              type="number"
              style={{ width: 52 }}
              value={S.payDay}
              min={1}
              max={31}
              placeholder="일"
              onChange={(e) => setS({ payDay: e.target.value })}
            />
            <span style={{ fontSize: 11, color: '#888' }}>일까지</span>
          </div>
        </div>
      </div>
    </>
  );
}
