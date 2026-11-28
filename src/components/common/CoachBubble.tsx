// 말풍선 단계 안내 — **한 번에 하나만** 뜬다(사용자 2026-11-28).
//
// 여러 단계 화면(파일 고르기 → 재무제표 → 기준일 → 맞춰 보기 → 만들기)에서 무엇을 먼저 할지 헷갈린다.
// 그래서 만화 말풍선처럼 **지금 할 단계 하나**만 그 자리 위에 띄우고, 그 단계를 마치면 그 말풍선은
// 사라지고 다음 단계 말풍선이 나타난다. 동시에 여러 개를 띄우지 않는다.
//
// JAYTAX 전체로 넓힐 수 있게 화면에 묶이지 않게 만든다:
//   const step = useCoach('wtb-half', [{ id: 'pick', done: !!prior }, { id: 'fs', done: srcs.length > 0 }, …]);
//   <CoachBubble show={step === 'pick'} n={1} of={6}>반기 정산표를 고르세요</CoachBubble>
// 말풍선은 감싼 요소의 **바로 위**에 붙는다(감싼 쪽이 position: relative 를 가진다 — CoachSpot).
// 「안내 끄기」는 사람마다 그 브라우저에 남는다(localStorage — 막혀 있어도 화면은 그대로).
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

const KEY = 'jaytax.coach.';

function readOff(id: string): boolean {
  try { return localStorage.getItem(KEY + id) === 'off'; } catch { return false; }
}
function writeOff(id: string, off: boolean) {
  try { if (off) localStorage.setItem(KEY + id, 'off'); else localStorage.removeItem(KEY + id); } catch { /* 저장 못 해도 그만 */ }
}

export interface CoachStep { id: string; done: boolean; /** 이 단계를 아예 건너뛴다(조건부 단계) */ skip?: boolean }

/** 지금 할 단계 — 아직 안 끝난 첫 단계. 다 끝났으면 null. */
export function currentStep(steps: CoachStep[]): string | null {
  return steps.find((s) => !s.skip && !s.done)?.id ?? null;
}

/**
 * 단계 목록 → 지금 보일 단계 id. `tour` 는 끄기 열쇠(화면마다 하나) — 꺼 두면 늘 null.
 * 돌려주는 `off`·`setOff` 로 「안내 끄기 / 다시 켜기」를 붙인다.
 */
export function useCoach(tour: string, steps: CoachStep[]): { step: string | null; off: boolean; setOff: (v: boolean) => void } {
  const [off, setOffState] = useState(() => readOff(tour));
  useEffect(() => { setOffState(readOff(tour)); }, [tour]);
  const setOff = (v: boolean) => { writeOff(tour, v); setOffState(v); };
  return { step: off ? null : currentStep(steps), off, setOff };
}

/** 말풍선이 붙을 자리 — 감싼 요소 위에 말풍선을 띄운다. */
export function CoachSpot({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ position: 'relative', ...style }}>{children}</div>;
}

/** 말풍선 하나. `show` 가 참일 때만 그린다(나타날 때 살짝 튀어 오른다). */
export function CoachBubble({ show, n, of, children, onOff }: { show: boolean; n?: number; of?: number; children: ReactNode; onOff?: () => void }) {
  if (!show) return null;
  return (
    <div role="status" aria-live="polite" className="coach-bubble">
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        {n != null && <span className="coach-no">{n}{of ? `/${of}` : ''}</span>}
        <div style={{ flex: 1 }}>{children}</div>
        {onOff && <button type="button" className="coach-off" title="이 화면의 말풍선 안내를 끕니다(다시 켤 수 있음)" onClick={onOff}>안내 끄기</button>}
      </div>
    </div>
  );
}
