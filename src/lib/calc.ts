// 수수료 계산 로직 — 원본 HTML(ver.4.6)의 calcBase / calcS 를 그대로 옮긴 것.
// 결과값이 원본과 1원 단위까지 일치하도록 연산 순서를 보존했습니다.
import type { AppConfig, Bracket, CalcResult, WizardState } from '../types';
import { DEFAULT_CONFIG } from './constants';

/** 콤마 포함 문자열 금액 → 숫자 */
function parseAmount(v: string | undefined): number {
  return parseFloat((v || '0').replace(/,/g, '')) || 0;
}

/**
 * 기준수수료 누진 계산.
 * 첫 구간은 정액(flat), 이후 구간은 누진율(rate). 9.9e15 이상은 ∞로 취급.
 */
export function calcBase(
  rev: number,
  isLaw: boolean,
  cfg: AppConfig = DEFAULT_CONFIG
): { baseFee: number; scale: number; A: number } {
  const B: Bracket[] = isLaw ? cfg.lawBrackets : cfg.perBrackets;
  const tot = B[0].flat ?? 0;
  let prev = B[0].upTo;
  let sc = 0;
  for (let i = 1; i < B.length; i++) {
    if (rev <= prev) break;
    const { upTo, rate } = B[i];
    const uv = upTo == null || upTo >= 9e14 ? Infinity : upTo;
    const cap = isFinite(uv) ? uv : rev;
    const chunk = Math.min(rev, cap) - prev;
    sc += chunk * (rate ?? 0);
    prev = Math.min(rev, cap);
    if (rev <= uv) break;
  }
  return { baseFee: tot, scale: sc, A: tot + sc };
}

/**
 * 청구서 1건 전체 수수료 계산. 원본 calcS() 와 동일.
 */
export function calcS(s: WizardState, cfg: AppConfig = DEFAULT_CONFIG): CalcResult {
  const rev = parseAmount(s.revenue);
  const isLaw = s.bizType === '법인';
  const { baseFee, scale, A } = calcBase(rev, isLaw, cfg);

  const vr = (cfg.방문횟수[s.visitCount] || 0) + (cfg.상담난이도[s.visitDiff] || 0);
  const pr = (cfg.전화횟수[s.phoneCount] || 0) + (cfg.상담난이도[s.phoneDiff] || 0);
  const jr = (cfg.업무해당[s.장부P] || 0) + (cfg.업무량[s.장부A] || 0) + (cfg.업무난이도[s.장부D] || 0);
  const gr = (cfg.업무해당[s.결산P] || 0) + (cfg.업무량[s.결산A] || 0) + (cfg.업무난이도[s.결산D] || 0);
  const zr = (cfg.업무해당[s.조정P] || 0) + (cfg.업무량[s.조정A] || 0) + (cfg.업무난이도[s.조정D] || 0);
  const wr = (cfg.업무해당[s.원가P] || 0) + (cfg.업무량[s.원가A] || 0) + (cfg.업무난이도[s.원가D] || 0);

  const r4 = vr + pr + jr + gr;
  const r5 = wr;
  const r6 = zr;

  // 성실기본수수료: default=CFG기본값, none=0, custom=직접입력
  let modelFee = 0;
  if (s.isModel) {
    const feeMode = s.modelFeeMode || 'default';
    if (feeMode === 'default') modelFee = cfg.성실신고기본;
    else if (feeMode === 'custom') modelFee = parseAmount(s.modelFeeAmt);
    // 'none' → 0
  }

  const f4 = A * r4;
  const f5 = A * r5;
  const f6 = A * r6;
  const Btot = modelFee + f4 + f5 + f6;

  const evFee = cfg.증빙금액[s.evCount] || 0;
  const otherFee = parseAmount(s.otherAmt);
  const penFee = parseAmount(s.penaltyAmt);
  const f7 = evFee + otherFee + penFee;

  const C = Math.round((A + Btot + f7) / 1000) * 1000;
  const disc = parseAmount(s.discAmt);
  const D = C - disc;
  const VAT = Math.round(D * 0.1);

  return {
    rev, isLaw, baseFee, scale, A, modelFee,
    r4, f4, r5, f5, r6, f6, Btot,
    evFee, otherFee, penFee, f7,
    C, disc, D, VAT, grand: D + VAT,
  };
}

// ── 포매팅 헬퍼 (원본 fm/w/pct/dt) ──
export const fm = (n: number): string => Math.round(n).toLocaleString('ko-KR');
export const won = (n: number): string => fm(n) + '원';
export const pct = (n: number): string => (n === 0 ? '0%' : (n * 100).toFixed(1) + '%');
export const dt = (s: string): string => (s ? s.replace(/-/g, '.') : '');
