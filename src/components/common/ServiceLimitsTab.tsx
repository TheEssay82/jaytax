// ⚙️ 서비스 한도 — 외부 서비스 요금제에 얼마나 다가갔는지.
//
// **한도를 넘기면 어느 날 갑자기 막힌다.** 미리 알면 요금제를 올리거나 자료를 줄일 시간이 있다.
// 최고관리자 전용(menu.ts cap: manageUsers) — 계정 수·용량은 운영 정보다.
import { useCallback, useEffect, useState } from 'react';
import Loading from './Loading';
import Guide from './Guide';
import {
  SUPABASE_FREE, EXTERNAL_SERVICES, ratioOf, levelOf, worstLevel,
  humanBytes, humanUsed, LEVEL_LABEL, WARN_AT, type LimitLevel,
} from '../../lib/serviceLimits';
import {
  listUsage, listUsageTables, listUsageBuckets,
  type UsageRow, type TableRow, type BucketRow,
} from '../../lib/serviceUsageApi';

const TONE: Record<LimitLevel, { bar: string; text: string; bg: string }> = {
  ok: { bar: '#2E6449', text: '#2E6449', bg: '#E4EEE7' },
  warn: { bar: '#A9761F', text: '#8A6218', bg: '#F3EAD6' },
  critical: { bar: '#9B3527', text: '#9B3527', bg: '#F6E7E3' },
  over: { bar: '#7A1F14', text: '#7A1F14', bg: '#F6E7E3' },
};

