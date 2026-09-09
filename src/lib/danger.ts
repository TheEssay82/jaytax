/**
 * 되돌릴 수 없는 확인 — **판단 규칙만**.
 *
 * 왜 따로 세우는가: 브라우저 기본 `confirm()` 은 「청구예정에서 3건을 지웁니다」와
 * 「보존기간이 지난 1,240건을 파기합니다」가 **생김새가 똑같다**. 글도 길면 잘린다.
 * 손이 먼저 움직이는 자리라, 무게가 다른 일은 화면도 달라야 한다.
 *
 * 여기에는 화면이 없다 — `<DangerConfirm/>` 이 이 규칙을 그려 쓴다.
 * 순수 함수라 `tsx --test` 로 바로 부를 수 있다.
 */

/** 확인창의 무게. `purge` 만 **글자를 받아 적게** 한다. */
export type DangerLevel =
  /** 지운 것을 다시 만들 수 있다 — 붉은 창에 이름만 확인. */
  | 'delete'
  /** 여러 건을 한 번에 — 몇 건인지 눈으로 세게 한다. */
  | 'bulk'
  /** 파기·영구삭제·초기화 — 대상 이름을 **그대로 받아 적어야** 열린다. */
  | 'purge';

export interface DangerAsk {
  /** 무슨 일이 일어나는지 한 줄. 「삭제할까요?」가 아니라 「거래처를 삭제합니다」. */
  title: string;
  /** 무게. 기본 'delete'. */
  level?: DangerLevel;
  /** 대상 이름 — **눈으로 확인하는 자리**. 한 건이면 여기. */
  target?: string;
  /** 여러 건이면 여기. 목록으로 보여 주고 많으면 접는다. */
  targets?: string[];
  /** 함께 일어나는 일 — 「사업장·담당자·대표이사가 함께 삭제됩니다」. */
  detail?: string;
  /**
   * 받아 적어야 하는 글자. `level: 'purge'` 이면서 비워 두면 `target` 을 쓴다.
   * target 도 없으면 '파기'.
   */
  confirmWord?: string;
  /** 진행 버튼 글자. 기본 '삭제합니다'. */
  okLabel?: string;
}

/** 목록을 몇 개까지 펼쳐 보일지. 넘으면 「외 N건」으로 접는다. */
export const LIST_CAP = 8;

/** 앞뒤 공백을 떼고 사이 공백은 하나로 — 받아 적을 때 공백 하나로 막히면 억울하다. */
export function normalize(s: string): string {
  return String(s ?? '').trim().replace(/\s+/g, ' ');
}

/** 이 확인창이 글자를 받아 적게 하는가. */
export function needsTyping(ask: DangerAsk): boolean {
  return ask.level === 'purge';
}

/**
 * 받아 적어야 하는 글자.
 *
 * `confirmWord` → `target` → '파기' 순. 대상 이름을 그대로 쓰게 하는 것이 핵심이라
 * (「예」나 「DELETE」가 아니라) 손이 아니라 **눈이 한 번 더 지나가게** 된다.
 */
export function wordToType(ask: DangerAsk): string {
  return normalize(ask.confirmWord || ask.target || '파기');
}

/** 진행 버튼을 열어도 되는가. 받아 적을 필요가 없으면 언제나 열려 있다. */
export function canProceed(ask: DangerAsk, typed: string): boolean {
  if (!needsTyping(ask)) return true;
  return normalize(typed) === wordToType(ask);
}

/** 목록에서 화면에 펼칠 몫과 접을 개수. */
export function splitList(targets: string[] | undefined, cap = LIST_CAP): { shown: string[]; more: number } {
  const all = (targets ?? []).filter((t) => normalize(t));
  return { shown: all.slice(0, cap), more: Math.max(0, all.length - cap) };
}

/**
 * 대상을 한 줄로. 한 건이면 이름, 여럿이면 「첫 이름 외 N건」, 없으면 빈 문자열.
 * 확인창 제목 아래에 굵게 놓는 줄이다.
 */
export function targetLine(ask: DangerAsk): string {
  if (normalize(ask.target || '')) return normalize(ask.target!);
  const all = (ask.targets ?? []).filter((t) => normalize(t));
  if (!all.length) return '';
  if (all.length === 1) return normalize(all[0]);
  return `${normalize(all[0])} 외 ${all.length - 1}건`;
}
