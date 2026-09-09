// 매출통계 › 예산 › **인건비 세팅**
//
// 사장님이 해마다 하시는 일을 그대로 옮긴 자리다(2026-09-06 요구) —
//   "사람을 고르고 → 지금 급여구조를 보고 → 내년 호봉을 골라 연봉을 정한다"
//
// ⚠️ **호봉을 먼저 고르고 금액이 따라온다.** 그 반대가 아니다.
//    회사의 기본급은 인덕회계법인 직원급여산정표(별표 1)에서 나오므로 임의로 정할 수 없다.
//    화면이 금액을 자유롭게 넣게 두면 급여정책을 벗어난 값이 조용히 들어온다.
//
// ⚠️ **정남지 님은 관리수당이 있다.** 관리수당은 사장님이 신설한 칸이지만 법인의 정책은
//    어길 수 없어, **기본금 + 관리수당이 호봉표의 한 칸과 같아야** 한다. 그래서 이 화면은
//    호봉의 금액에서 관리수당을 떼어 낸 나머지를 기본금으로 둔다(splitByStep).
//
// 급여 자료라 김민섭·김동주·정남지는 이 화면에 닿지 못한다 — 부모(BudgetTab)가 막는다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import Guide from '../common/Guide';
import { confirmDanger } from '../common/DangerConfirm';
import Loading from '../common/Loading';
import Empty from '../common/Empty';
import { fyOf, fyLabel, kstYm } from '../../lib/revenueStatsApi';
import {
  listStaffCost, saveStaffCost, deleteStaffCost, totalCost, isCostExempt,
  basicTotal, deriveCost, raiseOf, yearPay,
  PAY_SCALE, payOf, splitByStep, locate,
  type StaffCost,
} from '../../lib/staffCostApi';

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const num = (s: string) => Number(String(s).replace(/[^\d]/g, '')) || 0;
const curFy = fyOf(kstYm());

/** 화면이 다루는 한 사람 — 올해 줄과 지난해 줄을 짝지어 둔다. */
interface Person {
  name: string;
  cur: StaffCost | null;
  prev: StaffCost | null;
}

