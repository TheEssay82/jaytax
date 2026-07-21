// 조회서발송관리 › 조회현황
// 2025 control sheet 의 '총괄시트' 자리. 다만 숫자를 손으로 적지 않고 조회처에서 집계한다.
// 전자/실물을 나눠 발송·회수를 보여주고, 반송 건은 펼쳐서 사유까지 확인한다.
import { useEffect, useMemo, useState } from 'react';
import {
  listConfirmations,
  listFiscalYears,
  listItemsByYear,
  summarize,
  sumProgress,
  pct,
  defaultFiscalYear,
  type Confirmation,
  type ConfirmItem,
} from '../../lib/confirmApi';
import { exportConfirmationSheet, exportYearSummary } from '../../lib/confirmExcel';
import TrackingLink from '../docsend/TrackingLink';
import ConfirmAuditModal from './ConfirmAuditModal';

export default function ConfirmStatusTab() {
  const [rows, setRows] = useState<Confirmation[]>([]);
  const [items, setItems] = useState<Record<string, ConfirmItem[]>>({});
  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState(defaultFiscalYear());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // 변경이력 — null 이면 닫힘, {id:undefined} 면 연도 전체
  const [auditFor, setAuditFor] = useState<{ id?: string; title: string } | null>(null);

  async function load(y = year) {
    try {
      setError(null);
      const [list, ys, map] = await Promise.all([listConfirmations(y), listFiscalYears(), listItemsByYear(y)]);
      setRows(list);
      setYears(ys);
      setItems(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load(year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const yearOptions = useMemo(() => [...new Set([defaultFiscalYear(), ...years])].sort((a, b) => b - a), [years]);

  const perClient = useMemo(
    () => rows.map((c) => ({ conf: c, progress: summarize(items[c.id] ?? []) })),
    [rows, items],
  );
  const total = useMemo(() => sumProgress(perClient.map((x) => x.progress)), [perClient]);

  /** 반송 건이 있는 거래처만 추린다(조치가 필요한 목록) */
  const returnedList = useMemo(
    () =>
      perClient
        .filter((x) => x.progress.returned > 0)
        .map((x) => ({ conf: x.conf, items: (items[x.conf.id] ?? []).filter((i) => i.collectStatus === '반송') })),
    [perClient, items],
  );

  if (loading) {
    return (
      <div className="card">
        <div className="chdr">📊 조회현황</div>
        <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>불러오는 중…</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="chdr">조회현황</div>

      {error && <div className="alert-w">{error}</div>}

      {/* 연도 전체 요약 */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <Tile label="거래처" main={`${rows.length}곳`} sub={`조회처 ${total.total}건`} color="#1A2B52" />
        <Tile
          label="전체 발송"
          main={`${pct(total.sent, total.total)}%`}
          sub={`${total.sent} / ${total.total}건`}
          color="#1E40AF"
          ratio={pct(total.sent, total.total)}
        />
        <Tile
          label="전체 회수"
          main={`${pct(total.collected, total.sent)}%`}
          sub={`${total.collected} / ${total.sent}건 (발송분 기준)`}
          color="#065F46"
          ratio={pct(total.collected, total.sent)}
        />
        <Tile
          label="전자조회"
          main={`${total.elecSent} / ${total.elecCollected}`}
          sub={`발송 / 회수 · 전체 ${total.elecTotal}건`}
          color="#1E40AF"
        />
        <Tile
          label="실물발송"
          main={`${total.postSent} / ${total.postCollected}`}
          sub={`발송 / 회수 · 전체 ${total.postTotal}건`}
          color="#92400E"
        />
        <Tile
          label="반송(조치 필요)"
          main={`${total.returned}건`}
          sub={total.returned ? '아래에서 사유 확인' : '없음'}
          color={total.returned ? '#B91C1C' : '#9CA3AF'}
        />
      </div>

      <div className="alert-i" style={{ fontSize: 11 }}>
        📊 조회처 한 건씩의 발송·회수 기록에서 <b>자동 집계</b>한 현황입니다(조회 전용).
        회수율은 <b>발송한 건</b>을 분모로 계산합니다. 거래처 행의 <b>⬇</b> 버튼으로 조서를 엑셀로 내려받을 수 있습니다.
      </div>

      <div className="sbar">
        <select value={year} onChange={(e) => { setYear(Number(e.target.value)); setOpenId(null); }}>
          {yearOptions.map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <button className="btn-sm" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => void load()}>🔄 새로고침</button>
        <button
          className="btn-sm btn-sm-blue"
          style={{ fontSize: 11, padding: '2px 8px' }}
          disabled={rows.length === 0}
          onClick={() => void exportYearSummary(year, perClient)}
          title="연도 총괄을 엑셀로 저장합니다"
        >
          ⬇ 총괄 엑셀
        </button>
        <button
          className="btn-sm"
          style={{ fontSize: 11, padding: '2px 8px' }}
          onClick={() => setAuditFor({ title: `${year}년 전체` })}
          title="발송·회수 처리 기록(감사증빙)"
        >
          🕘 변경이력
        </button>
      </div>

      {/* 거래처별 현황 */}
      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>거래처명</th>
              <th style={{ width: 62, textAlign: 'center' }}>조회처</th>
              <th style={{ width: 92, textAlign: 'center' }}>전자 발송/회수</th>
              <th style={{ width: 92, textAlign: 'center' }}>실물 발송/회수</th>
              <th style={{ width: 120, textAlign: 'center' }}>발송률</th>
              <th style={{ width: 120, textAlign: 'center' }}>회수율</th>
              <th style={{ width: 58, textAlign: 'center' }}>반송</th>
              <th style={{ width: 96, textAlign: 'center' }}>최초발송일</th>
              <th style={{ width: 82, textAlign: 'center' }}>조서 · 이력</th>
            </tr>
          </thead>
          <tbody>
            {perClient.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: 'center', color: '#BBB', padding: 24 }}>
                {year}년에 등록된 조회서가 없습니다.
              </td></tr>
            )}
            {perClient.map(({ conf: c, progress: p }) => (
              <tr key={c.id}>
                <td style={{ fontSize: 12.5 }}><b style={{ color: '#1A2B52' }}>{c.companyName}</b></td>
                <td style={{ textAlign: 'center', fontSize: 11.5 }}>{p.total}</td>
                <td style={{ textAlign: 'center', fontSize: 11, color: '#1E40AF' }}>
                  {p.elecTotal ? `${p.elecSent} / ${p.elecCollected}` : <span style={{ color: '#CCC' }}>—</span>}
                </td>
                <td style={{ textAlign: 'center', fontSize: 11, color: '#92400E' }}>
                  {p.postTotal ? `${p.postSent} / ${p.postCollected}` : <span style={{ color: '#CCC' }}>—</span>}
                </td>
                <td><Meter value={pct(p.sent, p.total)} label={`${p.sent}/${p.total}`} color="#1E40AF" /></td>
                <td><Meter value={pct(p.collected, p.sent)} label={`${p.collected}/${p.sent}`} color="#059669" /></td>
                <td style={{ textAlign: 'center' }}>
                  {p.returned > 0
                    ? <b style={{ color: '#B91C1C', fontSize: 12 }}>{p.returned}</b>
                    : <span style={{ color: '#CCC' }}>—</span>}
                </td>
                <td style={{ textAlign: 'center', fontSize: 11 }}>
                  {p.firstSentDate ? p.firstSentDate.replace(/-/g, '.') : <span style={{ color: '#CCC' }}>—</span>}
                </td>
                <td style={{ textAlign: 'center' }}>
                  <div style={{ display: 'flex', gap: 3, justifyContent: 'center' }}>
                    <button
                      className="btn-sm"
                      style={{ fontSize: 10.5, padding: '1px 6px' }}
                      title="이 거래처의 진행현황 조서를 엑셀로 내려받습니다"
                      onClick={() => void exportConfirmationSheet(c, items[c.id] ?? [])}
                    >
                      ⬇
                    </button>
                    <button
                      className="btn-sm"
                      style={{ fontSize: 10.5, padding: '1px 6px' }}
                      title="이 거래처의 발송·회수 처리 기록"
                      onClick={() => setAuditFor({ id: c.id, title: c.companyName })}
                    >
                      🕘
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {perClient.length > 0 && (
              <tr style={{ background: '#FaF8F4', fontWeight: 700 }}>
                <td style={{ fontSize: 12 }}>합계</td>
                <td style={{ textAlign: 'center', fontSize: 11.5 }}>{total.total}</td>
                <td style={{ textAlign: 'center', fontSize: 11, color: '#1E40AF' }}>{total.elecSent} / {total.elecCollected}</td>
                <td style={{ textAlign: 'center', fontSize: 11, color: '#92400E' }}>{total.postSent} / {total.postCollected}</td>
                <td><Meter value={pct(total.sent, total.total)} label={`${total.sent}/${total.total}`} color="#1E40AF" /></td>
                <td><Meter value={pct(total.collected, total.sent)} label={`${total.collected}/${total.sent}`} color="#059669" /></td>
                <td style={{ textAlign: 'center', color: total.returned ? '#B91C1C' : '#CCC' }}>{total.returned || '—'}</td>
                <td colSpan={2}></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {auditFor && (
        <ConfirmAuditModal
          confirmationId={auditFor.id}
          title={auditFor.title}
          onClose={() => setAuditFor(null)}
        />
      )}

      {/* 반송 목록 — 조치가 필요한 건 */}
      {returnedList.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#B91C1C', marginBottom: 6 }}>
            ↪ 반송 — 조치가 필요한 거래처 {returnedList.length}곳 / {total.returned}건
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 30 }}></th>
                <th>거래처명</th>
                <th style={{ width: 80, textAlign: 'center' }}>반송 건수</th>
                <th>반송된 금융기관</th>
              </tr>
            </thead>
            <tbody>
              {returnedList.map(({ conf: c, items: its }) => {
                const open = openId === c.id;
                return (
                  <>
                    <tr key={c.id} style={open ? { background: '#FFF7F7' } : undefined}>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          className="btn-sm"
                          style={{ fontSize: 10, padding: '1px 5px' }}
                          onClick={() => setOpenId(open ? null : c.id)}
                          title="반송 사유 보기"
                        >
                          {open ? '▾' : '▸'}
                        </button>
                      </td>
                      <td style={{ fontSize: 12.5 }}>
                        <b style={{ color: '#1A2B52', cursor: 'pointer' }} onClick={() => setOpenId(open ? null : c.id)}>
                          {c.companyName}
                        </b>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <b style={{ color: '#B91C1C' }}>{its.length}</b>
                      </td>
                      <td style={{ fontSize: 11.5, color: '#666' }}>
                        {its.map((i) => i.institution).join(', ')}
                      </td>
                    </tr>
                    {open && (
                      <tr key={`${c.id}-d`}>
                        <td colSpan={4} style={{ background: '#FFF7F7', padding: 10 }}>
                          <table className="tbl">
                            <thead>
                              <tr>
                                <th style={{ width: 84 }}>구분</th>
                                <th style={{ width: 170 }}>금융기관명</th>
                                <th style={{ width: 84, textAlign: 'center' }}>조회방식</th>
                                <th style={{ width: 168 }}>등기번호</th>
                                <th style={{ width: 92, textAlign: 'center' }}>발송일</th>
                                <th style={{ width: 92, textAlign: 'center' }}>반송일</th>
                                <th>반송 사유</th>
                              </tr>
                            </thead>
                            <tbody>
                              {its.map((it) => (
                                <tr key={it.id}>
                                  <td style={{ fontSize: 11.5 }}>{it.kind}</td>
                                  <td style={{ fontSize: 12 }}><b>{it.institution}</b></td>
                                  <td style={{ textAlign: 'center' }}>
                                    <span
                                      className="bdg"
                                      style={{
                                        fontSize: 10,
                                        ...(it.isElectronic
                                          ? { background: '#DBEAFE', color: '#1E40AF' }
                                          : { background: '#FEF3C7', color: '#92400E' }),
                                      }}
                                    >
                                      {it.isElectronic ? '전자조회' : '실물발송'}
                                    </span>
                                  </td>
                                  <td>{it.isElectronic ? <span style={{ color: '#CCC', fontSize: 11 }}>—</span> : <TrackingLink no={it.trackingNo} />}</td>
                                  <td style={{ textAlign: 'center', fontSize: 11 }}>{it.sentDate?.replace(/-/g, '.') || '—'}</td>
                                  <td style={{ textAlign: 'center', fontSize: 11 }}>{it.collectDate?.replace(/-/g, '.') || '—'}</td>
                                  <td style={{ fontSize: 11.5, color: '#B91C1C' }}>
                                    {it.returnReason || <span style={{ color: '#CCC' }}>사유 미기재</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Tile({ label, main, sub, color, ratio }: {
  label: string; main: string; sub: string; color: string; ratio?: number;
}) {
  return (
    <div style={{ flex: '1 1 150px', minWidth: 140, border: '1px solid #E3DED3', borderRadius: 8, padding: '9px 12px', background: '#fff' }}>
      <div style={{ fontSize: 11, color: '#888' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color }}>{main}</div>
      <div style={{ fontSize: 10.5, color: '#999' }}>{sub}</div>
      {ratio !== undefined && (
        <div style={{ height: 4, background: '#E9EDF3', borderRadius: 3, overflow: 'hidden', marginTop: 5 }}>
          <div style={{ width: `${ratio}%`, height: '100%', background: color }} />
        </div>
      )}
    </div>
  );
}

function Meter({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ flex: 1, height: 7, background: '#E9EDF3', borderRadius: 4, overflow: 'hidden', minWidth: 40 }}>
        <div style={{ width: `${value}%`, height: '100%', background: color }} />
      </div>
      <span style={{ fontSize: 10, color: '#555', whiteSpace: 'nowrap', minWidth: 62 }}>
        {label} ({value}%)
      </span>
    </div>
  );
}
