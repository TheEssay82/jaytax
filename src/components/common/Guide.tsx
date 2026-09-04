// 화면 맨 위의 안내문 — **한 줄만 내놓고 나머지는 접는다.**
//
// 왜 필요한가: 안내 상자가 앱 전체에 160개인데, 그중 열여덟 곳이 여섯 줄을 넘었다.
// 수금·미수금은 열일곱 줄이라 표를 보려면 스크롤부터 해야 했다. 설명은 처음 한 번
// 필요하고 그 뒤로는 방해가 된다 — 처음 보는 사람은 펼치고, 매달 보는 사람은 표부터 본다.
//
// 펼침 여부는 **사람마다 그 브라우저에** 남는다. 한 번 펼쳐 두면 다음에도 펼쳐져 있다.
import { useState, type ReactNode } from 'react';

const KEY = 'jaytax.guide.';

/** 저장소가 막혀 있어도(사생활 보호 창 등) 화면은 그대로 떠야 한다. */
function readOpen(id: string | undefined, dflt: boolean): boolean {
  if (!id) return dflt;
  try {
    const v = localStorage.getItem(KEY + id);
    return v === null ? dflt : v === '1';
  } catch { return dflt; }
}
function writeOpen(id: string | undefined, v: boolean) {
  if (!id) return;
  try { localStorage.setItem(KEY + id, v ? '1' : '0'); } catch { /* 저장 못 해도 그만 */ }
}

export interface GuideProps {
  /** 늘 보이는 한 줄. 이 화면이 무엇인지 한 문장으로. */
  summary: ReactNode;
  /** 접히는 나머지. 없으면 접기 자체가 안 나온다. */
  children?: ReactNode;
  /** 접기를 여는 글. 화면 성격에 맞춰 적는다 — '보는 법 자세히' · '셈법 자세히'. */
  label?: string;
  /**
   * 펼침 여부를 기억할 이름. 화면마다 다르게 준다(예: 'receivable').
   * 주지 않으면 기억하지 않는다.
   */
  id?: string;
  /** 처음 열 때 펼쳐 둘지. 기본은 접힘. */
  defaultOpen?: boolean;
  /** 상자 모양 — 일하는 화면은 alert-i, 보고서 화면은 rep-hint. */
  box?: 'alert-i' | 'alert-w' | 'rep-hint';
}

export default function Guide({
  summary, children, label = '자세히', id, defaultOpen = false, box = 'alert-i',
}: GuideProps) {
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));
  return (
    <div className={`${box} guide`}>
      <div className="guide-head">{summary}</div>
      {children && (
        <details
          open={open}
          onToggle={(e) => {
            const v = (e.currentTarget as HTMLDetailsElement).open;
            setOpen(v); writeOpen(id, v);
          }}
        >
          <summary className="guide-more-btn">{label}</summary>
          <div className="guide-more">{children}</div>
        </details>
      )}
    </div>
  );
}
