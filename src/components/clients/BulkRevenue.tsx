// 매출액 일괄입력 화면 — 원본 rClientsBulkRev/doSaveBulkRevenues/applyExcelPaste 포팅
import { useMemo, useState } from 'react';
import type { Client } from '../../types';
import { CURRENT_YEAR, ALL_YEARS } from '../../lib/constants';
import { fm, getRevForYear } from '../../lib/format';
import { updateClient } from '../../lib/clientsApi';

export default function BulkRevenue({
  clients,
  onBack,
  onChanged,
}: {
  clients: Client[];
  onBack: () => void;
  onChanged: () => Promise<void>;
}) {
  const [year, setYear] = useState(CURRENT_YEAR - 1);
  const [filter, setFilter] = useState('');
  const [biz, setBiz] = useState('');
  const [revInputs, setRevInputs] = useState<Record<string, string>>({});
  const [modelInputs, setModelInputs] = useState<Record<string, string>>({});
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);

  const yearPills = useMemo(
    () => ALL_YEARS.filter((y) => y >= 2020 && y <= CURRENT_YEAR + 2).slice(0, 8),
    [],
  );

  const list = useMemo(() => {
    let l = clients;
    if (filter) l = l.filter((c) => (c.companyName + c.manager).includes(filter));
    if (biz) l = l.filter((c) => c.bizType === biz);
    return l;
  }, [clients, filter, biz]);

  // 입력값 키는 '연도:거래처' — 연도를 바꿨을 때 이전 연도 입력이 넘어와
  // 다른 연도 값으로 저장되는 것을 막는다.
  const key = (clientId: string, y: number = year) => `${y}:${clientId}`;

  // 입력값(없으면 현재값) 조회
  const revVal = (c: Client) => {
    const k = key(c.id);
    if (revInputs[k] !== undefined) return revInputs[k];
    const cur = getRevForYear(c, year);
    return cur ? String(cur) : '';
  };
  const modelVal = (c: Client) => {
    const k = key(c.id);
    if (modelInputs[k] !== undefined) return modelInputs[k];
    const mv = (c.modelYears || {})[String(year)];
    return mv === true ? 'O' : mv === false ? 'X' : '';
  };

  /** 현재 연도에 아직 저장하지 않은 입력 수 — 화면에 표시해 잊고 넘어가지 않게 한다. */
  const pendingCount = useMemo(() => {
    const pre = `${year}:`;
    return (
      Object.keys(revInputs).filter((k) => k.startsWith(pre)).length +
      Object.keys(modelInputs).filter((k) => k.startsWith(pre)).length
    );
  }, [revInputs, modelInputs, year]);

  async function saveAll() {
    setBusy(true);
    let saved = 0;
    let modelSaved = 0;
    try {
      const ops: Promise<void>[] = [];
      // 필터가 걸려 있어도 입력해 둔 값은 모두 저장한다.
      // (list 만 순회하면 화면에서 가려진 거래처의 입력이 저장되지 않은 채 지워졌다)
      for (const c of clients) {
        const revs = { ...(c.revenues || {}) };
        const mys = { ...(c.modelYears || {}) };
        let changed = false;
        const rin = revInputs[key(c.id)];
        if (rin !== undefined) {
          const v = parseFloat(rin);
          if (v > 0) {
            if (revs[String(year)] !== v) {
              revs[String(year)] = v;
              changed = true;
              saved++;
            }
          } else if ((v === 0 || rin === '') && revs[String(year)] !== undefined) {
            delete revs[String(year)];
            changed = true;
          }
        }
        const min = modelInputs[key(c.id)];
        if (min !== undefined) {
          if (min === 'O' || min === 'X') {
            const mv = min === 'O';
            if (mys[String(year)] !== mv) {
              mys[String(year)] = mv;
              changed = true;
              modelSaved++;
            }
          } else if (min === '' && mys[String(year)] !== undefined) {
            delete mys[String(year)];
            changed = true;
          }
        }
        if (changed) ops.push(updateClient(c.id, { revenues: revs, modelYears: mys }));
      }
      await Promise.all(ops);
      const pre = `${year}:`;
      const dropYear = (m: Record<string, string>) =>
        Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith(pre)));
      setRevInputs(dropYear);
      setModelInputs(dropYear);
      await onChanged();
      alert(`✅ ${year}년 저장 완료\n매출액 입력 ${saved}건 · 성실신고 ${modelSaved}건`);
    } catch (e) {
      alert('저장 실패: ' + (e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function applyPaste() {
    if (!paste.trim()) {
      alert('붙여넣을 데이터가 없습니다.');
      return;
    }
    setBusy(true);
    try {
      const norm = (s: string) => s.replace(/-/g, '');
      const lines = paste.trim().split('\n');
      let matched = 0;
      const ops: Promise<void>[] = [];
      for (const line of lines) {
        const cols = line.split('\t').map((s) => s.trim().replace(/,/g, ''));
        if (cols.length < 2) continue;
        const key = cols[0];
        const val = parseFloat(cols[cols.length - 1]);
        if (!key || !val || isNaN(val)) continue;
        const c = clients.find(
          (x) => (x.taxId && norm(x.taxId) === norm(key)) || x.companyName === key,
        );
        if (c) {
          const revs = { ...(c.revenues || {}), [String(year)]: val };
          ops.push(updateClient(c.id, { revenues: revs }));
          matched++;
        }
      }
      if (matched === 0) {
        alert('매칭된 거래처가 없습니다.\n사업자번호 또는 회사명이 정확한지 확인해 주세요.');
        return;
      }
      await Promise.all(ops);
      setPaste('');
      await onChanged();
      alert(`✅ ${matched}개 거래처 ${year}년 매출액 적용 완료`);
    } catch (e) {
      alert('적용 실패: ' + (e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="chdr">
        매출액 일괄입력
        <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onBack}>
          ← 거래처 목록으로
        </button>
      </div>

      <div className="alert-i" style={{ fontSize: 11 }}>
        <strong>방법 ①</strong> 표에서 직접 입력 후 [일괄 저장] &nbsp;|&nbsp; <strong>방법 ②</strong> 엑셀에서
        사업자번호·매출액 2열 복사 → 하단 붙여넣기
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1A2B52' }}>귀속연도:</span>
        <div className="pills">
          {yearPills.map((y) => (
            <span key={y} className={`pill${year === y ? ' on' : ''}`} onClick={() => setYear(y)}>
              {y}년
            </span>
          ))}
        </div>
        <button
          className="btn-p"
          style={{ marginLeft: 'auto' }}
          onClick={saveAll}
          disabled={busy}
          title={pendingCount > 0 ? '검색으로 가려진 거래처의 입력도 함께 저장됩니다' : undefined}
        >
          💾 일괄 저장 ({year}년){pendingCount > 0 ? ` · 미저장 ${pendingCount}` : ''}
        </button>
      </div>

      <div className="sbar">
        <input placeholder="🔍 거래처명·담당자" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select value={biz} onChange={(e) => setBiz(e.target.value)}>
          <option value="">전체 구분</option>
          <option value="법인">법인</option>
          <option value="개인">개인</option>
        </select>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>구분</th>
              <th>담당자</th>
              <th>거래처명</th>
              <th>사업자번호</th>
              <th className="r">{year}년 매출액 (현재)</th>
              <th style={{ minWidth: 160 }}>{year}년 매출액 (신규입력)</th>
              <th style={{ minWidth: 130, textAlign: 'center' }}>{year}년 성실신고</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 24, color: '#BBB' }}>
                  거래처 없음
                </td>
              </tr>
            )}
            {list.map((c) => {
              const cur = getRevForYear(c, year);
              return (
                <tr key={c.id}>
                  <td>
                    <span className={`bdg ${c.bizType === '법인' ? 'b-law' : 'b-per'}`}>{c.bizType}</span>
                  </td>
                  <td>{c.manager}</td>
                  <td style={{ fontWeight: 700, color: '#1A2B52' }}>{c.companyName}</td>
                  <td style={{ fontSize: 11 }}>{c.taxId}</td>
                  <td className="r" style={{ fontFamily: 'monospace', color: cur ? '#1A2B52' : '#BBB' }}>
                    {cur ? fm(cur) : 'N/A'}
                  </td>
                  <td>
                    <input
                      type="number"
                      value={revVal(c)}
                      placeholder="미입력시 기존값 유지"
                      onChange={(e) => setRevInputs((p) => ({ ...p, [key(c.id)]: e.target.value }))}
                      style={{ width: '100%', textAlign: 'right' }}
                    />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <select
                      value={modelVal(c)}
                      onChange={(e) => setModelInputs((p) => ({ ...p, [key(c.id)]: e.target.value }))}
                      style={{ width: '100%', padding: '4px 6px', fontSize: 12 }}
                    >
                      <option value="">❓ 미확정</option>
                      <option value="O">✅ O 해당</option>
                      <option value="X">✗ X 미해당</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #EDE9E2' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 7 }}>
          📋 Excel 붙여넣기 (사업자번호 ⇥ 매출액)
        </div>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
          엑셀에서 [사업자번호] [매출액] 2개 열을 복사(Ctrl+C) 후 아래에 붙여넣기(Ctrl+V)
        </div>
        <textarea
          rows={6}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={'430-88-01343\t1270633180\n...'}
          style={{
            width: '100%',
            fontFamily: 'monospace',
            fontSize: 12,
            padding: 8,
            border: '1px solid #D0CCC4',
            borderRadius: 6,
          }}
        />
        <div style={{ display: 'flex', gap: 7, marginTop: 7 }}>
          <button className="btn-gold" onClick={applyPaste} disabled={busy}>
            📋 붙여넣기 적용 ({year}년)
          </button>
          <button className="btn-s" onClick={() => setPaste('')}>
            초기화
          </button>
        </div>
      </div>
    </div>
  );
}
