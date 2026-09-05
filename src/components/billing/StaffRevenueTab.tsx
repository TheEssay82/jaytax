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
import MultiPick from '../common/MultiPick';
import {
  EMPTY_FILTER, isAll, passes, passesAny, type MultiFilter,
} from '../../lib/multiFilter';
import { EmptyRow } from '../common/Empty';
import Loading from '../common/Loading';
import Guide from '../common/Guide';
import { pivotMulti, MEASURES } from '../../lib/revenuePivot';
import { todayYmd, kstDateTime } from '../../lib/format';
import { listStaffChangeLog, type StaffChangeLog } from '../../lib/invoiceStaffApi';
import {
  listRevenueAll, listForecastFacts, pivot, DIMS, fyOf, fyRange, fyLabel,
  type RevenueFact, type Dim,
} from '../../lib/revenueStatsApi';
import { useAuth } from '../../context/AuthContext';
import { canSeeStaffCost } from '../../lib/staffCostApi';
import BudgetTab from './BudgetTab';

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const dimOf = (key: string): Dim => DIMS.find((d) => d.key === key) ?? DIMS[0];

/**
 * 매출통계 — 통계와 **예산**을 나란히 둔 자리.
 *
 * 예산을 여기 넣은 이유: 자료가 같고(같은 매출 사실), 「감사팀은 담당회계사 ·
 * taxteam 은 회계사×직원」이라는 구분 규칙이 이 화면에 이미 있다.
 *
 * **급여 자료라 볼 수 없는 사람에게는 서브탭 자체를 내놓지 않는다** — 눌러서 막히는 것이
 * 아니라 있는 줄도 모르게 한다(사용자 요구 2026-09-03).
 */
export default function StaffRevenueTab() {
  const { role, profileName } = useAuth();
  const canBudget = canSeeStaffCost(role, profileName);
  const [sub, setSub] = useState<'stats' | 'budget'>('stats');

  if (!canBudget) return <StatsPanel />;
  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {([['stats', '📊 통계'], ['budget', '💵 예산']] as const).map(([k, label]) => (
          <button key={k} className={sub === k ? 'btn-p' : 'btn-sm'} onClick={() => setSub(k)}>
            {label}
          </button>
        ))}
      </div>
      {sub === 'budget' ? (
        <div className="card rep">
          <BudgetTab />
        </div>
      ) : <StatsPanel />}
    </>
  );
}

