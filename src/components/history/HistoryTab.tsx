// 청구기록 탭 — 원본 rHistory 포팅 (목록·필터·정렬·상세펼침·수정·삭제·청구서 PDF)
import { useEffect, useMemo, useState } from 'react';
import Loading from '../common/Loading';
import { Grid, GridExport, useGrid, type GridCol } from '../billing/grid';
import { ColumnSettings } from '../clients/tableKit';
import Empty from '../common/Empty';
import { createPortal } from 'react-dom';
import type { BillingRecord } from '../../types';
import { useBillingData } from '../../hooks/useBillingData';
import { useWizard } from '../../context/WizardContext';
import { useConfig } from '../../context/ConfigContext';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/roles';
import { deleteBillingRecord, finalizeBillingRecord } from '../../lib/billingApi';
import { isNewForYear, isOwnRecord } from '../../lib/wizardHelpers';
import { fm } from '../../lib/format';
import InvoiceDocument from '../wizard/InvoiceDocument';

const dt = (s?: string) => (s ? s.split('T')[0].replace(/-/g, '.') : '');

type SortKey = 'fiscalYear' | 'manager' | 'companyName' | 'rev' | 'A' | 'C' | 'disc' | 'D' | 'VAT' | 'grand';

export default function HistoryTab({ onSwitchTab }: { onSwitchTab: (id: string) => void }) {
  const { records: allRecords, loading, error, refresh } = useBillingData();
  const { loadRecord } = useWizard();
  const { config } = useConfig();
  const { user, role, profileName } = useAuth();
  const canDelete = can(role, 'deleteBilling');
  const canFinalize = can(role, 'finalizeInvoice');
  const ownOnly = !can(role, 'viewAllBilling');
  // 전체 조회 권한이 없으면 본인 담당 청구기록만 (담당자 계정ID 우선, 없으면 이름)
  const records = ownOnly
    ? allRecords.filter((r) => isOwnRecord(r, user?.id ?? '', profileName))
    : allRecords;
  const [printRec, setPrintRec] = useState<BillingRecord | null>(null);
  // 청구서 인쇄 모달이 열리면 body에 print-mode를 걸어 인쇄 시 앱(#root) 대신 청구서만 출력한다.
  useEffect(() => {
    document.body.classList.toggle('print-mode', !!printRec);
    return () => document.body.classList.remove('print-mode');
  }, [printRec]);
  const [filter, setFilter] = useState('');
  const [year, setYear] = useState('');
  const [biz, setBiz] = useState('');
  // 표 안 정렬은 Grid 의 제목행이 맡는다. 여기 둘은 목록을 처음 세울 때의 기본 순서다.
  const [sortKey] = useState<SortKey>('fiscalYear');
  const [sortDir] = useState(-1);
  const [expandId, setExpandId] = useState<string | null>(null);

  const allYears = useMemo(
    () => [...new Set(records.map((r) => r.fiscalYear))].sort((a, b) => b - a),
    [records],
  );

  const view = useMemo(() => {
    let recs = records;
    if (year) recs = recs.filter((r) => String(r.fiscalYear) === String(year));
    if (biz) recs = recs.filter((r) => r.bizType === biz);
    if (filter) recs = recs.filter((r) => (r.companyName + r.manager).includes(filter));
    const arr = [...recs].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir;
      return String(av || '').localeCompare(String(bv || ''), 'ko') * sortDir;
    });
    return arr;
  }, [records, year, biz, filter, sortKey, sortDir]);

  // 표는 Grid 한 부품으로 그린다 — 정렬·열 필터·열 숨김/순서·너비·복사/엑셀이 함께 온다.
  // 상세 펼침은 부품의 detail 로 넘긴다(colSpan 을 부품이 알아서 맞춘다).
  const cols: GridCol<BillingRecord>[] = useMemo(() => [
    { key: 'fiscalYear', label: '귀속연도', width: 74, value: (r) => r.fiscalYear,
      cell: (r) => `${r.fiscalYear}년` },
    { key: 'bizType', label: '구분', width: 74, value: (r) => r.bizType, opts: ['법인', '개인'],
      cell: (r) => (
        <>
          <span className={`bdg ${r.bizType === '법인' ? 'b-law' : 'b-per'}`}>{r.bizType}</span>
          {isNewForYear(records, { id: r.selClientId || '', companyName: r.companyName }, r.fiscalYear)
            && <> <span className="bdg b-new">신규</span></>}
        </>
      ) },
    { key: 'manager', label: '담당자', width: 74, value: (r) => r.manager },
    { key: 'companyName', label: '거래처명', width: 170, value: (r) => r.companyName,
      cell: (r) => (
        <>
          <b style={{ color: 'var(--navy)' }}>{r.companyName}</b>
          {r.status === 'draft' && <> <span className="bdg-draft">작성중</span></>}
        </>
      ) },
    { key: 'rev', label: '매출액', width: 108, num: true, value: (r) => r.rev || 0, sum: (r) => r.rev || 0,
      style: { fontFamily: 'monospace' }, cell: (r) => fm(r.rev || 0) },
    { key: 'A', label: '기본보수A', width: 100, num: true, value: (r) => r.A || 0, sum: (r) => r.A || 0,
      style: { fontFamily: 'monospace' }, cell: (r) => fm(r.A || 0) },
    { key: 'C', label: '보수총계C', width: 100, num: true, value: (r) => r.C || 0, sum: (r) => r.C || 0,
      style: { fontFamily: 'monospace', color: 'var(--ink-2)' }, cell: (r) => fm(r.C || 0) },
    { key: 'disc', label: '할인⑧', width: 92, num: true, value: (r) => r.disc || 0, sum: (r) => r.disc || 0,
      style: { fontFamily: 'monospace', color: 'var(--bad)' },
      cell: (r) => (r.disc ? `-${fm(r.disc)}` : '-') },
    { key: 'D', label: '총보수D', width: 100, num: true, value: (r) => r.D || 0, sum: (r) => r.D || 0,
      style: { fontFamily: 'monospace' }, cell: (r) => fm(r.D || 0) },
    { key: 'VAT', label: 'VAT⑨', width: 92, num: true, value: (r) => r.VAT || 0, sum: (r) => r.VAT || 0,
      style: { fontFamily: 'monospace', color: 'var(--ink-3)' }, cell: (r) => fm(r.VAT || 0) },
    { key: 'grand', label: '최종청구금액', width: 116, num: true, value: (r) => r.grand || 0, sum: (r) => r.grand || 0,
      style: { fontFamily: 'monospace' },
      cell: (r) => <b style={{ color: 'var(--navy)' }}>{fm(r.grand || 0)}</b> },
    { key: 'savedAt', label: '저장일', width: 84, value: (r) => r.savedAt ?? '',
      style: { color: 'var(--ink-3)' }, cell: (r) => dt(r.savedAt) },
    { key: 'act', label: '관리', width: 150, value: () => '',
      // 단추를 누를 때 줄이 펼쳐지지 않게 여기서 이벤트를 끊는다.
      cell: (r) => (
        <div style={{ display: 'flex', gap: 3 }} onClick={(e) => e.stopPropagation()}>
          <button className="btn-sm" onClick={() => setPrintRec(r)} title="청구서 PDF/인쇄">📄 PDF</button>
          {r.status === 'draft' && canFinalize && (
            <button className="btn-sm btn-sm-navy" onClick={() => void finalize(r)}>확정</button>
          )}
          {(canFinalize || (r.status === 'draft' && isOwnRecord(r, user?.id ?? '', profileName))) && (
            <button className="btn-sm" onClick={() => edit(r)}>✏️</button>
          )}
          {(canDelete || (r.status === 'draft' && isOwnRecord(r, user?.id ?? '', profileName))) && (
            <button className="btn-sm btn-sm-del" onClick={() => void del(r)}>🗑</button>
          )}
        </div>
      ) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [records, canFinalize, canDelete, user?.id, profileName]);
  const grid = useGrid('billing-history', cols, view, { key: 'fiscalYear', dir: 'desc' });
  const tblH = Math.max(260, Math.round(window.innerHeight * 0.52));

  async function del(r: BillingRecord) {
    if (!confirm(`'${r.companyName}' ${r.fiscalYear}년 청구기록을 삭제하시겠습니까?`)) return;
    try {
      await deleteBillingRecord(r.id);
      await refresh();
    } catch (e) {
      alert('삭제 실패: ' + (e instanceof Error ? e.message : e));
    }
  }

  function edit(r: BillingRecord) {
    loadRecord(r);
    onSwitchTab('wizard');
  }

  async function finalize(r: BillingRecord) {
    if (!confirm(`'${r.companyName}' ${r.fiscalYear}년 청구건을 확정하시겠습니까?`)) return;
    try {
      const sync = await finalizeBillingRecord(r.id);
      await refresh();
      // 세무조정 매출계약까지 채워졌는지 알려 준다 — 조용히 지나가면 옮겨 적을 일을 놓친다.
      if (sync.updated) {
        alert(`확정했습니다.

매출계약 ${sync.contractCode ?? ''} 금액도 ${(sync.amount ?? 0).toLocaleString('ko-KR')}원으로 채웠습니다`
          + `${sync.previous ? ` (이전 ${sync.previous.toLocaleString('ko-KR')}원)` : ''}.`);
      } else if (sync.reason) {
        alert(`확정했습니다.

다만 매출계약 금액은 채우지 못했습니다 — ${sync.reason}`);
      }
    } catch (e) {
      alert('확정 실패: ' + (e instanceof Error ? e.message : e));
    }
  }

  if (loading) return <Loading title="📋 청구기록" rows={10} />;

  return (
    <div className="card">
      <div className="chdr">
        청구기록 (총 {records.length}건 / 표시 {view.length}건)
      </div>

      {error && <div className="alert-w">{error}</div>}
      {ownOnly && (
        <div className="alert-i" style={{ fontSize: 'var(--fs-1)' }}>
          🔒 본인(담당자: {profileName || '미지정'}) 청구기록만 표시됩니다.
        </div>
      )}

      <div className="sbar">
        <input placeholder="🔍 거래처명·담당자" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">전체 연도</option>
          {allYears.map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>
        <select value={biz} onChange={(e) => setBiz(e.target.value)}>
          <option value="">전체 구분</option>
          <option value="법인">법인</option>
          <option value="개인">개인</option>
        </select>
        <span style={{ display: 'inline-flex', gap: 4, marginLeft: 'auto' }}>
          {grid.filterCount > 0 && (
            <button className="btn-sm" onClick={grid.clearFilters}>열 필터 지우기 ({grid.filterCount})</button>
          )}
          <GridExport grid={grid} name="청구기록" />
          <ColumnSettings cols={grid.ordered} view={grid.view} />
        </span>
      </div>

      <Grid grid={grid} rowKey={(r) => r.id} maxHeight={tblH}
        footerLabel={`합계 (${grid.rowsView.length}건)`}
        detail={{
          isOpen: (r) => expandId === r.id,
          onToggle: (r) => setExpandId((id) => (id === r.id ? null : r.id)),
          render: (r) => <HistDetail r={r} />,
        }}
        empty={<Empty text="기록 없음"
          hint={grid.filterCount > 0 || filter || year || biz
            ? '조건을 걸어서 비었습니다.'
            : '청구서를 작성해 저장하면 여기 쌓입니다.'}
          action={grid.filterCount > 0
            ? { label: '열 필터 지우기', onClick: grid.clearFilters }
            : (filter || year || biz)
              ? { label: '조건 지우기', onClick: () => { setFilter(''); setYear(''); setBiz(''); } }
              : undefined} />} />

      {printRec &&
        createPortal(
          <div className="inv-print-modal" onClick={() => setPrintRec(null)}>
            <div className="inv-print-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="no-print" style={{ display: 'flex', gap: 7, justifyContent: 'flex-end', marginBottom: 9 }}>
                <button className="btn-gold" onClick={() => window.print()}>🖨 인쇄/PDF</button>
                <button className="btn-sm" onClick={() => setPrintRec(null)}>닫기 ✕</button>
              </div>
              <InvoiceDocument S={printRec} config={config} draft={printRec.status !== 'final'} />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

/** 줄을 펼쳤을 때 아래에 나오는 상세 — 업무량 측정 내역까지.
 *  표의 열 수는 부품(Grid)이 알아서 맞추므로 여기서는 내용만 그린다. */
function HistDetail({ r }: { r: BillingRecord }) {
  return (
          <div className="hdet">
            <div className="hdet-grid">
              <div className="hdet-item">
                <label>기본업무보수 A)</label>
                <strong>{fm(r.A || 0)}원</strong>
              </div>
              <div className="hdet-item">
                <label>추가업무보수 B)</label>
                <strong>{fm(r.Btot || 0)}원</strong>
              </div>
              <div className="hdet-item">
                <label>보수총계 C) ← 할인 전</label>
                <strong style={{ color: 'var(--navy)' }}>{fm(r.C || 0)}원</strong>
              </div>
              <div className="hdet-item">
                <label>할인금액 ⑧</label>
                <strong style={{ color: '#DC2626' }}>-{fm(r.disc || 0)}원</strong>
              </div>
              <div className="hdet-item">
                <label>총보수합계 D)</label>
                <strong>{fm(r.D || 0)}원</strong>
              </div>
              <div className="hdet-item">
                <label>VAT ⑨</label>
                <strong>{fm(r.VAT || 0)}원</strong>
              </div>
              <div className="hdet-item">
                <label>최종 청구금액</label>
                <strong style={{ fontSize: 'var(--fs-4)', color: 'var(--navy)' }}>{fm(r.grand || 0)}원</strong>
              </div>
              <div className="hdet-item">
                <label>할인 사유</label>
                <strong>{r.discContent || '-'}</strong>
              </div>
            </div>
            <div style={{ fontSize: 'var(--fs-1)', fontWeight: 700, color: 'var(--ink-2)', margin: '8px 0 4px' }}>
              업무량 측정 내역
            </div>
            <div className="wf-grid">
              <div className="wf-item">
                <span>방문상담</span>
                {r.visitCount || '-'} / {r.visitDiff || '-'}
              </div>
              <div className="wf-item">
                <span>전화상담</span>
                {r.phoneCount || '-'} / {r.phoneDiff || '-'}
              </div>
              <div className="wf-item">
                <span>기장업무</span>
                {r.장부P || 'X'}
                {r.장부P === 'O' ? ` (${r.장부A}/${r.장부D})` : ''}
              </div>
              <div className="wf-item">
                <span>결산업무</span>
                {r.결산P || 'X'}
                {r.결산P === 'O' ? ` (${r.결산A}/${r.결산D})` : ''}
              </div>
              <div className="wf-item">
                <span>조정업무</span>
                {r.조정P || 'X'}
                {r.조정P === 'O' ? ` (${r.조정A}/${r.조정D})` : ''}
              </div>
              <div className="wf-item">
                <span>원가계산</span>
                {r.원가P || 'X'}
                {r.원가P === 'O' ? ` (${r.원가A}/${r.원가D})` : ''}
              </div>
              <div className="wf-item">
                <span>증빙발행</span>
                {r.evCount || '-'}
              </div>
              <div className="wf-item">
                <span>기타</span>
                {r.otherContent || '-'}
              </div>
            </div>
          </div>
  );
}
