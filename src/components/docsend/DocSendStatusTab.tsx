// 문서발송 › 발송업무 현황 — 요청·처리 전체 내역 조회(읽기 전용 대시보드)
// 기본은 처리중(미접수+진행중)만, '발송완료'는 상태 필터로만 표시.
import { useEffect, useMemo, useState } from 'react';
import { Grid, GridExport, useGrid, type GridCol } from '../billing/grid';
import { ColumnSettings } from '../clients/tableKit';
import Empty from '../common/Empty';
import {
  listSendRequests,
  listAttachments,
  WORK_TYPES,
  DOC_REQUESTERS,
  type SendRequest,
  type SendAttachment,
} from '../../lib/docSendApi';
import AttachmentsModal from './AttachmentsModal';
import TrackingLink from './TrackingLink';
import { exportSendStatus } from '../../lib/docSendExcel';

const statusStyle = (s: string): React.CSSProperties => {
  if (s === '발송완료') return { background: '#D1FAE5', color: '#065F46' };
  if (s === '재발송완료') return { background: '#CFFAFE', color: '#155E75' };
  if (s === '반송') return { background: '#FEE2E2', color: 'var(--bad)' };
  if (s === '재발송요청') return { background: '#FEF3C7', color: 'var(--warn)' };
  if (s === '취소') return { background: '#E5E7EB', color: 'var(--ink-3)' };
  if (s === '진행중') return { background: '#DBEAFE', color: '#1E40AF' };
  return { background: '#F3F4F6', color: 'var(--ink-3)' };
};

// 완결계열(발송완료·재발송완료). 반송은 후속조치가 필요하므로 '처리중'에 포함한다.
const isClosed = (s: string) => s === '발송완료' || s === '재발송완료';

// 상태 필터 옵션 (기본 active = 미접수+진행중+반송+재발송요청)
const STATUS_FILTERS = [
  { v: 'active', label: '처리중 (미접수·진행중·반송·재발송요청)' },
  { v: '미접수', label: '미접수' },
  { v: '진행중', label: '진행중' },
  { v: '반송', label: '반송' },
  { v: '재발송요청', label: '재발송요청' },
  { v: '발송완료', label: '발송완료' },
  { v: '재발송완료', label: '재발송완료' },
  { v: '취소', label: '취소' },
  { v: 'all', label: '전체 (취소 포함)' },
] as const;

