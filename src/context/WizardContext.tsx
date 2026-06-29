// 위저드 전역 상태 — 원본의 단일 S 객체 + step 을 React Context 로 옮긴 것
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { BillingRecord, WizardState } from '../types';
import { makeWizardState, STEP_LABELS } from '../lib/constants';
import { saveDraft } from '../lib/draft';

const STEP_COUNT = STEP_LABELS.length; // 6

interface WizardCtx {
  /** 위저드 입력 상태 (원본 S) */
  S: WizardState;
  /** 부분 갱신 (merge) */
  setS: (patch: Partial<WizardState>) => void;
  /** 전체 교체 (드래프트 복원/기록 불러오기) */
  replaceS: (s: WizardState) => void;
  /** 현재 단계 1..6 */
  step: number;
  setStep: (n: number) => void;
  /** 이전/다음 (원본 wizNav) */
  wizNav: (d: number) => void;
  /** 뒤로만 이동 가능 (원본 goStep) */
  goStep: (n: number) => void;
  savedMsg: boolean;
  setSavedMsg: (b: boolean) => void;
  /** 새 청구서 작성 (연도 유지, 원본 doNewInvoice) */
  resetNew: () => void;
  /** 청구기록을 위저드로 불러와 수정 (원본 loadRec) */
  loadRecord: (rec: BillingRecord) => void;
  /** 수정 중인 기록 id (있으면 저장 시 덮어쓰기, 없으면 신규 저장) */
  editId: string | null;
  /** 수정 모드 해제 */
  clearEdit: () => void;
}

const Ctx = createContext<WizardCtx | undefined>(undefined);

export function WizardProvider({ children }: { children: ReactNode }) {
  const [S, setSState] = useState<WizardState>(makeWizardState);
  const [step, setStep] = useState(1);
  const [savedMsg, setSavedMsg] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const sRef = useRef(S);
  sRef.current = S;

  const setS = useCallback((patch: Partial<WizardState>) => {
    setSState((prev) => ({ ...prev, ...patch }));
    setSavedMsg(false);
  }, []);

  const replaceS = useCallback((s: WizardState) => {
    setSState(s);
    setSavedMsg(false);
  }, []);

  const wizNav = useCallback((d: number) => {
    setStep((s) => Math.max(1, Math.min(STEP_COUNT, s + d)));
    setSavedMsg(false);
  }, []);

  const goStep = useCallback((n: number) => {
    setStep((s) => (n < s ? n : s));
    setSavedMsg(false);
  }, []);

  const resetNew = useCallback(() => {
    setSState((prev) => ({ ...makeWizardState(), fiscalYear: prev.fiscalYear }));
    setStep(1);
    setSavedMsg(false);
    setEditId(null);
  }, []);

  const clearEdit = useCallback(() => setEditId(null), []);

  // 청구기록 → 위저드 S 로 복원 (WizardState 키만 추출) — 원본 loadRec
  const loadRecord = useCallback((rec: BillingRecord) => {
    const fresh = makeWizardState();
    const picked = { ...fresh };
    (Object.keys(fresh) as (keyof WizardState)[]).forEach((k) => {
      const v = (rec as Partial<WizardState>)[k];
      if (v !== undefined) (picked[k] as unknown) = v;
    });
    setSState(picked);
    setStep(3); // 거래처선택·기본정보 건너뛰고 업무량(3단계)부터 편집
    setSavedMsg(false);
    setEditId(rec.id); // 수정 모드: 저장 시 이 기록을 덮어쓴다
  }, []);

  // 업무량 입력 중 자동 임시저장 (step>=2 && 거래처 선택됨)
  useEffect(() => {
    if (step >= 2 && S.selClientId) saveDraft(S, step);
  }, [S, step]);

  return (
    <Ctx.Provider
      value={{
        S,
        setS,
        replaceS,
        step,
        setStep,
        wizNav,
        goStep,
        savedMsg,
        setSavedMsg,
        resetNew,
        loadRecord,
        editId,
        clearEdit,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWizard(): WizardCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWizard must be used within WizardProvider');
  return ctx;
}
