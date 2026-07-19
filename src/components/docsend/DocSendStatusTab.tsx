// 문서발송 › 발송업무 현황 — 요청·처리 전체 내역 조회(읽기 전용 대시보드)
// 기본은 처리중(미접수+진행중)만, '발송완료'는 상태 필터로만 표시.
import { useEffect, useMemo, useState } from 'react';
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
  if (s === '반송') return { background: '#FEE2E2', color: '#B91C1C' };
  if (s === '재발송요청') return { background: '#FEF3C7', color: '#92400E' };
  if (s === '진행중') return { background: '#DBEAFE', color: '#1E40AF' };
  return { background: '#F3F4F6', color: '#6B7280' };
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
  { v: 'all', label: '전체' },
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
  const [sortBySent, setSortBySent] = useState(false); // false=의뢰일자, true=발송일
  const [sortDir, setSortDir] = useState(-1); // -1 최신순
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

  const counts = useMemo(() => ({
    미접수: ranged.filter((r) => r.status === '미접수').length,
    진행중: ranged.filter((r) => r.status === '진행중').length,
    반송: ranged.filter((r) => r.status === '반송').length,
    재발송요청: ranged.filter((r) => r.status === '재발송요청').length,
    발송완료: ranged.filter((r) => r.status === '발송완료').length,
    재발송완료: ranged.filter((r) => r.status === '재발송완료').length,
    전체: ranged.length,
  }), [ranged]);

  const view = useMemo(() => {
    let list = ranged;
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
  }, [ranged, statusF, workF, reqF, q, sortBySent, sortDir]);

  const attCount = (r: SendRequest) => (r.batchId ? (attByBatch[r.batchId]?.length ?? 0) : 0);

  function toggleSort(bySent: boolean) {
    if (sortBySent === bySent) setSortDir((d) => -d);
    else { setSortBySent(bySent); setSortDir(-1); }
  }
  const sortMark = (bySent: boolean) => (sortBySent === bySent ? (sortDir === -1 ? ' ▼' : ' ▲') : '');

  if (loading) {
    return (
      <div className="card">
        <div className="chdr">📊 발송업무 현황</div>
        <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>불러오는 중…</div>
      </div>
    );
  }

  const tiles: { key: string; label: string; n: number; filter: string; color: string }[] = [
    { key: '미접수', label: '미접수', n: counts.미접수, filter: '미접수', color: '#6B7280' },
    { key: '진행중', label: '진행중', n: counts.진행중, filter: '진행중', color: '#1E40AF' },
    { key: '반송', label: '반송(조치 필요)', n: counts.반송, filter: '반송', color: '#B91C1C' },
    { key: '재발송요청', label: '재발송요청', n: counts.재발송요청, filter: '재발송요청', color: '#92400E' },
    { key: '발송완료', label: `발송완료${counts.재발송완료 ? ` (+재발송 ${counts.재발송완료})` : ''}`, n: counts.발송완료, filter: '발송완료', color: '#065F46' },
    { key: '전체', label: '전체', n: counts.전체, filter: 'all', color: '#1A2B52' },
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
            <div style={{ fontSize: 11, color: '#888' }}>{t.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: t.color }}>{t.n}</div>
          </button>
        ))}
      </div>

      <div className="alert-i" style={{ fontSize: 11 }}>
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
        <span style={{ fontSize: 11, color: '#888' }}>{view.length}건</span>
        <button
          className="btn-sm"
          style={{ fontSize: 11, padding: '2px 8px' }}
          onClick={() => void refresh()}
          disabled={busy}
          title="최신 내역을 다시 불러옵니다"
        >
          {busy ? '⏳' : '🔄'} 새로고침
        </button>
        <button
          className="btn-sm btn-sm-blue"
          style={{ fontSize: 11, padding: '2px 8px' }}
          disabled={view.length === 0}
          onClick={() =>
            exportSendStatus(view, {
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
                fontSize: 11,
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
          style={{ fontSize: 12 }}
          title="시작일"
        />
        <span style={{ fontSize: 11, color: '#888' }}>~</span>
        <input
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => { setTo(e.target.value); setPreset('custom'); }}
          style={{ fontSize: 12 }}
          title="종료일"
        />
        {(from || to) && (
          <button className="btn-sm" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => applyPreset('all')}>
            ✕ 기간해제
          </button>
        )}

        <span style={{ fontSize: 11, color: '#888', marginLeft: 'auto' }}>
          {from || to ? (
            <>
              <b style={{ color: '#1A2B52' }}>{dateBasis === 'sent' ? '발송일' : '의뢰일자'}</b>{' '}
              {from || '처음'} ~ {to || '오늘'} · 이 기간 {counts.전체}건
              {dateBasis === 'sent' && <span style={{ color: '#8a5a00' }}> (미발송 건 제외)</span>}
            </>
          ) : (
            '전체 기간'
          )}
        </span>
      </div>

      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ textAlign: 'center' }}>상태</th>
              <th onClick={() => toggleSort(false)} style={{ cursor: 'pointer' }}>의뢰일자{sortMark(false)}</th>
              <th>의뢰인</th>
              <th>거래처 · 수신자</th>
              <th>업무구분</th>
              <th>송부종류</th>
              <th>문서명</th>
              <th style={{ textAlign: 'center' }}>부수</th>
              <th style={{ textAlign: 'center' }}>날인</th>
              <th style={{ textAlign: 'center' }}>기한</th>
              <th style={{ textAlign: 'center' }}>첨부</th>
              <th onClick={() => toggleSort(true)} style={{ cursor: 'pointer' }}>발송일{sortMark(true)}</th>
              <th>등기번호</th>
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && (
              <tr><td colSpan={13} style={{ textAlign: 'center', color: '#BBB', padding: 24 }}>표시할 발송건이 없습니다.</td></tr>
            )}
            {view.map((r) => (
              <tr key={r.id}>
                <td style={{ textAlign: 'center' }}>
                  <span className="bdg" style={{ fontSize: 10, ...statusStyle(r.status) }}>{r.status}</span>
                  {r.statusNote && (
                    <div
                      style={{ fontSize: 10, color: '#B91C1C', marginTop: 2, maxWidth: 110, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      title={`사유: ${r.statusNote}`}
                    >
                      {r.statusNote}
                    </div>
                  )}
                </td>
                <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{r.requestDate?.replace(/-/g, '.')}</td>
                <td style={{ fontSize: 12 }}>{r.requester}</td>
                <td style={{ fontSize: 12 }}>
                  <b style={{ color: '#1A2B52' }}>{r.companyName}</b>
                  {r.recipientName && <span style={{ color: '#555' }}> · {r.recipientName} {r.recipientTitle}</span>}
                </td>
                <td style={{ fontSize: 12 }}>{r.workType}</td>
                <td style={{ fontSize: 12 }}>{r.sendKind}</td>
                <td style={{ fontSize: 12 }}>
                  {r.docName || <span style={{ color: '#CCC' }}>—</span>}
                  {r.etcRequest && (
                    <div style={{ fontSize: 10.5, color: '#8a5a00', marginTop: 2, whiteSpace: 'pre-wrap' }} title="기타요청사항">📝 {r.etcRequest}</div>
                  )}
                </td>
                <td style={{ textAlign: 'center', fontSize: 12 }}>{r.copies}</td>
                <td style={{ textAlign: 'center', fontSize: 11 }}>{r.sealRequired ? '🔖' : '—'}</td>
                <td style={{ textAlign: 'center', fontSize: 11 }}>{r.deadline === '긴급' ? <b style={{ color: '#dc2626' }}>긴급</b> : r.deadline}</td>
                <td style={{ textAlign: 'center' }}>
                  <button className="btn-sm" style={{ fontSize: 11, padding: '1px 7px', color: attCount(r) ? '#1A2B52' : '#bbb' }} title="첨부파일 보기/다운로드" onClick={() => setAttachFor(r)}>📎 {attCount(r) || ''}</button>
                </td>
                <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{r.sentDate ? r.sentDate.replace(/-/g, '.') : <span style={{ color: '#CCC' }}>—</span>}</td>
                <td>
                  {r.trackingNo ? (
                    <TrackingLink no={r.trackingNo} />
                  ) : <span style={{ color: '#CCC' }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
