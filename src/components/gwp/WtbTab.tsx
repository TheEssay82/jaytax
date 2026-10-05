// 감사업무관리 › 📒 정산표 관리 — 회사 고르기 + 「① 중간 이월」·「② 기말 갱신」(사용자 2026-10-05).
//
// 정산표는 일반조서와 주석·DSD 가 **함께 쓰는 줄기**라 따로 메뉴를 두었다(전에는 일반조서 관리 안 타일 — 「갑자기 안 보인다」).
//   ① 중간 이월 — 작년 확정 정산표 + 회사 제시 재무제표 → 올해 중간감사 정산표(rollWtb)
//   ② 기말 갱신 — 중간 정산표(주석 시트를 붙인 것도) + 기말 회사 재무제표 → 회사제시 열만 기말 숫자로(refreshWtb)
// 다른 화면에서 「정산표」 단추로 오면 그 회사를 골라 둔 채로 연다(sessionStorage 'jaytax:pickEng').
import { useEffect, useMemo, useState } from 'react';
import Empty from '../common/Empty';
import { useAuth } from '../../context/AuthContext';
import { listEngagements, type Engagement } from '../../lib/dsdApi';
import { listWtbOutputs, type EngFile } from '../../lib/gwpStageApi';
import WtbRollCard from './WtbRollCard';

export const PICK_KEY = 'jaytax:pickEng';
/** 다른 화면에서 이 회사를 골라 둔 채로 열게 한다. */
export function pickEngagementFor(id: string) { try { sessionStorage.setItem(PICK_KEY, id); } catch { /* 저장소를 못 쓰면 그냥 연다 */ } }
export function takePickedEngagement(): string | null {
  // 바로 지우지 않고 잠깐 뒤에 지운다 — 개발 모드(StrictMode)는 화면을 두 번 그려 첫 번째가 가져가 버린다.
  try { const v = sessionStorage.getItem(PICK_KEY); if (v) setTimeout(() => { try { sessionStorage.removeItem(PICK_KEY); } catch { /* 무시 */ } }, 1500); return v; } catch { return null; }
}

type Key = 'none' | 'mid' | 'end';
const STAGE: Record<Key, { label: string; color: string }> = {
  none: { label: '이월 전', color: '#9AA0A6' },
  mid: { label: '중간 이월 ✓', color: '#2F7BD8' },
  end: { label: '기말 갱신 ✓', color: '#12A38A' },
};