export default function DocSendStatusTab() {
  const [reqs, setReqs] = useState<SendRequest[]>([]);
  const [attByBatch, setAttByBatch] = useState<Record<string, SendAttachment[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusF, setStatusF] = useState<string>('active');
  const [workF, setWorkF] = useState('');
  const [reqF, setReqF] = useState('');
  const [q, setQ] = useState('');
  const [sortBySent] = useState(false); // false=의뢰일자, true=발송일
  const [sortDir] = useState(-1); // -1 최신순 (표 안 정렬은 Grid 의 제목행이 맡는다)
  const [attachFor, setAttachFor] = useState<SendRequest | null>(null);

  // 기간 필터 — 기준일(의뢰일자/발송일) + 시작·종료. 비우면 전체 기간.
  const [dateBasis, setDateBasis] = useState<'request' | 'sent'>('request');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [preset, setPreset] = useState('all');

  function applyPreset(p: string) {
    const n = new Date();
    const y = n.getFullYear();
    const m = n.getMonth();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const endOf = (yy: number, mm: number) => iso(new Date(yy, mm + 1, 0)); // 해당 월 말일
    if (p === 'all') { setFrom(''); setTo(''); }
    else if (p === 'thisMonth') { setFrom(iso(new Date(y, m, 1))); setTo(endOf(y, m)); }
    else if (p === 'lastMonth') { setFrom(iso(new Date(y, m - 1, 1))); setTo(endOf(y, m - 1)); }
    else if (p === 'last3m') { setFrom(iso(new Date(y, m - 2, 1))); setTo(endOf(y, m)); }
    else if (p === 'thisYear') { setFrom(`${y}-01-01`); setTo(`${y}-12-31`); }
    else if (p === 'lastYear') { setFrom(`${y - 1}-01-01`); setTo(`${y - 1}-12-31`); }
    setPreset(p);
  }
  const PRESETS = [
    { v: 'all', label: '전체기간' },
    { v: 'thisMonth', label: '이번달' },
    { v: 'lastMonth', label: '지난달' },
    { v: 'last3m', label: '최근3개월' },
    { v: 'thisYear', label: '올해' },
    { v: 'lastYear', label: '작년' },
  ];

  async function load() {
    try {
      setError(null);
      const [r, atts] = await Promise.all([listSendRequests(), listAttachments()]);
      setReqs(r);
      const map: Record<string, SendAttachment[]> = {};
      for (const a of atts) (map[a.batchId] ||= []).push(a);
      setAttByBatch(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    await load();
    setBusy(false);
  }

  // 기간으로 먼저 좁힌다 — 집계 타일도 이 결과 기준이라 선택한 기간의 숫자가 나온다.
  const ranged = useMemo(() => {
    if (!from && !to) return reqs;
    const key = (r: SendRequest) => (dateBasis === 'sent' ? r.sentDate || '' : r.requestDate || '');
    return reqs.filter((r) => {
      const d = key(r);
      if (!d) return false; // 발송일 기준인데 아직 발송 전인 건은 기간 조회에서 제외
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [reqs, dateBasis, from, to]);

  // 취소 건은 업무 집계에서 빼고 본다(필터에서 '취소'/'전체'를 고를 때만 보인다).
  const active = useMemo(() => ranged.filter((r) => r.status !== '취소'), [ranged]);

  const counts = useMemo(() => ({
    미접수: active.filter((r) => r.status === '미접수').length,
    진행중: active.filter((r) => r.status === '진행중').length,
    반송: active.filter((r) => r.status === '반송').length,
    재발송요청: active.filter((r) => r.status === '재발송요청').length,
    발송완료: active.filter((r) => r.status === '발송완료').length,
    재발송완료: active.filter((r) => r.status === '재발송완료').length,
    전체: active.length,
    취소: ranged.length - active.length,
  }), [ranged, active]);

  const view = useMemo(() => {
    let list = statusF === 'all' || statusF === '취소' ? ranged : active;
    if (statusF === 'active') list = list.filter((r) => !isClosed(r.status));
    else if (statusF !== 'all') list = list.filter((r) => r.status === statusF);
    if (workF) list = list.filter((r) => r.workType === workF);
    if (reqF) list = list.filter((r) => r.requester === reqF);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter((r) =>
        [r.companyName, r.recipientName, r.docName, r.sendKind, r.requester, r.trackingNo].some((v) => (v || '').toLowerCase().includes(s)),
      );
    }
    const key = (r: SendRequest) => (sortBySent ? (r.sentDate || '') : r.requestDate) || '';
    return [...list].sort((a, b) => key(a).localeCompare(key(b)) * sortDir);
  }, [ranged, active, statusF, workF, reqF, q, sortBySent, sortDir]);

  const attCount = (r: SendRequest) => (r.batchId ? (attByBatch[r.batchId]?.length ?? 0) : 0);

  /** 열 필터의 상태 후보 — 지금 자료에 실제로 있는 값에서 뽑는다(고정 목록을 또 두면 어긋난다). */
  const statusOpts = useMemo(
    () => [...new Set(view.map((r) => r.status).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')),
    [view],
  );

  // 표는 Grid 한 부품으로 그린다 — 정렬·열 필터·열 숨김/순서·너비·복사/엑셀이 함께 온다.
  // 열이 열셋이라 좁은 화면에서 넘치는데, 그전에는 숨길 방법이 없었다.
  const cols: GridCol<SendRequest>[] = useMemo(() => [
    { key: 'status', label: '상태', width: 92, value: (r) => r.status, opts: statusOpts, wrap: true,
      cell: (r) => (
        <>
          <span className="bdg" style={{ fontSize: 'var(--fs-0)', ...statusStyle(r.status) }}>{r.status}</span>
          {r.statusNote && (
            <div style={{ fontSize: 'var(--fs-0)', color: 'var(--bad)', marginTop: 2 }} title={`사유: ${r.statusNote}`}>
              {r.statusNote}
            </div>
          )}
        </>
      ) },
    { key: 'requestDate', label: '의뢰일자', width: 84, value: (r) => r.requestDate ?? '',
      cell: (r) => r.requestDate?.replace(/-/g, '.') ?? '' },
    { key: 'requester', label: '의뢰인', width: 76, value: (r) => r.requester },
    { key: 'company', label: '거래처 · 수신자', width: 210, wrap: true,
      value: (r) => `${r.companyName}${r.recipientName ? ` ${r.recipientName}` : ''}`,
      cell: (r) => (
        <span title={r.address ? `${r.address}${r.phone ? ` · ☎ ${r.phone}` : ''}` : undefined}>
          <b style={{ color: 'var(--navy)' }}>{r.companyName}</b>
          {r.recipientName && <span style={{ color: 'var(--ink-2)' }}> · {r.recipientName} {r.recipientTitle}</span>}
          {r.address && <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)', marginTop: 1 }}>📮 {r.address}</div>}
        </span>
      ) },
    { key: 'workType', label: '업무구분', width: 92, value: (r) => r.workType },
    { key: 'sendKind', label: '송부종류', width: 92, value: (r) => r.sendKind },
    { key: 'docName', label: '문서명', width: 190, wrap: true, value: (r) => r.docName ?? '',
      cell: (r) => (
        <span title={r.docName || undefined}>
          {r.docName || <span style={{ color: 'var(--ink-4)' }}>—</span>}
          {r.etcRequest && (
            <div style={{ fontSize: 'var(--fs-0)', color: '#8a5a00', marginTop: 2, whiteSpace: 'pre-wrap' }} title="기타요청사항">
              📝 {r.etcRequest}
            </div>
          )}
        </span>
      ) },
    { key: 'copies', label: '부수', width: 50, num: true, value: (r) => r.copies },
    { key: 'seal', label: '날인', width: 50, value: (r) => (r.sealRequired ? '필요' : ''),
      style: { textAlign: 'center' }, cell: (r) => (r.sealRequired ? '🔖' : '—') },
    { key: 'deadline', label: '기한', width: 62, value: (r) => r.deadline ?? '',
      style: { textAlign: 'center' },
      cell: (r) => (r.deadline === '긴급' ? <b style={{ color: 'var(--bad)' }}>긴급</b> : r.deadline) },
    { key: 'att', label: '첨부', width: 54, value: (r) => attCount(r) || '',
      style: { textAlign: 'center' },
      cell: (r) => (
        <button className="btn-sm" style={{ fontSize: 'var(--fs-1)', padding: '1px 7px', color: attCount(r) ? 'var(--navy)' : 'var(--ink-4)' }}
          title="첨부파일 보기/다운로드" onClick={() => setAttachFor(r)}>📎 {attCount(r) || ''}</button>
      ) },
    { key: 'sentDate', label: '발송일', width: 84, value: (r) => r.sentDate ?? '',
      cell: (r) => (r.sentDate ? r.sentDate.replace(/-/g, '.') : <span style={{ color: 'var(--ink-4)' }}>—</span>) },
    { key: 'tracking', label: '등기번호', width: 130, value: (r) => r.trackingNo ?? '',
      cell: (r) => (r.trackingNo ? <TrackingLink no={r.trackingNo} /> : <span style={{ color: 'var(--ink-4)' }}>—</span>) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [attByBatch, statusOpts]);
  const grid = useGrid('docsend-status', cols, view, { key: 'requestDate', dir: 'desc' });
  const tblH = Math.max(260, Math.round(window.innerHeight * 0.52));

  if (loading) {
    return (
      <div className="card">
        <div className="chdr">📊 발송업무 현황</div>
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>불러오는 중…</div>
      </div>
    );
  }

  const tiles: { key: string; label: string; n: number; filter: string; color: string }[] = [
    { key: '미접수', label: '미접수', n: counts.미접수, filter: '미접수', color: 'var(--ink-3)' },
    { key: '진행중', label: '진행중', n: counts.진행중, filter: '진행중', color: '#1E40AF' },
    { key: '반송', label: '반송(조치 필요)', n: counts.반송, filter: '반송', color: 'var(--bad)' },
    { key: '재발송요청', label: '재발송요청', n: counts.재발송요청, filter: '재발송요청', color: 'var(--warn)' },
    { key: '발송완료', label: `발송완료${counts.재발송완료 ? ` (+재발송 ${counts.재발송완료})` : ''}`, n: counts.발송완료, filter: '발송완료', color: '#065F46' },
    ...(counts.취소 > 0 ? [{ key: '취소', label: '취소', n: counts.취소, filter: '취소', color: 'var(--ink-3)' }] : []),
    { key: '전체', label: '전체', n: counts.전체, filter: 'all', color: 'var(--navy)' },
  ];

  return (
    <div className="card">
      <div className="chdr">발송업무 현황</div>

      {error && <div className="alert-w">{error}</div>}

      {/* 요약 타일 (클릭 시 해당 상태로 필터) */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        {tiles.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatusF(t.filter)}
            style={{
              flex: '1 1 120px', minWidth: 110, textAlign: 'left', cursor: 'pointer',
              border: `1px solid ${statusF === t.filter ? t.color : '#E3DED3'}`, borderRadius: 8, padding: '10px 12px',
              background: statusF === t.filter ? '#FaF8F4' : '#fff',
            }}
          >
            <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>{t.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: t.color }}>{t.n}</div>
          </button>
        ))}
      </div>

      <div className="alert-i" style={{ fontSize: 'var(--fs-1)' }}>
        📊 발송요청·처리 전체 내역입니다(조회 전용). 기본은 <b>처리중(미접수·진행중·반송·재발송요청)</b>만 표시되며, <b>발송완료·재발송완료</b>는 상태 필터에서 선택하면 나타납니다. <b>반송</b>은 요청자가 <b>재발송요청</b>을 올려야 하는 건, <b>재발송요청</b>은 처리자가 다시 발송해야 하는 건이라 처리중에 함께 표시됩니다. 실제 처리는 <b>‘발송요청 처리’</b>에서 합니다.
      </div>

      <div className="sbar">
        <input placeholder="🔍 거래처·수신자·문서명·등기번호·의뢰인" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)}>
          {STATUS_FILTERS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
        </select>
        <select value={workF} onChange={(e) => setWorkF(e.target.value)}>
          <option value="">업무구분 전체</option>
          {WORK_TYPES.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        <select value={reqF} onChange={(e) => setReqF(e.target.value)}>
          <option value="">의뢰인 전체</option>
          {DOC_REQUESTERS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>{view.length}건</span>
        <button
          className="btn-sm"
          style={{ fontSize: 'var(--fs-1)', padding: '2px 8px' }}
          onClick={() => void refresh()}
          disabled={busy}
          title="최신 내역을 다시 불러옵니다"
        >
          {busy ? '⏳' : '🔄'} 새로고침
        </button>
        <button
          className="btn-sm btn-sm-blue"
          style={{ fontSize: 'var(--fs-1)', padding: '2px 8px' }}
          disabled={view.length === 0}
          onClick={() =>
            void exportSendStatus(view, {
              basis: dateBasis === 'sent' ? '발송일' : '의뢰일자',
              from,
              to,
              statusLabel: STATUS_FILTERS.find((s) => s.v === statusF)?.label ?? statusF,
            })
          }
          title="지금 화면에 보이는 목록(필터·정렬 그대로)을 엑셀로 저장합니다"
        >
          ⬇ 엑셀
        </button>
        {/* 서식 있는 엑셀은 위에 그대로 두고, 표를 그대로 옮기는 복사와 열 설정만 더한다. */}
        <GridExport grid={grid} name="발송업무현황" csv={false} />
        <ColumnSettings cols={grid.ordered} view={grid.view} />
        {grid.filterCount > 0 && (
          <button className="btn-sm" onClick={grid.clearFilters}>열 필터 지우기 ({grid.filterCount})</button>
        )}
      </div>

      {/* 기간 필터 — 과거 기록 조회용. 기준일을 발송일로 바꾸면 실제 발송된 시점으로 집계된다. */}
      <div
        className="sbar"
        style={{ marginTop: 6, alignItems: 'center', flexWrap: 'wrap', gap: 6 }}
      >
        <select
          value={dateBasis}
          onChange={(e) => setDateBasis(e.target.value as 'request' | 'sent')}
          title="기간을 어떤 날짜로 따질지 선택합니다"
        >
          <option value="request">기준일: 의뢰일자</option>
          <option value="sent">기준일: 발송일</option>
        </select>

        <div style={{ display: 'flex', gap: 3 }}>
          {PRESETS.map((p) => (
            <button
              key={p.v}
              className="btn-sm"
              onClick={() => applyPreset(p.v)}
              style={{
                fontSize: 'var(--fs-1)',
                padding: '2px 8px',
                background: preset === p.v ? '#1A2B52' : '#fff',
                color: preset === p.v ? '#fff' : '#555',
                fontWeight: preset === p.v ? 700 : 400,
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <input
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => { setFrom(e.target.value); setPreset('custom'); }}
          style={{ fontSize: 'var(--fs-2)' }}
          title="시작일"
        />
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>~</span>
        <input
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => { setTo(e.target.value); setPreset('custom'); }}
          style={{ fontSize: 'var(--fs-2)' }}
          title="종료일"
        />
        {(from || to) && (
          <button className="btn-sm" style={{ fontSize: 'var(--fs-1)', padding: '2px 8px' }} onClick={() => applyPreset('all')}>
            ✕ 기간해제
          </button>
        )}

        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginLeft: 'auto' }}>
          {from || to ? (
            <>
              <b style={{ color: 'var(--navy)' }}>{dateBasis === 'sent' ? '발송일' : '의뢰일자'}</b>{' '}
              {from || '처음'} ~ {to || '오늘'} · 이 기간 {counts.전체}건
              {dateBasis === 'sent' && <span style={{ color: '#8a5a00' }}> (미발송 건 제외)</span>}
            </>
          ) : (
            '전체 기간'
          )}
        </span>
      </div>

      <Grid grid={grid} rowKey={(r) => r.id} maxHeight={tblH}
        empty={<Empty text="표시할 발송건이 없습니다"
          hint={grid.filterCount > 0 ? '열 아래 칸에 넣은 값으로 걸러서 비었습니다.' : '기간이나 조건을 바꿔 보세요.'}
          action={grid.filterCount > 0 ? { label: '열 필터 지우기', onClick: grid.clearFilters } : undefined} />} />

      {attachFor && (
        <AttachmentsModal
          req={attachFor}
          attachments={attachFor.batchId ? attByBatch[attachFor.batchId] ?? [] : []}
          shared={false}
          canWrite={false}
          onClose={() => setAttachFor(null)}
          onChanged={async () => { await load(); }}
        />
      )}
    </div>
  );
}
