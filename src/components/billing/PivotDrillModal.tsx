// 피벗 셀 하나의 **속내** — 어느 거래처에서 언제 얼마가 나왔는가.
//
// 왜 필요한가: 숫자만 보이고 왜 그런지 볼 방법이 없어 엑셀로 다시 뽑아야 했다.
// 여기서 보는 그 목록이 곧 <b>내려받을 원자료</b>다 — 화면과 파일이 어긋나지 않는다.
import { useMemo } from 'react';
import { useEscape } from '../../lib/useEscape';
import { drill, drillTotal, type SplitLike } from '../../lib/pivotDrill';
import { copyTable, downloadCsv, stamp } from '../../lib/tableExport';
import type { RevenueFact } from '../../lib/revenueStatsApi';

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');

export interface DrillTarget {
  rowName: string | null;
  colName: string | null;
  rowLabel: string;
  colLabel: string;
}

export default function PivotDrillModal({
  facts, row, col, target, onClose, onMessage,
}: {
  facts: RevenueFact[];
  row: SplitLike<RevenueFact>;
  col: SplitLike<RevenueFact>;
  target: DrillTarget;
  onClose: () => void;
  onMessage?: (t: string) => void;
}) {
  useEscape(onClose);

  const rows = useMemo(
    () => drill(facts, row, col, target.rowName, target.colName)
      .sort((a, b) => a.fact.ym.localeCompare(b.fact.ym)
        || b.fact.supply * b.weight - a.fact.supply * a.weight),
    [facts, row, col, target],
  );
  const total = drillTotal(rows);

  const head = ['귀속월', '거래처', '사업장', '매출계정', '매출유형', '담당회계사', '담당직원', '상태', '공급가액', '몫', '이 칸의 금액'];
  const body = () => rows.map((r) => [
    r.fact.ym, r.fact.company, r.fact.place, r.fact.erpAccount, r.fact.typeFull,
    r.fact.cpa, r.fact.shares.map((s) => s.name).join('·'), r.fact.status,
    Math.round(r.fact.supply), r.weight === 1 ? '' : `${Math.round(r.weight * 1000) / 10}%`,
    Math.round(r.fact.supply * r.weight),
  ]);
  const fileName = `매출내역_${[target.rowName, target.colName].filter(Boolean).join('_') || '전체'}`;

  const where = [
    target.rowName !== null ? `${target.rowLabel} ${target.rowName}` : null,
    target.colName !== null ? `${target.colLabel} ${target.colName}` : null,
  ].filter(Boolean).join(' × ') || '전체';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="card rep drill" onClick={(e) => e.stopPropagation()}>
        <div className="rep-title">
          {where}
          <span className="sub">{rows.length}건 · {won(total)}</span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
            <button className="btn-rep"
              onClick={() => void copyTable(head, body())
                .then(() => onMessage?.(`✓ ${rows.length}줄을 복사했습니다`))
                .catch(() => onMessage?.('복사가 막혀 있습니다 — 엑셀 단추를 쓰세요'))}>📋 복사</button>
            <button className="btn-rep"
              onClick={() => { downloadCsv(`${fileName}_${stamp()}`, head, body()); onMessage?.('✓ 내려받았습니다'); }}>
              📥 엑셀
            </button>
            <button className="btn-rep" onClick={onClose}>닫기</button>
          </span>
        </div>

        <div className="rep-hint">
          💡 이 칸에 담긴 청구 한 건 한 건입니다. 공동담당이면 <b>몫만큼만</b> 담깁니다 —
          {' '}그래서 「공급가액」과 「이 칸의 금액」이 다를 수 있습니다.
        </div>

        <div className="tbl-wide">
          <table className="tbl-rep">
            <thead>
              <tr>
                <th style={{ minWidth: 74 }}>귀속월</th>
                <th style={{ minWidth: 150 }}>거래처</th>
                <th style={{ minWidth: 120 }}>사업장</th>
                <th style={{ minWidth: 100 }}>매출계정</th>
                <th style={{ minWidth: 90 }}>담당회계사</th>
                <th style={{ minWidth: 90 }}>담당직원</th>
                <th>공급가액</th>
                <th>몫</th>
                <th>이 칸의 금액</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 22, color: 'var(--ink-4)' }}>
                  이 칸에 담긴 청구가 없습니다.
                </td></tr>
              )}
              {rows.map((r, i) => (
                <tr key={`${r.fact.id}-${i}`}>
                  <td>{r.fact.ym}</td>
                  <td style={{ fontWeight: 600 }}>{r.fact.company}</td>
                  <td>{r.fact.place}</td>
                  <td>{r.fact.erpAccount}</td>
                  <td>{r.fact.cpa}</td>
                  <td>{r.fact.shares.map((s) => s.name).join('·')}</td>
                  <td>{won(r.fact.supply)}</td>
                  <td>{r.weight === 1 ? '—' : `${Math.round(r.weight * 1000) / 10}%`}</td>
                  <td><b>{won(r.fact.supply * r.weight)}</b></td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr>
                  <td>합계 {rows.length}건</td>
                  <td colSpan={7}></td>
                  <td>{won(total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
