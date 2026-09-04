// 거래처현황조회 › 예산(차기 정산연도 projection).
//   예산 = 대상 정산연도에 유효계약이 계속된다는 가정의 예상매출.
//   · 계속분: 종료 없는 계약(기장 월 등)을 엔진이 자동 projection(수정 불필요).
//   · 갱신분: 전년(대상-1) 귀속 연단위 계약(감사·조정료 등)을 계속 가정 → 갱신 예산라인(끄기·금액조정).
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { corpDisplayName, type BizEntityFull } from '../../lib/bizRegistryApi';
import { contractFiscalYear, type SalesContract, type BillingCycle } from '../../lib/salesContractApi';
import { pathLabel, type Team } from '../../lib/salesContractTaxonomy';
import { periodRevenue, toNet } from '../../lib/billingSchedule';
import { listBudgetRenewals, createBudgetRenewal, updateBudgetRenewal, type BudgetRenewal } from '../../lib/budgetApi';

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const TEAMS: Team[] = ['감사team', 'taxteam'];
const CYCLE_ANN: Record<BillingCycle, number> = { 월: 12, 분기: 4, 반기: 2, 연: 1, 발생시: 1, 건: 1 };
const isOngoing = (c: SalesContract) => !c.endDate && c.fiscalYear == null;
/** 계약의 연간 순매출(공급가액) — 갱신 예산 기본값. */
const annualNet = (c: SalesContract) => toNet(c.amount * (CYCLE_ANN[c.billingCycle] ?? 1));

interface Row {
  c: SalesContract; entityId: string; label: string; team: Team; priorNet: number;
  saved?: BudgetRenewal; active: boolean; amount: number; alreadyRegistered: boolean;
}