function StatsPanel() {
  const thisMonth = todayYmd().slice(0, 7);
  const curFy = fyOf(thisMonth);

  const [fy, setFy] = useState<number | ''>(curFy);        // '' = 기간 직접 지정
  const [from, setFrom] = useState(() => fyRange(curFy).from);
  const [to, setTo] = useState(() => fyRange(curFy).to);
  const [team, setTeam] = useState('');
  const [rowKey, setRowKey] = useState('staff');
  const [colKey, setColKey] = useState('ym');
  const [value, setValue] = useState<'supply' | 'count'>('supply');
  /** 'cross' 교차표(행×열, 값 하나) · 'summary' 요약표(행 2단계, 값 여러 개 — 엑셀 시트 모양) */
  const [mode, setMode] = useState<'cross' | 'summary'>('cross');
  /** '실적' 이미 청구한 것 · '예상' 계약대로라면 나올 것. 원천이 달라 섞지 않는다. */
  const [basis, setBasis] = useState<'actual' | 'forecast'>('actual');
  const [subKey, setSubKey] = useState('staff');
  // 필터는 **고른 값들의 묶음**이다 — 여럿 고르기와 「특정 값만 빼기」가 둘 다 된다.
  const [cpaF, setCpaF] = useState<MultiFilter>(EMPTY_FILTER);
  const [staffF, setStaffF] = useState<MultiFilter>(EMPTY_FILTER);
  const [typeF, setTypeF] = useState<MultiFilter>(EMPTY_FILTER);
  const [erpF, setErpF] = useState<MultiFilter>(EMPTY_FILTER);
  const clearFilters = () => {
    setCpaF(EMPTY_FILTER); setStaffF(EMPTY_FILTER); setTypeF(EMPTY_FILTER); setErpF(EMPTY_FILTER);
  };

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
        basis === 'forecast'
          ? listForecastFacts(from, to, team || undefined, { includeDraft: true })
          : listRevenueAll(from, to, team || undefined),
        listStaffChangeLog(100),
      ]);
      setFacts(f); setLogs(l);
    } catch (e) { setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, [from, to, team, basis]);
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

  const filtered = useMemo(() => facts.filter((f) => (
    passes(cpaF, f.cpa)
    && passesAny(staffF, f.shares.map((s) => s.name))
    && passes(typeF, f.typeTop)
    && passes(erpF, f.erpAccount)
  )), [facts, cpaF, staffF, typeF, erpF]);

  const p = useMemo(
    () => pivot(filtered, dimOf(rowKey), dimOf(colKey), value),
    [filtered, rowKey, colKey, value],
  );
  const fmt = (n: number) => (value === 'count' ? String(Math.round(n * 100) / 100) : won(n));
  // 요약표(엑셀 모양) — 행 2단계 × 값 여러 개. 교차표와 달리 열 축을 쓰지 않는다.
  const sum2 = useMemo(
    () => pivotMulti(filtered, dimOf(rowKey), subKey === 'none' ? null : dimOf(subKey), MEASURES),
    [filtered, rowKey, subKey],
  );
  const max = Math.max(1, ...p.rows.map((r) => p.rowTotal.get(r) ?? 0));
  const filterCount = [cpaF, staffF, typeF, erpF].filter((f) => !isAll(f)).length;

  function copyTsv() {
    const head = ['', ...p.cols, '합계'].join('\t');
    const body = p.rows.map((r) => [
      r, ...p.cols.map((c) => Math.round(p.cell.get(`${r}|${c}`) ?? 0)), Math.round(p.rowTotal.get(r) ?? 0),
    ].join('\t'));
    const foot = ['합계', ...p.cols.map((c) => Math.round(p.colTotal.get(c) ?? 0)), Math.round(p.grand)].join('\t');
    void navigator.clipboard.writeText([head, ...body, foot].join('\n'));
  }

  if (loading) return <Loading title="📊 매출통계" rows={8} rep />;

  return (
    <div className="card rep">
      <div className="rep-title">
        📊 매출통계
        <span className="sub">
          {fy === '' ? `${from} ~ ${to}` : fyLabel(Number(fy))}
          {' · '}{team === '' ? '전체 팀' : team === 'taxteam' ? 'taxteam' : '감사팀'}
          {' · '}{basis === 'forecast' ? '예상' : '실적'}
        </span>
      </div>
      <div className="rep-sub">
        {filtered.length}건 · 공급가액 {won(filtered.reduce((s, f) => s + f.supply, 0))}
      </div>

      <div className="rep-controls">
        <select value={fy === '' ? '' : String(fy)} onChange={(e) => pickFy(e.target.value)} style={{ fontWeight: 700 }}
          title="사업연도를 고르면 기간이 7월~익년 6월로 맞춰집니다">
          {fyOpts.map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}
          <option value="">기간 직접 지정</option>
        </select>
        <input type="month" value={from} onChange={(e) => { if (e.target.value) { setFrom(e.target.value); setFy(''); } }}
          style={{ fontWeight: 700 }} />
        <span style={{ color: 'var(--ink-3)' }}>~</span>
        <input type="month" value={to} onChange={(e) => { if (e.target.value) { setTo(e.target.value); setFy(''); } }}
          style={{ fontWeight: 700 }} />
        <select value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">전체 팀</option>
          <option value="taxteam">taxteam</option>
          <option value="감사team">감사팀</option>
        </select>
        <select value={basis} onChange={(e) => setBasis(e.target.value as 'actual' | 'forecast')}
          style={{ fontWeight: 700, color: basis === 'forecast' ? '#92400E' : undefined }}
          title="실적은 이미 청구한 것, 예상은 계약대로라면 나올 것입니다">
          <option value="actual">실적</option>
          <option value="forecast">예상</option>
        </select>
      </div>
      {err && <div className="alert-w">{err}</div>}

      {/* ── 피벗 조건 ── */}
      <div style={{
        border: '1px solid #E1E8F1', background: '#F8FAFD', borderRadius: 7,
        padding: '8px 10px', marginBottom: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
      }}>
        <span style={{ display: 'inline-flex', border: '1px solid #D5DDE7', borderRadius: 5, overflow: 'hidden' }}>
          {([['cross', '교차표'], ['summary', '요약표']] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setMode(k)}
              style={{
                fontSize: 'var(--fs-1)', padding: '3px 9px', border: 0, cursor: 'pointer',
                background: mode === k ? '#1A2B52' : '#fff', color: mode === k ? '#fff' : '#555', fontWeight: 700,
              }}
              title={k === 'cross' ? '행 × 열 한 값 — 추이·교차 보기' : '행을 두 단계로 펼치고 값을 여러 개 — 엑셀 시트 모양'}>
              {lbl}
            </button>
          ))}
        </span>
        <label style={{ fontSize: 'var(--fs-1)', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <b style={{ color: 'var(--navy)' }}>행</b>
          <select value={rowKey} onChange={(e) => setRowKey(e.target.value)} style={{ fontWeight: 700 }}>
            {DIMS.filter((d) => d.key !== 'none').map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </label>
        {mode === 'cross' ? (
          <>
            <label style={{ fontSize: 'var(--fs-1)', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <b style={{ color: 'var(--navy)' }}>열</b>
              <select value={colKey} onChange={(e) => setColKey(e.target.value)} style={{ fontWeight: 700 }}>
                {DIMS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 'var(--fs-1)', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <b style={{ color: 'var(--navy)' }}>값</b>
              <select value={value} onChange={(e) => setValue(e.target.value as 'supply' | 'count')}>
                <option value="supply">공급가액</option>
                <option value="count">건수</option>
              </select>
            </label>
          </>
        ) : (
          <label style={{ fontSize: 'var(--fs-1)', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <b style={{ color: 'var(--navy)' }}>하위</b>
            <select value={subKey} onChange={(e) => setSubKey(e.target.value)} style={{ fontWeight: 700 }}
              title="행 아래에 한 단계 더 펼칩니다 (엑셀의 회계사 > 담당직원)">
              <option value="none">(펼치지 않음)</option>
              {DIMS.filter((d) => d.key !== 'none' && d.key !== rowKey)
                .map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </label>
        )}
        <span style={{ color: '#ddd' }}>|</span>
        <MultiPick title="담당회계사" opts={opts.cpa} value={cpaF} onChange={setCpaF} />
        <MultiPick title="담당직원" opts={opts.staff} value={staffF} onChange={setStaffF} />
        <MultiPick title="매출유형" opts={opts.type} value={typeF} onChange={setTypeF} />
        <MultiPick title="매출계정" opts={opts.erp} value={erpF} onChange={setErpF} />
        {filterCount > 0 && (
          <button className="btn-sm" onClick={clearFilters}>
            필터 초기화 ({filterCount})
          </button>
        )}
        <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={copyTsv}
          title="지금 표를 탭으로 구분해 복사합니다 — 엑셀에 그대로 붙습니다">
          📋 엑셀로 복사
        </button>
      </div>

      <Guide box="rep-hint" id="revenue-stats" label="보는 법 자세히"
        summary={<>💡 청구할 때 굳혀 둔 <b>그 시점의 담당·금액</b>을 더한 것입니다. 계약이 나중에 바뀌어도 지난 통계는 변하지 않습니다.</>}>
        · <b>행·열</b>에 원하는 구분자를 놓으면 엑셀 피벗처럼 잘라 볼 수 있습니다(담당직원 × 귀속월, 매출유형 × 담당회계사 …).
        <br />· <b>담당직원</b>은 배분 비율만큼 쪼개 더합니다 — 공동담당 건도 합계가 부풀지 않습니다.
        <b> 감사팀은 회계사 단위</b>로만 보므로, 팀을 감사팀으로 좁히면 행이 담당회계사로 바뀝니다.
        <br />· 기간의 기본은 <b>사업연도(7월~익년 6월)</b>입니다. 취소분은 빼고 <b>공급가액(부가세 별도)</b> 기준입니다.
        <br />· <b>요약표</b>는 행을 두 단계로 펼치고 값을 여러 개 보여 줍니다 — 엑셀에서 쓰시던 <b>회계사 › 담당직원 × (거래처수·기장료·조정료·합계)</b> 모양입니다. <b>교차표</b>는 행×열에 한 값으로 추이를 봅니다.
        <br />· 앱을 쓰기 전 기간(FY2025)은 <b>2025실적 자료</b>를, 그 뒤는 <b>앱의 청구기록</b>을 씁니다. 한 사업연도 안에서는 한 원천만 써서 이중으로 세지 않습니다.
        <br />· <b>예상</b>으로 바꾸면 <b>매출계약대로라면 나올 금액</b>을 같은 모양으로 봅니다(미확정 예정계약 포함).
        담당직원은 <b>지금 배정</b> 기준이고 공동담당은 <b>균등으로 나눕니다</b> — 실적처럼 청구별 배분이 아직 없기 때문입니다.
        <br />· 미래 예상(연환산·추이·예산)은 거래처관리 › <b>현황및예산조회</b>에서 봅니다. 여기는 <b>실제 매출</b>만 셉니다.
      </Guide>

      {basis === 'forecast' && (
        <div className="alert-w" style={{ fontSize: 'var(--fs-1)' }}>
          🔮 <b>예상</b>입니다 — 실제로 청구한 것이 아니라 <b>매출계약대로라면 나올 금액</b>입니다.
          미확정(예정) 계약도 넣었습니다. 담당직원은 <b>지금 배정</b> 기준이라 그 사이 담당이 바뀌었으면 과거 실적과 다르게 보입니다.
        </div>
      )}

      {mode === 'summary' ? (
        <div className="tbl-scroll">
          <table className="tbl" style={{ fontSize: 'var(--fs-1)' }}>
            <thead>
              <tr>
                <th style={{ minWidth: 160 }}>
                  {dimOf(rowKey).label}{subKey !== 'none' && ` › ${dimOf(subKey).label}`}
                </th>
                {MEASURES.map((m) => <th key={m.key} className="r">{m.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {sum2.rows.length === 0 && (
                <EmptyRow colSpan={1 + MEASURES.length} text="조건에 맞는 매출이 없습니다"
                  hint={filterCount > 0
                    ? `필터 ${filterCount}개가 걸려 있습니다.`
                    : '기간이나 팀을 바꿔 보세요. 앱을 쓰기 전 기간은 2025실적 자료에서 옵니다.'}
                  action={filterCount > 0
                    ? { label: '필터 초기화', onClick: clearFilters }
                    : undefined} />
              )}
              {sum2.rows.map((r) => (
                <tr key={`${r.key}|${r.sub ?? ''}`}
                  style={r.sub ? undefined : { background: '#EEF4FB' }}>
                  <td style={r.sub
                    ? { paddingLeft: 22, color: 'var(--ink-2)' }
                    : { fontWeight: 700, color: 'var(--navy)' }}>
                    {r.sub ?? (sum2.rows.some((x) => x.sub) ? `▾ ${r.key}` : r.key)}
                  </td>
                  {MEASURES.map((m) => (
                    <td key={m.key} className="r"
                      style={{ fontWeight: r.sub ? 400 : 700, color: r.sub ? '#555' : undefined }}>
                      {m.agg === 'sum'
                        ? (r.values[m.key] ? won(r.values[m.key]) : <span style={{ color: '#DDD' }}>—</span>)
                        : r.values[m.key].toLocaleString('ko-KR')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: '#EEF4FB', fontWeight: 700, color: 'var(--navy)' }}>
                <td>총합계</td>
                {MEASURES.map((m) => (
                  <td key={m.key} className="r">
                    {m.agg === 'sum' ? won(sum2.total[m.key]) : sum2.total[m.key].toLocaleString('ko-KR')}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
      <div className="tbl-scroll">
        <table className="tbl" style={{ fontSize: 'var(--fs-1)' }}>
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
              <EmptyRow colSpan={4 + p.cols.length} text="조건에 맞는 청구가 없습니다"
                hint={filterCount > 0
                  ? `필터 ${filterCount}개가 걸려 있습니다.`
                  : '기간이나 팀을 바꿔 보세요. 앱을 쓰기 전 기간은 2025실적 자료에서 옵니다.'}
                action={filterCount > 0
                  ? { label: '필터 초기화', onClick: clearFilters }
                  : undefined} />
            )}
            {p.rows.map((r) => (
              <tr key={r}>
                <td style={{ fontWeight: 700, color: 'var(--navy)' }}>{r}</td>
                <td className="r" style={{ color: 'var(--ink-3)' }}>{p.counts.get(r) ?? 0}</td>
                <td className="r" style={{ fontWeight: 700 }}>{fmt(p.rowTotal.get(r) ?? 0)}</td>
                <td>
                  <span style={{
                    display: 'block', height: 10, borderRadius: 5,
                    width: `${Math.max(2, ((p.rowTotal.get(r) ?? 0) / max) * 100)}%`,
                    background: 'var(--navy)', opacity: 0.75,
                  }} />
                </td>
                {p.cols.map((c) => {
                  const v = p.cell.get(`${r}|${c}`);
                  return (
                    <td key={c} className="r" style={{ color: 'var(--ink-2)' }}>
                      {v ? fmt(v) : <span style={{ color: '#DDD' }}>—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: '#EEF4FB', fontWeight: 700, color: 'var(--navy)' }}>
              <td>합계</td>
              <td className="r">{filtered.length}</td>
              <td className="r">{fmt(p.grand)}</td>
              <td></td>
              {p.cols.map((c) => <td key={c} className="r">{fmt(p.colTotal.get(c) ?? 0)}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
      )}

      <div style={{ marginTop: 14 }}>
        <button className="btn-sm" onClick={() => setShowLog((v) => !v)}>
          {showLog ? '▾' : '▸'} 담당직원 변경 이력 ({logs.length})
        </button>
        {showLog && (
          <>
            <div className="alert-i" style={{ fontSize: 'var(--fs-1)', marginTop: 8 }}>
              발행요청 화면에서 담당직원을 바꾼 기록입니다. <b>계약반영</b>이 <b>예</b>이면 매출계약의 담당직원도
              그 달부터 함께 바뀐 것이고, <b>아니오</b>면 그 달 청구 한 건만 바뀐 것입니다.
            </div>
            {/* 화면 아래에 접어 둔 보조 표라 일부러 낮게 둔다 — 화면을 채우면 안 된다. */}
            <div className="tbl-scroll" data-fixed-h style={{ maxHeight: '40vh', marginTop: 6 }}>
              <table className="tbl" style={{ fontSize: 'var(--fs-1)' }}>
                <thead>
                  <tr>
                    <th>적용월</th><th>거래처</th><th>이전</th><th>이후</th>
                    <th>계약반영</th><th>바꾼 사람</th><th>바꾼 시각</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: 'center', padding: 16, color: 'var(--ink-4)' }}>
                      아직 변경 이력이 없습니다.
                    </td></tr>
                  )}
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td style={{ fontWeight: 700 }}>{l.ym || '—'}</td>
                      <td>{l.company || '—'}</td>
                      <td style={{ color: 'var(--ink-3)' }}>{l.before || '(없음)'}</td>
                      <td style={{ fontWeight: 700, color: 'var(--navy)' }}>{l.after || '(없음)'}</td>
                      <td style={{ color: l.propagated ? '#2a7' : '#999', fontWeight: l.propagated ? 700 : 400 }}>
                        {l.propagated ? '예' : '아니오'}
                      </td>
                      <td>{l.changedBy || '—'}</td>
                      <td style={{ color: 'var(--ink-3)' }}>{kstDateTime(l.changedAt)}</td>
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

