// 세무조정수수료관리 › 세무조정 대상선정 — 옛 '거래처 관리' + '청구대상'을 한 화면으로 합쳤다.
// 흐름: 거래처관리에서 거래처 등록 → 매출계약등록에서 법인세/종합소득세 계약 등록
//       → 여기서 그 계약을 가져와 청구대상 편입 → 매출액·성실신고 입력 → 확정
//       → 청구서 작성 → 청구기록.
// 거래처 '등록'은 거래처관리(biz_*)에서만 한다(0070·0071). 여기서 관리하는 값은
// 청구 모집단(편입·확정)과 수수료 계산 기초자료(매출액·성실신고·상실), 청구 전용 정보(가상계좌 등)뿐이다.
// 담당회계사가 김준성·조현규인 세무조정은 이 시스템으로 청구하지 않는다(매출계약으로만 매출을 잡는다).
import { useEffect, useMemo, useState } from 'react';
import { useEscape } from '../../lib/useEscape';
import type { Client } from '../../types';
import { CURRENT_YEAR } from '../../lib/constants';
import { fm, dtFmt, getRevForYear, getClientDispYears, sortIndicator } from '../../lib/format';
import {
  updateClient, deleteClient, clientBillingUsage,
  listImportableTaxContracts, importTaxContractsAsClients, type ImportableTaxContract,
} from '../../lib/clientsApi';
import { setTarget } from '../../lib/targetsApi';
import { isBilled, hasDraftRecord, getTargetIds } from '../../lib/wizardHelpers';
import { useClients } from '../../hooks/useClients';
import { useBillingData } from '../../hooks/useBillingData';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/roles';
import ClientForm, { type ClientFormData } from '../clients/ClientForm';
import BulkRevenue from '../clients/BulkRevenue';

