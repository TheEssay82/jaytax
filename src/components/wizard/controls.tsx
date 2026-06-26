// 위저드 공용 입력 컨트롤 — 원본 pills/ynpills/wsec/help-icon 포팅
import type { ReactNode } from 'react';
import type { WizardState } from '../../types';
import { useWizard } from '../../context/WizardContext';
import { HELP_TEXTS } from '../../lib/constants';

/** 토글 pill 묶음 — 활성값 재클릭 시 첫 옵션으로 리셋 (원본 pills) */
export function Pills({
  value,
  opts,
  onChange,
}: {
  value: string;
  opts: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="pills">
      {opts.map((o) => (
        <span
          key={o}
          className={`pill${value === o ? ' on' : ''}`}
          onClick={() => onChange(value === o ? opts[0] : o)}
        >
          {o}
        </span>
      ))}
    </div>
  );
}

/** O 해당 / X 미해당 (원본 ynpills) */
export function YnPills({ value, onChange }: { value: string; onChange: (v: 'O' | 'X') => void }) {
  return (
    <div className="pills">
      <span className={`pill${value === 'O' ? ' on' : ''}`} onClick={() => onChange('O')}>
        O 해당
      </span>
      <span className={`pill${value === 'X' ? ' on' : ''}`} onClick={() => onChange('X')}>
        X 미해당
      </span>
    </div>
  );
}

/** 설명 툴팁 아이콘 (hover/focus 시 표시) */
export function HelpTooltip({ k }: { k: string }) {
  const txt = HELP_TEXTS[k];
  if (!txt) return null;
  return (
    <span className="help-icon" tabIndex={0}>
      i
      <span className="help-pop">
        <b>{k} 설명</b>
        {txt.split('\n').map((l, i) => (
          <span key={i}>{l || ' '}</span>
        ))}
      </span>
    </span>
  );
}

/** 업무 섹션 (해당여부 → 업무량/난이도) — 원본 wsec */
export function WorkSection({
  title,
  helpKey,
  pKey,
  aKey,
  dKey,
  extra,
}: {
  title: string;
  helpKey?: string;
  pKey: keyof WizardState;
  aKey: keyof WizardState;
  dKey: keyof WizardState;
  extra?: ReactNode;
}) {
  const { S, setS } = useWizard();
  const on = S[pKey] === 'O';
  return (
    <div className="wsec">
      <div className="whdr">
        <span>
          {title}
          {helpKey && <HelpTooltip k={helpKey} />}
        </span>
        <span className={`bdg ${on ? 'b-on' : 'b-off'}`}>{on ? '해당' : '미해당'}</span>
      </div>
      <div className="wbody">
        <div className="wrow">
          <span className="wl">해당여부</span>
          <YnPills value={S[pKey] as string} onChange={(v) => setS({ [pKey]: v } as Partial<WizardState>)} />
        </div>
        {on && (
          <>
            <div className="wrow">
              <span className="wl">업무량</span>
              <Pills
                value={S[aKey] as string}
                opts={['적음', '보통', '많음']}
                onChange={(v) => setS({ [aKey]: v } as Partial<WizardState>)}
              />
            </div>
            <div className="wrow">
              <span className="wl">난이도</span>
              <Pills
                value={S[dKey] as string}
                opts={['쉬움', '보통', '어려움']}
                onChange={(v) => setS({ [dKey]: v } as Partial<WizardState>)}
              />
            </div>
            {extra}
          </>
        )}
      </div>
    </div>
  );
}
