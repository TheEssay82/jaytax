// 위저드 순수 헬퍼 — 원본 HTML의 거래처/연도 판단 로직 포팅
import type { BillingRecord, Client, WizardState } from '../types';
import type { Target } from './targetsApi';
import { CURRENT_YEAR } from './constants';

/** 귀속연도별 담당자 (없으면 기본 담당자) */
export function getManagerForYear(c: Client | undefined, year: number | string): string {
  if (c?.managers?.[String(year)]) return c.managers[String(year)];
  return c?.manager || '';
}

/** 귀속연도별 성실신고 (없으면 기본 isModel) */
export function isModelForYear(c: Client | undefined, year: number | string): boolean {
  const my = c?.modelYears?.[String(year)];
  if (my !== undefined) return my;
  return c?.isModel || false;
}

/** 청구서작성 Step0 귀속연도 선택지: 데이터 있는 연도 + CY±3 (>=2015, 내림차순) */
export function getWizardYears(clients: Client[], records: BillingRecord[]): number[] {
  const revYears = clients.flatMap((c) => Object.keys(c.revenues || {}).map(Number));
  const histYears = records.map((r) => Number(r.fiscalYear));
  const base = [-3, -2, -1, 0, 1, 2, 3].map((d) => CURRENT_YEAR + d);
  return [...new Set([...revYears, ...histYears, ...base])].filter((y) => y >= 2015).sort((a, b) => b - a);
}

/** 해당 연도 청구기록 존재 여부 */
export function isBilled(records: BillingRecord[], year: number | string, cid: string): boolean {
  return records.some((r) => r.selClientId === cid && String(r.fiscalYear) === String(year));
}

/** 청구대상 확정 여부 */
export function isTarget(targets: Target[], year: number | string, cid: string): boolean {
  return targets.some((t) => String(t.fiscalYear) === String(year) && t.clientId === cid);
}

/** 해당 연도 청구대상 id 목록 */
export function getTargetIds(targets: Target[], year: number | string): string[] {
  return targets.filter((t) => String(t.fiscalYear) === String(year)).map((t) => t.clientId);
}

/** 신규: 전년도 청구기록 없음 */
export function isNewForYear(records: BillingRecord[], cid: string, year: number | string): boolean {
  if (!cid) return false;
  const py = String(Number(year) - 1);
  return !records.some((r) => r.selClientId === cid && String(r.fiscalYear) === py);
}

/** 수동 상실: 거래처에 명시적으로 설정된 상실 연도만 (거래처선택 화면용) */
export function isManualLossYear(clients: Client[], cid: string, year: number | string): boolean {
  const cl = clients.find((c) => c.id === cid);
  return !!cl?.lossYears?.map(Number).includes(Number(year));
}

/** 상실: 수동 플래그 우선, 또는 전년 기록 있고 당해 청구대상 미선택 (청구대상 탭용) */
export function isLossForYear(
  clients: Client[],
  records: BillingRecord[],
  targets: Target[],
  cid: string,
  year: number | string,
): boolean {
  if (!cid) return false;
  const cl = clients.find((c) => c.id === cid);
  if (cl?.lossYears?.map(Number).includes(Number(year))) return true;
  const py = String(Number(year) - 1);
  return (
    records.some((r) => r.selClientId === cid && String(r.fiscalYear) === py) &&
    !isTarget(targets, year, cid)
  );
}

/** 납부기한 자동설정 (법인 4/30, 개인-성실 7/31, 개인-일반 6/30). 이미 입력돼 있으면 유지 */
export function autoPayDatePatch(s: WizardState): Partial<WizardState> {
  if (s.payMonth && s.payDay) return {};
  if (s.bizType === '법인') return { payMonth: '4', payDay: '30' };
  if (s.isModel) return { payMonth: '7', payDay: '31' };
  return { payMonth: '6', payDay: '30' };
}
