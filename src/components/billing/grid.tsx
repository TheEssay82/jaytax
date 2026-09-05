// 청구관리 표 공용 그리드 — 제목행 정렬 · 열별 필터 · 열 너비 조절 · 열 숨김/순서 개인저장.
//
// 거래처관리 쪽 tableKit 의 부품(useTableView·ColFilter·ResizeHandle)을 그대로 쓰되,
// 발행요청 화면들은 열이 많고 합계행이 붙으므로 **열 정의 배열 하나**로 그리도록 묶었다.
// 열을 추가할 때 머리글·본문·합계·colSpan 을 따로 고치다 어긋나는 일을 없애려는 것이다.
import React, { useState } from 'react';
import {
  ColFilter, ResizeHandle, clip, stickyTop, useTableView,
} from '../clients/tableKit';
import { copyTable, downloadCsv, stamp } from '../../lib/tableExport';

export interface GridCol<T> {
  key: string;
  label: string;
  /** 기본 너비(px). 사용자가 조절하면 개인 설정이 우선한다. */
  width?: number;
  /** 숫자 열(우측 정렬 + 숫자 정렬). */
  num?: boolean;
  /** 정렬·필터가 보는 값. 화면 표시와 다를 수 있다(뱃지·버튼이 붙은 열). */
  value: (row: T) => string | number;
  /** 화면에 그릴 내용. 없으면 value 를 그대로 쓴다. */
  cell?: (row: T) => React.ReactNode;
  /** 드롭다운 필터 후보. 주면 '전체/값' 선택, 없으면 텍스트 부분일치. */
  opts?: readonly string[];
  /** 바닥 합계행에 더할 값. */
  sum?: (row: T) => number;
  /**
   * 여러 줄이 들어가는 칸(주소·사유·메모가 아래에 붙는 자리).
   * 기본은 한 줄로 자르고 …으로 줄인다 — 켜면 자르지 않고 줄을 늘린다.
   */
  wrap?: boolean;
  style?: React.CSSProperties;
}

export interface GridSort { key: string; dir: 'asc' | 'desc' }

/**
 * 표 상태 훅 — 정렬·필터·열설정을 들고, 걸러 정렬한 행(rowsView)을 돌려준다.
 * cols 는 매 렌더 새로 만들어도 되지만(행 수가 수십 건), 부모에서 useMemo 하면 더 좋다.
 */
export function useGrid<T>(viewKey: string, cols: GridCol<T>[], rows: T[], defaultSort?: GridSort) {
  const view = useTableView(viewKey);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<GridSort | null>(defaultSort ?? null);

  const ordered = view.orderCols(cols);
  const shown = ordered.filter((c) => !view.isHidden(c.key));

  let rowsView = rows;
  for (const c of cols) {
    const f = (filters[c.key] ?? '').trim().toLowerCase();
    if (!f) continue;
    rowsView = rowsView.filter((r) => {
      const s = String(c.value(r) ?? '').toLowerCase();
      return c.opts ? s === f : s.includes(f);
    });
  }
  if (sort) {
    const c = cols.find((x) => x.key === sort.key);
    if (c) {
      const dir = sort.dir === 'asc' ? 1 : -1;
      rowsView = [...rowsView].sort((a, b) => {
        const x = c.value(a), y = c.value(b);
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
        return String(x).localeCompare(String(y), 'ko') * dir;
      });
    }
  }

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' }));

  return {
    view, ordered, shown, rowsView, sort, toggleSort,
    filters, setFilter: (k: string, v: string) => setFilters((p) => ({ ...p, [k]: v })),
    clearFilters: () => setFilters({}),
    filterCount: Object.values(filters).filter((v) => v.trim()).length,
  };
}

export type GridState<T> = ReturnType<typeof useGrid<T>>;

/**
 * 표를 그대로 복사·내려받는 단추.
 * **보이는 그대로** 나간다 — 숨긴 열은 빠지고, 정렬·필터가 적용된 순서 그대로다.
 * 화면과 다른 것이 나오면 붙여 넣고 나서 다시 맞춰야 하므로 그렇게 맞춘다.
 */
