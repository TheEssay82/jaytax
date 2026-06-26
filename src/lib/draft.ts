// 업무량 입력 임시저장 (localStorage, 거래처+연도별) — 원본 saveDraft/loadDraft 포팅
import type { WizardState } from '../types';

const DPFX = 'ind_dft_';
const key = (cid: string, yr: number | string) => `${DPFX}${cid}_${yr}`;

export interface DraftState extends WizardState {
  _step?: number;
}

export function saveDraft(s: WizardState, step: number): void {
  if (!s.selClientId || step < 2) return;
  try {
    localStorage.setItem(key(s.selClientId, s.fiscalYear), JSON.stringify({ ...s, _step: step }));
  } catch {
    /* 용량 초과 등 무시 */
  }
}

export function loadDraft(cid: string, yr: number | string): DraftState | null {
  try {
    const d = localStorage.getItem(key(cid, yr));
    return d ? (JSON.parse(d) as DraftState) : null;
  } catch {
    return null;
  }
}

export function clearDraft(cid: string, yr: number | string): void {
  localStorage.removeItem(key(cid, yr));
}

export function hasDraft(cid: string, yr: number | string): boolean {
  return !!localStorage.getItem(key(cid, yr));
}
