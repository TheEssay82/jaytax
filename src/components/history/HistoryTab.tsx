// 청구기록 탭 — 원본 rHistory 포팅 (목록·필터·정렬·상세펼침·수정·삭제)
import { useMemo, useState } from 'react';
import type { BillingRecord } from '../../types';
import { useBillingData } from '../../hooks/useBillingData';
import { useWizard } from '../../context/WizardContext';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/roles';
import { deleteBillingRecord } from '../../lib/billingApi';
import { isNewForYear } from '../../lib/wizardHelpers';
import { fm } from '../../lib/format';

const dt = (s?: string) => (s ? s.split('T')[0].replace(/-/g, '.') : '');

type SortKey = 'fiscalYear' | 'manager' | 'companyName' | 'rev' | 'A' | 'C' | 'disc' | 'D' | 'VAT' | 'grand';

export default function HistoryTab({ onSwitchTab }: { onSwitchTab: (id: string) => void }) {
  const { records: allRecords, loading, error, refresh } = useBillingData();
  const { loadRecord } = useWizard();
  const { role, profileName } = useAuth();
  const canDelete = can(role, 'deleteBilling');
  const ownOnly = !can(role, 'viewAllStats');
  // 기장팀원은 본인(담당자명) 청구기록만
  const records = ownOnly ? allRecords.filter((r) => r.manager === profileName) : allRecords;
  const [filter, setFilter] = useState('');
  const [year, setYear] = useState('');
  const [biz, setBiz] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('fiscalYear');
  const [sortDir, setSortDir] = useState(-1);
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

  function sort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d * -1);
    else {
      setSortKey(key);
      setSortDir(1);
    }
  }

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

  const sum = (f: (r: BillingRecord) => number) => view.reduce((s, r) => s + (f(r) || 0), 0);

  if (loading) {
    return (
      <div className="card">
        <div className="chdr">📋 청구기록</div>
        <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>불러오는 중…</div>
      </div>
    );
  }

  const ind = (k: SortKey) => (sortKey === k ? (sortDir > 0 ? ' ▲' : ' ▼') : ' ⇅');

  return (
    <div className="card">
      <div className="chdr">
        청구기록 (총 {records.length}건 / 표시 {view.length}건)
      </div>

      {error && <div className="alert-w">{error}</div>}
      {ownOnly && (
        <div className="alert-i" style={{ fontSize: 11 }}>
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
      </div>

      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th onClick={() => sort('fiscalYear')} style={{ cursor: 'pointer' }}>
                귀속연도{ind('fiscalYear')}
              </th>
              <th>구분</th>
              <th onClick={() => sort('manager')} style={{ cursor: 'pointer' }}>
                담당자{ind('manager')}
              </th>
              <th onClick={() => sort('companyName')} style={{ cursor: 'pointer' }}>
                거래처명{ind('companyName')}
              </th>
              <th className="r" onClick={() => sort('rev')} style={{ cursor: 'pointer' }}>
                매출액{ind('rev')}
              </th>
              <th className="r" onClick={() => sort('A')} style={{ cursor: 'pointer' }}>
                기본보수A{ind('A')}
              </th>
              <th className="r" onClick={() => sort('C')} style={{ cursor: 'pointer' }}>
                보수총계C{ind('C')}
              </th>
              <th className="r" onClick={() => sort('disc')} style={{ cursor: 'pointer' }}>
                할인⑧{ind('disc')}
              </th>
              <th className="r" onClick={() => sort('D')} style={{ cursor: 'pointer' }}>
                총보수D{ind('D')}
              </th>
              <th className="r" onClick={() => sort('VAT')} style={{ cursor: 'pointer' }}>
                VAT⑨{ind('VAT')}
              </th>
              <th className="r" onClick={() => sort('grand')} style={{ cursor: 'pointer' }}>
                최종청구금액{ind('grand')}
              </th>
              <th>저장일</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && (
              <tr>
                <td colSpan={13} style={{ textAlign: 'center', padding: 24, color: '#BBB' }}>
                  기록 없음
                </td>
              </tr>
            )}
            {view.map((r) => (
              <HistRow
                key={r.id}
                r={r}
                expanded={expandId === r.id}
                isNew={isNewForYear(records, { id: r.selClientId || '', companyName: r.companyName }, r.fiscalYear)}
                onToggle={() => setExpandId((id) => (id === r.id ? null : r.id))}
                onEdit={() => edit(r)}
                onDel={() => del(r)}
                canDelete={canDelete}
              />
            ))}
          </tbody>
          {view.length > 0 && (
            <tfoot style={{ background: '#F5F1EB', fontWeight: 700 }}>
              <tr style={{ borderTop: '2px solid #1A2B52' }}>
                <td colSpan={4} style={{ padding: '7px 9px' }}>
                  합계 ({view.length}건)
                </td>
                <td className="r" style={{ fontFamily: 'monospace' }}>{fm(sum((r) => r.rev))}</td>
                <td className="r" style={{ fontFamily: 'monospace' }}>{fm(sum((r) => r.A))}</td>
                <td className="r" style={{ fontFamily: 'monospace' }}>{fm(sum((r) => r.C))}</td>
                <td className="r" style={{ fontFamily: 'monospace', color: '#DC2626' }}>
                  -{fm(sum((r) => r.disc))}
                </td>
                <td className="r" style={{ fontFamily: 'monospace' }}>{fm(sum((r) => r.D))}</td>
                <td className="r" style={{ fontFamily: 'monospace', color: '#888', fontSize: 11 }}>
                  {fm(sum((r) => r.VAT))}
                </td>
                <td className="r" style={{ fontFamily: 'monospace', color: '#1A2B52' }}>
                  {fm(sum((r) => r.grand))}
                </td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

interface RowProps {
  r: BillingRecord;
  expanded: boolean;
  isNew: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDel: () => void;
  canDelete: boolean;
}

function HistRow({ r, expanded, isNew, onToggle, onEdit, onDel, canDelete }: RowProps) {
  return (
    <>
      <tr onClick={onToggle} title="클릭: 업무량 상세" style={{ cursor: 'pointer' }}>
        <td>{r.fiscalYear}년</td>
        <td>
          <span className={`bdg ${r.bizType === '법인' ? 'b-law' : 'b-per'}`}>{r.bizType}</span>
          {isNew && (
            <>
              {' '}
              <span className="bdg b-new">신규</span>
            </>
          )}
        </td>
        <td>{r.manager}</td>
        <td style={{ fontWeight: 700, color: '#1A2B52' }}>{r.companyName}</td>
        <td className="r" style={{ fontFamily: 'monospace' }}>{fm(r.rev || 0)}</td>
        <td className="r" style={{ fontFamily: 'monospace' }}>{fm(r.A || 0)}</td>
        <td className="r" style={{ fontFamily: 'monospace', color: '#555' }}>{fm(r.C || 0)}</td>
        <td className="r" style={{ fontFamily: 'monospace', color: '#DC2626' }}>
          {r.disc ? '-' + fm(r.disc) : '-'}
        </td>
        <td className="r" style={{ fontFamily: 'monospace' }}>{fm(r.D || 0)}</td>
        <td className="r" style={{ fontFamily: 'monospace', color: '#888', fontSize: 11 }}>{fm(r.VAT || 0)}</td>
        <td className="r" style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1A2B52' }}>
          {fm(r.grand || 0)}
        </td>
        <td style={{ fontSize: 10, color: '#999' }}>{dt(r.savedAt)}</td>
        <td>
          <div style={{ display: 'flex', gap: 3 }} onClick={(e) => e.stopPropagation()}>
            <button className="btn-sm btn-sm-grn" onClick={onEdit}>
              수정
            </button>
            {canDelete && (
              <button className="btn-sm btn-sm-del" onClick={onDel}>
                🗑
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={13}>
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
                  <strong style={{ color: '#1A2B52' }}>{fm(r.C || 0)}원</strong>
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
                  <strong style={{ fontSize: 15, color: '#1A2B52' }}>{fm(r.grand || 0)}원</strong>
                </div>
                <div className="hdet-item">
                  <label>할인 사유</label>
                  <strong>{r.discContent || '-'}</strong>
                </div>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#555', margin: '8px 0 4px' }}>
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
          </td>
        </tr>
      )}
    </>
  );
}
