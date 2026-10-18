// 미수금대장 새 달 — 지난달에 사람이 정한 것을 이어받는다(사용자 2026-10-18).
//
// 대장에는 거래처코드가 없어 상호로만 붙인다(attachEntities). 상호가 안 맞는 줄은 사람이 손으로 붙이거나
// 「우리 건 아님」으로 접는데, 그 결정이 **그 달 줄에만** 남아 다음 달 대장을 올리면 다시 풀려 있었다
// (2026-09: 연결 19줄·제외 15줄을 SQL 로 메웠다). 같은 팀·같은 거래처명의 **가장 최근 달** 결정을 따른다.
//   · 그 달에 접어 두었으면(excluded) → 이번에도 접는다
//   · 상호로 못 붙은 줄 → 이전 달에 붙어 있던 거래처·사업장
//   · 상호로 거래처는 붙었는데 사업장을 못 정한 줄(사업장 여럿) → 이전 달에 같은 거래처로 정해 둔 사업장
import type { ArItem } from './arLedgerApi';

export interface PriorArLink {
  ym: string;
  clientName: string;
  entityId: string | null;
  placeId: string | null;
  excluded: boolean;
}

export interface InheritResult {
  rows: ArItem[];
  /** 이전 달 연결을 받아 붙은 줄 */
  linked: number;
  /** 이전 달 제외를 받아 접힌 줄 */
  excluded: number;
}

export function inheritPrior(rows: ArItem[], prior: PriorArLink[]): InheritResult {
  // 거래처명마다 가장 최근 달의 결정. 같은 달에 여러 줄이면 연결된 줄을 앞세운다.
  const latest = new Map<string, PriorArLink>();
  const latestLinked = new Map<string, PriorArLink>();
  const sorted = [...prior].sort((a, b) => b.ym.localeCompare(a.ym) || Number(!!b.entityId) - Number(!!a.entityId));
  for (const p of sorted) {
    const k = p.clientName.trim();
    if (!k) continue;
    if (!latest.has(k)) latest.set(k, p);
    if (p.entityId && !latestLinked.has(k)) latestLinked.set(k, p);
  }
  let linked = 0, excluded = 0;
  const out = rows.map((r) => {
    const k = r.clientName.trim();
    const last = latest.get(k);
    if (!last) return r;
    if (last.excluded) { excluded++; return { ...r, excluded: true }; }
    const lk = latestLinked.get(k);
    if (!lk) return r;
    if (!r.entityId) { linked++; return { ...r, entityId: lk.entityId, placeId: lk.placeId }; }
    if (!r.placeId && lk.placeId && lk.entityId === r.entityId) { linked++; return { ...r, placeId: lk.placeId }; }
    return r;
  });
  return { rows: out, linked, excluded };
}