export default function StaffCostTab({ focusName = '' }: { focusName?: string }) {
  const [fy, setFy] = useState(curFy);
  const [cur, setCur] = useState<StaffCost[]>([]);
  const [prev, setPrev] = useState<StaffCost[]>([]);
  const [showPay, setShowPay] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  // 예산 표에서 「세팅 ›」 을 눌러 건너온 사람을 펼친다.
  const [pick, setPick] = useState(focusName);
  useEffect(() => { if (focusName) setPick(focusName); }, [focusName]);
  const [adding, setAdding] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [a, b] = await Promise.all([listStaffCost(fy), listStaffCost(fy - 1)]);
      setCur(a); setPrev(b);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [fy]);
  useEffect(() => { void load(); }, [load]);

  /**
   * 사람 목록 — **올해 줄과 지난해 줄을 합쳐** 만든다. 지난해에 있었는데 올해 아직
   * 안 넣은 사람이 목록에서 사라지면, 넣어야 할 사람을 잊는다.
   */
  const people: Person[] = useMemo(() => {
    const names = [...new Set([...cur, ...prev].map((c) => c.staffName))]
      .filter((n) => !isCostExempt(n))
      .sort((a, b) => a.localeCompare(b, 'ko'));
    return names.map((name) => ({
      name,
      cur: cur.find((c) => c.staffName === name) ?? null,
      prev: prev.find((c) => c.staffName === name) ?? null,
    }));
  }, [cur, prev]);

  // 고른 사람이 목록에서 사라지면(연도를 바꿨을 때) 첫 사람으로 되돌린다.
  const sel = people.find((p) => p.name === pick) ?? people[0] ?? null;

  const totCur = cur.reduce((s, c) => s + totalCost(c), 0);
  const totPrev = prev.reduce((s, c) => s + totalCost(c), 0);
  const totRaise = raiseOf(totPrev, totCur);

  if (loading) return <Loading title="인건비 세팅" />;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <select value={fy} onChange={(e) => setFy(Number(e.target.value))}>
          {[curFy + 1, curFy, curFy - 1, curFy - 2].map((y) => (
            <option key={y} value={y}>{fyLabel(y)}</option>
          ))}
        </select>
        <span style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)' }}>
          {cur.length}명 · 총부담 <b style={{ color: 'var(--navy)' }}>{won(totCur)}</b>
          {totRaise && (
            <> · 앞 해 대비 <b style={{ color: totRaise.amount >= 0 ? 'var(--good)' : 'var(--bad)' }}>
              {totRaise.amount >= 0 ? '+' : ''}{won(totRaise.amount)} ({(totRaise.rate * 100).toFixed(2)}%)
            </b></>
          )}
        </span>
      </div>

      <Guide id="staff-cost-setup" label="셈법 자세히"
        summary={<>
          회사의 <b>기본급은 직원급여산정표(호봉표)</b>에서 나옵니다. 거기에 <b>비과세급여(식대)</b>를
          더한 것이 월급이고, <b>상여의 기준은 호봉표 금액</b>입니다.
        </>}>
        · <b>호봉을 먼저 고르면</b> 기본급이 따라옵니다 — 금액을 손으로 넣지 않습니다.
        법인의 급여정책이라 표를 벗어난 금액을 쓸 수 없기 때문입니다.
        <br />· <b>관리수당이 있는 분</b>(정남지 님)은 <b>기본금 + 관리수당이 호봉표의 한 칸</b>이 됩니다.
        호봉을 고르고 관리수당을 넣으면 나머지가 기본금이 됩니다.
        <br />· 월급합계 = 기본금 + 수당 + 관리수당 + 식대 · 상여 = 기본급(식대 제외) ·
        연봉 = 월급합계 × 12 + 상여.
        <br />· 퇴직금 = 연봉 ÷ 12 · 4대보험 = 연봉 × 10% · 기타 = 연봉 × 10%.
        <b> 총부담 = 연봉의 1.28333배</b>입니다.
      </Guide>

      {err && <div className="alert-e" style={{ fontSize: 'var(--fs-1)' }}>{err}</div>}

      {people.length === 0 ? (
        <Empty text={`${fyLabel(fy)} 에 등록된 인건비가 없습니다`}
          hint="아래에 이름을 넣어 사람을 먼저 만듭니다." />
      ) : (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* ── 왼쪽: 사람 목록 ── */}
          <div style={{ minWidth: 190, flex: '0 0 auto' }}>
            <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', marginBottom: 4 }}>사람</div>
            {people.map((p) => {
              const on = sel?.name === p.name;
              const missing = !p.cur;
              return (
                <button key={p.name} onClick={() => setPick(p.name)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', marginBottom: 3,
                    padding: '6px 9px', borderRadius: 4, cursor: 'pointer',
                    border: on ? '1px solid var(--navy)' : '1px solid #E5E7EB',
                    background: on ? '#EEF4FB' : '#fff',
                    fontWeight: on ? 700 : 400,
                    color: on ? 'var(--navy)' : 'var(--ink-1)',
                  }}>
                  {p.name}
                  <div style={{ fontSize: 'var(--fs-0)', fontWeight: 400, color: missing ? 'var(--bad)' : 'var(--ink-3)' }}>
                    {missing
                      ? `${fyLabel(fy)} 미등록`
                      : `${p.cur!.payStep ? `${p.cur!.payStep}호봉 · ` : ''}연봉 ${won(yearPay(p.cur!))}`}
                  </div>
                </button>
              );
            })}
            <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
              <input value={adding} onChange={(e) => setAdding(e.target.value)}
                placeholder="새 사람 이름" style={{ width: '100%', fontSize: 'var(--fs-1)' }} />
              <button className="btn-sm" disabled={!adding.trim()}
                onClick={() => { setPick(adding.trim()); setAdding(''); }}>＋</button>
            </div>
          </div>

          {/* ── 오른쪽: 고른 사람의 급여구조 ── */}
          <div style={{ flex: '1 1 460px', minWidth: 380 }}>
            {sel && (
              <PersonPanel key={`${sel.name}|${fy}`} fy={fy} person={sel} onSaved={() => void load()} />
            )}
            {!sel && pick && (
              <PersonPanel key={`${pick}|${fy}`} fy={fy}
                person={{ name: pick, cur: null, prev: null }} onSaved={() => void load()} />
            )}
          </div>
        </div>
      )}

      {cur.length > 0 && (
        <PayrollTable fy={fy} costs={cur} show={showPay} onToggle={() => setShowPay((v) => !v)}
          prevPayOf={(name) => { const c = prev.find((x) => x.staffName === name); return c ? yearPay(c) : 0; }}
          onPick={(name) => { setPick(name); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
      )}
    </div>
  );
}

