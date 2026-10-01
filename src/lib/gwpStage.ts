// 일반조서 단계 — 실무 순서대로 세 번 확정한다(사용자 2026-09-27). 순수 모듈.
//
//   1차 = 중간감사 전(계획) — 심리실이 중간감사 전에 계획조서 확정을 요구하는 경우가 많다.
//   2차 = 중간감사 후(기말감사 전)
//   3차 = 기말감사 완료 후
// 「계획/중간/기말」 절차명만 쓰면 헷갈린다 — 화면에서는 「1차 확정 · 중간감사 전」처럼 차수와 시점을 함께 쓴다.
//
// 확정 기록(gwp_stage_event)은 쌓기만 한다. 단계의 지금 상태는 그 단계의 마지막 줄이다.

export type StageNo = 1 | 2 | 3;

export const STAGES: { no: StageNo; label: string; when: string }[] = [
  { no: 1, label: '1차 확정', when: '중간감사 전(계획)' },
  { no: 2, label: '2차 확정', when: '중간감사 후' },
  { no: 3, label: '3차 확정', when: '기말감사 완료 후' },
];

export interface StageEvent {
  stage: StageNo;
  action: '확정' | '확정 취소';
  bookVersion: number | null;
  reason: string | null;
  createdEmail: string | null;
  createdAt: string;
}

export interface StageState {
  no: StageNo;
  confirmed: boolean;
  /** 확정한 판 */ version: number | null;
  at: string | null;
  by: string | null;
  /** 마지막 확정 취소 사유(다시 확정 전) */ reopenReason: string | null;
}

/** 확정 기록 → 단계마다 지금 상태. 기록 순서와 상관없이 시각으로 가린다. */
export function stageStates(events: StageEvent[]): StageState[] {
  return STAGES.map(({ no }) => {
    const mine = events.filter((e) => e.stage === no).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const last = mine[mine.length - 1];
    if (!last) return { no, confirmed: false, version: null, at: null, by: null, reopenReason: null };
    if (last.action === '확정') return { no, confirmed: true, version: last.bookVersion, at: last.createdAt, by: last.createdEmail, reopenReason: null };
    return { no, confirmed: false, version: null, at: null, by: null, reopenReason: last.reason };
  });
}

/** 지금 할 단계 — 확정 안 된 첫 단계. 모두 확정이면 null. */
export function currentStage(states: StageState[]): StageNo | null {
  return states.find((s) => !s.confirmed)?.no ?? null;
}

/**
 * 이 단계를 확정할 수 있는가 — 앞 단계가 확정돼 있어야 하고, 그 단계의 웹 조서가 모두 「확인」(엑셀에 반영)
 * 또는 「엑셀로 넘김」이어야 한다. 못 하면 까닭을 돌려준다.
 */
export function confirmBlockers(
  no: StageNo, states: StageState[], papers: { code: string; title: string; stage: StageNo; status: string | null }[],
): string[] {
  const out: string[] = [];
  const prev = states.find((s) => s.no === no - 1);
  if (prev && !prev.confirmed) out.push(`${STAGES[prev.no - 1].label}(${STAGES[prev.no - 1].when})을 먼저 하세요.`);
  for (const p of papers.filter((x) => x.stage === no)) {
    if (p.status !== '확인' && p.status !== '엑셀로 넘김') out.push(`${p.code} ${p.title} — 아직 엑셀에 반영하지 않았습니다.`);
  }
  return out;
}

/** 이 단계의 웹 조서를 고칠 수 있는가 — 확정된 단계는 잠긴다(확정 취소하면 풀린다). */
export function stageLocked(no: StageNo, states: StageState[]): boolean {
  return states.find((s) => s.no === no)?.confirmed ?? false;
}

// ── 거래처 목록의 진행 정도(사용자 2026-10-01 「세팅 전과 진행 정도에 따라 색깔 구분」) ─────────
export interface Progress { key: 'none' | 'setup' | 'draft' | 'stage1' | 'stage2' | 'stage3'; label: string; color: string; rank: number }
export const PROGRESS: Record<Progress['key'], Omit<Progress, 'key'>> = {
  none: { label: '세팅 전', color: '#9AA0A6', rank: 0 },
  setup: { label: '세팅 · 판 없음', color: '#E0A100', rank: 1 },
  draft: { label: '작성 중 · 1차 전', color: '#2F7BD8', rank: 2 },
  stage1: { label: '1차 확정', color: '#12A38A', rank: 3 },
  stage2: { label: '2차 확정', color: '#2E8B3E', rank: 4 },
  stage3: { label: '3차 확정 · 완료', color: '#1F3A68', rank: 5 },
};
/** 세팅 여부·판 수·확정된 단계 → 진행 정도. 확정은 1차부터 이어진 것만 센다(1차 취소 뒤 2차만 남는 일은 없지만). */
export function progressOf(setup: boolean, books: number, confirmed: StageNo[]): Progress {
  let top = 0;
  while (confirmed.includes((top + 1) as StageNo)) top += 1;
  const key: Progress['key'] = !setup ? 'none' : top >= 3 ? 'stage3' : top === 2 ? 'stage2' : top === 1 ? 'stage1' : books > 0 ? 'draft' : 'setup';
  return { key, ...PROGRESS[key] };
}
