// 담당자별 연도별 최종청구금액(VAT제외) 변동 라인차트 (SVG)
import type { BillingRecord } from '../../types';

const COLORS = ['#1A2B52', '#C8963C', '#059669', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#65A30D'];

export default function StatsChart({ records }: { records: BillingRecord[] }) {
  const years = [...new Set(records.map((r) => Number(r.fiscalYear)))].sort((a, b) => a - b);
  const managers = [...new Set(records.map((r) => r.manager || '(미지정)'))].sort();
  if (!years.length || !managers.length) {
    return <div style={{ padding: 16, textAlign: 'center', color: '#BBB', fontSize: 12 }}>표시할 데이터 없음</div>;
  }

  // data[manager][year] = sum of 최종청구금액(D, VAT제외)
  const data: Record<string, Record<number, number>> = {};
  managers.forEach((m) => {
    data[m] = {};
    years.forEach((y) => (data[m][y] = 0));
  });
  records.forEach((r) => {
    const m = r.manager || '(미지정)';
    data[m][Number(r.fiscalYear)] = (data[m][Number(r.fiscalYear)] || 0) + (r.D || 0);
  });
  const maxV = Math.max(1, ...managers.flatMap((m) => years.map((y) => data[m][y])));

  const W = 760, H = 320, mL = 64, mR = 130, mT = 16, mB = 36;
  const pw = W - mL - mR;
  const ph = H - mT - mB;
  const xOf = (i: number) => (years.length === 1 ? mL + pw / 2 : mL + (pw * i) / (years.length - 1));
  const yOf = (v: number) => mT + ph - (ph * v) / maxV;
  const fmt = (v: number) =>
    v >= 1e8 ? (v / 1e8).toFixed(1) + '억' : Math.round(v / 1e4).toLocaleString('ko-KR') + '만';
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * maxV);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={mL} y1={yOf(t)} x2={mL + pw} y2={yOf(t)} stroke="#EDE9E2" />
          <text x={mL - 6} y={yOf(t) + 3} textAnchor="end" fontSize="10" fill="#999">
            {fmt(t)}
          </text>
        </g>
      ))}
      {years.map((y, i) => (
        <text key={y} x={xOf(i)} y={H - mB + 18} textAnchor="middle" fontSize="11" fill="#555">
          {y}년
        </text>
      ))}
      {managers.map((m, mi) => {
        const color = COLORS[mi % COLORS.length];
        const pts = years.map((y, i) => `${xOf(i)},${yOf(data[m][y])}`).join(' ');
        return (
          <g key={m}>
            <polyline points={pts} fill="none" stroke={color} strokeWidth={2} />
            {years.map((y, i) => (
              <circle key={y} cx={xOf(i)} cy={yOf(data[m][y])} r={3} fill={color} />
            ))}
            <rect x={mL + pw + 16} y={mT + mi * 18} width={10} height={10} fill={color} />
            <text x={mL + pw + 30} y={mT + mi * 18 + 9} fontSize={11} fill="#333">
              {m}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
