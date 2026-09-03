// 예산 — 직원별 수입 대비 인건비.
//
// 사용자가 엑셀에서 하던 일을 옮긴 것이다 —
//   "1년간의 성과를 직원별로 집계하고, 인건비를 예측해서 실적을 계산한다"
//
// **급여가 걸린 자리라 김민섭·김동주·정남지는 이 탭을 열 수 없다.** 화면과 표(RLS)
// 양쪽에서 막는다. 배부는 **직접비(인건비)만** 한다 — 공통비는 결산 시스템을 만들 때 붙인다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  listBudgetFacts, listForecastFacts, listRevenueAll, fyOf, fyLabel, fyRange, kstYm,
} from '../../lib/revenueStatsApi';
import {
  listStaffCost, saveStaffCost, deleteStaffCost, copyStaffCostFrom, totalCost, canSeeStaffCost,
  isCostExempt, type StaffCost,
} from '../../lib/staffCostApi';

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const curFy = fyOf(kstYm());
const num = (s: string) => Number(String(s).replace(/[^\d-]/g, '')) || 0;

/** 수입을 무엇으로 볼지. 기본은 **예산(혼합)** — 예산은 원래 이렇게 굴러간다. */
type Basis = 'budget' | 'forecast' | 'actual';
const BASIS_LABEL: Record<Basis, string> = {
  budget: '예산(지난 달 실적 + 남은 달 예상)',
  forecast: '예상만(계약 기준)',
  actual: '실적만(청구 기준)',
};

