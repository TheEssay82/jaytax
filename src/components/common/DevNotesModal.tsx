// 개발노트 팝업 — 헤더의 버전 배지를 클릭하면 뜬다. 버전별 개발내역을 최신순으로 보여준다.
//  데이터는 src/lib/changelog.ts (리포 코드). 최초 화면(홈 대시보드)이 생기면 이 목록을 위젯으로도 재사용 예정.
import { CHANGELOG, LATEST_VERSION } from '../../lib/changelog';

export default function DevNotesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-box"
        style={{ maxWidth: 560, width: '92vw', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          📓 개발노트
          <span style={{ fontSize: 11, fontWeight: 600, color: '#9aa0ad' }}>현재 v{LATEST_VERSION}</span>
          <button className="btn-s" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>

        <div style={{ overflowY: 'auto', marginTop: 4, paddingRight: 2 }}>
          {CHANGELOG.map((e, i) => (
            <div
              key={e.version}
              style={{
                padding: '12px 2px',
                borderTop: i === 0 ? 'none' : '1px solid #ece8df',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span
                  className="bdg"
                  style={{
                    fontSize: 11, fontWeight: 700,
                    color: i === 0 ? '#1A6E3C' : '#1A2B52',
                    background: i === 0 ? '#eafaef' : '#eef2fb',
                    border: `1px solid ${i === 0 ? '#bfe6cc' : '#cdd8ef'}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  v{e.version}
                </span>
                <span style={{ fontWeight: 700, color: '#1f2937' }}>{e.title}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#9aa0ad', whiteSpace: 'nowrap' }}>{e.date}</span>
              </div>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {e.highlights.map((h, j) => (
                  <li key={j} style={{ fontSize: 12.5, color: '#4b5563', lineHeight: 1.55 }}>{h}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