export default function BudgetPanel({ contracts, entMap }: { contracts: SalesContract[]; entMap: Map<string, BizEntityFull> }) {
  const { role, readonly } = useAuth();
  const canEdit = !readonly && ['superuser', 'accountant', 'team_lead'].includes(role);
  const curSettlementYear = useMemo(() => { const d = new Date(); return d.getMonth() + 1 >= 7 ? d.getFullYear() : d.getFullYear() - 1; }, []);
  const [targetYear, setTargetYear] = useState<number>(0);
  const [renewals, setRenewals] = useState<BudgetRenewal[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const year = targetYear || curSettlementYear;

  async function loadRenewals(y: number) {
    try { setRenewals(await listBudgetRenewals(y)); }
    catch (e) { setMsg('예산 불러오기 실패: ' + (e instanceof Error ? e.message : e)); }
  }
  useEffect(() => { void loadRenewals(year); }, [year]);
  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(''), 2000); }

  const entName = (id: string) => { const e = entMap.get(id); return e ? corpDisplayName(e.name, e.corpForm, e.corpFormPosition) : '(삭제됨)'; };

  // 확정분(자동): 대상 정산연도에 잡히는 '등록계약' 매출 projection(발생 기준). 계속(기장)+등록된 연단위(감사 등) 모두.
  const confirmed = useMemo(() => {
    const from = `${year}-07`, to = `${year + 1}-06`;
    const m: Record<string, number> = { 감사team: 0, taxteam: 0 };
    for (const c of contracts) m[c.team] = (m[c.team] ?? 0) + periodRevenue(c, 'accrual', from, to);
    return m;
  }, [contracts, year]);

  // 대상연도에 이미 등록된 (거래처|유형) 집합 — 갱신 후보 중복 판정용.
  const registeredKeys = useMemo(() => {
    const s = new Set<string>();
    for (const c of contracts) if (contractFiscalYear(c) === year) s.add(`${c.entityId}|${c.categoryCode}`);
    return s;
  }, [contracts, year]);

  // 갱신 후보: 전년(대상-1) 귀속 연단위 계약(계속계약 제외) + 저장된 갱신라인 병합.
  //   이미 대상연도에 등록된 (거래처|유형)은 확정분에 포함 → 기본 비활성(중복 방지).
  const rows = useMemo<Row[]>(() => {
    const prior = year - 1;
    const savedBySrc = new Map<string, BudgetRenewal>();
    for (const r of renewals) if (r.sourceContractId) savedBySrc.set(r.sourceContractId, r);
    const out: Row[] = [];
    for (const c of contracts) {
      if (isOngoing(c)) continue;                       // 계속계약은 확정분에서 자동 반영
      if (contractFiscalYear(c) !== prior) continue;    // 전년 귀속만
      const saved = savedBySrc.get(c.id);
      const priorNet = annualNet(c);
      const alreadyRegistered = registeredKeys.has(`${c.entityId}|${c.categoryCode}`);
      out.push({
        c, entityId: c.entityId, team: c.team,
        label: pathLabel(c.categoryCode) + (c.categoryEtcName ? ` (${c.categoryEtcName})` : ''),
        priorNet, saved, alreadyRegistered,
        active: saved ? saved.active : !alreadyRegistered, amount: saved ? saved.amount : priorNet,
      });
    }
    return out.sort((a, b) => b.amount - a.amount);
  }, [contracts, renewals, year, registeredKeys]);

  // 갱신분 팀별 합계(활성만)
  const renewByTeam = useMemo(() => {
    const m: Record<string, number> = { 감사team: 0, taxteam: 0 };
    for (const r of rows) if (r.active) m[r.team] = (m[r.team] ?? 0) + r.amount;
    return m;
  }, [rows]);

  async function persist(r: Row, patch: { active?: boolean; amount?: number }) {
    if (!canEdit) return;
    setBusy(true);
    try {
      if (r.saved) {
        await updateBudgetRenewal(r.saved.id, patch);
      } else {
        await createBudgetRenewal({
          targetYear: year, sourceContractId: r.c.id, team: r.team, entityId: r.entityId,
          categoryCode: r.c.categoryCode, label: `${entName(r.entityId)} · ${r.label}`,
          amount: patch.amount ?? r.amount, active: patch.active ?? r.active,
        });
      }
      await loadRenewals(year);
      flash('저장됨');
    } catch (e) { setMsg('저장 실패: ' + (e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  }

  const yearOpts = useMemo(() => {
    const ys = new Set<number>([curSettlementYear, curSettlementYear + 1]);
    for (const c of contracts) { const fy = contractFiscalYear(c); if (fy != null) ys.add(fy + 1); }
    return [...ys].sort((a, b) => b - a);
  }, [contracts, curSettlementYear]);

  const grand = (m: Record<string, number>) => TEAMS.reduce((s, t) => s + (m[t] ?? 0), 0);

  return (
    <div style={{ border: '1px solid #cdd8c0', borderRadius: 8, background: '#f6faef', padding: '8px 10px', marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <b style={{ fontSize: 'var(--fs-2)', color: '#465' }}>📋 예산 (차기 정산연도 projection)</b>
        <select value={year} onChange={(e) => setTargetYear(Number(e.target.value))} style={selStyle} title="예산 대상 정산연도(회계연도 7/1~익6/30)">
          {yearOpts.map((y) => <option key={y} value={y}>{y} 귀속(정산 {y}-07~{y + 1}-06)</option>)}
        </select>
        <span style={{ fontSize: 'var(--fs-0)', color: '#8a6' }}>확정분=등록계약 projection(자동) · 갱신분={year - 1}귀속 연단위 계약을 계속 가정 · 공급가액(순액)</span>
        {msg && <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-1)', color: 'var(--good)' }}>{msg}</span>}
        {!canEdit && <span style={{ fontSize: 'var(--fs-0)', color: '#b95' }}>· 편집은 회계사·팀장·최고관리자</span>}
      </div>

      {/* 팀별 예산 요약 */}
      <table style={{ borderCollapse: 'collapse', fontSize: 'var(--fs-2)', marginBottom: 10, minWidth: 460 }}>
        <thead><tr style={{ background: '#e9f0da' }}>
          <th style={thc}>팀</th>
          <th style={{ ...thc, textAlign: 'right' }}>확정분(등록계약)</th>
          <th style={{ ...thc, textAlign: 'right' }}>갱신분(가정)</th>
          <th style={{ ...thc, textAlign: 'right' }}>예산 합계</th>
        </tr></thead>
        <tbody>
          {TEAMS.map((t) => (
            <tr key={t} style={{ borderTop: '1px solid #e0e8d2' }}>
              <td style={{ ...tdc, fontWeight: 600 }}>{t}</td>
              <td style={{ ...tdc, textAlign: 'right' }}>{won(confirmed[t] ?? 0)}</td>
              <td style={{ ...tdc, textAlign: 'right' }}>{won(renewByTeam[t] ?? 0)}</td>
              <td style={{ ...tdc, textAlign: 'right', fontWeight: 700, color: '#254' }}>{won((confirmed[t] ?? 0) + (renewByTeam[t] ?? 0))}</td>
            </tr>
          ))}
          <tr style={{ borderTop: '2px solid #a9b98a', background: '#eef4e0', fontWeight: 700 }}>
            <td style={tdc}>합계</td>
            <td style={{ ...tdc, textAlign: 'right' }}>{won(grand(confirmed))}</td>
            <td style={{ ...tdc, textAlign: 'right' }}>{won(grand(renewByTeam))}</td>
            <td style={{ ...tdc, textAlign: 'right', color: '#243' }}>{won(grand(confirmed) + grand(renewByTeam))}</td>
          </tr>
        </tbody>
      </table>

      {/* 갱신 후보 편집 */}
      <div style={{ fontSize: 'var(--fs-1)', fontWeight: 700, color: '#576', margin: '2px 0 4px' }}>갱신 후보 — {year - 1}귀속 연단위 계약 ({rows.length}건) {busy && <span style={{ color: 'var(--ink-3)' }}>· 저장 중…</span>}</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>{year - 1}귀속 연단위 계약이 없습니다.</div>
      ) : (
        <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 'var(--fs-1)', minWidth: 640 }}>
            <thead><tr style={{ background: '#e9f0da' }}>
              <th style={{ ...thc, textAlign: 'center' }}>갱신</th>
              <th style={{ ...thc, textAlign: 'left' }}>거래처</th>
              <th style={{ ...thc, textAlign: 'left' }}>유형</th>
              <th style={thc}>팀</th>
              <th style={{ ...thc, textAlign: 'right' }}>전년금액(순액)</th>
              <th style={{ ...thc, textAlign: 'right' }}>예산액</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.c.id} style={{ borderTop: '1px solid #e0e8d2', opacity: r.active ? 1 : 0.5 }}>
                  <td style={{ ...tdc, textAlign: 'center' }}>
                    <input type="checkbox" checked={r.active} disabled={!canEdit || busy} onChange={(e) => persist(r, { active: e.target.checked })} />
                  </td>
                  <td style={{ ...tdc, fontWeight: 600 }}>{entName(r.entityId)}{r.alreadyRegistered && <span style={{ marginLeft: 5, fontSize: 9.5, color: '#a80', background: '#fdf3e0', padding: '0 4px', borderRadius: 3 }} title={`${year} 귀속에 동일 거래처·유형 계약이 이미 등록되어 확정분에 포함됨(중복 방지 위해 기본 제외)`}>이미등록</span>}</td>
                  <td style={tdc}>{r.label}</td>
                  <td style={tdc}>{r.team}</td>
                  <td style={{ ...tdc, textAlign: 'right', color: 'var(--ink-3)' }}>{won(r.priorNet)}</td>
                  <td style={{ ...tdc, textAlign: 'right' }}>
                    {canEdit ? (
                      <input type="text" defaultValue={won(r.amount)} disabled={busy || !r.active}
                        onBlur={(e) => { const v = Number(e.target.value.replace(/[^\d]/g, '')) || 0; if (v !== r.amount) persist(r, { amount: v }); }}
                        style={{ width: 96, textAlign: 'right', fontSize: 'var(--fs-1)', padding: '2px 4px' }} />
                    ) : won(r.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const selStyle: React.CSSProperties = { padding: '4px 7px', fontSize: 'var(--fs-2)' };
const thc: React.CSSProperties = { padding: '5px 7px', fontWeight: 700, color: '#556', whiteSpace: 'nowrap', borderBottom: '1px solid #dbe4cc' };
const tdc: React.CSSProperties = { padding: '3px 7px', whiteSpace: 'nowrap' };