/** 'YYYY-MM' 한 달 앞 — 안내 문구에만 쓴다. */
function prevOf(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export default function BudgetTab() {
  const { role, profileName, readonly } = useAuth();
  const allowed = canSeeStaffCost(role, profileName);

  const [fy, setFy] = useState(curFy);
  const [basis, setBasis] = useState<Basis>('budget');
  const [team, setTeam] = useState('taxteam');
  const [costs, setCosts] = useState<StaffCost[]>([]);
  const [income, setIncome] = useState<Map<string, { supply: number; clients: Set<string> }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<StaffCost | null>(null);

  const load = useCallback(async () => {
    if (!allowed) { setLoading(false); return; }
    setLoading(true); setErr('');
    try {
      const { from, to } = fyRange(fy);
      const t = team || undefined;
      const [cs, facts] = await Promise.all([
        listStaffCost(fy),
        basis === 'budget' ? listBudgetFacts(fy, t, { includeDraft: true })
          : basis === 'forecast' ? listForecastFacts(from, to, t, { includeDraft: true })
            : listRevenueAll(from, to, t),
      ]);
      const m = new Map<string, { supply: number; clients: Set<string> }>();
      for (const f of facts) {
        const list = f.shares.length ? f.shares : [{ name: '(미지정)', share: 100 }];
        for (const s of list) {
          const g = m.get(s.name) ?? { supply: 0, clients: new Set<string>() };
          g.supply += f.supply * (s.share / 100);
          g.clients.add(f.company);
          m.set(s.name, g);
        }
      }
      setCosts(cs); setIncome(m);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [allowed, fy, basis, team]);
  useEffect(() => { void load(); }, [load]);

  /** 인건비가 등록된 사람 + 수입이 잡힌 사람을 합쳐 한 줄씩. */
  const rows = useMemo(() => {
    const names = new Set<string>([...costs.map((c) => c.staffName), ...income.keys()]);
    names.delete('(미지정)');
    return [...names].map((name) => {
      const c = costs.find((x) => x.staffName === name);
      const inc = income.get(name);
      const exempt = isCostExempt(name);
      const cost = exempt ? 0 : c ? totalCost(c) : 0;
      const supply = inc?.supply ?? 0;
      return { name, exempt, cost, supply, clients: inc?.clients.size ?? 0, c, margin: supply - cost };
    }).sort((a, b) => Number(a.exempt) - Number(b.exempt) || b.margin - a.margin);
  }, [costs, income]);

  // 합계는 **인건비 대상만** 센다 — 대상 아닌 사람의 수입이 섞이면 배수가 부풀려진다.
  const counted = rows.filter((r) => !r.exempt);
  const sum = (f: (r: typeof rows[number]) => number) => counted.reduce((s, r) => s + f(r), 0);
  const exempted = rows.filter((r) => r.exempt && r.supply > 0);
  const unassigned = income.get('(미지정)');
  const cut = kstYm();

  if (!allowed) {
    return (
      <div className="card">
        <div className="chdr">💵 예산</div>
        <div className="alert-w" style={{ fontSize: 12 }}>
          이 화면은 <b>급여 자료</b>를 다루므로 열 수 없습니다.
          <br />필요하시면 최고관리자에게 문의해 주세요.
        </div>
      </div>
    );
  }
  if (loading) return <div className="card">불러오는 중…</div>;

  return (
    <div className="card">
      <div className="chdr" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        💵 예산 — 직원별 수입 대비 인건비
        <select value={fy} onChange={(e) => setFy(Number(e.target.value))} style={{ fontWeight: 700 }}>
          {[curFy + 1, curFy, curFy - 1, curFy - 2].map((y) => (
            <option key={y} value={y}>{fyLabel(y)}</option>
          ))}
        </select>
        <select value={basis} onChange={(e) => setBasis(e.target.value as Basis)}
          style={{ fontWeight: 700, color: basis === 'budget' ? '#1A2B52' : '#92400E' }}
          title={BASIS_LABEL[basis]}>
          {(Object.keys(BASIS_LABEL) as Basis[]).map((b) => (
            <option key={b} value={b}>{BASIS_LABEL[b]}</option>
          ))}
        </select>
        <select value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="taxteam">taxteam</option>
          <option value="감사team">감사팀</option>
          <option value="">전체 팀</option>
        </select>
        <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => void load()}>새로고침</button>
      </div>

      <div className="alert-i" style={{ fontSize: 11.5 }}>
        <b>수입 − 인건비 = 기여</b>. 직원이 맡은 거래처에서 나오는(나올) 매출에서 그 사람의 총부담비용을 뺀 것입니다.
        <br />· <b>배수 = 수입 ÷ 인건비</b> — 인건비 1원당 얼마를 벌어들였는가입니다. <b>2.00×</b> 면 인건비의
        두 배를 벌어온 것입니다. 기여 금액만 보면 사람마다 인건비 규모가 달라 비교가 어긋나는데, 배수는 그 차이를 지웁니다.
        <br />· 배부는 <b>직접비(인건비)만</b> 합니다. 임차료·관리비 같은 공통비는 결산 시스템을 만들 때 붙입니다.
        <br />· 공동담당은 <b>배분 비율만큼</b> 나눠 더합니다 — 한 거래처가 두 사람에게 통째로 잡히지 않습니다.
        <br />· 이 화면은 <b>급여 자료</b>라 김민섭·김동주·정남지에게는 열리지 않습니다.
      </div>
      {basis === 'budget' && (
        <div style={{ fontSize: 11.5, color: '#555', margin: '6px 0' }}>
          📐 수입 기준 — <b>{fyRange(fy).from} ~ {prevOf(cut)}</b> 은 실제로 청구한 <b>실적</b>,
          {' '}<b>{cut} 이후</b>는 계약에서 뽑은 <b>예상</b>입니다.
          {' '}달이 갈수록 실적이 예상을 밀어냅니다. 이번 달은 아직 청구가 끝나지 않았을 수 있어 예상 쪽에 둡니다.
        </div>
      )}
      {err && <div className="alert-e" style={{ fontSize: 11.5 }}>{err}</div>}

      <table className="tbl" style={{ fontSize: 11.5 }}>
        <thead>
          <tr>
            <th style={{ minWidth: 90 }}>직원</th>
            <th className="r" style={{ width: 70 }}>거래처</th>
            <th className="r" style={{ minWidth: 120 }}>수입</th>
            <th className="r" style={{ minWidth: 120 }}>인건비(총부담)</th>
            <th className="r" style={{ minWidth: 120 }}>기여</th>
            <th className="r" style={{ width: 70 }} title="수입 ÷ 인건비 — 인건비 1원당 벌어들인 수입">배수</th>
            <th style={{ width: 90 }}>인건비 입력</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={7} style={{ textAlign: 'center', padding: 18, color: '#BBB' }}>
              자료가 없습니다.
            </td></tr>
          )}
          {rows.map((r) => (
            <tr key={r.name}
              style={r.exempt ? { color: '#999' } : r.cost === 0 ? { background: '#FFFBEB' } : undefined}>
              <td style={{ fontWeight: 700, color: r.exempt ? '#999' : '#1A2B52' }}>{r.name}</td>
              <td className="r" style={{ color: '#666' }}>{r.clients}</td>
              <td className="r">{won(r.supply)}</td>
              <td className="r" style={{ color: r.exempt ? '#999' : r.cost ? '#666' : '#c33' }}>
                {r.exempt ? '대상 아님' : r.cost ? won(r.cost) : '미등록'}
              </td>
              <td className="r" style={{
                fontWeight: 700,
                color: r.exempt ? '#999' : r.margin >= 0 ? '#065F46' : '#991B1B',
              }}>
                {r.exempt ? '—' : won(r.margin)}
              </td>
              <td className="r" style={{ color: '#666' }}>
                {r.exempt || !r.cost ? '—' : `${(r.supply / r.cost).toFixed(2)}×`}
              </td>
              <td>
                {!r.exempt && (
                  <button className="btn-sm" disabled={readonly}
                    onClick={() => setEdit(r.c ?? {
                      id: '', fy, staffName: r.name, monthly: 0, annual: 0, bonus: 0,
                      severance: 0, insurance: 0, etcCost: 0, note: '',
                    })}>
                    {r.c ? '수정' : '입력'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ background: '#f5efdd', fontWeight: 700 }}>
            <td>합계<span style={{ fontWeight: 400, fontSize: 10.5, color: '#666' }}> (인건비 대상)</span></td>
            <td className="r">{sum((r) => r.clients)}</td>
            <td className="r">{won(sum((r) => r.supply))}</td>
            <td className="r">{won(sum((r) => r.cost))}</td>
            <td className="r" style={{ color: sum((r) => r.margin) >= 0 ? '#065F46' : '#991B1B' }}>
              {won(sum((r) => r.margin))}
            </td>
            <td className="r">
              {sum((r) => r.cost) ? `${(sum((r) => r.supply) / sum((r) => r.cost)).toFixed(2)}×` : '—'}
            </td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      {exempted.length > 0 && (
        <div style={{ fontSize: 11.5, color: '#666', marginTop: 8 }}>
          ℹ️ {exempted.map((r) => r.name).join('·')} 님의 수입{' '}
          <b>{won(exempted.reduce((s, r) => s + r.supply, 0))}</b> 은 <b>인건비 대상이 아니어서</b> 위 합계에서
          뺐습니다 — 인건비 없이 합치면 배수가 부풀려집니다.
        </div>
      )}

      {unassigned && unassigned.supply > 0 && (
        <div className="alert-w" style={{ fontSize: 11.5, marginTop: 8 }}>
          ⚠️ 담당직원이 지정되지 않은 매출이 <b>{won(unassigned.supply)}</b>({unassigned.clients.size}곳) 있습니다 —
          어느 직원의 기여로도 잡히지 않습니다. 매출계약이나 거래처에 담당직원을 넣어 주세요.
        </div>
      )}

      <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
        <button className="btn-sm" disabled={readonly}
          onClick={() => void (async () => {
            if (!confirm(`FY${fy - 1} 인건비를 FY${fy} 로 복사합니다. 이미 있는 사람은 덮어씁니다.`)) return;
            const n = await copyStaffCostFrom(fy - 1, fy);
            if (!n) return alert(`FY${fy - 1} 에 등록된 인건비가 없습니다.`);
            await load();
          })()}>
          ⧉ 앞 연도에서 복사
        </button>
      </div>

      {edit && (
        <CostEditor row={edit} onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); void load(); }} />
      )}
    </div>
  );
}

/** 인건비 한 사람 — 엑셀 표와 같은 칸을 그대로 둔다. */
function CostEditor({ row, onClose, onSaved }: {
  row: StaffCost; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({
    monthly: String(row.monthly || ''), annual: String(row.annual || ''),
    bonus: String(row.bonus || ''), severance: String(row.severance || ''),
    insurance: String(row.insurance || ''), etcCost: String(row.etcCost || ''), note: row.note,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const total = num(f.annual) + num(f.bonus) + num(f.severance) + num(f.insurance) + num(f.etcCost);

  /** 엑셀과 같은 채우기 — 연봉=세전×12, 4대보험·기타=연봉의 10%, 퇴직금=(연봉+상여)/13. */
  function autoFill() {
    const m = num(f.monthly);
    if (!m) return alert('세전 월급을 먼저 넣어 주세요.');
    const annual = m * 12;
    const bonus = num(f.bonus) || 0;
    setF((p) => ({
      ...p,
      annual: String(annual),
      insurance: String(Math.round(annual * 0.1)),
      etcCost: String(Math.round(annual * 0.1)),
      severance: String(Math.round((annual + bonus) / 13)),
    }));
  }

  async function save() {
    setBusy(true); setErr('');
    try {
      await saveStaffCost({
        fy: row.fy, staffName: row.staffName,
        monthly: num(f.monthly), annual: num(f.annual), bonus: num(f.bonus),
        severance: num(f.severance), insurance: num(f.insurance), etcCost: num(f.etcCost),
        note: f.note,
      });
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const F = ({ label, k }: { label: string; k: keyof typeof f }) => (
    <label style={{ fontSize: 11.5, display: 'block' }}>
      {label}<br />
      <input value={f[k]} onChange={(e) => set(k, e.target.value.replace(/[^\d-]/g, ''))}
        style={{ width: '100%', textAlign: 'right' }} />
    </label>
  );

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 60,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520, width: '100%' }}>
        <div className="chdr" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          💰 {row.staffName} — FY{row.fy} 인건비
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>닫기</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <F label="세전(월)" k="monthly" />
          <F label="연봉" k="annual" />
          <F label="상여" k="bonus" />
          <F label="퇴직금" k="severance" />
          <F label="4대보험" k="insurance" />
          <F label="기타 지출비용" k="etcCost" />
        </div>
        <button className="btn-sm" style={{ marginTop: 8 }} onClick={autoFill}
          title="연봉=세전×12, 4대보험·기타=연봉의 10%, 퇴직금=(연봉+상여)/13">
          ⚡ 세전 월급으로 나머지 채우기
        </button>
        <label style={{ fontSize: 11.5, display: 'block', marginTop: 8 }}>
          비고<br />
          <input value={f.note} onChange={(e) => set('note', e.target.value)} style={{ width: '100%' }} />
        </label>
        <div style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: '#1A2B52' }}>
          총부담비용 {won(total)}
        </div>
        {err && <div className="alert-e" style={{ fontSize: 11.5, marginTop: 6 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button className="btn-p" disabled={busy} onClick={() => void save()}>
            {busy ? '저장 중…' : '저장'}
          </button>
          {row.id && (
            <button className="btn-sm btn-sm-del" disabled={busy}
              onClick={() => void (async () => {
                if (!confirm(`${row.staffName} 의 FY${row.fy} 인건비를 지웁니다.`)) return;
                await deleteStaffCost(row.id); onSaved();
              })()}>
              삭제
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
