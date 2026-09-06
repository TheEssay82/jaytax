// 매출통계 › 예산 — 수입 대비 인건비.
//
// 사용자가 엑셀에서 하던 일을 옮긴 것이다 —
//   "1년간의 성과를 직원별로 집계하고, 인건비를 예측해서 실적을 계산한다"
//
// **급여가 걸린 자리라 김민섭·김동주·정남지는 이 탭을 열 수 없다.** 화면과 표(RLS)
// 양쪽에서 막는다. 배부는 **직접비(인건비)만** 한다 — 공통비는 결산 시스템을 만들 때 붙인다.
//
// 팀에 따라 **구분 기준이 다르다**(사용자 확정 2026-09-03):
//   · 감사팀  — 담당회계사. 감사 계약에는 담당직원이 아예 없다(33건 전부).
//              인건비는 비워 둔다 — 수입·거래처만 본다.
//   · taxteam — 담당직원, 또는 담당회계사 › 담당직원 2단계(엑셀 시트 모양). 화면에서 전환한다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import Guide from '../common/Guide';
import StaffCostTab from './StaffCostTab';
import {
  listRenewalCandidates, listRenewalPicks, saveRenewalPick, renewalFacts,
  pickedTotal, type RenewalCandidate, type RenewalPick,
} from '../../lib/budgetRenewalApi';
import { useAuth } from '../../context/AuthContext';
import {
  listBudgetFacts, listForecastFacts, listRevenueAll, fyOf, fyLabel, fyRange, kstYm,
  DIMS, type RevenueFact,
} from '../../lib/revenueStatsApi';
import { pivotMulti, type Dim, type Measure } from '../../lib/revenuePivot';
import {
  listStaffCost, totalCost, canSeeStaffCost, isCostExempt, type StaffCost,
} from '../../lib/staffCostApi';

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const curFy = fyOf(kstYm());

/** 'YYYY-MM' 한 달 앞 — 안내 문구에만 쓴다. */
function prevOf(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** 수입을 무엇으로 볼지. 기본은 **예산(혼합)** — 예산은 원래 이렇게 굴러간다. */
type Basis = 'budget' | 'forecast' | 'actual';
const BASIS_LABEL: Record<Basis, string> = {
  budget: '예산(지난 달 실적 + 남은 달 예상)',
  forecast: '예상만(계약 기준)',
  actual: '실적만(청구 기준)',
};

/** taxteam 의 행 구성. 감사팀은 언제나 담당회계사라 이 선택이 없다. */
type Axis = 'staff' | 'cpa-staff';

/**
 * 수입을 크게 셋으로 가른다(사용자 요구 2026-09-03). **ERP 매출계정**으로 판정한다 —
 * 청구주기로 가르면 FY2025 실적(biz_revenue_actual)에는 주기가 없어 통째로 빈다.
 *   · 기장(월별)   = 기장대리수입 (기장·부가세·원천)
 *   · 조정수수료   = 세무조정수입 (법인세조정 + 종합소득세)
 *   · 건별·기타    = 회계감사수입 · 기타용역수입 (한 건씩 끊는 일)
 */
const KINDS = [
  { key: 'book', label: '기장(월별)', is: (f: RevenueFact) => f.kind === '기장료' },
  { key: 'adj', label: '조정수수료', is: (f: RevenueFact) => f.kind === '세무조정' },
  { key: 'etc', label: '건별·기타', is: (f: RevenueFact) => f.kind === '기타' },
] as const;

const MEAS: Measure<RevenueFact>[] = [
  { key: 'clients', label: '거래처', agg: 'clients' },
  ...KINDS.map((k) => ({ key: k.key, label: k.label, agg: 'sum' as const, where: k.is })),
  { key: 'supply', label: '수입', agg: 'sum' as const },
];

const dimOf = (key: string): Dim<RevenueFact> =>
  DIMS.find((d) => d.key === key) as unknown as Dim<RevenueFact>;

/**
 * 배수(수입÷인건비)에 붙일 신호색. **값이 색을 정한다** — 예쁘라고 칠하지 않는다.
 * 전체 평균을 기준선으로 삼아 위/근처/아래로 가른다(±5%).
 */
function sigClass(ratio: number, avg: number): string {
  if (!avg) return '';
  if (ratio >= avg * 1.05) return 'sig sig-hi';
  if (ratio <= avg * 0.95) return 'sig sig-low';
  return 'sig sig-mid';
}

/** 표에 그릴 한 줄. 소계 줄은 인건비를 붙이지 않는다(아래 자식 줄에서 이미 센다). */
interface Row {
  key: string;
  sub: string | null;
  /** 인건비를 붙이는 줄(= 사람 한 명). 2단계의 회계사 소계 줄은 false. */
  leaf: boolean;
  /** 이 줄이 가리키는 사람 이름 — 인건비를 찾는 열쇠. 감사팀이면 회계사 이름. */
  person: string;
  values: Record<string, number>;
  cost: number;
  exempt: boolean;
  /** 인건비를 안분했는가(2단계에서 한 사람이 여러 회계사에 걸칠 때). */
  split: boolean;
}

/**
 * 예산 — **보는 자리와 세팅하는 자리를 가른다**(2026-09-06).
 *
 * 그전에는 한 화면에서 매출 피벗을 보다가 「수정」을 눌러 급여를 고쳤다. 급여를 정하는 일은
 * 표를 훑는 일과 성격이 다르다 — 사람을 고르고, 지금 구조를 보고, 호봉을 올린다. 그래서
 * 사장님 요청대로 하부 탭을 따로 세웠다.
 */
export default function BudgetTab() {
  const { role, profileName } = useAuth();
  const allowed = canSeeStaffCost(role, profileName);
  const [view, setView] = useState<'budget' | 'setup'>('budget');
  /** 세팅 탭으로 건너갈 때 **누구를** 펼칠지. 표에서 「인건비 입력」을 누른 사람이다. */
  const [focus, setFocus] = useState('');

  if (!allowed) return <BudgetPanel onSetup={() => {}} />;
  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {([['budget', '📈 수입 대비 인건비'], ['setup', '⚙️ 인건비 세팅']] as const).map(([k, label]) => (
          <button key={k} className={view === k ? 'btn-p' : 'btn-sm'}
            onClick={() => { setView(k); if (k === 'setup') setFocus(''); }}>
            {label}
          </button>
        ))}
      </div>
      {view === 'setup'
        ? <StaffCostTab focusName={focus} />
        : <BudgetPanel onSetup={(name) => { setFocus(name); setView('setup'); }} />}
    </>
  );
}

