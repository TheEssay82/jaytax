// 관리화면의 순위 분석. 원자료(순위표)를 받아 화면에서 계산한다.
//  ① 작품 순위표 — 평균순위(낮을수록 좋음)·1위표·최고/최저·표준편차(의견이 갈린 정도)
//  ② 평가자 × 작품 행렬 — 누가 무엇을 몇 위로 뒀는지
//  ③ 평가자별 성향 — 평균 순위와 얼마나 같은 방향인지(스피어만 상관), 한 줄 평
import type { EssayPiece, RankRow, ReaderRow } from '../../lib/essayApi';

type Props = { pieces: EssayPiece[]; rankings: RankRow[]; readers: ReaderRow[] };

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** 표본표준편차. 표본이 2 미만이면 0. */
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** 순위끼리의 상관(스피어만) — 두 순위가 같으면 1, 정반대면 -1 */
function spearman(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

export default function RankingStats({ pieces, rankings, readers }: Props) {
  const published = pieces.filter((p) => p.status === 'published');
  const voters = [...new Set(rankings.map((r) => r.reader))];
  const rankOf = (reader: string, pieceId: string) =>
    rankings.find((r) => r.reader === reader && r.pieceId === pieceId)?.rank;

  const stats = published
    .map((p) => {
      const rs = rankings.filter((r) => r.pieceId === p.id).map((r) => r.rank);
      return {
        piece: p,
        n: rs.length,
        avg: mean(rs),
        sd: stdev(rs),
        first: rs.filter((r) => r === 1).length,
        best: rs.length ? Math.min(...rs) : 0,
        worst: rs.length ? Math.max(...rs) : 0,
      };
    })
    .sort((a, b) => (a.n === 0 ? 1 : b.n === 0 ? -1 : a.avg - b.avg));

  // 작품별 평균순위를 '전체 의견'으로 보고, 각 평가자가 그것과 얼마나 같은 방향인지
  const avgByPiece = new Map(stats.map((s) => [s.piece.id, s.avg]));
  const voterProfile = voters.map((v) => {
    const ids = published.filter((p) => rankOf(v, p.id) !== undefined);
    const mine = ids.map((p) => rankOf(v, p.id)!);
    const crowd = ids.map((p) => avgByPiece.get(p.id)!);
    const top = published.find((p) => rankOf(v, p.id) === 1);
    const bottom = published.find((p) => rankOf(v, p.id) === published.length);
    return {
      name: v,
      agreement: spearman(mine, crowd),
      top: top?.title ?? '—',
      bottom: bottom?.title ?? '—',
      comment: readers.find((r) => r.name === v)?.comment ?? null,
    };
  });

  const submitted = readers.filter((r) => r.submittedAt).length;
  const reading = readers.filter((r) => !r.submittedAt && r.readCount > 0).length;

  if (published.length === 0) return null;

  return (
    <>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 16, color: '#1A2B52' }}>순위 결과</b>
          <span style={{ fontSize: 12.5, color: '#8a8170' }}>
            순위 제출 {submitted}명 · 읽는 중 {reading}명 · 등록 {readers.length}명
          </span>
        </div>
        <div style={{ fontSize: 12, color: '#9aa0ad', marginBottom: 12 }}>
          평균 순위는 <b>낮을수록 좋습니다</b>. 편차가 크면 호불호가 갈린 글입니다.
        </div>

        {submitted === 0 ? (
          <div style={{ fontSize: 13.5, color: '#8a8170', padding: '10px 0' }}>아직 순위를 낸 사람이 없습니다.</div>
        ) : (
          <table style={table}>
            <thead>
              <tr style={theadRow}>
                <th style={{ ...th, width: 34 }}>#</th>
                <th style={th}>제목</th>
                <th style={{ ...th, width: 92, textAlign: 'right' }}>평균 순위</th>
                <th style={{ ...th, width: 64, textAlign: 'right' }}>1위표</th>
                <th style={{ ...th, width: 92, textAlign: 'right' }}>최고~최저</th>
                <th style={{ ...th, width: 72, textAlign: 'right' }}>편차</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s, i) => (
                <tr key={s.piece.id} style={{ borderTop: '1px solid #eee9dd', background: i === 0 ? '#fbf9f2' : undefined }}>
                  <td style={{ ...td, color: i === 0 ? '#8a5a00' : '#9aa0ad', fontWeight: i === 0 ? 800 : 400 }}>{i + 1}</td>
                  <td style={{ ...td, fontWeight: 600, color: '#1A2B52' }}>{s.piece.title}</td>
                  <td style={num}>{s.n ? s.avg.toFixed(2) : '—'}</td>
                  <td style={num}>{s.first || '—'}</td>
                  <td style={num}>{s.n ? `${s.best} ~ ${s.worst}` : '—'}</td>
                  <td style={{ ...num, color: '#6b7280' }}>{s.n > 1 ? s.sd.toFixed(2) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {voters.length > 0 && (
        <div style={card}>
          <b style={{ fontSize: 16, color: '#1A2B52' }}>평가자별 순위</b>
          <div style={{ fontSize: 12, color: '#9aa0ad', margin: '4px 0 12px' }}>
            가로줄이 한 사람의 순위입니다. 1위는 진하게 표시했습니다.
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ ...table, minWidth: 520 }}>
              <thead>
                <tr style={theadRow}>
                  <th style={{ ...th, width: 110 }}>평가자</th>
                  {stats.map((s) => (
                    <th key={s.piece.id} style={{ ...th, textAlign: 'center', minWidth: 74 }}>
                      {s.piece.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {voters.map((v) => (
                  <tr key={v} style={{ borderTop: '1px solid #eee9dd' }}>
                    <td style={{ ...td, fontWeight: 600, color: '#1A2B52' }}>{v}</td>
                    {stats.map((s) => {
                      const r = rankOf(v, s.piece.id);
                      return (
                        <td
                          key={s.piece.id}
                          style={{
                            ...td,
                            textAlign: 'center',
                            fontVariantNumeric: 'tabular-nums',
                            fontWeight: r === 1 ? 800 : 400,
                            color: r === 1 ? '#8a5a00' : '#3d4756',
                            background: r === 1 ? '#fdf3e0' : undefined,
                          }}
                        >
                          {r ?? '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {voterProfile.length > 0 && (
        <div style={card}>
          <b style={{ fontSize: 16, color: '#1A2B52' }}>평가자 성향과 한 줄 평</b>
          <div style={{ fontSize: 12, color: '#9aa0ad', margin: '4px 0 12px' }}>
            일치도는 그 사람의 순위가 전체 평균과 얼마나 같은 방향인지입니다(1에 가까울수록 다수 의견, 음수면 반대 취향).
          </div>
          <table style={table}>
            <thead>
              <tr style={theadRow}>
                <th style={{ ...th, width: 110 }}>평가자</th>
                <th style={{ ...th, width: 80, textAlign: 'right' }}>일치도</th>
                <th style={th}>1위로 꼽은 글</th>
                <th style={th}>마지막으로 둔 글</th>
              </tr>
            </thead>
            <tbody>
              {voterProfile.map((v) => (
                <tr key={v.name} style={{ borderTop: '1px solid #eee9dd' }}>
                  <td style={{ ...td, fontWeight: 600, color: '#1A2B52' }}>
                    {v.name}
                    {v.comment && (
                      <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 400, marginTop: 4, fontStyle: 'italic' }}>
                        “{v.comment}”
                      </div>
                    )}
                  </td>
                  <td style={{ ...num, color: v.agreement < 0 ? '#b04a3a' : '#3d4756' }}>{v.agreement.toFixed(2)}</td>
                  <td style={td}>{v.top}</td>
                  <td style={{ ...td, color: '#6b7280' }}>{v.bottom}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e8e2d5',
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13.5 };
const theadRow: React.CSSProperties = { textAlign: 'left', color: '#6b7280', fontSize: 12.5 };
const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '9px 8px', verticalAlign: 'top' };
const num: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