/** 빈 사람의 시작점 — 저장되지 않은 껍데기. */
const blank = (fy: number, name: string): StaffCost => ({
  id: '', fy, staffName: name, monthly: 0, annual: 0, bonus: 0,
  severance: 0, insurance: 0, etcCost: 0, note: '',
  basePay: 0, allowance: 0, mgmtAllowance: 0, meal: 0,
  severanceDiv: 12, insuranceRate: 0.1, etcRate: 0.1, payStep: null,
});

/**
 * 한 사람의 급여구조. 왼쪽에 **지난해**, 오른쪽에 **이번 해 세팅**을 나란히 둔다 —
 * 인상을 정하는 일은 언제나 견주는 일이라, 견줄 것이 옆에 없으면 화면을 두 번 오가게 된다.
 */
function PersonPanel({ fy, person, onSaved }: {
  fy: number; person: Person; onSaved: () => void;
}) {
  const base = person.cur ?? blank(fy, person.name);
  // 이번 해가 비어 있으면 **지난해 호봉을 시작점**으로 삼는다. 빈 화면에서 시작하면
  // 사장님이 표를 다시 찾아야 한다.
  const startStep = base.payStep ?? person.prev?.payStep ?? null;

  const [step, setStep] = useState<number | null>(startStep);
  const [mgmt, setMgmt] = useState(String(base.mgmtAllowance || person.prev?.mgmtAllowance || ''));
  const [meal, setMeal] = useState(String(base.meal || person.prev?.meal || ''));
  const [note, setNote] = useState(base.note);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const stepPay = step ? (payOf(step) ?? 0) : 0;
  const split = splitByStep(stepPay, num(mgmt));
  // 「수당」은 화면에 없다 — 회사에 관리수당 말고는 수당이 없다(사용자 확정 2026-09-06).
  // 옛 줄에 값이 남아 있으면 그대로 안고 간다. 지어서 0 으로 덮지 않는다.
  const parts = {
    basePay: split.basePay, allowance: base.allowance,
    mgmtAllowance: split.mgmtAllowance, meal: num(meal),
  };
  const rates = {
    severanceDiv: base.severanceDiv, insuranceRate: base.insuranceRate, etcRate: base.etcRate,
  };
  const d = deriveCost(parts, rates);
  const year = yearPay(d);
  const prevYear = person.prev ? yearPay(person.prev) : 0;
  const raise = raiseOf(prevYear, year);

  /**
   * 기본급이 호봉표와 어긋났는가. **수당**을 따로 넣으면 기본급(기본금+수당+관리수당)이
   * 호봉 금액을 넘어선다 — 그러면 급여정책을 벗어난 것이라 화면이 그 사실을 말해야 한다.
   */
  const off = step != null && basicTotal(parts) !== stepPay;

  async function save() {
    if (!step) { setErr('호봉을 골라 주세요.'); return; }
    setBusy(true); setErr('');
    try {
      await saveStaffCost({
        fy, staffName: person.name, ...parts, ...rates,
        payStep: basicTotal(parts) === stepPay ? step : null,
        note,
      });
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const Cell = ({ label, v, strong, muted }: {
    label: string; v: number | string; strong?: boolean; muted?: boolean;
  }) => (
    <div>
      <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)' }}>{label}</div>
      <div style={{
        textAlign: 'right', fontSize: strong ? 'var(--fs-2)' : 'var(--fs-1)',
        fontWeight: strong ? 700 : 400,
        color: muted ? 'var(--ink-3)' : strong ? 'var(--navy)' : 'var(--ink-1)',
      }}>
        {typeof v === 'number' ? won(v) : v}
      </div>
    </div>
  );

  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 'var(--fs-3)', color: 'var(--navy)', marginBottom: 8 }}>
        {person.name}
        <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-2)' }}>
          {' — '}{fyLabel(fy)} 인건비
        </span>
      </div>

      {/* ── 지난해 급여구조 ── */}
      <div style={{ background: '#F7F8FA', borderRadius: 4, padding: '8px 10px', marginBottom: 10 }}>
        <div style={{ fontSize: 'var(--fs-1)', fontWeight: 700, color: 'var(--ink-2)', marginBottom: 5 }}>
          지금 급여 — {fyLabel(fy - 1)}
        </div>
        {person.prev ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
              <Cell label="호봉" v={person.prev.payStep ? `${person.prev.payStep}호봉` : '—'} />
              <Cell label="기본금" v={person.prev.basePay} />
              <Cell label="관리수당" v={person.prev.mgmtAllowance || '—'} />
              <Cell label="식대" v={person.prev.meal} />
              <Cell label="연봉" v={prevYear} strong />
            </div>
            <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)', marginTop: 4 }}>
              기본급 {won(basicTotal(person.prev))} · 월급합계 {won(person.prev.monthly)} ·
              상여 {won(person.prev.bonus)} · 총부담 {won(totalCost(person.prev))}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
            {fyLabel(fy - 1)} 자료가 없습니다 — 인상을 견줄 것이 없어 인상률은 나오지 않습니다.
          </div>
        )}
      </div>

      {/* ── 이번 해 세팅 ── */}
      <div style={{ fontSize: 'var(--fs-1)', fontWeight: 700, marginBottom: 5 }}>
        {fyLabel(fy)} 세팅 — <span style={{ fontWeight: 400, color: 'var(--ink-2)' }}>호봉을 고르면 기본급이 따라옵니다</span>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 'var(--fs-1)' }}>
          호봉<br />
          <select value={step ?? ''} onChange={(e) => setStep(e.target.value ? Number(e.target.value) : null)}
            style={{ minWidth: 210 }}>
            <option value="">— 고르세요 —</option>
            {PAY_SCALE.map((s) => (
              <option key={s.step} value={s.step}>
                {s.step}호봉 · {won(s.monthly)} (연 {won(s.annual)})
              </option>
            ))}
          </select>
        </label>
        {person.prev?.payStep && step && step !== person.prev.payStep && (
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--good)', paddingBottom: 4 }}>
            {person.prev.payStep}호봉 → <b>{step}호봉</b> ({step > person.prev.payStep ? '+' : ''}{step - person.prev.payStep})
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
        <label style={{ fontSize: 'var(--fs-1)' }} title="기본금과 합쳐서 호봉표의 금액이 됩니다">
          관리수당<br />
          <input value={mgmt} onChange={(e) => setMgmt(e.target.value.replace(/[^\d]/g, ''))}
            style={{ width: '100%', textAlign: 'right' }} />
        </label>
        <label style={{ fontSize: 'var(--fs-1)' }}
          title="비과세급여입니다. 월급합계에는 들어가고 상여 계산에서는 빠집니다">
          식대(비과세)<br />
          <input value={meal} onChange={(e) => setMeal(e.target.value.replace(/[^\d]/g, ''))}
            style={{ width: '100%', textAlign: 'right' }} />
        </label>
        {base.allowance > 0 && (
          // 화면에서 없앤 칸이지만 옛 줄에 값이 있으면 숨기지 않고 보여 준다.
          <div style={{ fontSize: 'var(--fs-1)' }}>
            수당(옛 값)<br />
            <div style={{ textAlign: 'right', padding: '3px 6px', background: '#F3F4F6', borderRadius: 4 }}>
              {won(base.allowance)}
            </div>
          </div>
        )}
      </div>

      {step != null && (
        <div style={{
          marginTop: 8, padding: '7px 10px', borderRadius: 4,
          background: off ? '#FEF3C7' : '#EEF4FB',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            <Cell label="기본금" v={parts.basePay} />
            <Cell label={`관리수당${split.over ? ' (넘침)' : ''}`} v={parts.mgmtAllowance || '—'} />
            <Cell label={`기본급 = ${step}호봉`} v={basicTotal(parts)} />
            <Cell label="월급합계" v={d.monthly} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 6 }}>
            <Cell label="상여 100%" v={d.bonus} />
            <Cell label="연봉" v={year} strong />
            <Cell label="퇴직금·보험·기타" v={d.severance + d.insurance + d.etcCost} muted />
            <Cell label="총부담비용" v={d.total} strong />
          </div>
          {off && (
            <div style={{ fontSize: 'var(--fs-1)', color: 'var(--warn)', marginTop: 6 }}>
              ⚠️ 기본급 <b>{won(basicTotal(parts))}</b> 이 {step}호봉({won(stepPay)})과 다릅니다
              {' — '}수당을 넣으면 호봉표를 벗어납니다. 이대로 저장하면 <b>호봉 없이</b> 금액만 남습니다.
            </div>
          )}
          {split.over && (
            <div style={{ fontSize: 'var(--fs-1)', color: 'var(--bad)', marginTop: 4 }}>
              ⚠️ 관리수당이 호봉 금액보다 커서 기본금이 0 이 되었습니다.
            </div>
          )}
        </div>
      )}

      {raise && (
        <div style={{
          marginTop: 8, fontSize: 'var(--fs-1)', padding: '6px 10px', borderRadius: 4,
          background: raise.amount >= 0 ? '#ECFDF5' : '#FEF2F2',
        }}>
          연봉 {won(prevYear)} → <b>{won(year)}</b>
          {' · '}인상 <b>{raise.amount >= 0 ? '+' : ''}{won(raise.amount)}</b>
          {' ('}{(raise.rate * 100).toFixed(2)}%{')'}
        </div>
      )}

      <label style={{ fontSize: 'var(--fs-1)', display: 'block', marginTop: 8 }}>
        비고<br />
        <input value={note} onChange={(e) => setNote(e.target.value)} style={{ width: '100%' }} />
      </label>

      {err && <div className="alert-e" style={{ fontSize: 'var(--fs-1)', marginTop: 6 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button className="btn-p" disabled={busy || !step} onClick={() => void save()}>
          {busy ? '저장 중…' : person.cur ? '저장' : '등록'}
        </button>
        {person.cur?.id && (
          <button className="btn-sm btn-sm-del" disabled={busy}
            onClick={() => void (async () => {
              if (!await confirmDanger({
                title: '인건비 설정을 지웁니다',
                target: `${person.name} · ${fyLabel(fy)}`,
                detail: '호봉 · 기본금 · 수당 · 부담률이 모두 지워집니다.',
              })) return;
              await deleteStaffCost(person.cur!.id); onSaved();
            })()}>
            삭제
          </button>
        )}
        {person.prev && !person.cur && (
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', alignSelf: 'center' }}>
            {fyLabel(fy - 1)} 값을 시작점으로 채워 두었습니다 — 호봉만 올리면 됩니다.
          </span>
        )}
      </div>

      {/* 지금 급여가 표의 어디쯤인지 — 옛 줄(호봉 없는 줄)을 표 위에 얹어 보는 자리. */}
      {person.cur && person.cur.payStep == null && basicTotal(person.cur) > 0 && (
        <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', marginTop: 8 }}>
          ℹ️ 저장된 기본급 {won(basicTotal(person.cur))} 은 호봉표에 <b>딱 맞는 칸이 없습니다</b>
          {' — '}가장 가까운 곳은 {locate(basicTotal(person.cur)).step}호봉이고
          {' '}{won(Math.abs(locate(basicTotal(person.cur)).diff))} 차이입니다.
        </div>
      )}
    </div>
  );
}

/**
 * 급여표 전체 — **엑셀 급여표를 그대로 옮긴 표**(2026-09-06).
 *
 * 위쪽은 한 사람을 정하는 자리이고, 여기는 **정해 놓은 것을 한눈에 견주는** 자리다.
 * 기본금부터 총부담비용까지 왼쪽에서 오른쪽으로 읽으면 셈이 따라온다.
 *
 * 접어 둔 채로 시작한다 — 한 사람을 고치러 온 사람에게 전원의 급여를 먼저 펼칠 이유는 없다.
 */
function PayrollTable({ fy, costs, prevPayOf, show, onToggle, onPick }: {
  fy: number;
  costs: StaffCost[];
  prevPayOf: (name: string) => number;
  show: boolean;
  onToggle: () => void;
  onPick: (name: string) => void;
}) {
  const rows = [...costs].sort((a, b) => b.annual - a.annual);
  const sum = (f: (c: StaffCost) => number) => rows.reduce((s, c) => s + f(c), 0);
  const totPrev = sum((c) => prevPayOf(c.staffName));
  const totYear = sum(yearPay);
  const totRaise = raiseOf(totPrev, totYear);

  return (
    <div style={{ marginTop: 12 }}>
      <button className="btn-sm" onClick={onToggle} style={{ fontWeight: 700 }}>
        {show ? '▾' : '▸'} 📋 급여표 전체 — {fyLabel(fy)} ({rows.length}명 · 총부담 {won(sum(totalCost))})
      </button>
      {show && (
        <div className="tbl-wide" style={{ marginTop: 6 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>이름</th>
                <th className="r">호봉</th>
                <th className="r">기본금</th>
                <th className="r">수당</th>
                <th className="r">관리수당</th>
                <th className="r">기본급합계</th>
                <th className="r">식대</th>
                <th className="r">월급합계</th>
                <th className="r">상여</th>
                <th className="r">연봉</th>
                <th className="r">FY{fy - 1} 연봉</th>
                <th className="r">인상</th>
                <th className="r">퇴직금</th>
                <th className="r">4대보험</th>
                <th className="r">기타</th>
                <th className="r">총부담비용</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const parts = {
                  basePay: c.basePay, allowance: c.allowance,
                  mgmtAllowance: c.mgmtAllowance, meal: c.meal,
                };
                // 구성요소가 비어 있는 옛 줄은 **저장된 결과값**을 그대로 보여 준다.
                // 지어낸 구성요소를 만들어 내면 화면이 거짓말을 한다.
                const legacy = basicTotal(parts) + parts.meal === 0;
                const year = yearPay(c);
                const prev = prevPayOf(c.staffName);
                const r = raiseOf(prev, year);
                const dash = <span style={{ color: 'var(--ink-4)' }}>—</span>;
                return (
                  <tr key={c.id || c.staffName}>
                    <td style={{ fontWeight: 700, color: 'var(--navy)' }}>{c.staffName}</td>
                    <td className="r" style={{ color: c.payStep ? 'var(--ink-1)' : 'var(--warn)' }}>
                      {c.payStep ? `${c.payStep}호봉` : '표 밖'}
                    </td>
                    <td className="r">{legacy ? dash : won(c.basePay)}</td>
                    <td className="r">{legacy || !c.allowance ? dash : won(c.allowance)}</td>
                    <td className="r">{legacy || !c.mgmtAllowance ? dash : won(c.mgmtAllowance)}</td>
                    <td className="r" style={{ color: 'var(--ink-2)' }}>
                      {legacy ? dash : won(basicTotal(parts))}
                    </td>
                    <td className="r">{legacy || !c.meal ? dash : won(c.meal)}</td>
                    <td className="r" style={{ fontWeight: 700 }}>{won(c.monthly)}</td>
                    <td className="r">{won(c.bonus)}</td>
                    <td className="r" style={{ fontWeight: 700, color: 'var(--navy)' }}>{won(year)}</td>
                    <td className="r" style={{ color: 'var(--ink-3)' }}>{prev ? won(prev) : dash}</td>
                    <td className="r" style={{ color: r ? (r.amount >= 0 ? 'var(--good)' : 'var(--bad)') : undefined }}>
                      {r ? `${r.amount >= 0 ? '+' : ''}${won(r.amount)} (${(r.rate * 100).toFixed(2)}%)` : dash}
                    </td>
                    <td className="r" style={{ color: 'var(--ink-2)' }}>{won(c.severance)}</td>
                    <td className="r" style={{ color: 'var(--ink-2)' }}>{won(c.insurance)}</td>
                    <td className="r" style={{ color: 'var(--ink-2)' }}>{won(c.etcCost)}</td>
                    <td className="r" style={{ fontWeight: 700 }}>{won(totalCost(c))}</td>
                    <td>
                      <button className="btn-sm" onClick={() => onPick(c.staffName)}>위에서 고치기 ↑</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: '#f5efdd', fontWeight: 700 }}>
                <td>합계</td>
                <td colSpan={6}></td>
                <td className="r">{won(sum((c) => c.monthly))}</td>
                <td className="r">{won(sum((c) => c.bonus))}</td>
                <td className="r">{won(totYear)}</td>
                <td className="r">{totPrev ? won(totPrev) : ''}</td>
                <td className="r" style={{ color: totRaise && totRaise.amount < 0 ? 'var(--bad)' : 'var(--good)' }}>
                  {totRaise ? `${totRaise.amount >= 0 ? '+' : ''}${won(totRaise.amount)} (${(totRaise.rate * 100).toFixed(2)}%)` : ''}
                </td>
                <td className="r">{won(sum((c) => c.severance))}</td>
                <td className="r">{won(sum((c) => c.insurance))}</td>
                <td className="r">{won(sum((c) => c.etcCost))}</td>
                <td className="r">{won(sum(totalCost))}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {show && (
        <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', marginTop: 6 }}>
          <b>기본급(기본금+관리수당) = 호봉표의 한 칸</b>입니다. 월급합계 = 기본급+식대 ·
          상여 = 기본급 · 연봉 = 월급합계×12+상여 · 퇴직금 = 연봉÷12 · 4대보험·기타 = 연봉의 10%.
          「표 밖」은 호봉표에 없는 금액이라 호봉을 붙이지 못한 줄입니다.
        </div>
      )}
    </div>
  );
}
