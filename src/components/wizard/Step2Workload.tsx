// Step 2: 업무량 — 원본 rStep2 포팅
import { useWizard } from '../../context/WizardContext';
import { DEFAULT_CONFIG } from '../../lib/constants';
import { fm } from '../../lib/format';
import { Pills, WorkSection, HelpTooltip } from './controls';
import type { ModelFeeMode } from '../../types';

const CFG = DEFAULT_CONFIG; // TODO: 설정 탭 포팅 시 DB app_config 연동

export default function Step2Workload() {
  const { S, setS } = useWizard();

  const modelFeeDisplay = (() => {
    const m = S.modelFeeMode || 'default';
    if (!S.isModel) return '해당없음';
    if (m === 'none') return '0원 (미적용)';
    if (m === 'custom') return fm(parseFloat((S.modelFeeAmt || '0').replace(/,/g, '')) || 0) + '원';
    return fm(CFG.성실신고기본) + '원 (기본)';
  })();

  const modeLabel =
    (S.modelFeeMode || 'default') === 'default' ? '기본적용' : S.modelFeeMode === 'none' ? '미적용' : '조정적용';

  return (
    <>
      <div className="wsec">
        <div className="whdr">
          <span>방문 및 전화 상담</span>
        </div>
        <div className="wbody">
          <div className="wrow">
            <span className="wl">
              방문 횟수
              <HelpTooltip k="방문" />
            </span>
            <Pills
              value={S.visitCount}
              opts={['없음', '2회이하', '5회이하', '10회이하', '10회초과']}
              onChange={(v) => setS({ visitCount: v as typeof S.visitCount })}
            />
          </div>
          <div className="wrow">
            <span className="wl">방문 난이도</span>
            <Pills
              value={S.visitDiff}
              opts={['해당없음', '쉬움', '보통', '어려움']}
              onChange={(v) => setS({ visitDiff: v as typeof S.visitDiff })}
            />
          </div>
          <div className="wrow">
            <span className="wl">
              전화 횟수
              <HelpTooltip k="전화" />
            </span>
            <Pills
              value={S.phoneCount}
              opts={['없음', '10회이하', '30회이하', '60회이하', '60회초과']}
              onChange={(v) => setS({ phoneCount: v as typeof S.phoneCount })}
            />
          </div>
          <div className="wrow">
            <span className="wl">전화 난이도</span>
            <Pills
              value={S.phoneDiff}
              opts={['해당없음', '쉬움', '보통', '어려움']}
              onChange={(v) => setS({ phoneDiff: v as typeof S.phoneDiff })}
            />
          </div>
        </div>
      </div>

      <WorkSection title="계약 외 기장업무" helpKey="장부" pKey="장부P" aKey="장부A" dKey="장부D" />
      <WorkSection title="결산업무" helpKey="결산" pKey="결산P" aKey="결산A" dKey="결산D" />
      <WorkSection title="세무조정업무 (회계사 작성)" helpKey="조정" pKey="조정P" aKey="조정A" dKey="조정D" />
      <WorkSection
        title="원가계산"
        helpKey="원가"
        pKey="원가P"
        aKey="원가A"
        dKey="원가D"
        extra={
          S.원가P === 'O' ? (
            <div className="wrow">
              <span className="wl">업무종류</span>
              <input
                value={S.원가T}
                placeholder="원가계산 업무 내용"
                onChange={(e) => setS({ 원가T: e.target.value })}
              />
            </div>
          ) : null
        }
      />

      {S.isModel && (
        <div className="wsec" style={{ borderColor: '#C8963C' }}>
          <div className="whdr" style={{ background: '#FEF3C7' }}>
            <span>성실신고수수료 적용 방식</span>
            <span className="bdg" style={{ background: '#C8963C', color: '#fff' }}>
              {modeLabel}
            </span>
          </div>
          <div className="wbody">
            <div className="wrow">
              <span className="wl">적용방식</span>
              <div className="pills">
                {(
                  [
                    ['default', `① 기본 적용 (${fm(CFG.성실신고기본)}원)`],
                    ['none', '② 미적용'],
                    ['custom', '③ 조정 적용 (직접입력)'],
                  ] as [ModelFeeMode, string][]
                ).map(([mode, lbl]) => (
                  <span
                    key={mode}
                    className={`pill${(S.modelFeeMode || 'default') === mode ? ' on' : ''}`}
                    onClick={() => setS({ modelFeeMode: mode })}
                  >
                    {lbl}
                  </span>
                ))}
              </div>
            </div>
            {S.modelFeeMode === 'custom' && (
              <div className="wrow">
                <span className="wl">조정금액</span>
                <input
                  inputMode="numeric"
                  value={S.modelFeeAmt}
                  placeholder="직접 입력 (숫자만, 예: 1500000)"
                  onChange={(e) => setS({ modelFeeAmt: e.target.value.replace(/[^0-9]/g, '') })}
                  style={{ fontFamily: 'monospace' }}
                />
              </div>
            )}
            <div className="wrow">
              <span className="wl">적용금액</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#C8963C' }}>{modelFeeDisplay}</span>
            </div>
          </div>
        </div>
      )}

      <div className="wsec">
        <div className="whdr">
          <span>증빙업무 및 기타</span>
        </div>
        <div className="wbody">
          <div className="wrow">
            <span className="wl">
              증빙 발행
              <HelpTooltip k="증빙" />
            </span>
            <Pills
              value={S.evCount}
              opts={['없음', '2회이하', '5회이하', '10회이하', '10회초과']}
              onChange={(v) => setS({ evCount: v as typeof S.evCount })}
            />
          </div>
          <div className="wrow">
            <span className="wl">기타 내용</span>
            <input
              value={S.otherContent}
              placeholder="계약 외 추가 업무 내용"
              onChange={(e) => setS({ otherContent: e.target.value })}
            />
          </div>
          <div className="wrow">
            <span className="wl">기타 금액</span>
            <input
              value={S.otherAmt}
              placeholder="가산/감액 금액 (원)"
              onChange={(e) => setS({ otherAmt: e.target.value })}
            />
          </div>
          <div className="wrow">
            <span className="wl">가산세 내용</span>
            <input
              value={S.penaltyContent}
              placeholder="가산세 내용"
              onChange={(e) => setS({ penaltyContent: e.target.value })}
            />
          </div>
          <div className="wrow">
            <span className="wl">가산세 금액</span>
            <input
              value={S.penaltyAmt}
              placeholder="가산세 금액 (원)"
              onChange={(e) => setS({ penaltyAmt: e.target.value })}
            />
          </div>
        </div>
      </div>
    </>
  );
}
