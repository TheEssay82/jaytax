// 불러오는 동안 **화면 모양을 지킨다.**
//
// 왜 필요한가: 열두 화면이 `if (loading) return <div className="card">불러오는 중…</div>` 이었다.
// 탭을 옮길 때마다 제목도 조작줄도 사라졌다가 돌아와 깜빡임이 컸고, 카드 높이가 한 줄로
// 줄었다 늘어나며 화면이 튀었다.
//
// 그래서 **제목은 그대로 두고 표 자리만 회색 뼈대**로 채운다. 무엇을 보고 있는지가
// 이어지고, 높이가 미리 잡혀 있어 다 불러왔을 때 화면이 뛰지 않는다.

export default function Loading(
  { title, rows = 9, rep = false }: { title: string; rows?: number; rep?: boolean },
) {
  return (
    <div className={rep ? 'card rep' : 'card'} aria-busy="true">
      <div className={rep ? 'rep-title' : 'chdr'}>
        {title}
        <span className="skel-note">불러오는 중…</span>
      </div>
      <div className="skel-bar" />
      <div className="skel-tbl">
        {Array.from({ length: rows }, (_, i) => <div key={i} className="skel-row" />)}
      </div>
    </div>
  );
}
