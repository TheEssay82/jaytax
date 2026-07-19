// 등기번호 → 우체국 배달조회 링크. 발송요청·처리·현황 세 탭에서 공용으로 쓴다.
import { epostTrackingUrl } from '../../lib/docSendApi';

export default function TrackingLink({ no }: { no: string }) {
  if (!no) return <span style={{ color: '#CCC' }}>—</span>;
  return (
    <button
      className="btn-sm btn-sm-blue"
      style={{ fontSize: 11, padding: '1px 6px' }}
      title="우체국 배달조회 (새 창)"
      onClick={() => window.open(epostTrackingUrl(no), '_blank', 'noopener')}
    >
      🔎 {no}
    </button>
  );
}
