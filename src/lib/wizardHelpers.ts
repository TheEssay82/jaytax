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

/** 거래처 참조 (id + 회사명) */
export interface ClientRef {
  id: string;
  companyName: string;
}

/**
 * 기록이 해당 거래처 것인지 — selClientId(id) 우선, 안 맞으면 회사명 보조 매칭.
 * 거래처 삭제·재등록/마이그레이션으로 id가 바뀌어도 회사명으로 연결을 유지한다.
 */
export function recordMatchesClient(r: BillingRecord, client: ClientRef): boolean {
  if (r.selClientId && r.selClientId === client.id) return true;
  return !!client.companyName && r.companyName === client.companyName;
}

/** 해당 연도 '확정(final)' 청구기록 존재 여부 (작성중 draft 는 제외) */
export function isBilled(records: BillingRecord[], year: number | string, client: ClientRef): boolean {
  return records.some(
    (r) => r.status !== 'draft' && String(r.fiscalYear) === String(year) && recordMatchesClient(r, client),
  );
}

/** 해당 연도 '작성중(draft)' 청구기록 존재 여부 */
export function hasDraftRecord(records: BillingRecord[], year: number | string, client: ClientRef): boolean {
  return records.some(
    (r) => r.status === 'draft' && String(r.fiscalYear) === String(year) && recordMatchesClient(r, client),
  );
}

/** 청구대상 확정 여부 */
export function isTarget(targets: Target[], year: number | string, cid: string): boolean {
  return targets.some((t) => String(t.fiscalYear) === String(year) && t.clientId === cid);
}

/** 해당 연도 청구대상 id 목록 */
export function getTargetIds(targets: Target[], year: number | string): string[] {
  return targets.filter((t) => String(t.fiscalYear) === String(year)).map((t) => t.clientId);
}

/**
 * 거래처의 해당 연도 상태 (청구서작성 거래처선택용)
 * - 'billed'   : 그 해 '확정' 청구기록 있음
 * - 'drafting' : 그 해 '작성중(draft)' 기록만 있음 (아직 미확정)
 * - 'lost'     : 상실 연도 이후 (lossYears 최솟값 ≤ year) → 더 이상 거래처 아님
 * - 'pre'      : 첫 활동연도 이전 (year < 첫 매출/청구 연도) → 아직 거래 전(신규 이전)
 * - 'unbilled' : 위에 해당 없는 활성 거래처인데 아직 미청구 → 실제 청구 후보
 */
export type ClientYearStatus = 'billed' | 'drafting' | 'lost' | 'pre' | 'unbilled';
export function clientYearStatus(
  records: BillingRecord[],
  client: Client,
  year: number | string,
): ClientYearStatus {
  const y = Number(year);
  if (isBilled(records, y, client)) return 'billed';
  if (hasDraftRecord(records, y, client)) return 'drafting';
  const ly = (client.lossYears || []).map(Number);
  if (ly.length && y >= Math.min(...ly)) return 'lost';
  const revYears = Object.keys(client.revenues || {}).map(Number);
  const recYears = records.filter((r) => recordMatchesClient(r, client)).map((r) => Number(r.fiscalYear));
  const all = [...revYears, ...recYears];
  if (all.length && y < Math.min(...all)) return 'pre';
  return 'unbilled';
}

/** 신규: 전년도 청구기록 없음 (id+회사명 매칭) */
export function isNewForYear(records: BillingRecord[], client: ClientRef, year: number | string): boolean {
  if (!client.id && !client.companyName) return false;
  const py = String(Number(year) - 1);
  return !records.some((r) => String(r.fiscalYear) === py && recordMatchesClient(r, client));
}

/** 기록이 특정 담당자(본인) 것인지 — managerId(계정) 우선, 없으면 이름 fallback */
export function isOwnRecord(
  r: { managerId?: string | null; manager: string },
  userId: string,
  userName: string,
): boolean {
  if (r.managerId) return r.managerId === userId;
  return (r.manager || '') === userName;
}

/** 담당자 그룹 키 — managerId 우선(없으면 이름). 통계 집계용 */
export function managerGroupKey(r: { managerId?: string | null; manager: string }): string {
  return r.managerId ? 'id:' + r.managerId : 'name:' + (r.manager || '(미지정)');
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