export default function ServiceLimitsTab() {
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [buckets, setBuckets] = useState<BucketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [u, t, b] = await Promise.all([listUsage(), listUsageTables(8), listUsageBuckets()]);
      setUsage(u); setTables(t); setBuckets(b);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rows = SUPABASE_FREE.map((l) => {
    const u = usage.find((x) => x.key === l.key);
    const used = l.unit === 'bytes' ? u?.bytes ?? null : u?.items ?? null;
    const ratio = ratioOf(used, l.limit);
    return { ...l, used, ratio, level: levelOf(ratio), items: u?.items ?? null };
  });
  const worst = worstLevel(rows.map((r) => r.level));

  if (loading) return <Loading title="⚙️ 서비스 한도" rows={6} rep />;

  return (
    <div className="card rep">
      <div className="rep-title">
        ⚙️ 서비스 한도
        <span className="sub">요금제를 올려야 할 때를 미리 알려 줍니다</span>
        <button className="btn-rep" style={{ marginLeft: 'auto' }} onClick={() => void load()}>새로고침</button>
      </div>

      {err && <div className="alert-e" style={{ fontSize: 'var(--fs-1)' }}>{err}</div>}

      <Guide box={worst === 'ok' ? 'rep-hint' : 'alert-w'} id="service-limits" label="한도 기준"
        summary={worst === 'ok'
          ? <>지금은 <b>여유가 있습니다.</b> {Math.round(WARN_AT * 100)}% 를 넘으면 여기가 경고로 바뀝니다.</>
          : <><b>{LEVEL_LABEL[worst]}</b> — 아래에서 어느 항목인지 보시고, 요금제를 올리거나 자료를 줄여야 합니다.</>}>
        · 한도는 <b>Supabase 무료 플랜</b> 기준입니다. 요금제는 바뀌므로, 경고가 뜨면 콘솔에서 현재 한도를 확인해 주세요.
      </Guide>

      {/* ── 한도 막대 ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
        {rows.map((r) => {
          const t = TONE[r.level];
          const w = r.ratio == null ? 0 : Math.min(100, Math.round(r.ratio * 100));
          return (
            <div key={r.key}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 'var(--fs-3)', color: 'var(--navy)' }}>{r.label}</b>
                <span style={{ fontSize: 'var(--fs-2)', color: 'var(--ink)' }}>
                  {humanUsed(r.used, r.unit)}
                  <span style={{ color: 'var(--ink-3)' }}> / {r.limit == null ? '한도 모름'
                    : r.unit === 'bytes' ? humanBytes(r.limit) : r.limit.toLocaleString('ko-KR')}</span>
                </span>
                <span style={{
                  fontSize: 'var(--fs-1)', padding: '2px 7px', borderRadius: 3,
                  background: t.bg, color: t.text, fontWeight: 700,
                }}>
                  {r.ratio == null ? '—' : `${w}% · ${LEVEL_LABEL[r.level]}`}
                </span>
                {r.key === 'storage' && r.items != null && (
                  <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>파일 {r.items}개</span>
                )}
              </div>
              <div style={{ height: 8, background: '#EDEAE2', borderRadius: 4, marginTop: 5, overflow: 'hidden' }}>
                <div style={{ width: `${w}%`, height: '100%', background: t.bar, borderRadius: 4 }} />
              </div>
              <div style={{ fontSize: 'var(--fs-1)', color: '#777', marginTop: 4 }}>{r.consequence}</div>
            </div>
          );
        })}
      </div>

      {/* ── 무엇이 자리를 차지하나 ── */}
      <div style={{ marginTop: 20 }}>
        <b style={{ fontSize: 'var(--fs-3)', color: 'var(--navy)' }}>무엇이 자리를 차지하나</b>
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}> — 줄여야 할 때 여기를 봅니다</span>
        <table className="tbl" style={{ fontSize: 'var(--fs-1)', marginTop: 6 }}>
          <thead>
            <tr><th>테이블</th><th className="r" style={{ width: 90 }}>크기</th><th className="r" style={{ width: 90 }}>행 수(추정)</th></tr>
          </thead>
          <tbody>
            {tables.map((t) => (
              <tr key={t.name}>
                <td style={{ fontFamily: 'monospace', fontSize: 'var(--fs-1)' }}>{t.name}</td>
                <td className="r">{humanBytes(t.bytes)}</td>
                <td className="r" style={{ color: 'var(--ink-2)' }}>{t.rowsEst.toLocaleString('ko-KR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {buckets.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <b style={{ fontSize: 'var(--fs-3)', color: 'var(--navy)' }}>파일 저장소</b>
          <table className="tbl" style={{ fontSize: 'var(--fs-1)', marginTop: 6 }}>
            <thead>
              <tr><th>버킷</th><th className="r" style={{ width: 90 }}>크기</th><th className="r" style={{ width: 90 }}>파일 수</th></tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.name}>
                  <td style={{ fontFamily: 'monospace', fontSize: 'var(--fs-1)' }}>{b.name}</td>
                  <td className="r">{humanBytes(b.bytes)}</td>
                  <td className="r" style={{ color: 'var(--ink-2)' }}>{b.items}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 앱에서 잴 수 없는 것 ── */}
      <div style={{ marginTop: 20 }}>
        <b style={{ fontSize: 'var(--fs-3)', color: 'var(--navy)' }}>앱에서 잴 수 없는 것</b>
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}> — 각자 콘솔에서 봐야 합니다</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
          {EXTERNAL_SERVICES.map((s) => (
            <div key={s.name} style={{
              border: '1px solid var(--rule)', borderRadius: 6, padding: '8px 10px', fontSize: 'var(--fs-1)',
            }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <b style={{ color: 'var(--navy)' }}>{s.name}</b>
                <span style={{
                  fontSize: 'var(--fs-0)', padding: '1px 6px', borderRadius: 3,
                  background: '#F1EFE9', color: 'var(--ink-3)',
                }}>{s.plan}</span>
                <a href={s.url} target="_blank" rel="noreferrer"
                  style={{ marginLeft: 'auto', fontSize: 'var(--fs-1)', color: '#A9761F', fontWeight: 700 }}>
                  콘솔 열기 ↗
                </a>
              </div>
              <div style={{ color: 'var(--ink-2)', marginTop: 3, lineHeight: 1.6 }}>{s.watch}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
