// 거래처 관리 탭 — 원본 HTML rClients() 포팅 (목록·필터·정렬·CRUD)
import { useMemo, useState } from 'react';
import type { Client } from '../../types';
import { CURRENT_YEAR } from '../../lib/constants';
import { fm, dtFmt, getRevForYear, getClientDispYears, sortIndicator } from '../../lib/format';
import { createClient, updateClient, deleteClient, deleteClients } from '../../lib/clientsApi';
import { useClients } from '../../hooks/useClients';
import ClientForm, { type ClientFormData } from './ClientForm';

export default function ClientsTab() {
  const { clients, loading, error, refresh } = useClients();
  const [filter, setFilter] = useState('');
  const [bizFilter, setBizFilter] = useState('');
  const [displayYear, setDisplayYear] = useState(CURRENT_YEAR);
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const norm = (s: string) => s.replace(/-/g, '');

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

  const allSel = view.length > 0 && view.every((c) => selected.has(c.id));

  function clientSort(key: string) {
    if (sortKey === key) setSortDir((d) => d * -1);
    else {
      setSortKey(key);
      setSortDir(1);
    }
  }

  function toggleSel(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSel ? new Set() : new Set(view.map((c) => c.id)));
  }

  // 신규 추가: 사업자번호 기준 upsert (원본 upsertClient)
  async function handleAdd(data: ClientFormData, mgrYear: number, modelYear: number) {
    const dup = data.taxId ? clients.find((c) => c.taxId && norm(c.taxId) === norm(data.taxId)) : undefined;
    try {
      if (dup) {
        const upd: Partial<Client> = { revenues: { ...(dup.revenues || {}), ...data.revenues } };
        if (data.companyName && data.companyName !== dup.companyName)
          upd.companyName = `${data.companyName}(M:${dup.companyName})`;
        if (data.manager && mgrYear) {
          upd.managers = { ...(dup.managers || {}), [mgrYear]: data.manager };
          upd.manager = data.manager;
        } else if (data.manager) upd.manager = data.manager;
        if (modelYear) {
          upd.modelYears = { ...(dup.modelYears || {}), [modelYear]: data.isModel };
          upd.isModel = data.isModel;
        }
        if (data.tradeName) upd.tradeName = data.tradeName;
        if (data.repName) upd.repName = data.repName;
        if (data.bankAccount) upd.bankAccount = data.bankAccount;
        await updateClient(dup.id, upd);
        alert(`기존 거래처(${dup.companyName})를 갱신했습니다.`);
      } else {
        await createClient({ ...data, managers: {}, modelYears: {}, lossYears: [] });
      }
      setShowAdd(false);
      await refresh();
    } catch (e) {
      alert('저장 실패: ' + (e instanceof Error ? e.message : e));
    }
  }

  // 수정 저장 (원본 doSaveClient: id 경로)
  async function handleEdit(
    target: Client,
    data: ClientFormData,
    mgrYear: number,
    modelYear: number,
  ) {
    const revenues = { ...(target.revenues || {}), ...data.revenues };
    const upd: Partial<Client> = {
      bizType: data.bizType,
      manager: data.manager,
      companyName: data.companyName,
      tradeName: data.tradeName,
      taxId: data.taxId,
      repName: data.repName,
      bankAccount: data.bankAccount,
      isModel: data.isModel,
      revenues,
    };
    if (mgrYear && data.manager) upd.managers = { ...(target.managers || {}), [mgrYear]: data.manager };
    if (modelYear) upd.modelYears = { ...(target.modelYears || {}), [modelYear]: data.isModel };
    try {
      await updateClient(target.id, upd);
      setEditingId(null);
      await refresh();
    } catch (e) {
      alert('저장 실패: ' + (e instanceof Error ? e.message : e));
    }
  }

  async function handleDelete(c: Client) {
    if (!confirm(`'${c.companyName}'을(를) 삭제하시겠습니까?`)) return;
    try {
      await deleteClient(c.id);
      setSelected((prev) => {
        const n = new Set(prev);
        n.delete(c.id);
        return n;
      });
      await refresh();
    } catch (e) {
      alert('삭제 실패: ' + (e instanceof Error ? e.message : e));
    }
  }

  async function handleBulkDelete() {
    if (!confirm(`선택한 ${selected.size}개 거래처를 삭제하시겠습니까?`)) return;
    setBusy(true);
    try {
      await deleteClients([...selected]);
      setSelected(new Set());
      await refresh();
    } catch (e) {
      alert('삭제 실패: ' + (e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
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

  const colCount = 7 + dispYears.length + 3;

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
          {selected.size > 0 && (
            <button className="btn-sm btn-sm-red" onClick={handleBulkDelete} disabled={busy}>
              선택 {selected.size}개 삭제
            </button>
          )}
          <button
            className="btn-sm"
            onClick={() => {
              setShowAdd(true);
              setEditingId(null);
            }}
          >
            + 새 거래처
          </button>
        </div>
      </div>

      {error && <div className="alert-w">{error}</div>}
      <div className="alert-i" style={{ fontSize: 11 }}>
        신규/상실은 청구기록 기반 자동 판단입니다. 사업자번호가 같은 거래처를 새로 추가하면 기존 정보가 갱신됩니다.
      </div>

      {showAdd && editingId === null && (
        <ClientForm isAdd onSubmit={handleAdd} onCancel={() => setShowAdd(false)} />
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

      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input type="checkbox" checked={allSel} onChange={toggleAll} title="전체선택" />
              </th>
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
                  selected={selected.has(c.id)}
                  editing={editingId === c.id}
                  colCount={colCount}
                  onToggleSel={() => toggleSel(c.id)}
                  onEdit={() => {
                    setEditingId(c.id);
                    setShowAdd(false);
                  }}
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
  selected: boolean;
  editing: boolean;
  colCount: number;
  onToggleSel: () => void;
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
  selected,
  editing,
  colCount,
  onToggleSel,
  onEdit,
  onDelete,
  onModelYear,
  onToggleLoss,
  onSubmitEdit,
  onCancelEdit,
}: RowProps) {
  return (
    <>
      <tr>
        <td>
          <input type="checkbox" checked={selected} onChange={onToggleSel} />
        </td>
        <td>
          <span className={`bdg ${c.bizType === '법인' ? 'b-law' : 'b-per'}`}>{c.bizType}</span>
        </td>
        <td>{c.manager}</td>
        <td style={{ fontWeight: 700, color: '#1A2B52' }}>{c.companyName}</td>
        <td>{c.tradeName}</td>
        <td style={{ fontSize: 11 }}>{c.taxId}</td>
        <td style={{ textAlign: 'center' }}>
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
        </td>
        {dispYears.map((y) => {
          const rv = getRevForYear(c, y);
          const isLoss = (c.lossYears || []).map(Number).includes(Number(y));
          if (!rv) {
            return (
              <td key={y} className="r" style={{ fontFamily: 'monospace', fontSize: 11, color: '#CCC' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                  <span style={{ color: '#CCC' }}>N/A</span>
                  <button
                    className={`btn-sm ${isLoss ? 'btn-sm-red' : 'btn-sm-del'}`}
                    style={{ fontSize: 10, padding: '1px 6px' }}
                    onClick={() => onToggleLoss(y, !isLoss)}
                    title={isLoss ? '상실 해제' : '상실 처리'}
                  >
                    {isLoss ? '상실 ✓' : '상실?'}
                  </button>
                </div>
              </td>
            );
          }
          return (
            <td key={y} className="r" style={{ fontFamily: 'monospace', fontSize: 11 }}>
              {fm(rv)}
            </td>
          );
        })}
        <td style={{ fontSize: 10, color: '#888', whiteSpace: 'nowrap' }}>{dtFmt(c.createdAt)}</td>
        <td style={{ fontSize: 10, color: '#888', whiteSpace: 'nowrap' }}>{dtFmt(c.updatedAt)}</td>
        <td>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn-sm btn-sm-blue" onClick={onEdit} title="수정">
              ✏️
            </button>
            <button className="btn-sm btn-sm-del" onClick={onDelete} title="삭제">
              🗑
            </button>
          </div>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={colCount}>
            <ClientForm isAdd={false} initial={c} onSubmit={onSubmitEdit} onCancel={onCancelEdit} />
          </td>
        </tr>
      )}
    </>
  );
}
