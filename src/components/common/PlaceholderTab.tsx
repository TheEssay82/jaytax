// 아직 설계 전인 메뉴의 자리표시 화면 (회계및세무상담시스템 하부메뉴 등)
export default function PlaceholderTab({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="card">
      <div className="chdr">{title}</div>
      <div className="alert-i" style={{ lineHeight: 1.7 }}>
        {desc ?? '이 메뉴는 설계 예정입니다. 곧 제공됩니다.'}
      </div>
    </div>
  );
}