export function GridExport<T>({ grid, name, onMessage, csv = true }: {
  grid: GridState<T>; name: string; onMessage?: (t: string) => void;
  /**
   * CSV 단추를 낼지. **서식까지 갖춘 엑셀 저장이 이미 있는 화면은 false** 로 둔다 —
   * 여기 CSV 로 바꾸면 서식·머리글·시트 구성을 잃어 오히려 나빠진다.
   */
  csv?: boolean;
}) {
  const head = grid.shown.map((c) => c.label);
  const body = () => grid.rowsView.map((r) => grid.shown.map((c) => c.value(r) ?? ''));
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <button className="btn-sm" title="지금 보이는 표를 탭으로 갈라 복사합니다 — 엑셀에 그대로 붙습니다"
        onClick={() => void copyTable(head, body())
          .then(() => onMessage?.(`✓ ${grid.rowsView.length}줄을 복사했습니다`))
          .catch(() => onMessage?.('복사가 막혀 있습니다 — 엑셀 단추를 쓰세요'))}>
        📋 복사
      </button>
      {csv && (
        <button className="btn-sm" title="지금 보이는 표를 CSV 파일로 내려받습니다"
          onClick={() => { downloadCsv(`${name}_${stamp()}`, head, body()); onMessage?.('✓ 내려받았습니다'); }}>
          📥 엑셀
        </button>
      )}
    </span>
  );
}

/**
 * 표 본체. 선택 체크박스 열은 select 를 주면 맨 앞에 붙는다.
 * 합계행은 sum 을 가진 열이 하나라도 있으면 나온다.
 */