export default function WtbTab({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const { role, readonly, sandbox } = useAuth();
  const canWriteBase = !readonly && (role === 'superuser' || role === 'accountant' || role === 'per_head_accountant');
  const [engs, setEngs] = useState<Engagement[]>([]);
  const [outs, setOuts] = useState<Map<string, { mid: EngFile | null; end: EngFile | null }>>(new Map());
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'중간' | '기말'>('중간');
  const [listOpen, setListOpen] = useState(true);
  const [filter, setFilter] = useState<Key | null>(null);
  const [fyAt, setFyAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refreshOuts = () => listWtbOutputs().then(setOuts).catch(() => undefined);
  useEffect(() => {
    void (async () => {
      try {
        const [list, o] = await Promise.all([listEngagements(), listWtbOutputs()]);
        const real = list.filter((e) => !e.isDemo || sandbox);
        setEngs(real); setOuts(o);
        const want = takePickedEngagement();
        if (want && real.some((e) => e.id === want)) {
          setPickedId(want); setListOpen(false);
          setMode(o.get(want)?.mid ? '기말' : '중간');
        }
      } catch (e) { setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'); } finally { setLoading(false); }
    })();
  }, []);

  const years = useMemo(() => [...new Set(engs.map((e) => e.fy))].sort((a, b) => b - a), [engs]);
  const fy = fyAt ?? years[0];
  const inYear = useMemo(() => engs.filter((e) => e.fy === fy).sort((a, b) => a.entityName.localeCompare(b.entityName, 'ko')), [engs, fy]);
  const keyOf = (id: string): Key => (outs.get(id)?.end ? 'end' : outs.get(id)?.mid ? 'mid' : 'none');
  const picked = engs.find((e) => e.id === pickedId) ?? null;
  // 체험 계정은 시연용 건에서만 저장(서버 0168 과 같은 선).
  const canWrite = canWriteBase && (!sandbox || !!picked?.isDemo);

  function pick(id: string) {
    setPickedId(id); setListOpen(false);
    setMode(outs.get(id)?.mid ? '기말' : '중간');
  }
  function go(tab: 'dsd' | 'gwp') { if (picked) pickEngagementFor(picked.id); onNavigate?.(tab); }

  if (loading) return <div className="card">불러오는 중…</div>;
  const counts = new Map<Key, number>();
  for (const e of inYear) counts.set(keyOf(e.id), (counts.get(keyOf(e.id)) ?? 0) + 1);
  const shown = picked && !listOpen ? inYear.filter((e) => e.id === picked.id) : inYear.filter((e) => !filter || keyOf(e.id) === filter);
  const chip = (on: boolean, n: number) => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, cursor: n ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 'var(--fs-1)',
    border: `1px solid ${on ? 'var(--navy)' : 'var(--rule)'}`, background: on ? 'var(--navy-bg)' : '#fff', color: 'var(--ink-2)',
    fontWeight: on ? 700 : 400, borderRadius: 999, padding: '2px 10px', opacity: n ? 1 : 0.45,
  } as const);
  const o = picked ? outs.get(picked.id) : undefined;

  return (
    <div>
      <div className="card">
        <div className="chdr">📒 정산표 관리
          <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>{picked ? `${picked.entityName} · FY${picked.fy} ${picked.scope}` : '회사를 고르세요'}</span>
        </div>
        <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7 }}>
          중간감사 때 <b>작년 정산표를 한 해 이월</b>하고, 기말감사 때 <b>회사 기말 재무제표로 회사제시 열을 갱신</b>합니다. 일반조서와 주석·DSD 가 같은 정산표를 씁니다.
        </div>
      </div>
      {err && <div className="card" style={{ color: 'var(--bad)', background: 'var(--bad-bg)' }}>{err}</div>}

      <div className="card" style={{ padding: '10px 12px 12px' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 9 }}>
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>사업연도</span>
          {years.map((y) => (
            <button key={y} onClick={() => { setFyAt(y); setListOpen(true); setFilter(null); }} style={{
              cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--fs-1)', border: `1px solid ${y === fy ? 'var(--navy)' : 'var(--rule)'}`,
              background: y === fy ? 'var(--navy)' : '#fff', color: y === fy ? '#fff' : 'var(--ink-2)', fontWeight: y === fy ? 700 : 400, borderRadius: 999, padding: '3px 11px',
            }}>FY{y}<span style={{ opacity: 0.7, marginLeft: 6, fontWeight: 400 }}>· {engs.filter((e) => e.fy === y).length}건</span></button>
          ))}
        </div>
        {inYear.length === 0 ? <Empty text="작업 건이 없습니다" hint="주석·DSD 관리 또는 일반조서 관리의 「새 건 만들기」로 만듭니다." /> : (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
              <button style={chip(!filter, inYear.length)} onClick={() => { setFilter(null); setListOpen(true); }}>전체 {inYear.length}</button>
              {(Object.keys(STAGE) as Key[]).map((k) => (
                <button key={k} style={chip(filter === k, counts.get(k) ?? 0)} disabled={!counts.get(k)} onClick={() => { setFilter(filter === k ? null : k); setListOpen(true); }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: STAGE[k].color }} />{STAGE[k].label} {counts.get(k) ?? 0}
                </button>
              ))}
              {picked && <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setListOpen(!listOpen)}>{listOpen ? '목록 접기 ▲' : `다른 회사 고르기 ▼ (${inYear.length - 1})`}</button>}
            </div>
            <div style={{ border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
              {shown.map((e, i) => {
                const k = keyOf(e.id), st = STAGE[k], x = outs.get(e.id), on = e.id === pickedId;
                const latest = x?.end ?? x?.mid;
                return (
                  <button key={e.id} onClick={() => pick(e.id)} style={{
                    display: 'grid', gridTemplateColumns: '6px minmax(0, 1fr) auto auto', gap: 10, alignItems: 'center', width: '100%',
                    textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', border: 0, borderTop: i ? '1px solid var(--rule)' : 0,
                    background: on ? 'var(--navy-bg)' : '#fff', padding: '7px 10px 7px 0',
                  }}>
                    <span style={{ alignSelf: 'stretch', background: st.color }} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--navy)' }}>{e.entityName}</span>
                      <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginLeft: 8 }}>{e.scope}{latest ? ` · ${latest.fileName} · ${latest.createdAt.slice(0, 10)}` : ''}</span>
                    </span>
                    <span style={{ fontSize: 'var(--fs-1)', fontWeight: 700, color: '#fff', background: st.color, borderRadius: 999, padding: '1px 9px', whiteSpace: 'nowrap' }}>{st.label}</span>
                    <span style={{ color: 'var(--ink-4)', fontSize: 'var(--fs-1)' }}>{on ? '●' : '›'}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {!picked ? <div className="card"><Empty text="위에서 회사를 고르세요." /></div> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '2px 0 10px' }}>
            {([['중간', '①', '중간 이월', '중간감사', '작년 확정 정산표 → 올해 중간 정산표', o?.mid], ['기말', '②', '기말 갱신', '기말감사', '중간 정산표 → 기말 회사제시로', o?.end]] as const).map(([m, no, t, when, d, f]) => {
              const on = mode === m;
              return (
                <button key={m} onClick={() => setMode(m)} style={{
                  textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', padding: '8px 12px', borderRadius: 'var(--r-sm)',
                  border: `1.5px solid ${on ? 'var(--navy)' : 'var(--rule)'}`, background: on ? 'var(--navy)' : '#fff',
                }}>
                  <div style={{ fontSize: 'var(--fs-1)', color: on ? 'rgba(255,255,255,.75)' : 'var(--ink-3)' }}>{when} · {d}</div>
                  <div style={{ fontSize: 'var(--fs-3)', fontWeight: 700, color: on ? '#fff' : 'var(--navy)' }}>{no} {t}{f ? ' ✓' : ''}</div>
                </button>
              );
            })}
          </div>
          <WtbRollCard key={`${picked.id}:${mode}`} eng={picked} canWrite={canWrite} mode={mode} />
          <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 'var(--fs-2)', color: 'var(--ink-2)' }}>
            <span>{mode === '중간' ? '다음 — 이 정산표로 주석 껍데기를 만들려면' : '다음 — 갱신한 정산표의 주석을 채우고 검증하려면'}</span>
            <button className="btn-sm btn-sm-navy" onClick={() => go('dsd')}>📗 주석·DSD 관리로 ›</button>
            <button className="btn-sm" onClick={() => go('gwp')}>📘 일반조서 관리로 ›</button>
            <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => void refreshOuts()}>목록 새로고침</button>
          </div>
        </>
      )}
    </div>
  );
}
