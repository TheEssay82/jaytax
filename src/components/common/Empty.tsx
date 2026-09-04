// 비어 있을 때 **다음에 할 일**을 함께 내놓는다.
//
// 왜 필요한가: 「…없습니다」가 121곳인데 대부분 그걸로 끝이었다. 그런데 비어 있는 데는
// 두 가지가 있다 —
//   ① **걸러서** 비었다 → 할 일은 <필터 지우기>
//   ② **원래** 없다     → 할 일은 <만들기>
// 둘이 같은 회색 문장이라, 필터를 걸어 둔 것을 잊고 「자료가 없네」로 읽는 일이 생긴다.

export default function Empty(
  { text, hint, action }:
  { text: string; hint?: string; action?: { label: string; onClick: () => void } },
) {
  return (
    <div className="empty">
      <div className="empty-t">{text}</div>
      {hint && <div className="empty-h">{hint}</div>}
      {action && <button className="btn-sm" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}

/** 표 한가운데에 놓을 때 — colSpan 을 받아 한 칸으로 편다. */
export function EmptyRow(
  { colSpan, text, hint, action }:
  { colSpan: number; text: string; hint?: string; action?: { label: string; onClick: () => void } },
) {
  return (
    <tr><td colSpan={colSpan} style={{ padding: 0 }}>
      <Empty text={text} hint={hint} action={action} />
    </td></tr>
  );
}