export default function TargetSelectionTab() {
  const { clients, loading, error, refresh } = useClients();
  const { records, targets, loading: bdLoading, refresh: refreshBilling } = useBillingData();
  const { role, readonly } = useAuth();
  // 전체 관리(등록·삭제·일괄·엑셀·모든 필드) 권한. 없으면(기장팀원) 일부 필드만 수정.
  const canManage = can(role, 'manageClients');
  const canTarget = can(role, 'manageTargets') && !readonly;   // 청구대상 확정 권한
  const [busyTarget, setBusyTarget] = useState(false);
  const [filter, setFilter] = useState('');
  const [bizFilter, setBizFilter] = useState('');
  // 기본은 전년 귀속 — 세무조정은 전년도(예: 2025년 귀속)를 올해 신고·청구한다.
  const [displayYear, setDisplayYear] = useState(CURRENT_YEAR - 1);
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState(1);
  const [showImport, setShowImport] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mode, setMode] = useState<'list' | 'bulk'>('list');

  // 필터 + 정렬
  const view = useMemo(() => {
    let list = clients;
    if (filter) list = list.filter((c) => (c.companyName + c.manager + c.taxId).includes(filter));
    if (bizFilter) list = list.filter((c) => c.bizType === bizFilter);
    if (sortKey) {
      const arr = [...list];
      if (sortKey.startsWith('rev_')) {
        const ry = sortKey.slice(4);
        arr.sort((a, b) => (getRevForYear(a, ry) - getRevForYear(b, ry)) * sortDir);
      } else if (sortKey === 'modelYear') {
        const yr = String(displayYear);
        const n = (v: boolean | undefined) => (v === true ? 0 : v === false ? 1 : 2);
        arr.sort((a, b) => (n((a.modelYears || {})[yr]) - n((b.modelYears || {})[yr])) * sortDir);
      } else {
        arr.sort((a, b) => {
          const av = (a as unknown as Record<string, unknown>)[sortKey] || '';
          const bv = (b as unknown as Record<string, unknown>)[sortKey] || '';
          return String(av).localeCompare(String(bv), 'ko') * sortDir;
        });
      }
      list = arr;
    }
    return list;
  }, [clients, filter, bizFilter, sortKey, sortDir, displayYear]);

  const dispYears = useMemo(() => getClientDispYears(clients, displayYear), [clients, displayYear]);

  // 귀속연도(=매출액 기준연도) 기준 확정·청구 상태
  const targetIds = useMemo(() => new Set(getTargetIds(targets, displayYear)), [targets, displayYear]);
  const statusOf = (c: Client): '청구완료' | '작성중' | '확정' | '미확정' => {
    if (isBilled(records, displayYear, c)) return '청구완료';
    if (hasDraftRecord(records, displayYear, c)) return '작성중';
    return targetIds.has(c.id) ? '확정' : '미확정';
  };
  const prevGrand = (c: Client) =>
    records.find((r) => r.selClientId === c.id && String(r.fiscalYear) === String(displayYear - 1))?.grand ?? null;

  async function toggleTarget(id: string, val: boolean) {
    try {
      await setTarget(displayYear, id, val);
      await refreshBilling();
    } catch (e) {
      alert('확정 변경 실패: ' + (e instanceof Error ? e.message : e));
    }
  }
  async function bulkTarget(val: boolean) {
    if (!confirm(`화면에 보이는 ${view.length}개 거래처를 ${displayYear}년 청구대상에서 ${val ? '전체 확정' : '전체 해제'}할까요?`)) return;
    setBusyTarget(true);
    try {
      await Promise.all(view.map((c) => setTarget(displayYear, c.id, val)));
      await refreshBilling();
    } catch (e) {
      alert('일괄 변경 실패: ' + (e instanceof Error ? e.message : e));
    } finally {
      setBusyTarget(false);
    }
  }

  // 기준연도 선택지: 데이터 있는 연도 전체 + CY±3 (>=2015, 내림차순)
  const baseOpts = useMemo(() => {
    const data = clients.flatMap((c) => Object.keys(c.revenues || {}).map(Number));
    const around = [-3, -2, -1, 0, 1, 2, 3].map((d) => CURRENT_YEAR + d);
    return [...new Set([...data, ...around])].filter((y) => y >= 2015).sort((a, b) => b - a);
  }, [clients]);

  function clientSort(key: string) {
    if (sortKey === key) setSortDir((d) => d * -1);
    else {
      setSortKey(key);
      setSortDir(1);
    }
  }

  async function handleEdit(
    target: Client,
    data: ClientFormData,
    mgrYear: number,
    modelYear: number,
  ) {
    // 기장팀원(일부수정): 사업자번호·대표자명·가상계좌·성실신고만 반영(나머지·매출·귀속연도 이력 미변경).
    const upd: Partial<Client> = canManage
      ? {
          bizType: data.bizType,
          manager: data.manager,
          companyName: data.companyName,
          tradeName: data.tradeName,
          taxId: data.taxId,
          repName: data.repName,
          bankAccount: data.bankAccount,
          isModel: data.isModel,
          revenues: { ...(target.revenues || {}), ...data.revenues },
        }
      : {
          taxId: data.taxId,
          repName: data.repName,
          bankAccount: data.bankAccount,
          isModel: data.isModel,
        };
    if (canManage && mgrYear && data.manager) upd.managers = { ...(target.managers || {}), [mgrYear]: data.manager };
    if (canManage && modelYear) upd.modelYears = { ...(target.modelYears || {}), [modelYear]: data.isModel };
    try {
      await updateClient(target.id, upd);
      setEditingId(null);
      await refresh();
    } catch (e) {
      alert('저장 실패: ' + (e instanceof Error ? e.message : e));
    }
  }

  // 삭제 = '가져오기 취소'. 청구기록·청구대상·상담이 하나라도 붙어 있으면 막는다
  // (예전엔 그냥 지워져서 청구기록의 거래처 연결이 조용히 끊겼다).
  async function handleDelete(c: Client) {
    try {
      const u = await clientBillingUsage(c.id);
      const total = u.records + u.targets + u.consults;
      if (total > 0) {
        alert(
          `'${c.companyName}'은(는) 지울 수 없습니다.

` +
            `청구기록 ${u.records}건 · 청구대상 ${u.targets}건 · 상담 ${u.consults}건이 연결돼 있습니다.
` +
            '거래처 자체를 정리하려면 거래처관리에서 처리하세요.',
        );
        return;
      }
      if (!confirm(`'${c.companyName}'을(를) 청구 거래처에서 제외할까요?

거래처관리의 원본은 그대로 남습니다.`)) return;
      await deleteClient(c.id);
      await refresh();
    } catch (e) {
      alert('삭제 실패: ' + (e instanceof Error ? e.message : e));
    }
  }

  async function setModelYear(c: Client, year: number, value: string) {
    const mys = { ...(c.modelYears || {}) };
    if (value === 'O') mys[String(year)] = true;
    else if (value === 'X') mys[String(year)] = false;
    else delete mys[String(year)];
    try {
      await updateClient(c.id, { modelYears: mys });
      await refresh();
    } catch (e) {
      alert('변경 실패: ' + (e instanceof Error ? e.message : e));
    }
  }

  async function toggleLossYear(c: Client, year: number, setLoss: boolean) {
    let ly = [...(c.lossYears || [])].map(Number);
    if (setLoss) {
      if (!ly.includes(year)) ly.push(year);
    } else {
      ly = ly.filter((y) => y !== year);
    }
    try {
      await updateClient(c.id, { lossYears: ly });
      await refresh();
    } catch (e) {
      alert('변경 실패: ' + (e instanceof Error ? e.message : e));
    }
  }

  if (loading || bdLoading) {
    return (
      <div className="card">
        <div className="chdr">🏢 거래처 관리</div>
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>불러오는 중…</div>
      </div>
    );
  }

  if (mode === 'bulk') {
    return <BulkRevenue clients={clients} onBack={() => setMode('list')} onChanged={refresh} />;
  }

  // 체크박스 열은 관리자(일괄삭제)만 → 팀원은 열 하나 줄어든다.
  const colCount = (canTarget ? 8 : 7) + dispYears.length + 3;

  return (
    <div className="card">
      <div className="chdr">
        🎯 세무조정 대상선정 — {displayYear}년 귀속 (대상 {clients.length} · 확정 {clients.filter((c) => targetIds.has(c.id)).length} · 청구완료 {clients.filter((c) => statusOf(c) === '청구완료').length})
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            gap: 5,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          {canTarget && (
            <>
              <button className="btn-sm" disabled={busyTarget} onClick={() => void bulkTarget(true)}>보이는 건 전체 확정</button>
              <button className="btn-sm" disabled={busyTarget} onClick={() => void bulkTarget(false)}>전체 해제</button>
            </>
          )}
          {!readonly && canManage && (
            <>
              <button className="btn-sm btn-sm-blue" style={{ fontWeight: 600 }} onClick={() => setMode('bulk')}>
                📊 매출액 일괄입력
              </button>
              <button className="btn-p" onClick={() => setShowImport(true)}>
                ＋ 매출계약에서 가져오기
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="alert-w">{error}</div>}
      {canManage ? (
        <div className="alert-i" style={{ fontSize: 'var(--fs-1)' }}>
          흐름: <b>매출계약등록</b>에 법인세·종합소득세 계약을 넣고 → <b>＋ 매출계약에서 가져오기</b>로 편입 → <b>매출액·성실신고</b> 입력 → <b>확정</b> → 청구서 작성. 매출 셀: <b>숫자</b>=매출액 · <b style={{ color: 'var(--ink-3)' }}>0</b>=매출 0원(기록됨) · <b style={{ color: 'var(--ink-4)' }}>—</b>=데이터 없음 · <span className="bdg b-loss">상실</span>=거래종료.
        </div>
      ) : (
        <div className="alert-i" style={{ fontSize: 'var(--fs-1)' }}>
          🔧 기장팀원은 <b>사업자번호·대표자명·가상계좌·성실신고</b>만 수정할 수 있습니다. 거래처 편입·제외·매출/담당자 변경은 기장팀장 이상만 가능합니다.
        </div>
      )}

      {showImport && canManage && !readonly && (
        <ImportFromContracts
          fiscalYear={displayYear}
          onClose={() => setShowImport(false)}
          onDone={async () => {
            setShowImport(false);
            await refresh();
          }}
        />
      )}

      <div className="sbar">
        <input
          placeholder="🔍 거래처명·담당자·사업자번호"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select value={bizFilter} onChange={(e) => setBizFilter(e.target.value)}>
          <option value="">전체 구분</option>
          <option value="법인">법인</option>
          <option value="개인">개인</option>
        </select>
        <span style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', fontWeight: 700, whiteSpace: 'nowrap' }}>
          귀속연도:
        </span>
        <select
          value={displayYear}
          onChange={(e) => setDisplayYear(parseInt(e.target.value))}
          style={{ fontWeight: 700 }}
        >
          {baseOpts.map((y) => (
            <option key={y} value={y}>
              {y}년 귀속
            </option>
          ))}
        </select>
        <span style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
          ← 확정·청구 상태와 매출액이 이 연도 기준으로 보입니다
        </span>
      </div>

      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
              {canTarget && <th style={{ width: 44 }} title="청구대상 확정">확정</th>}
              <th style={{ width: 78 }}>상태</th>
              <th onClick={() => clientSort('bizType')} style={{ cursor: 'pointer' }}>
                구분{sortIndicator('bizType', sortKey, sortDir)}
              </th>
              <th onClick={() => clientSort('manager')} style={{ cursor: 'pointer' }}>
                담당자{sortIndicator('manager', sortKey, sortDir)}
              </th>
              <th onClick={() => clientSort('companyName')} style={{ cursor: 'pointer' }}>
                회사명{sortIndicator('companyName', sortKey, sortDir)}
              </th>
              <th>상호명</th>
              <th>사업자번호</th>
              <th onClick={() => clientSort('modelYear')} style={{ cursor: 'pointer' }} title="클릭: 성실 기준 정렬">
                {displayYear}년 성실{sortIndicator('modelYear', sortKey, sortDir)}
              </th>
              {dispYears.map((y) => (
                <th key={y} className="r" onClick={() => clientSort('rev_' + y)} style={{ cursor: 'pointer' }}>
                  {y}년 매출액{sortIndicator('rev_' + y, sortKey, sortDir)}
                </th>
              ))}
              <th className="r">전년 청구액</th>
              <th>수정일</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && (
              <tr>
                <td colSpan={colCount} style={{ textAlign: 'center', padding: 24, color: 'var(--ink-4)' }}>
                  등록된 거래처 없음
                </td>
              </tr>
            )}
            {view.map((c) => {
              const mv = (c.modelYears || {})[String(displayYear)];
              const mvBg = mv === true ? '#D1FAE5' : mv === false ? '#F9FAFB' : '#FEF3C7';
              return (
                <ClientRow
                  key={c.id}
                  c={c}
                  dispYears={dispYears}
                  canTarget={canTarget}
                  status={statusOf(c)}
                  isTarget={targetIds.has(c.id)}
                  prevGrand={prevGrand(c)}
                  onToggleTarget={(v) => void toggleTarget(c.id, v)}
                  displayYear={displayYear}
                  mvBg={mvBg}
                  mv={mv}
                  canManage={canManage}
                  editing={editingId === c.id}
                  colCount={colCount}
                  onEdit={() => setEditingId(c.id)}
                  onDelete={() => handleDelete(c)}
                  onModelYear={(v) => setModelYear(c, displayYear, v)}
                  onToggleLoss={(y, setLoss) => toggleLossYear(c, y, setLoss)}
                  onSubmitEdit={(data, my, moy) => handleEdit(c, data, my, moy)}
                  onCancelEdit={() => setEditingId(null)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface RowProps {
  c: Client;
  dispYears: number[];
  canTarget: boolean;
  status: '청구완료' | '작성중' | '확정' | '미확정';
  isTarget: boolean;
  prevGrand: number | null;
  onToggleTarget: (v: boolean) => void;
  displayYear: number;
  mvBg: string;
  mv: boolean | undefined;
  canManage: boolean;
  editing: boolean;
  colCount: number;
  onEdit: () => void;
  onDelete: () => void;
  onModelYear: (v: string) => void;
  onToggleLoss: (year: number, setLoss: boolean) => void;
  onSubmitEdit: (data: ClientFormData, mgrYear: number, modelYear: number) => void;
  onCancelEdit: () => void;
}

function ClientRow({
  c,
  dispYears,
  canTarget,
  status,
  isTarget,
  prevGrand,
  onToggleTarget,
  mv,
  mvBg,
  canManage,
  editing,
  colCount,
  onEdit,
  onDelete,
  onModelYear,
  onToggleLoss,
  onSubmitEdit,
  onCancelEdit,
}: RowProps) {
  const { readonly } = useAuth();
  const statusStyle: Record<string, { bg: string; fg: string }> = {
    청구완료: { bg: '#D1FAE5', fg: '#065F46' },
    작성중: { bg: '#FEF3C7', fg: '#92400E' },
    확정: { bg: '#DBEAFE', fg: '#1E3A8A' },
    미확정: { bg: '#F3F4F6', fg: '#6B7280' },
  };
  return (
    <>
      <tr>
        {canTarget && (
          <td style={{ textAlign: 'center' }}>
            <input
              type="checkbox"
              checked={isTarget}
              disabled={status === '청구완료'}
              title={status === '청구완료' ? '이미 청구된 건은 확정 해제할 수 없습니다' : '청구대상 확정'}
              onChange={(e) => onToggleTarget(e.target.checked)}
            />
          </td>
        )}
        <td>
          <span style={{
            display: 'inline-block', padding: '1px 6px', borderRadius: 9, fontSize: 'var(--fs-0)', fontWeight: 700,
            background: statusStyle[status].bg, color: statusStyle[status].fg, whiteSpace: 'nowrap',
          }}>{status}</span>
        </td>
        <td>
          <span className={`bdg ${c.bizType === '법인' ? 'b-law' : 'b-per'}`}>{c.bizType}</span>
        </td>
        <td>{c.manager}</td>
        <td style={{ fontWeight: 700, color: 'var(--navy)' }}>{c.companyName}</td>
        <td>{c.tradeName}</td>
        <td style={{ fontSize: 'var(--fs-1)' }}>{c.taxId}</td>
        <td style={{ textAlign: 'center' }}>
          {canManage ? (
            <select
              value={mv === true ? 'O' : mv === false ? 'X' : ''}
              onChange={(e) => onModelYear(e.target.value)}
              style={{
                width: 82,
                padding: '2px 3px',
                fontSize: 'var(--fs-1)',
                border: '1px solid var(--rule)',
                borderRadius: 4,
                fontFamily: 'inherit',
                cursor: 'pointer',
                background: mvBg,
              }}
            >
              <option value="">❓ 미확정</option>
              <option value="O">✅ O 해당</option>
              <option value="X">✗ X 미해당</option>
            </select>
          ) : (
            <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)' }}>{mv === true ? '✅ O' : mv === false ? '✗ X' : '❓'}</span>
          )}
        </td>
        {dispYears.map((y) => {
          const rv = getRevForYear(c, y);
          const hasKey = !!c.revenues && Object.prototype.hasOwnProperty.call(c.revenues, String(y));
          const isLoss = (c.lossYears || []).map(Number).includes(Number(y));
          // ① 상실 확정 — 빨강 '상실' + 해제 버튼
          if (isLoss) {
            return (
              <td key={y} className="r" style={{ fontFamily: 'monospace', fontSize: 'var(--fs-1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                  <span className="bdg b-loss">상실</span>
                  {canManage && (
                    <button
                      className="btn-sm btn-sm-del"
                      style={{ fontSize: 'var(--fs-0)', padding: '1px 6px' }}
                      onClick={() => onToggleLoss(y, false)}
                      title="상실 해제"
                    >
                      해제
                    </button>
                  )}
                </div>
              </td>
            );
          }
          // ② 매출 있음 — 금액만
          if (rv > 0) {
            return (
              <td key={y} className="r" style={{ fontFamily: 'monospace', fontSize: 'var(--fs-1)' }}>
                {fm(rv)}
              </td>
            );
          }
          // ③ 매출 0(기록됨) / 데이터 없음 — 구분 표기 + 상실 처리 버튼
          return (
            <td key={y} className="r" style={{ fontFamily: 'monospace', fontSize: 'var(--fs-1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                <span
                  style={{ color: hasKey ? '#6B7280' : '#CCC', fontWeight: hasKey ? 700 : 400 }}
                  title={hasKey ? '매출 0원(기록됨)' : '데이터 없음'}
                >
                  {hasKey ? '0' : '—'}
                </span>
                {canManage && (
                  <button
                    className="btn-sm btn-sm-del"
                    style={{ fontSize: 'var(--fs-0)', padding: '1px 6px' }}
                    onClick={() => onToggleLoss(y, true)}
                    title="이 연도를 상실(거래종료)로 처리"
                  >
                    상실?
                  </button>
                )}
              </div>
            </td>
          );
        })}
        <td className="r" style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>
          {prevGrand != null ? fm(prevGrand) : <span style={{ color: 'var(--ink-4)' }}>—</span>}
        </td>
        <td style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{dtFmt(c.updatedAt)}</td>
        <td>
          <div style={{ display: 'flex', gap: 4 }}>
            {!readonly && (
              <button className="btn-sm btn-sm-blue" onClick={onEdit} title="수정">
                ✏️
              </button>
            )}
            {!readonly && canManage && (
              <button className="btn-sm btn-sm-del" onClick={onDelete} title="청구 거래처에서 제외(청구이력 없는 건만)">
                🗑
              </button>
            )}
          </div>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={colCount}>
            <ClientForm isAdd={false} initial={c} limited={!canManage} onSubmit={onSubmitEdit} onCancel={onCancelEdit} />
          </td>
        </tr>
      )}
    </>
  );
}

// ── 매출계약에서 가져오기 ──────────────────────────────────
// 그 해 세무조정 계약(법인세·종합소득세)이 있는 거래처를 청구 모집단으로 편입한다.
// 담당회계사가 김준성·조현규인 건은 이 시스템으로 청구하지 않으므로 기본으로 감춘다.
function ImportFromContracts({ fiscalYear, onClose, onDone }: { fiscalYear: number; onClose: () => void; onDone: () => Promise<void> }) {
  useEscape(onClose);
  const [rows, setRows] = useState<ImportableTaxContract[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [hideTaken, setHideTaken] = useState(true);
  const [onlyMain, setOnlyMain] = useState(true);   // 정우철 담당분만
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRows(null);
    listImportableTaxContracts(fiscalYear)
      .then(setRows)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [fiscalYear]);

  const view = useMemo(() => {
    let list = rows ?? [];
    if (hideTaken) list = list.filter((r) => !r.already);
    if (onlyMain) list = list.filter((r) => r.cpa === '정우철');
    if (q.trim()) {
      const k = q.trim().toLowerCase();
      list = list.filter((r) => (r.code + r.companyName + r.taxId + r.cpa).toLowerCase().includes(k));
    }
    return list;
  }, [rows, q, hideTaken, onlyMain]);

  const otherCpaCnt = (rows ?? []).filter((r) => !r.already && r.cpa !== '정우철').length;

  async function run() {
    const target = (rows ?? []).filter((r) => pick.has(r.contractId) && !r.already);
    if (!target.length) return;
    if (!confirm(`${target.length}건을 ${fiscalYear}년 청구 거래처로 편입할까요?`)) return;
    setBusy(true);
    try {
      const n = await importTaxContractsAsClients(target);
      alert(`✅ ${n}개 거래처를 편입했습니다. 매출액·성실신고를 입력한 뒤 확정하세요.`);
      await onDone();
    } catch (e) {
      alert('가져오기 실패: ' + (e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 980 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <b style={{ color: 'var(--navy)' }}>매출계약에서 가져오기 — {fiscalYear}년 귀속</b>
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>법인세·종합소득세 계약 기준 · 이미 편입된 건은 회색</span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>

        {err && <div className="alert-w">{err}</div>}
        {!rows && !err && <div style={{ padding: 20, color: 'var(--ink-3)', fontSize: 'var(--fs-2)' }}>불러오는 중…</div>}

        {rows && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <input placeholder="🔍 코드·거래처·사업자번호·담당CPA" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
              <label style={{ fontSize: 'var(--fs-1)' }}>
                <input type="checkbox" checked={hideTaken} onChange={(e) => setHideTaken(e.target.checked)} /> 편입된 건 숨김
              </label>
              <label style={{ fontSize: 'var(--fs-1)' }} title="김준성·조현규 담당 세무조정은 이 시스템으로 청구하지 않습니다">
                <input type="checkbox" checked={onlyMain} onChange={(e) => setOnlyMain(e.target.checked)} /> 정우철 담당분만
              </label>
              <button className="btn-p" disabled={busy || pick.size === 0} onClick={() => void run()}>
                {busy ? '처리 중…' : `선택 ${pick.size}건 편입`}
              </button>
            </div>
            {onlyMain && otherCpaCnt > 0 && (
              <div className="alert-i" style={{ fontSize: 'var(--fs-1)' }}>
                김준성·조현규 담당 세무조정 계약 <b>{otherCpaCnt}건</b>은 숨겨져 있습니다 — 이 시스템으로 청구하지 않고 매출계약으로만 매출을 잡습니다.
              </div>
            )}

            <div style={{ maxHeight: '55vh', overflow: 'auto', border: '1px solid var(--rule)', borderRadius: 6 }}>
              <table className="tbl" style={{ fontSize: 'var(--fs-1)' }}>
                <thead>
                  <tr>
                    <th style={{ width: 32 }}></th>
                    <th>코드</th><th>구분</th><th>거래처</th><th>유형</th><th className="r">계약금액</th><th>담당CPA</th><th>사업자번호</th><th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {view.length === 0 && (
                    <tr><td colSpan={9} style={{ textAlign: 'center', padding: 20, color: 'var(--ink-4)' }}>
                      가져올 계약이 없습니다. 거래처관리 › 매출계약등록에서 {fiscalYear}년 귀속 법인세·종합소득세 계약을 먼저 등록하세요.
                    </td></tr>
                  )}
                  {view.map((r) => (
                    <tr key={r.contractId} style={{ opacity: r.already ? 0.45 : 1 }}>
                      <td>
                        <input
                          type="checkbox"
                          disabled={r.already}
                          checked={pick.has(r.contractId)}
                          onChange={() =>
                            setPick((prev) => {
                              const n = new Set(prev);
                              if (n.has(r.contractId)) n.delete(r.contractId);
                              else n.add(r.contractId);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: 'var(--fs-1)' }}>{r.code}</td>
                      <td><span className={`bdg ${r.bizType === '법인' ? 'b-law' : 'b-per'}`}>{r.bizType}</span></td>
                      <td style={{ fontWeight: 700, color: 'var(--navy)' }}>{r.companyName}</td>
                      <td>{r.taxType}{!r.confirmed && <span style={{ marginLeft: 4, fontSize: 'var(--fs-0)', fontWeight: 700, color: 'var(--warn)', background: '#FEF3C7', border: '1px solid #FCD34D', padding: '0 4px', borderRadius: 3 }}>미계약</span>}</td>
                      <td className="r">{fm(r.amount)}</td>
                      <td>{r.cpa || <span style={{ color: 'var(--ink-4)' }}>—</span>}</td>
                      <td style={{ fontSize: 'var(--fs-1)' }}>{r.taxId || <span style={{ color: 'var(--ink-4)' }}>—</span>}</td>
                      <td>{r.already ? <span style={{ color: 'var(--ink-3)' }}>편입됨</span> : r.placeStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