export function Grid<T>({ grid, rowKey, select, rowStyle, detail, empty, maxHeight = 340, footerLabel, headBg = '#f4efe4', filterBg = '#faf7f0' }: {
  grid: GridState<T>;
  rowKey: (row: T) => string;
  select?: {
    /** 지금 고른 키 */ picked: Set<string>;
    /** 한 건 토글 */ toggle: (key: string) => void;
    /** 체크박스를 그릴 행(보이는 행 중 고를 수 있는 것) */ selectableKeys: string[];
    /** 머리글 전체선택이 고를 행. 없으면 selectableKeys 전부. */ headerKeys?: string[];
    /** 전체선택/해제 */ setAll: (keys: string[] | null) => void;
  };
  rowStyle?: (row: T) => React.CSSProperties;
  /**
   * 줄 아래에 펼치는 상세.
   *
   * 왜 부품에 두는가: 화면마다 손으로 `colSpan={13}` 을 적고 있었는데, 열을 하나 더하면
   * 그 숫자도 같이 고쳐야 하고 안 고치면 상세 상자가 표 밖으로 삐져나간다.
   * 여기서는 **부품이 지금 보이는 열 수를 알고 있으므로** 저절로 맞는다.
   */
  detail?: {
    /** 이 줄이 지금 펼쳐져 있나. */
    isOpen: (row: T) => boolean;
    /** 펼쳤을 때 아래에 그릴 것. */
    render: (row: T) => React.ReactNode;
    /** 줄을 누르면 펼침/접힘. 주면 줄에 손 모양 커서가 붙는다. */
    onToggle?: (row: T) => void;
  };
  /** 비었을 때. 글 한 줄이어도 되고, 다음에 할 일을 담은 <Empty> 를 넣어도 된다. */
  empty: React.ReactNode;
  maxHeight?: number;
  /** 합계행 맨 왼쪽에 넣을 설명. 없으면 '합계 N건'. */
  footerLabel?: string;
  headBg?: string;
  filterBg?: string;
}) {
  const { view, shown, rowsView, sort, toggleSort, filters, setFilter } = grid;
  const hasSum = shown.some((c) => c.sum);
  const headKeys = select ? (select.headerKeys ?? select.selectableKeys) : [];
  const allPicked = !!select && headKeys.length > 0 && headKeys.every((k) => select.picked.has(k));

  // 표는 maxHeight 를 받아 **일부러 낮게** 둔다 — data-fixed-h 로 fillHeight 가 건드리지 않게 한다.
  return (
    <div className="tbl-scroll" data-fixed-h style={{ overflow: 'auto', maxHeight, border: '1px solid var(--rule-2)', borderRadius: 6 }}>
      <table className="tbl" style={{ tableLayout: 'fixed', width: '100%', fontSize: 'var(--fs-1)' }}>
        <colgroup>
          {select && <col style={{ width: 30 }} />}
          {shown.map((c) => <col key={c.key} style={{ width: view.widthOf(c.key, c.width ?? 90) }} />)}
        </colgroup>
        <thead>
          <tr>
            {select && (
              <th style={{ ...thc, ...stickyTop(0, headBg) }}>
                <input type="checkbox" checked={allPicked} title="보이는 행 전체선택"
                  onChange={() => select.setAll(allPicked ? null : headKeys)} />
              </th>
            )}
            {shown.map((c) => (
              <th key={c.key} onClick={() => toggleSort(c.key)}
                title="클릭: 정렬 · 우측 끝 드래그: 너비 조절 · 더블클릭: 내용에 맞춤"
                style={{
                  ...thc, ...clip, height: 26, cursor: 'pointer', userSelect: 'none',
                  textAlign: c.num ? 'right' : 'left', ...stickyTop(0, headBg),
                }}>
                {c.label}{sort?.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                <ResizeHandle onMouseDown={view.startResize(c.key, view.widthOf(c.key, c.width ?? 90))}
                  onAutoFit={(px) => view.setWidth(c.key, px)} />
              </th>
            ))}
          </tr>
          <tr>
            {select && <th style={{ padding: 2, ...stickyTop(26, filterBg) }}></th>}
            {shown.map((c) => (
              <th key={c.key} style={{ padding: 2, ...stickyTop(26, filterBg) }}>
                <ColFilter opts={c.opts} value={filters[c.key] || ''} onChange={(v) => setFilter(c.key, v)} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowsView.length === 0 && (
            <tr><td colSpan={shown.length + (select ? 1 : 0)}
              style={typeof empty === 'string'
                ? { textAlign: 'center', padding: 20, color: 'var(--ink-4)' }
                : { padding: 0 }}>
              {empty}
            </td></tr>
          )}
          {rowsView.map((r) => {
            const k = rowKey(r);
            const open = detail?.isOpen(r) ?? false;
            return (
              <React.Fragment key={k}>
              <tr
                style={{ ...(detail?.onToggle ? { cursor: 'pointer' } : {}), ...rowStyle?.(r) }}
                onClick={detail?.onToggle ? () => detail.onToggle!(r) : undefined}>
                {select && (
                  <td style={{ textAlign: 'center' }}>
                    {select.selectableKeys.includes(k) || select.picked.has(k) ? (
                      <input type="checkbox" checked={select.picked.has(k)} onChange={() => select.toggle(k)} />
                    ) : null}
                  </td>
                )}
                {shown.map((c) => (
                  <td key={c.key}
                    style={{ ...(c.wrap ? {} : clip), textAlign: c.num ? 'right' : 'left', ...c.style }}>
                    {c.cell ? c.cell(r) : c.value(r)}
                  </td>
                ))}
              </tr>
              {open && (
                // colSpan 은 **지금 보이는 열 수**로 저절로 맞는다 — 열을 숨겨도 어긋나지 않는다.
                <tr>
                  <td colSpan={shown.length + (select ? 1 : 0)} style={{ padding: 0 }}>
                    {detail!.render(r)}
                  </td>
                </tr>
              )}
              </React.Fragment>
            );
          })}
        </tbody>
        {hasSum && (
          <tfoot>
            <tr style={{ background: '#f5efdd', fontWeight: 700, position: 'sticky', bottom: 0 }}>
              {select && <td></td>}
              {shown.map((c, i) => (
                <td key={c.key} style={{ textAlign: c.num ? 'right' : 'left', ...clip }}>
                  {/* 금액은 **반올림해서** 낸다 — 소수를 그냥 더하면 부동소수 오차가 남아
                      「214,926,221.947」 같은 합계가 나온다. */}
                  {c.sum ? Math.round(rowsView.reduce((s, r) => s + (c.sum!(r) || 0), 0)).toLocaleString('ko-KR')
                    : i === 0 ? (footerLabel ?? `합계 ${rowsView.length}건`) : ''}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

const thc: React.CSSProperties = {
  padding: '5px 6px', textAlign: 'left', fontWeight: 700, color: 'var(--ink-2)',
  whiteSpace: 'nowrap', position: 'relative',
};