function BudgetPanel({ onSetup }: { onSetup: (name: string) => void }) {
  const { role, profileName, readonly } = useAuth();
  const allowed = canSeeStaffCost(role, profileName);

  const [fy, setFy] = useState(curFy);
  const [basis, setBasis] = useState<Basis>('budget');
  const [team, setTeam] = useState('taxteam');
  const [axis, setAxis] = useState<Axis>('staff');
  const [costs, setCosts] = useState<StaffCost[]>([]);
  const [facts, setFacts] = useState<RevenueFact[]>([]);
  /**
   * 계약갱신 대상 — 앞 해에는 있었는데 이번 해에 계약이 없는 것.
   * **계약을 만들지 않고** 여기서 체크한 것만 예산에 더한다(사장님 지시 2026-09-06).
   */
  const [cands, setCands] = useState<RenewalCandidate[]>([]);
  const [picks, setPicks] = useState<Map<string, RenewalPick>>(new Map());
  const [showRenew, setShowRenew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  /** 감사팀은 담당회계사로만 구분한다 — 감사 계약에는 담당직원이 없다. */
  const isAudit = team === '감사team';

  const load = useCallback(async () => {
    if (!allowed) { setLoading(false); return; }
    setLoading(true); setErr('');
    try {
      const { from, to } = fyRange(fy);
      const t = team || undefined;
      const [cs, fs, cd, pk] = await Promise.all([
        listStaffCost(fy),
        basis === 'budget' ? listBudgetFacts(fy, t, { includeDraft: true })
          : basis === 'forecast' ? listForecastFacts(from, to, t, { includeDraft: true })
            : listRevenueAll(from, to, t),
        listRenewalCandidates(fy, t),
        listRenewalPicks(fy),
      ]);
      setCosts(cs); setFacts(fs); setCands(cd); setPicks(pk);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [allowed, fy, basis, team]);
  useEffect(() => { void load(); }, [load]);

  const costOf = useCallback(
    (name: string) => {
      const c = costs.find((x) => x.staffName === name);
      return c ? totalCost(c) : 0;
    }, [costs]);


  /**
   * 표 줄 만들기. 인건비를 붙이는 규칙이 여기 다 있다.
   *
   * **2단계(회계사 › 직원)에서는 인건비를 수입 비율로 안분한다.** 한 직원이 두 회계사
   * 아래 걸치면 인건비를 양쪽에 통째로 놓을 수 없다 — 합계가 두 배가 된다. 수입 비율로
   * 나누면 소계·합계가 그대로 맞아떨어지고 각 칸의 배수도 뜻이 산다.
   */
  /**
   * 예산이 세는 줄 = 실제 매출 + **체크한 갱신 대상**.
   *
   * 「실적만」 으로 보고 있을 때는 섞지 않는다 — 실적은 이미 일어난 일이라
   * 아직 계약도 없는 갱신 예정을 거기 더하면 지난 일을 지어내는 셈이 된다.
   */
  const allFacts = useMemo(
    () => (basis === 'actual' ? facts : [...facts, ...renewalFacts(fy, cands, picks)]),
    [facts, basis, fy, cands, picks],
  );
  const renewTotal = pickedTotal(cands, picks);

  const { rows, leaves } = useMemo(() => {
    const rowDim = dimOf(isAudit || axis === 'cpa-staff' ? 'cpa' : 'staff');
    const subDim = !isAudit && axis === 'cpa-staff' ? dimOf('staff') : null;
    const t = pivotMulti(allFacts, rowDim, subDim, MEAS);

    // 안분 기준 — 그 사람의 전체 수입(모든 회계사 아래를 합친 것).
    const wholeOf = new Map<string, number>();
    if (subDim) {
      for (const r of pivotMulti(allFacts, subDim, null, MEAS).rows) {
        wholeOf.set(r.key, r.values.supply ?? 0);
      }
    }

    const out: Row[] = t.rows.map((r) => {
      const isSub = r.sub != null;
      const leaf = subDim ? isSub : true;
      const person = (isSub ? r.sub : r.key) ?? '';
      const exempt = isCostExempt(person);
      let cost = 0;
      let split = false;
      if (leaf && !isAudit && !exempt && person !== '(미지정)') {
        const full = costOf(person);
        if (subDim) {
          const whole = wholeOf.get(person) ?? 0;
          const ratio = whole > 0 ? (r.values.supply ?? 0) / whole : 0;
          cost = full * ratio;
          split = full > 0 && ratio < 0.999;
        } else {
          cost = full;
        }
      }
      return { key: r.key, sub: r.sub, leaf, person, values: r.values, cost, exempt, split };
    });

    // 소계 줄의 인건비 = 그 아래 자식 줄의 합.
    if (subDim) {
      for (const r of out) {
        if (r.sub != null) continue;
        r.cost = out.filter((x) => x.key === r.key && x.sub != null).reduce((s, x) => s + x.cost, 0);
      }
    }
    return { rows: out, leaves: out.filter((r) => r.leaf) };
  }, [allFacts, isAudit, axis, costOf]);

  // 합계는 **잎 줄만** 센다 — 소계까지 더하면 두 번 센다.
  const counted = leaves.filter((r) => !r.exempt);
  const exempted = leaves.filter((r) => r.exempt && (r.values.supply ?? 0) > 0);
  const unassigned = leaves.filter((r) => r.person === '(미지정)');
  const sumOf = (l: Row[], k: string) => l.reduce((s, r) => s + (r.values[k] ?? 0), 0);
  const totCost = counted.reduce((s, r) => s + r.cost, 0);
  const totSupply = sumOf(counted, 'supply');
  const exSupply = sumOf(exempted, 'supply');
  /** 신호색의 기준선 — 전체 평균 배수. */
  const avgRatio = totCost > 0 ? totSupply / totCost : 0;
  const cut = kstYm();

  if (!allowed) {
    return (
      <div className="alert-w" style={{ fontSize: 'var(--fs-2)' }}>
        이 화면은 <b>급여 자료</b>를 다루므로 열 수 없습니다.
        <br />필요하시면 최고관리자에게 문의해 주세요.
      </div>
    );
  }
  // 이 화면은 매출통계 카드 **안**이라 카드를 또 그리지 않는다. 뼈대만 둔다.
  if (loading) return (
    <div aria-busy="true">
      <div className="skel-bar" />
      <div className="skel-tbl">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="skel-row" />)}
      </div>
    </div>
  );

  return (
    <div>
      <div className="rep-title">
        📊 예산 분석
        <span className="sub">
          {fyLabel(fy)} · {isAudit ? '감사팀' : 'taxteam'} · {BASIS_LABEL[basis]}
        </span>
      </div>
      <div className="rep-sub">
        {isAudit ? '담당회계사별 수입' : '인건비 대비 수입 성과'}
      </div>

      <div className="rep-controls">
        <select value={fy} onChange={(e) => setFy(Number(e.target.value))} style={{ fontWeight: 700 }}>
          {[curFy + 1, curFy, curFy - 1, curFy - 2].map((y) => (
            <option key={y} value={y}>{fyLabel(y)}</option>
          ))}
        </select>
        <select value={basis} onChange={(e) => setBasis(e.target.value as Basis)}
          style={{ fontWeight: 700, color: basis === 'budget' ? 'var(--navy)' : 'var(--warn)' }}
          title={BASIS_LABEL[basis]}>
          {(Object.keys(BASIS_LABEL) as Basis[]).map((b) => (
            <option key={b} value={b}>{BASIS_LABEL[b]}</option>
          ))}
        </select>
        <select value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="taxteam">taxteam</option>
          <option value="감사team">감사팀</option>
        </select>
        {isAudit ? (
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--warn)', fontWeight: 700 }}>구분: 담당회계사</span>
        ) : (
          <select value={axis} onChange={(e) => setAxis(e.target.value as Axis)}>
            <option value="staff">담당직원별</option>
            <option value="cpa-staff">담당회계사 › 담당직원</option>
          </select>
        )}
        <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => void load()}>새로고침</button>
      </div>

      <Guide box="rep-hint" id="budget" label="셈법 자세히"
        summary={<>
          💡 <b>배수 = 수입 ÷ 인건비</b> — 인건비 1원당 얼마를 벌어들였는지 나타냅니다.
          {' '}<b>기여 = 수입 − 인건비</b>.
        </>}>
        · 기여 금액만 보면 사람마다 인건비 규모가 달라 비교가 어긋납니다. <b>배수는 그 차이를 지웁니다.</b>
        <br />· 수입은 셋으로 갈라 봅니다 — <b>기장(월별)</b> · <b>조정수수료</b>(법인세조정+종합소득세) ·
        {' '}<b>건별·기타</b>. ERP 매출계정으로 가릅니다.
        <br />· 배부는 <b>직접비(인건비)만</b> 합니다. 임차료·관리비 같은 공통비는 결산시스템에서 붙입니다.
        <br />· 공동담당은 <b>배분 비율만큼</b> 나눠 더합니다 — 한 거래처가 두 사람에게 통째로 잡히지 않습니다.
      </Guide>

      {basis === 'budget' && (
        <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', margin: '6px 0' }}>
          📐 수입 기준 — <b>{fyRange(fy).from} ~ {prevOf(cut)}</b> 은 실제로 청구한 <b>실적</b>,
          {' '}<b>{cut} 이후</b>는 계약에서 뽑은 <b>예상</b>입니다.
          {' '}달이 갈수록 실적이 예상을 밀어냅니다. 이번 달은 아직 청구가 끝나지 않았을 수 있어 예상 쪽에 둡니다.
        </div>
      )}
      {isAudit && (
        <div className="alert-w" style={{ fontSize: 'var(--fs-1)' }}>
          감사팀은 <b>담당회계사</b>로 구분합니다 — 감사 계약에는 담당직원이 없습니다.
          {' '}인건비는 <b>비워 둡니다</b>(수입·거래처만 봅니다).
        </div>
      )}
      {!isAudit && axis === 'cpa-staff' && (
        <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', margin: '6px 0' }}>
          ⚖️ 한 직원이 여러 회계사 아래 걸치면 <b>인건비를 수입 비율로 나눠</b> 놓았습니다(그 줄에 <i>안분</i> 표시).
          {' '}통째로 놓으면 합계가 사람 수보다 부풀기 때문입니다. 회계사 줄의 인건비는 아래 직원 줄의 합입니다.
        </div>
      )}
      {err && <div className="alert-e" style={{ fontSize: 'var(--fs-1)' }}>{err}</div>}

      {/* 칸이 많아 좁은 화면에서는 표만 가로로 민다 — 페이지가 통째로 밀리면 제목까지 사라진다. */}
      <div className="tbl-wide">
      <table className="tbl-rep">
        <thead>
          <tr>
            <th style={{ minWidth: 110 }}>
              {isAudit ? '담당회계사' : axis === 'cpa-staff' ? '회계사 › 직원' : '담당직원'}
            </th>
            <th className="r" style={{ width: 60 }}>거래처</th>
            {KINDS.map((k) => <th key={k.key} className="r" style={{ minWidth: 100 }}>{k.label}</th>)}
            <th className="r" style={{ minWidth: 110 }}>수입 합계</th>
            <th className="r" style={{ minWidth: 110 }}>인건비(총부담)</th>
            <th className="r" style={{ minWidth: 110 }}>기여</th>
            <th className="r" style={{ width: 66 }} title="수입 ÷ 인건비 — 인건비 1원당 벌어들인 수입">배수</th>
            <th style={{ width: 80 }}>인건비 입력</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={KINDS.length + 7} style={{ textAlign: 'center', padding: 18, color: 'var(--ink-4)' }}>
              자료가 없습니다.
            </td></tr>
          )}
          {rows.map((r) => {
            const supply = r.values.supply ?? 0;
            const noCost = isAudit || r.exempt || r.person === '(미지정)';
            const margin = supply - r.cost;
            const isSubtotal = r.sub == null && !isAudit && axis === 'cpa-staff';
            return (
              <tr key={`${r.key} ${r.sub ?? ''}`}
                style={isSubtotal ? { background: '#F3F4F6', fontWeight: 700 }
                  : r.exempt ? { color: 'var(--ink-3)' }
                    : !noCost && r.cost === 0 ? { background: '#FFFBEB' } : undefined}>
                <td style={{ fontWeight: r.sub == null ? 700 : 400, color: r.exempt ? '#999' : '#1A2B52' }}>
                  {r.sub == null ? r.key : <span style={{ paddingLeft: 14, color: 'var(--ink-2)' }}>└ {r.sub}</span>}
                  {r.split && <span style={{ fontSize: 'var(--fs-0)', color: 'var(--warn)' }}> 안분</span>}
                </td>
                <td className="r" style={{ color: 'var(--ink-2)' }}>{r.values.clients ?? 0}</td>
                {KINDS.map((k) => (
                  <td key={k.key} className="r" style={{ color: (r.values[k.key] ?? 0) ? undefined : '#CCC' }}>
                    {won(r.values[k.key] ?? 0)}
                  </td>
                ))}
                <td className="r" style={{ fontWeight: 700 }}>{won(supply)}</td>
                <td className="r" style={{ color: noCost ? '#999' : r.cost ? '#666' : '#c33' }}>
                  {isAudit ? '—' : r.exempt ? '대상 아님' : r.person === '(미지정)' ? '—'
                    : r.cost ? won(r.cost) : '미등록'}
                </td>
                <td className="r" style={{
                  fontWeight: 700,
                  color: noCost ? '#999' : margin >= 0 ? '#065F46' : '#991B1B',
                }}>
                  {noCost ? '—' : won(margin)}
                </td>
                <td className={noCost || !r.cost ? '' : sigClass(supply / r.cost, avgRatio)}
                  style={noCost || !r.cost ? { color: 'var(--ink-4)' } : undefined}>
                  {noCost || !r.cost ? '—' : `${(supply / r.cost).toFixed(2)}×`}
                </td>
                <td>
                  {r.leaf && !isAudit && !r.exempt && r.person !== '(미지정)' && !r.split && (
                    // 급여를 고치는 곳은 **한 곳뿐**이다 — 여기서 고치게 두면 호봉표를
                    // 거치지 않고 금액을 넣을 수 있어 급여정책이 샌다. 세팅 탭으로 보낸다.
                    <button className="btn-sm" disabled={readonly}
                      title="인건비 세팅 탭에서 호봉으로 정합니다"
                      onClick={() => onSetup(r.person)}>
                      {costs.some((x) => x.staffName === r.person) ? '세팅 ›' : '입력 ›'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ background: '#f5efdd', fontWeight: 700 }}>
            <td>
              합계
              {!isAudit && <span style={{ fontWeight: 400, fontSize: 'var(--fs-0)', color: 'var(--ink-2)' }}> (인건비 대상)</span>}
            </td>
            <td className="r">{sumOf(counted, 'clients')}</td>
            {KINDS.map((k) => <td key={k.key} className="r">{won(sumOf(counted, k.key))}</td>)}
            <td className="r">{won(totSupply)}</td>
            <td className="r">{isAudit ? '—' : won(totCost)}</td>
            <td className="r" style={{ color: totSupply - totCost >= 0 ? '#065F46' : '#991B1B' }}>
              {isAudit ? '—' : won(totSupply - totCost)}
            </td>
            <td className={!isAudit && totCost ? 'sig sig-sum' : ''}>
              {!isAudit && totCost ? `${(totSupply / totCost).toFixed(2)}×` : '—'}
            </td>
            <td></td>
          </tr>
          {exempted.length > 0 && (
            <>
              <tr style={{ color: 'var(--ink-3)' }}>
                <td>대상 아님 ({exempted.map((r) => r.person).join('·')})</td>
                <td className="r">{sumOf(exempted, 'clients')}</td>
                {KINDS.map((k) => <td key={k.key} className="r">{won(sumOf(exempted, k.key))}</td>)}
                <td className="r">{won(exSupply)}</td>
                <td colSpan={4}></td>
              </tr>
              <tr style={{ background: '#EEF2FF', fontWeight: 700 }}>
                <td>전체 합계</td>
                <td className="r"></td>
                {KINDS.map((k) => (
                  <td key={k.key} className="r">{won(sumOf(counted, k.key) + sumOf(exempted, k.key))}</td>
                ))}
                <td className="r">{won(totSupply + exSupply)}</td>
                <td colSpan={4}></td>
              </tr>
            </>
          )}
        </tfoot>
      </table>
      </div>

      {!isAudit && avgRatio > 0 && (
        <div className="legend">
          <span><i style={{ background: 'var(--good-bg)' }} /> 평균 위</span>
          <span><i style={{ background: 'var(--warn-bg)' }} /> 평균 근처</span>
          <span><i style={{ background: 'var(--bad-bg)' }} /> 평균 아래</span>
          <span><i style={{ background: 'var(--navy-bg)' }} /> 전체 평균 {avgRatio.toFixed(2)}×</span>
        </div>
      )}

      {exempted.length > 0 && (
        <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', marginTop: 8 }}>
          ℹ️ {exempted.map((r) => r.person).join('·')} 님은 <b>인건비 대상이 아니어서</b> 기여·배수를 따지지
          않습니다 — 인건비 없이 수입만 합치면 배수가 부풀려집니다.
        </div>
      )}

      {sumOf(unassigned, 'supply') > 0 && (
        <div className="alert-w" style={{ fontSize: 'var(--fs-1)', marginTop: 8 }}>
          ⚠️ 담당{isAudit ? '회계사' : '직원'}가 지정되지 않은 매출이 <b>{won(sumOf(unassigned, 'supply'))}</b>
          ({sumOf(unassigned, 'clients')}곳) 있습니다 — 누구의 기여로도 잡히지 않습니다.
          매출계약이나 거래처에 담당을 넣어 주세요.
        </div>
      )}

      {cands.length > 0 && (
        <RenewalBox fy={fy} cands={cands} picks={picks} total={renewTotal}
          show={showRenew} onToggle={() => setShowRenew((v) => !v)} readonly={readonly}
          onChange={(next) => setPicks(next)} />
      )}


    </div>
  );
}

/**
 * 계약갱신 대상 — **앞 해에는 있었는데 이번 해에 계약이 없는 것**.
 *
 * 법인세조정·종합소득세처럼 해마다 새 계약 줄이 필요한 일은, 갱신을 잊으면 아무 표시 없이
 * 예상매출만 조용히 낮아진다. 2026-09-06 에 실제로 FY2025 연 계약 8건이 FY2026 으로
 * 넘어오지 않았고 그중 하나(문지훈 님 종합소득세)는 계속해야 할 건이었다.
 *
 * ⚠️ **여기서 계약을 만들지 않는다**(사장님 지시). 매출계약등록은 실제로 맺은 것만 담고,
 *    예산은 "이렇게 될 것 같다"를 세는 자리다. 그래서 체크는 계약을 건드리지 않고
 *    budget_renewal 표에만 남으며, 켜 둔 것만 위 표의 수입에 더해진다.
 *
 * 접어 둔 채로 시작하되 **몇 건인지와 더해진 금액은 접힌 채로도 보인다** — 펼치지 않으면
 * 무엇이 빠졌는지 모르는 것이 애초의 문제였기 때문이다.
 */
function RenewalBox({ fy, cands, picks, total, show, onToggle, onChange, readonly }: {
  fy: number;
  cands: RenewalCandidate[];
  picks: Map<string, RenewalPick>;
  total: number;
  show: boolean;
  onToggle: () => void;
  onChange: (next: Map<string, RenewalPick>) => void;
  readonly: boolean;
}) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const on = (id: string) => picks.get(id)?.include ?? false;
  const onCount = cands.filter((c) => on(c.prevId)).length;

  /** 체크·금액을 바꾼다. 화면을 먼저 바꾸고 저장한다 — 되돌릴 때는 저장 실패를 알린다. */
  async function put(c: RenewalCandidate, include: boolean, amount: number | null) {
    const next = new Map(picks);
    next.set(c.prevId, { prevId: c.prevId, include, amount });
    onChange(next);
    setBusy(c.prevId); setErr('');
    try {
      await saveRenewalPick(fy, c.prevId, include, amount);
    } catch (e) {
      onChange(picks);                                  // 저장 못 했으면 화면도 되돌린다
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(''); }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button className="btn-sm" onClick={onToggle} style={{ fontWeight: 700 }}>
        {show ? '▾' : '▸'} 🔁 계약갱신 대상 {cands.length}건
        {onCount > 0
          ? <span style={{ color: 'var(--good)' }}> · {onCount}건 반영 (+{won(total)})</span>
          : <span style={{ color: 'var(--ink-3)' }}> · 반영 없음</span>}
      </button>

      {show && (
        <>
          <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', margin: '6px 0' }}>
            {fyLabel(fy - 1)} 에는 있었는데 <b>{fyLabel(fy)} 에 계약이 없는</b> 건입니다.
            체크하면 <b>위 표의 수입에 더해집니다</b> — <b>계약은 만들어지지 않습니다</b>.
            금액을 비워 두면 앞 해 금액을 그대로 씁니다.
          </div>
          {err && <div className="alert-e" style={{ fontSize: 'var(--fs-1)' }}>{err}</div>}
          <div className="tbl-wide">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 42 }}>반영</th>
                  <th>거래처</th>
                  <th>매출유형</th>
                  <th>담당</th>
                  <th className="r">{fyLabel(fy - 1)} 금액</th>
                  <th className="r" style={{ width: 120 }}>{fyLabel(fy)} 금액</th>
                </tr>
              </thead>
              <tbody>
                {cands.map((c) => {
                  const p = picks.get(c.prevId);
                  const use = on(c.prevId);
                  return (
                    <tr key={c.prevId} style={use ? { background: '#ECFDF5' } : undefined}>
                      <td style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={use} disabled={readonly || busy === c.prevId}
                          onChange={(e) => void put(c, e.target.checked, p?.amount ?? null)} />
                      </td>
                      <td style={{ fontWeight: 700, color: 'var(--navy)' }}>{c.company}</td>
                      <td style={{ color: 'var(--ink-2)' }}>{c.categoryCode}</td>
                      <td style={{ color: 'var(--ink-2)' }}>
                        {c.cpa || <span style={{ color: 'var(--ink-4)' }}>—</span>}
                        {c.staff.length > 0 && ` · ${c.staff.join('·')}`}
                      </td>
                      <td className="r" style={{ color: 'var(--ink-3)' }}>{won(c.prevAmount)}</td>
                      <td className="r">
                        <input
                          value={p?.amount == null ? '' : String(p.amount)}
                          placeholder={won(c.prevAmount)}
                          disabled={readonly || !use}
                          onChange={(e) => {
                            const v = e.target.value.replace(/[^\d]/g, '');
                            void put(c, true, v === '' ? null : Number(v));
                          }}
                          style={{ width: '100%', textAlign: 'right' }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: '#f5efdd', fontWeight: 700 }}>
                  <td colSpan={4}>반영 {onCount}건</td>
                  <td className="r" style={{ color: 'var(--ink-3)' }}>
                    {won(cands.reduce((s, c) => s + c.prevAmount, 0))}
                  </td>
                  <td className="r" style={{ color: 'var(--good)' }}>+{won(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', marginTop: 6 }}>
            담당회계사·담당직원은 <b>앞 해 계약의 것</b>을 그대로 씁니다.
            실제로 계약을 등록하시면 이 목록에서 저절로 빠집니다.
          </div>
        </>
      )}
    </div>
  );
}
