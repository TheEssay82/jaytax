// 세무조정수수료관리 › 거래처 관리 탭 — 매출액·성실신고 관리 전용.
// 거래처 '등록'은 거래처관리(biz_*) 한 곳에서만 한다(0071). 여기서는 청구 대상 거래처를
// 거래처관리에서 '가져오기'로 편입하고, 청구에만 쓰이는 값(가상계좌 등)과 연도별 매출액·
// 성실신고를 관리한다. 청구이력이 붙은 거래처는 지울 수 없다.
import { useEffect, useMemo, useState } from 'react';
import type { Client } from '../../types';
import { CURRENT_YEAR } from '../../lib/constants';
import { fm, dtFmt, getRevForYear, getClientDispYears, sortIndicator } from '../../lib/format';
import {
  updateClient, deleteClient, clientBillingUsage,
  listImportablePlaces, importPlacesAsClients, type ImportablePlace,
} from '../../lib/clientsApi';
import { useClients } from '../../hooks/useClients';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../lib/roles';
import ClientForm, { type ClientFormData } from './ClientForm';
import BulkRevenue from './BulkRevenue';

export default function ClientsTab() {
  const { clients, loading, error, refresh } = useClients();
  const { role, readonly } = useAuth();
  // 전체 관리(등록·삭제·일괄·엑셀·모든 필드) 권한. 없으면(기장팀원) 일부 필드만 수정.
  const canManage = can(role, 'manageClients');
  const [filter, setFilter] = useState('');
  const [bizFilter, setBizFilter] = useState('');
  const [displayYear, setDisplayYear] = useState(CURRENT_YEAR);
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

  if (loading) {
    return (
      <div className="card">
        <div className="chdr">🏢 거래처 관리</div>
        <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>불러오는 중…</div>
      </div>
    );
  }

  if (mode === 'bulk') {
    return <BulkRevenue clients={clients} onBack={() => setMode('list')} onChanged={refresh} />;
  }

  // 체크박스 열은 관리자(일괄삭제)만 → 팀원은 열 하나 줄어든다.
  const colCount = 6 + dispYears.length + 3;

  return (
    <div className="card">
      <div className="chdr">
        거래처 관리 (총 {clients.length}개)
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            gap: 5,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          {!readonly && canManage && (
            <>
              <button className="btn-sm btn-sm-blue" style={{ fontWeight: 600 }} onClick={() => setMode('bulk')}>
                📊 매출액 일괄입력
              </button>
              <button className="btn-p" onClick={() => setShowImport(true)}>
                ＋ 거래처관리에서 가져오기
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="alert-w">{error}</div>}
      {canManage ? (
        <div className="alert-i" style={{ fontSize: 11 }}>
          매출 셀: <b>숫자</b>=매출액 · <b style={{ color: '#6B7280' }}>0</b>=매출 0원(기록됨) · <b style={{ color: '#CCC' }}>—</b>=데이터 없음 · <span className="bdg b-loss">상실</span>=거래종료(‘상실?’ 버튼으로 처리/‘해제’로 취소). <b>거래처 등록은 거래처관리에서</b> 하고, 여기에는 <b>＋ 거래처관리에서 가져오기</b>로 청구 대상만 편입합니다.
        </div>
      ) : (
        <div className="alert-i" style={{ fontSize: 11 }}>
          🔧 기장팀원은 <b>사업자번호·대표자명·가상계좌·성실신고</b>만 수정할 수 있습니다. 거래처 편입·제외·매출/담당자 변경은 기장팀장 이상만 가능합니다.
        </div>
      )}

      {showImport && canManage && !readonly && (
        <ImportFromBiz
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
        <span style={{ fontSize: 12, color: '#555', fontWeight: 700, whiteSpace: 'nowrap' }}>
          매출액 기준연도:
        </span>
        <select
          value={displayYear}
          onChange={(e) => setDisplayYear(parseInt(e.target.value))}
          style={{ fontWeight: 700 }}
        >
          {baseOpts.map((y) => (
            <option key={y} value={y}>
              {y}년 기준
            </option>
          ))}
        </select>
        <span style={{ fontSize: 10, color: '#888', whiteSpace: 'nowrap' }}>
          ← 기준연도 포함 최근 4개년 + 데이터 있는 연도 전체 표시
        </span>
      </div>

      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
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
              <th>등록일</th>
              <th>수정일</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && (
              <tr>
                <td colSpan={colCount} style={{ textAlign: 'center', padding: 24, color: '#BBB' }}>
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
  return (
    <>
      <tr>
        <td>
          <span className={`bdg ${c.bizType === '법인' ? 'b-law' : 'b-per'}`}>{c.bizType}</span>
        </td>
        <td>{c.manager}</td>
        <td style={{ fontWeight: 700, color: '#1A2B52' }}>{c.companyName}</td>
        <td>{c.tradeName}</td>
        <td style={{ fontSize: 11 }}>{c.taxId}</td>
        <td style={{ textAlign: 'center' }}>
          {canManage ? (
            <select
              value={mv === true ? 'O' : mv === false ? 'X' : ''}
              onChange={(e) => onModelYear(e.target.value)}
              style={{
                width: 82,
                padding: '2px 3px',
                fontSize: 11,
                border: '1px solid #D0CCC4',
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
            <span style={{ fontSize: 11, color: '#555' }}>{mv === true ? '✅ O' : mv === false ? '✗ X' : '❓'}</span>
          )}
        </td>
        {dispYears.map((y) => {
          const rv = getRevForYear(c, y);
          const hasKey = !!c.revenues && Object.prototype.hasOwnProperty.call(c.revenues, String(y));
          const isLoss = (c.lossYears || []).map(Number).includes(Number(y));
          // ① 상실 확정 — 빨강 '상실' + 해제 버튼
          if (isLoss) {
            return (
              <td key={y} className="r" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                  <span className="bdg b-loss">상실</span>
                  {canManage && (
                    <button
                      className="btn-sm btn-sm-del"
                      style={{ fontSize: 10, padding: '1px 6px' }}
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
              <td key={y} className="r" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                {fm(rv)}
              </td>
            );
          }
          // ③ 매출 0(기록됨) / 데이터 없음 — 구분 표기 + 상실 처리 버튼
          return (
            <td key={y} className="r" style={{ fontFamily: 'monospace', fontSize: 11 }}>
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
                    style={{ fontSize: 10, padding: '1px 6px' }}
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
        <td style={{ fontSize: 10, color: '#888', whiteSpace: 'nowrap' }}>{dtFmt(c.createdAt)}</td>
        <td style={{ fontSize: 10, color: '#888', whiteSpace: 'nowrap' }}>{dtFmt(c.updatedAt)}</td>
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

// ── 거래처관리에서 가져오기 ────────────────────────────────
// 거래처관리 사업장 목록에서 골라 청구 거래처(clients)로 편입한다. 값은 이때 한 번 복사되고
// 이후 거래처관리에서 이름이 바뀌어도 따라오지 않는다(과거 청구서 표기 보호).
function ImportFromBiz({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [rows, setRows] = useState<ImportablePlace[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [hideTaken, setHideTaken] = useState(true);
  const [hideClosed, setHideClosed] = useState(true);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listImportablePlaces()
      .then(setRows)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const view = useMemo(() => {
    let list = rows ?? [];
    if (hideTaken) list = list.filter((r) => !r.already);
    if (hideClosed) list = list.filter((r) => r.status === '정상');
    if (q.trim()) {
      const k = q.trim().toLowerCase();
      list = list.filter((r) => (r.code + r.companyName + r.placeName + r.taxId + r.manager).toLowerCase().includes(k));
    }
    return list;
  }, [rows, q, hideTaken, hideClosed]);

  async function run() {
    const target = (rows ?? []).filter((r) => pick.has(r.placeId) && !r.already);
    if (!target.length) return;
    if (!confirm(`${target.length}개 사업장을 청구 거래처로 가져올까요?`)) return;
    setBusy(true);
    try {
      const n = await importPlacesAsClients(target);
      alert(`✅ ${n}개 거래처를 가져왔습니다.`);
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
          <b style={{ color: '#1A2B52' }}>거래처관리에서 가져오기</b>
          <span style={{ fontSize: 11, color: '#888' }}>사업장 단위로 편입 · 이미 편입된 건은 회색</span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>

        {err && <div className="alert-w">{err}</div>}
        {!rows && !err && <div style={{ padding: 20, color: '#888', fontSize: 12.5 }}>불러오는 중…</div>}

        {rows && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <input placeholder="🔍 코드·거래처·사업장·사업자번호·담당직원" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
              <label style={{ fontSize: 11.5 }}>
                <input type="checkbox" checked={hideTaken} onChange={(e) => setHideTaken(e.target.checked)} /> 편입된 건 숨김
              </label>
              <label style={{ fontSize: 11.5 }}>
                <input type="checkbox" checked={hideClosed} onChange={(e) => setHideClosed(e.target.checked)} /> 정상 사업장만
              </label>
              <button className="btn-p" disabled={busy || pick.size === 0} onClick={() => void run()}>
                {busy ? '처리 중…' : `선택 ${pick.size}개 가져오기`}
              </button>
            </div>

            <div style={{ maxHeight: '55vh', overflow: 'auto', border: '1px solid #E5E1D8', borderRadius: 6 }}>
              <table className="tbl" style={{ fontSize: 11.5 }}>
                <thead>
                  <tr>
                    <th style={{ width: 32 }}></th>
                    <th>코드</th><th>구분</th><th>거래처</th><th>사업장</th><th>사업자번호</th><th>대표자</th><th>담당직원</th><th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {view.length === 0 && (
                    <tr><td colSpan={9} style={{ textAlign: 'center', padding: 20, color: '#BBB' }}>가져올 사업장이 없습니다.</td></tr>
                  )}
                  {view.map((r) => (
                    <tr key={r.placeId} style={{ opacity: r.already ? 0.45 : 1 }}>
                      <td>
                        <input
                          type="checkbox"
                          disabled={r.already}
                          checked={pick.has(r.placeId)}
                          onChange={() =>
                            setPick((prev) => {
                              const n = new Set(prev);
                              if (n.has(r.placeId)) n.delete(r.placeId);
                              else n.add(r.placeId);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.code}</td>
                      <td><span className={`bdg ${r.bizType === '법인' ? 'b-law' : 'b-per'}`}>{r.bizType}</span></td>
                      <td style={{ fontWeight: 700, color: '#1A2B52' }}>{r.companyName}</td>
                      <td>{r.placeName}</td>
                      <td style={{ fontSize: 11 }}>{r.taxId || <span style={{ color: '#CCC' }}>—</span>}</td>
                      <td>{r.repName}</td>
                      <td>{r.manager}</td>
                      <td>{r.already ? <span style={{ color: '#888' }}>편입됨</span> : r.status}</td>
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
