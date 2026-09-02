// 기장등청구관리 › 매출통계
//
// 청구 한 건마다 그 시점의 담당(회계사·직원)과 금액이 굳어 있다(biz_invoice_request).
// 계약을 지금 읽는 것이 아니라 **청구 시점 기록**을 더하므로, 담당이 바뀌어도 과거 실적은 변하지 않는다.
//
// 화면은 **엑셀 피벗**처럼 쓴다 — 행과 열에 원하는 구분자를 놓고, 값은 공급가액이나 건수로 본다.
// 담당직원처럼 한 건이 여럿에게 나뉘는 축은 비율만큼 쪼개 더하므로 합계가 부풀지 않는다.
//
// 기간은 **사업연도(7/1~익년 6/30)** 가 기본이다. FY2026 = 2026-07~2027-06.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { todayYmd, kstDateTime } from '../../lib/format';
import { listStaffChangeLog, type StaffChangeLog } from '../../lib/invoiceStaffApi';
import {
  listRevenueFacts, pivot, DIMS, fyOf, fyRange, fyLabel,
  type RevenueFact, type Dim,
} from '../../lib/revenueStatsApi';

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const dimOf = (key: string): Dim => DIMS.find((d) => d.key === key) ?? DIMS[0];

export default function StaffRevenueTab() {
  const thisMonth = todayYmd().slice(0, 7);
  const curFy = fyOf(thisMonth);

  const [fy, setFy] = useState<number | ''>(curFy);        // '' = 기간 직접 지정
  const [from, setFrom] = useState(() => fyRange(curFy).from);
  const [to, setTo] = useState(() => fyRange(curFy).to);
  const [team, setTeam] = useState('');
  const [rowKey, setRowKey] = useState('staff');
  const [colKey, setColKey] = useState('ym');
  const [value, setValue] = useState<'supply' | 'count'>('supply');
  const [cpaF, setCpaF] = useState('');
  const [staffF, setStaffF] = useState('');
  const [typeF, setTypeF] = useState('');
  const [erpF, setErpF] = useState('');

  const [facts, setFacts] = useState<RevenueFact[]>([]);
  const [logs, setLogs] = useState<StaffChangeLog[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  /** 감사팀은 회계사 단위로만 본다 — 팀을 감사팀으로 좁히면 행을 담당회계사로 바꿔 준다. */
  useEffect(() => {
    if (team === '감사team' && rowKey === 'staff') setRowKey('cpa');
  }, [team, rowKey]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setErr(null);
      const [f, l] = await Promise.all([
        listRevenueFacts(from, to, team || undefined),
        listStaffChangeLog(100),
      ]);
      setFacts(f); setLogs(l);
    } catch (e) { setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, [from, to, team]);
  useEffect(() => { void load(); }, [load]);

  /** FY 를 고르면 기간이 그 사업연도(7월~익년 6월)로 맞춰진다. */
  function pickFy(v: string) {
    if (!v) { setFy(''); return; }
    const n = Number(v);
    const r = fyRange(n);
    setFy(n); setFrom(r.from); setTo(r.to);
  }
  const fyOpts = useMemo(() => {
    const l: number[] = [];
    for (let y = curFy + 1; y >= curFy - 4; y--) l.push(y);
    return l;
  }, [curFy]);

  // 필터 후보는 지금 불러온 자료에서 뽑는다 — 쓰이지 않는 값은 내놓지 않는다.
  const opts = useMemo(() => {
    const u = (l: string[]) => [...new Set(l.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
    return {
      cpa: u(facts.map((f) => f.cpa)),
      staff: u(facts.flatMap((f) => f.shares.map((s) => s.name))),
      type: u(facts.map((f) => f.typeTop)),
      erp: u(facts.map((f) => f.erpAccount)),
    };
  }, [facts]);

  const filtered = useMemo(() => facts.filter((f) => {
    if (cpaF && f.cpa !== cpaF) return false;
    if (staffF && !f.shares.some((s) => s.name === staffF)) return false;
    if (typeF && f.typeTop !== typeF) return false;
    if (erpF && f.erpAccount !== erpF) return false;
    return true;
  }), [facts, cpaF, staffF, typeF, erpF]);

  const p = useMemo(
    () => pivot(filtered, dimOf(rowKey), dimOf(colKey), value),
    [filtered, rowKey, colKey, value],
  );
  const fmt = (n: number) => (value === 'count' ? String(Math.round(n * 100) / 100) : won(n));
  const max = Math.max(1, ...p.rows.map((r) => p.rowTotal.get(r) ?? 0));
  const filterCount = [cpaF, staffF, typeF, erpF].filter(Boolean).length;

  function copyTsv() {
    const head = ['', ...p.cols, '합계'].join('\t');
    const body = p.rows.map((r) => [
      r, ...p.cols.map((c) => Math.round(p.cell.get(`${r}|${c}`) ?? 0)), Math.round(p.rowTotal.get(r) ?? 0),
    ].join('\t'));
    const foot = ['합계', ...p.cols.map((c) => Math.round(p.colTotal.get(c) ?? 0)), Math.round(p.grand)].join('\t');
    void navigator.clipboard.writeText([head, ...body, foot].join('\n'));
  }

  if (loading) return <div className="card">불러오는 중…</div>;

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        📊 매출통계
        <select value={fy === '' ? '' : String(fy)} onChange={(e) => pickFy(e.target.value)} style={{ fontWeight: 700 }}
          title="사업연도를 고르면 기간이 7월~익년 6월로 맞춰집니다">
          {fyOpts.map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}
          <option value="">기간 직접 지정</option>
        </select>
        <input type="month" value={from} onChange={(e) => { if (e.target.value) { setFrom(e.target.value); setFy(''); } }}
          style={{ fontWeight: 700 }} />
        <span style={{ color: '#999' }}>~</span>
        <input type="month" value={to} onChange={(e) => { if (e.target.value) { setTo(e.target.value); setFy(''); } }}
          style={{ fontWeight: 700 }} />
        <select value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">전체 팀</option>
          <option value="taxteam">taxteam</option>
          <option value="감사team">감사팀</option>
        </select>
        <span style={{ fontSize: 11, fontWeight: 400, color: '#888' }}>
          {filtered.length}건 · 공급가액 {won(filtered.reduce((s, f) => s + f.supply, 0))}
        </span>
      </div>
      {err && <div className="alert-w">{err}</div>}

      {/* ── 피벗 조건 ── */}
      <div style={{
        border: '1px solid #e2d9c6', background: '#fdfaf3', borderRadius: 6,
        padding: '8px 10px', marginBottom: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
      }}>
        <label style={{ fontSize: 11.5, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <b style={{ color: '#1A2B52' }}>행</b>
          <select value={rowKey} onChange={(e) => setRowKey(e.target.value)} style={{ fontWeight: 700 }}>
            {DIMS.filter((d) => d.key !== 'none').map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11.5, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <b style={{ color: '#1A2B52' }}>열</b>
          <select value={colKey} onChange={(e) => setColKey(e.target.value)} style={{ fontWeight: 700 }}>
            {DIMS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11.5, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <b style={{ color: '#1A2B52' }}>값</b>
          <select value={value} onChange={(e) => setValue(e.target.value as 'supply' | 'count')}>
            <option value="supply">공급가액</option>
            <option value="count">건수</option>
          </select>
        </label>
        <span style={{ color: '#ddd' }}>|</span>
        <Filter label="담당회계사" value={cpaF} onChange={setCpaF} opts={opts.cpa} />
        <Filter label="담당직원" value={staffF} onChange={setStaffF} opts={opts.staff} />
        <Filter label="매출유형" value={typeF} onChange={setTypeF} opts={opts.type} />
        <Filter label="매출계정" value={erpF} onChange={setErpF} opts={opts.erp} />
        {filterCount > 0 && (
          <button className="btn-sm" onClick={() => { setCpaF(''); setStaffF(''); setTypeF(''); setErpF(''); }}>
            필터 초기화 ({filterCount})
          </button>
        )}
        <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={copyTsv}
          title="지금 표를 탭으로 구분해 복사합니다 — 엑셀에 그대로 붙습니다">
          📋 엑셀로 복사
        </button>
      </div>

      <div className="alert-i" style={{ fontSize: 11 }}>
        청구할 때 굳혀 둔 <b>그 시점의 담당·금액</b>을 더한 것입니다. 계약이 나중에 바뀌어도 지난 통계는 변하지 않습니다.
        <br />· <b>행·열</b>에 원하는 구분자를 놓으면 엑셀 피벗처럼 잘라 볼 수 있습니다(담당직원 × 귀속월, 매출유형 × 담당회계사 …).
        <br />· <b>담당직원</b>은 배분 비율만큼 쪼개 더합니다 — 공동담당 건도 합계가 부풀지 않습니다.
        <b> 감사팀은 회계사 단위</b>로만 보므로, 팀을 감사팀으로 좁히면 행이 담당회계사로 바뀝니다.
        <br />· 기간의 기본은 <b>사업연도(7월~익년 6월)</b>입니다. 취소분은 빼고 <b>공급가액(부가세 별도)</b> 기준입니다.
        <br />· 미래 예상(연환산·추이·예산)은 거래처관리 › <b>현황및예산조회</b>에서 봅니다. 여기는 <b>실제로 청구한 것</b>만 셉니다.
      </div>

      <div className="tbl-scroll" style={{ maxHeight: '58vh' }}>
        <table className="tbl" style={{ fontSize: 11.5 }}>
          <thead>
            <tr>
              <th style={{ minWidth: 120 }}>{dimOf(rowKey).label}</th>
              <th className="r">건수</th>
              <th className="r">{value === 'count' ? '건수' : '공급가액'}</th>
              <th style={{ width: '18%' }}></th>
              {p.cols.map((c) => <th key={c} className="r">{colLabel(c)}</th>)}
            </tr>
          </thead>
          <tbody>
            {p.rows.length === 0 && (
              <tr><td colSpan={4 + p.cols.length} style={{ textAlign: 'center', padding: 20, color: '#BBB' }}>
                조건에 맞는 청구가 없습니다.
              </td></tr>
            )}
            {p.rows.map((r) => (
              <tr key={r}>
                <td style={{ fontWeight: 700, color: '#1A2B52' }}>{r}</td>
                <td className="r" style={{ color: '#888' }}>{p.counts.get(r) ?? 0}</td>
                <td className="r" style={{ fontWeight: 700 }}>{fmt(p.rowTotal.get(r) ?? 0)}</td>
                <td>
                  <span style={{
                    display: 'block', height: 10, borderRadius: 5,
                    width: `${Math.max(2, ((p.rowTotal.get(r) ?? 0) / max) * 100)}%`,
                    background: '#1A2B52', opacity: 0.75,
                  }} />
                </td>
                {p.cols.map((c) => {
                  const v = p.cell.get(`${r}|${c}`);
                  return (
                    <td key={c} className="r" style={{ color: '#666' }}>
                      {v ? fmt(v) : <span style={{ color: '#DDD' }}>—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: '#f5efdd', fontWeight: 700 }}>
              <td>합계</td>
              <td className="r">{filtered.length}</td>
              <td className="r">{fmt(p.grand)}</td>
              <td></td>
              {p.cols.map((c) => <td key={c} className="r">{fmt(p.colTotal.get(c) ?? 0)}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>

      <div style={{ marginTop: 14 }}>
        <button className="btn-sm" onClick={() => setShowLog((v) => !v)}>
          {showLog ? '▾' : '▸'} 담당직원 변경 이력 ({logs.length})
        </button>
        {showLog && (
          <>
            <div className="alert-i" style={{ fontSize: 11, marginTop: 8 }}>
              발행요청 화면에서 담당직원을 바꾼 기록입니다. <b>계약반영</b>이 <b>예</b>이면 매출계약의 담당직원도
              그 달부터 함께 바뀐 것이고, <b>아니오</b>면 그 달 청구 한 건만 바뀐 것입니다.
            </div>
            <div className="tbl-scroll" style={{ maxHeight: '40vh', marginTop: 6 }}>
              <table className="tbl" style={{ fontSize: 11.5 }}>
                <thead>
                  <tr>
                    <th>적용월</th><th>거래처</th><th>이전</th><th>이후</th>
                    <th>계약반영</th><th>바꾼 사람</th><th>바꾼 시각</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: 'center', padding: 16, color: '#BBB' }}>
                      아직 변경 이력이 없습니다.
                    </td></tr>
                  )}
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td style={{ fontWeight: 700 }}>{l.ym || '—'}</td>
                      <td>{l.company || '—'}</td>
                      <td style={{ color: '#888' }}>{l.before || '(없음)'}</td>
                      <td style={{ fontWeight: 700, color: '#1A2B52' }}>{l.after || '(없음)'}</td>
                      <td style={{ color: l.propagated ? '#2a7' : '#999', fontWeight: l.propagated ? 700 : 400 }}>
                        {l.propagated ? '예' : '아니오'}
                      </td>
                      <td>{l.changedBy || '—'}</td>
                      <td style={{ color: '#888' }}>{kstDateTime(l.changedAt)}</td>
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

/** 열 이름이 'YYYY-MM' 이면 짧게. */
const colLabel = (c: string) => (/^\d{4}-\d{2}$/.test(c) ? c.slice(2) : c);

function Filter({ label, value, onChange, opts }: {
  label: string; value: string; onChange: (v: string) => void; opts: string[];
}) {
  if (!opts.length) return null;
  return (
    <label style={{ fontSize: 11.5, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ fontWeight: value ? 700 : 400, color: value ? '#1A2B52' : undefined }}>
        <option value="">전체</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
