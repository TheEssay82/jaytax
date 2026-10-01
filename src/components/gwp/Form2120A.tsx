// 2120A 위험평가 분석적절차 입력 — 전기(이월 때 옮겨 둔 열)와 당기(전기 DSD 로 채움)를 나란히, 증감·비고.
import { useState } from 'react';
import { balance, cleanFs, groupLike, sameGroup, unusedBorrowed, type Paper2120A, type Row2120, type FillReport } from '../../lib/gwpPaper2120A';
import { flagsOf, coveredByGroup, bundlesOf, bundleProc, missingProcs, fillStdProcs, offIndustry, splitProc, generalizeProc, stdHas, triggerOf, stdAccountOf, INDUSTRIES, UNEXPECTED_FACTOR, type ProcStd, type ProcBundle } from '../../lib/gwpProcStd';

const fmt = (n: number | null | undefined) => (n == null ? '' : n.toLocaleString('ko-KR'));
const parse = (s: string): number | null => { const t = s.replace(/[,\s]/g, ''); if (!t) return null; const n = Number(t.replace(/^\((.*)\)$/, '-$1')); return Number.isFinite(n) ? n : null; };

const SRC: Record<string, { t: string; c: string }> = {
  문구: { t: 'DSD', c: 'var(--good)' }, 차감: { t: 'DSD 차감', c: 'var(--good)' }, 금액: { t: 'DSD(금액으로 짝)', c: 'var(--navy)' }, 손: { t: '손으로', c: 'var(--ink-2)' },
};

export default function Form2120A({ value, onChange, readOnly, fill, report, om, omWarn, std, industry, industryGuessed, onIndustry, onSaveStd }: {
  value: Paper2120A;
  onChange: (v: Paper2120A) => void;
  readOnly: boolean;
  /** 전기 DSD 로 채우기 버튼(없으면 자료함에 DSD 가 없는 것) */ fill?: React.ReactNode;
  report: FillReport | null;
  /** 판정 기준 중요성(원) — 2700A-2 계획단계. 없으면 판정을 못 한다. */ om: number | null;
  /** 2700A-2 가 미덥지 않다(확인 전·금액이 이 회사 재무제표와 다름) — 판정이 틀릴 수 있다 */ omWarn?: string | null;
  /** 주요 감사절차 표준(gwp_proc_std) */ std: ProcStd[];
  /** 이 회사 업종 — 표준 문구를 고를 때 */ industry: string | null;
  /** 업종이 저장값이 아니라 추정값이다 */ industryGuessed: boolean;
  onIndustry: (v: string) => void;
  /** 적은 절차를 표준 줄로(사용자 2026-10-01 「WEB 창에서 표준절차를 직접」) — 없으면 버튼을 숨긴다 */ onSaveStd?: (rows: Omit<ProcStd, 'id'>[]) => Promise<void>;
}) {
  const [only, setOnly] = useState<'all' | 'big' | 'todo' | 'proc'>('all');
  /** 받을 줄 없는 계정을 더할 줄(계정 → 줄 key) · 이미 더한 계정 */
  const [pick, setPick] = useState<Record<string, string>>({});
  const [placed, setPlaced] = useState<Set<string>>(new Set());
  /** 받을 줄 없는 계정을 새 줄로 넣을 분류(계정 → 「BS|분류」) · 아래 「+ 계정 줄 추가」 입력 */
  const [grp, setGrp] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<{ g: string; label: string; cur: string; fsli: string } | null>(null);
  // 분류 — 새 계정 줄을 끼울 곳(「Ⅰ. 유동자산」·「(1) 유형자산」·「Ⅳ. 판매비와관리비」). 평안정공 2026-09-28.
  const groups: { id: string; name: string; pl: boolean; sec?: Row2120['sec'] }[] = [];
  for (const r of value.rows) {
    if (!r.group) continue;
    const id = `${r.pl ? 'PL' : 'BS'}|${r.group}`;
    if (!groups.some((g) => g.id === id)) groups.push({ id, name: r.group.replace(/\s+/g, ' '), pl: r.pl, sec: r.sec });
  }
  /** 새 계정 줄을 그 분류의 끝에 — 반영할 때 엑셀에도 그 분류 끝에 줄을 끼우고 합계 범위를 늘린다. */
  const addRow = (gid: string, label: string, cur: number | null, extra: Partial<Row2120> = {}) => {
    const g = groups.find((x) => x.id === gid);
    if (!g || !label.trim()) return;
    const row: Row2120 = { key: `new|${gid}|${label.trim()}`, label: label.trim(), fsli: '', pl: g.pl, prev: null, cur, note: '', src: '손', sec: g.sec, group: value.rows.find((r) => `${r.pl ? 'PL' : 'BS'}|${r.group}` === gid)?.group, added: true, ...extra };
    const last = value.rows.map((r, i) => ({ r, i })).filter(({ r }) => `${r.pl ? 'PL' : 'BS'}|${r.group}` === gid).pop()?.i ?? value.rows.length - 1;
    onChange({ ...value, rows: [...value.rows.slice(0, last + 1), row, ...value.rows.slice(last + 1)] });
  };
  const set = (key: string, p: Partial<Row2120>) => onChange({ ...value, rows: value.rows.map((r) => (r.key === key ? { ...r, ...p } : r)) });
  const big = (r: Row2120) => {
    if (r.prev == null || r.cur == null) return false;
    const g = r.cur - r.prev;
    return Math.abs(g) >= 10_000_000 && (r.prev === 0 || Math.abs(g / r.prev) >= 0.2);
  };
  const todo = (r: Row2120) => (!!r.prev && r.cur == null) || r.prevDiff != null;
  // 주요 감사절차 — Material(잔액 > 중요성) · Unexpected(증감 > 중요성×90%)가 뜬 줄은 K 를 적어야 한다(사용자 2026-09-30).
  const flag = (r: Row2120) => flagsOf(r, om);
  // 재고·유형·무형자산은 묶음 — 계정마다가 아니라 분류 줄(또는 첫 줄)에 한 번(사용자 2026-10-01).
  const units = bundlesOf(value.rows, std, om);
  const unitOf = new Map<string, ProcBundle>(units.flatMap((u) => u.rows.map((r) => [r.key ?? r.label, u] as const)));
  const unitNeed = (u: ProcBundle) => !!value.hasProc && (u.flags.material || u.flags.unexpected) && !bundleProc(u, value.groupProc);
  const needProc = (r: Row2120) => { if (unitOf.has(r.key)) return unitNeed(unitOf.get(r.key)!); const f = flag(r); return !!value.hasProc && (f.material || f.unexpected) && !r.proc?.trim() && !coveredByGroup(r, value.groupProc); };
  const lacking = missingProcs(value, om, std).length;
  /** [표준에 저장] — 적은 문구를 ①② 로 나눠, 표준에 없는 줄만 이 계정의 공통 표준으로. 금액은 {증감액} 자리표시로. */
  const [savingStd, setSavingStd] = useState('');
  const saveStd = async (key: string, account: string, label: string, text: string, flags?: { material: boolean; unexpected: boolean }) => {
    if (!onSaveStd) return;
    const lines = splitProc(text).map(generalizeProc).filter((b) => !stdHas(std, account, b));
    if (!lines.length) { alert(`「${account}」 표준에 이미 같은 문구가 있습니다.`); return; }
    const aliases = label && cleanFs(label) !== cleanFs(account) ? [label] : [];
    const rows = lines.map((body, i) => ({ account, aliases, trigger: triggerOf(body, flags), industry: '공통', body, sort: 50 + i, active: true, note: '2120A 화면에서 저장' }));
    const list = rows.map((r) => `· [${r.trigger}] ${r.body}`).join('\n');
    if (!confirm(`「${account}」 표준(공통)에 ${rows.length}줄을 더합니다 — 다음 회사부터 [표준 절차 넣기]에 들어갑니다.\n\n${list}\n\n업종 한정·판정은 ③ 표준 절차 탭에서 고칠 수 있습니다.`)) return;
    setSavingStd(key);
    try { await onSaveStd(rows); } catch (e) { alert(e instanceof Error ? e.message : '저장하지 못했습니다.'); } finally { setSavingStd(''); }
  };
  const stdBtn = (key: string, account: string, label: string, text: string, flags?: { material: boolean; unexpected: boolean }) => (onSaveStd && text.trim() ? (
    <button className="btn-sm" style={{ whiteSpace: 'nowrap', padding: '0 6px' }} disabled={!!savingStd} title="이 문구를 이 계정의 표준 절차로 저장 — 다음 회사부터 자동으로 들어갑니다"
      onClick={() => void saveStd(key, account, label, text, flags)}>{savingStd === key ? '저장 중…' : '표준에 저장'}</button>
  ) : null);
  /** 표준 절차 넣기 — 판정이 났는데 비었거나(분류 줄 절차도 없음) 「항상」 절차가 있는 계정의 빈 칸만. 이미 적힌 회사 문구는 건드리지 않는다. */
  const fillStd = () => {
    const r = fillStdProcs(value, std, industry, om);
    onChange(r.data);
    return r.n;
  };
  const [filled, setFilled] = useState<number | null>(null);
  const unused = value.rows.filter((r) => unusedBorrowed(value, r)).length;
  const rows = value.rows.filter((r) => !unusedBorrowed(value, r) && (only === 'big' ? big(r) : only === 'todo' ? todo(r) : only === 'proc' ? needProc(r) || !!r.procStd : true));
  if (!value.rows.length) return <div style={{ color: 'var(--warn)' }}>2120A 에서 전기·당기 열(「BS: 2024_4Q」 같은 머리)을 찾지 못했습니다.</div>;

  return (
    <div style={{ fontSize: 'var(--fs-2)' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        {!readOnly && fill}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {([['all', '모두'], ['big', '증감 큰 줄'], ['todo', '확인할 줄'], ['proc', `절차 확인할 줄${lacking ? ` ${lacking}` : ''}`]] as const).map(([k, l]) => (
            <button key={k} className={`btn-sm${only === k ? ' btn-sm-navy' : ''}`} onClick={() => setOnly(k)}>{l}</button>
          ))}
        </span>
      </div>
      {value.hasProc && (
        <div style={{ padding: '6px 10px', borderRadius: 8, marginBottom: 6, background: 'var(--surface-2)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', lineHeight: 1.6 }}>
          <span>
            <b>판정 기준</b> — 2700A-2 계획단계 중요성{' '}
            {om == null ? <b style={{ color: 'var(--bad)' }}>없음(2700A-2 를 먼저 확인하세요)</b>
              : <><b>{fmt(Math.round(om))}</b>원 · Unexpected 는 증감 {'>'} {fmt(Math.round(om * UNEXPECTED_FACTOR))}원</>}
            {omWarn && <div style={{ color: 'var(--bad)', fontSize: 'var(--fs-1)' }}>⚠ {omWarn}</div>}
          </span>
          <span>
            <b>업종</b>{' '}
            <select className="btn-sm" disabled={readOnly} value={industry ?? ''} onChange={(e) => onIndustry(e.target.value)}>
              {INDUSTRIES.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            {industryGuessed && <span style={{ color: 'var(--warn)', fontSize: 'var(--fs-0)', marginLeft: 4 }}>재무제표로 추정 — 맞으면 그대로, 아니면 고르세요</span>}
          </span>
          {!readOnly && om != null && (
            <button className="btn-sm btn-sm-navy" onClick={() => setFilled(fillStd())}
              title="판정이 났는데 절차가 빈 줄(분류 줄 절차도 없는 줄)만 표준 문구로 채웁니다 — 이미 적힌 문구는 그대로">표준 절차 넣기</button>
          )}
          {lacking > 0 ? <b style={{ color: 'var(--bad)' }}>절차가 빈 판정 줄 {lacking}개 — 채워야 [확인]됩니다</b>
            : om != null && <span style={{ color: 'var(--good)' }}>판정 줄 모두 절차 있음 ✓</span>}
          {filled != null && <span style={{ color: 'var(--ink-2)' }}>{filled}줄에 표준 절차를 넣었습니다(노란 표시 — 회사 사실에 맞게 고치세요).</span>}
        </div>
      )}
      {/* 자산 = 부채 + 자본 — 사용자 2026-09-27 「2120A 는 자산=부채+자본 검증이 필요」 */}
      {(['prev', 'cur'] as const).map((w) => {
        const b = balance(value.rows, w);
        if (!b) return null;
        const ok = Math.abs(b.diff) < 1;
        const lab = w === 'prev' ? '전기' : '당기';
        return (
          <div key={w} style={{ padding: '5px 10px', borderRadius: 8, marginBottom: 4, fontVariantNumeric: 'tabular-nums',
            background: ok ? 'var(--good-bg)' : 'var(--bad-bg)', color: ok ? 'var(--good)' : 'var(--bad)' }}>
            <b>{lab} {ok ? '✓' : '✗'}</b> 자산 {fmt(b.asset)} {ok ? '=' : '≠'} 부채 {fmt(b.liab)} + 자본 {fmt(b.equity)}
            {!ok && <b> · 차이 {fmt(b.diff)}</b>}
          </div>
        );
      })}
      {report && (
        <div style={{ padding: '6px 10px', borderRadius: 8, background: 'var(--surface-2)', marginBottom: 8, lineHeight: 1.6 }}>
          전기 DSD 로 채움 — 문구 {report.byLabel} · 차감 계정 {report.byContra} · 금액으로 짝 {report.byValue}
          {report.scale !== 1 && ` · DSD 단위 ×${report.scale}`}
          {report.missing.length > 0 && <div style={{ color: 'var(--warn)' }}>작년 금액이 있는데 DSD 에서 못 찾은 줄: {report.missing.join(', ')} — 손으로 넣으세요.</div>}
          {report.prevDiff.length > 0 && <div style={{ color: 'var(--warn)' }}>전기 열 금액이 DSD 전기 금액과 다른 줄: {report.prevDiff.join(', ')} — 재분류·재작성인지 보세요.</div>}
          {report.unplaced.filter((u) => !placed.has(u.label)).length > 0 && (
            <div style={{ color: 'var(--warn)' }}>
              DSD 에는 있는데 2120A 에 받을 줄이 없는 계정 — 합계가 이만큼 어긋납니다. 같은 계정인 줄을 골라 더하세요:
              {report.unplaced.filter((u) => !placed.has(u.label)).map((u) => {
                const isPl = /손익/.test(u.statement);
                const mineGroups = groups.filter((g) => g.pl === isPl);
                // DSD 윗 과목이 2120A 에 없는 분류면(더그림 「투자자산」) 새 분류를 제안한다 — 엉뚱한 분류(투자부동산)에 넣지 않게.
                const p = u.parents?.[0];
                const fresh = p && !/총계|합계/.test(p) && !['자산', '부채', '자본'].includes(p) && !mineGroups.some((g) => groupLike(cleanFs(g.name), p)) ? p : null;
                const chosen = grp[u.label] ?? (fresh ? `NEW:${fresh}` : '');
                return (
                  <div key={u.label} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 6, color: 'var(--ink-1)' }}>
                    <span style={{ whiteSpace: 'nowrap', minWidth: 170 }}><b>{u.label}</b> {fmt(u.cur)} →</span>
                    <select className="btn-sm" style={{ maxWidth: 260 }} disabled={readOnly} value={pick[u.label] ?? ''} onChange={(e) => setPick({ ...pick, [u.label]: e.target.value })}>
                      <option value="">줄 고르기</option>
                      {value.rows.filter((r) => r.pl === isPl).map((r) => (
                        <option key={r.key} value={r.key}>{r.label}{r.fsli ? ` (${r.fsli})` : ''}{r.cur ? ` · ${fmt(r.cur)}` : ''}</option>
                      ))}
                    </select>
                    <button className="btn-sm" style={{ whiteSpace: 'nowrap' }} disabled={readOnly || !pick[u.label]} onClick={() => {
                      const k = pick[u.label];
                      onChange({ ...value, rows: value.rows.map((r) => (r.key === k ? { ...r, cur: (r.cur ?? 0) + u.cur, src: '손', note: r.note || `${u.label} 포함`, absorbs: [...(r.absorbs ?? []), u.label] } : r)) });
                      setPlaced(new Set(placed).add(u.label));
                    }}>이 줄에 더하기</button>
                    <span style={{ color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>또는</span>
                    <select className="btn-sm" style={{ maxWidth: 240 }} disabled={readOnly} value={chosen} onChange={(e) => setGrp({ ...grp, [u.label]: e.target.value })}>
                      <option value="">분류 고르기</option>
                      {fresh && <option value={`NEW:${fresh}`}>＋ 새 분류: {fresh}</option>}
                      {mineGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                    <button className="btn-sm" style={{ whiteSpace: 'nowrap' }} disabled={readOnly || !chosen}
                      title={chosen.startsWith('NEW:') ? '반영할 때 그 구역 끝에 새 분류 머리 줄(합계)과 이 계정 줄을 끼우고, 구역 합계식에 더합니다' : '그 분류 끝에 새 계정 줄로 — 반영할 때 엑셀에도 줄을 끼우고 합계 범위를 늘립니다'}
                      onClick={() => {
                        if (chosen.startsWith('NEW:')) {
                          const name = chosen.slice(4);
                          const sec: Row2120['sec'] = isPl ? '손익' : u.sec ?? '자산';
                          const row: Row2120 = { key: `new|${name}|${u.label}`, label: u.label, fsli: u.label, pl: isPl, prev: null, cur: u.cur, note: '', src: '손', sec, group: name, added: true, absorbs: [u.label] };
                          const at = value.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.pl === isPl && r.sec === sec).pop()?.i ?? value.rows.length - 1;
                          const newGroups = [...(value.newGroups ?? []).filter((g) => !sameGroup(g.name, name)), { name, pl: isPl, parents: u.parents ?? [], sec }];
                          onChange({ ...value, newGroups, rows: [...value.rows.slice(0, at + 1), row, ...value.rows.slice(at + 1)] });
                        } else addRow(chosen, u.label, u.cur, { absorbs: [u.label], note: '' });
                        setPlaced(new Set(placed).add(u.label));
                      }}>새 줄로 넣기</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {unused > 0 && (
        <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginBottom: 4 }}>
          빌린 틀({value.borrow?.entity})에만 있고 이 회사 재무제표엔 없는 계정 {unused}줄은 숨겼습니다 — 시트에서도 숨긴 줄로 반영됩니다.
          공시 계정은 이 회사 전기 DSD 재무제표 과목입니다.
        </div>
      )}
      <table className="tbl">
        <thead><tr style={{ background: 'var(--surface-2)' }}>
          <th>계정</th><th style={{ width: 120 }}>공시 계정</th>
          <th style={{ width: 130 }}>{value.prevLabel.replace(/\s*PL:.*$/s, '').replace(/^BS:\s*/, '') || '전기'}</th>
          <th style={{ width: 140 }}>{value.curLabel.replace(/\s*PL:.*$/s, '').replace(/^BS:\s*/, '') || '당기'}</th>
          <th style={{ width: 110 }}>증감</th><th style={{ width: 60 }}>%</th><th style={{ width: 200 }}>비고</th>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const g = r.prev != null && r.cur != null ? r.cur - r.prev : null;
            const p = g != null && r.prev ? g / r.prev : null;
            const first = i === 0 || rows[i - 1].pl !== r.pl;
            return (
              <FragmentRows key={r.key} head={first ? (r.pl ? '손익' : '재무상태') : null}>
                <tr style={{ background: big(r) ? 'var(--warn-bg)' : undefined }}>
                  <td>
                    {r.label}{r.src && <span style={{ fontSize: 'var(--fs-0)', color: SRC[r.src]?.c, marginLeft: 4 }}>{SRC[r.src]?.t}</span>}
                    {r.added && <span style={{ fontSize: 'var(--fs-0)', background: '#FFFF00', color: '#000', padding: '0 4px', marginLeft: 4 }}>새 줄</span>}
                    {r.added && !readOnly && <button className="btn-sm" style={{ marginLeft: 4, padding: '0 6px' }} title="이 새 줄 빼기" onClick={() => onChange({ ...value, rows: value.rows.filter((x) => x.key !== r.key) })}>✕</button>}
                    {flag(r).material && <span style={{ fontSize: 'var(--fs-0)', background: 'var(--bad-bg)', color: 'var(--bad)', padding: '0 4px', marginLeft: 4, borderRadius: 4 }}>Material</span>}
                    {flag(r).unexpected && <span style={{ fontSize: 'var(--fs-0)', background: 'var(--warn-bg)', color: 'var(--warn)', padding: '0 4px', marginLeft: 4, borderRadius: 4 }}>Unexpected</span>}
                  </td>
                  <td style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-0)' }}>{r.fsli}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(r.prev)}{r.prevDiff != null && <div style={{ fontSize: 'var(--fs-0)', color: 'var(--warn)' }}>DSD {fmt(r.prevDiff)}</div>}
                  </td>
                  <td><input className="btn-sm" style={{ width: '100%', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} disabled={readOnly}
                    value={fmt(r.cur)} onChange={(e) => set(r.key, { cur: parse(e.target.value), src: '손' })} /></td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: g && g < 0 ? 'var(--bad)' : undefined }}>{fmt(g)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{p == null ? '' : `${Math.round(p * 1000) / 10}%`}</td>
                  <td><input className="btn-sm" style={{ width: '100%' }} disabled={readOnly} value={r.note} onChange={(e) => set(r.key, { note: e.target.value })} /></td>
                </tr>
                {value.hasProc && unitOf.has(r.key) && unitOf.get(r.key)!.rows[0] === r && (() => {
                  const u = unitOf.get(r.key)!;
                  const text = bundleProc(u, value.groupProc);
                  if (!u.flags.material && !u.flags.unexpected && !text) return null;
                  const std1 = u.onGroup ? (value.groupStd ?? []).includes(u.group) : !!u.rows.find((x) => (x.key ?? x.label) === u.holder && (x as Row2120).procStd);
                  const setText = (v: string) => (u.onGroup
                    ? onChange({ ...value, groupProc: { ...(value.groupProc ?? {}), [u.group]: v }, groupStd: (value.groupStd ?? []).filter((g) => g !== u.group) })
                    : set(u.holder, { proc: v, procStd: false }));
                  return (
                    <tr>
                      <td colSpan={7} style={{ paddingTop: 0, background: unitNeed(u) ? 'var(--bad-bg)' : std1 ? '#FFFF0033' : undefined }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                          <span style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)', whiteSpace: 'nowrap', paddingTop: 4 }} title={u.rows.map((x) => x.label).join(', ')}>
                            {u.bundle} 묶음 절차<br />({u.rows.length}개 계정{u.onGroup ? ' · 분류 줄에 적음' : ''})
                          </span>
                          <textarea className="btn-sm" rows={Math.min(5, Math.max(2, Math.ceil(text.length / 90)))} style={{ flex: 1, resize: 'vertical' }} disabled={readOnly}
                            placeholder={`${u.bundle} 계정 중 판정이 난 줄이 있습니다 — 묶어서 한 번 적거나 [표준 절차 넣기]`} value={text} onChange={(e) => setText(e.target.value)} />
                          {std1 && <span style={{ fontSize: 'var(--fs-0)', background: '#FFFF00', color: '#000', padding: '0 4px', whiteSpace: 'nowrap' }}>표준</span>}
                          {!std1 && stdBtn(u.id, u.bundle, u.bundle, text, u.flags)}
                        </div>
                      </td>
                    </tr>
                  );
                })()}
                {value.hasProc && !unitOf.has(r.key) && (flag(r).material || flag(r).unexpected || !!r.proc) && (
                  <tr>
                    <td colSpan={7} style={{ paddingTop: 0, background: needProc(r) ? 'var(--bad-bg)' : r.procStd ? '#FFFF0033' : undefined }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                        <span style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)', whiteSpace: 'nowrap', paddingTop: 4 }}>주요 감사절차</span>
                        {coveredByGroup(r, value.groupProc) && !r.proc?.trim()
                          ? <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)', paddingTop: 3 }}>상위 분류 「{r.group?.replace(/\s+/g, ' ')}」의 절차 적용 — {value.groupProc![r.group!].slice(0, 90)}{value.groupProc![r.group!].length > 90 ? '…' : ''}</span>
                          : <textarea className="btn-sm" rows={Math.min(4, Math.max(1, Math.ceil((r.proc ?? '').length / 90)))} style={{ flex: 1, resize: 'vertical' }} disabled={readOnly}
                              placeholder="판정이 났습니다 — 주요 감사절차를 적거나 [표준 절차 넣기]" value={r.proc ?? ''}
                              onChange={(e) => set(r.key, { proc: e.target.value, procStd: false })} />}
                        {r.procStd && <span style={{ fontSize: 'var(--fs-0)', background: '#FFFF00', color: '#000', padding: '0 4px', whiteSpace: 'nowrap' }}>표준</span>}
                        {!r.procStd && !coveredByGroup(r, value.groupProc) && stdBtn(r.key, stdAccountOf(r, std) ?? cleanFs(r.label).replace(/^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX]+\./, ''), r.label.trim(), r.proc ?? '', flag(r))}
                        {!!r.proc?.trim() && offIndustry(r.proc, industry) && <span style={{ fontSize: 'var(--fs-0)', background: 'var(--bad-bg)', color: 'var(--bad)', padding: '0 4px', whiteSpace: 'nowrap' }} title="틀에서 딸려 온 다른 업종(운송) 문구 — [표준 절차 넣기]가 이 회사 업종 문구로 바꿉니다">다른 업종 문구</span>}
                      </div>
                    </td>
                  </tr>
                )}
              </FragmentRows>
            );
          })}
        </tbody>
      </table>
      {!readOnly && groups.length > 0 && (
        <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 8, background: 'var(--surface-2)' }}>
          {!adding ? (
            <button className="btn-sm" onClick={() => setAdding({ g: '', label: '', cur: '', fsli: '' })}>+ 계정 줄 추가</button>
          ) : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <b>새 계정</b>
              <select className="btn-sm" value={adding.g} onChange={(e) => setAdding({ ...adding, g: e.target.value })}>
                <option value="">분류 고르기</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.pl ? '손익 · ' : '재무상태 · '}{g.name}</option>)}
              </select>
              <input className="btn-sm" placeholder="계정명" value={adding.label} onChange={(e) => setAdding({ ...adding, label: e.target.value })} style={{ width: 150 }} />
              <input className="btn-sm" placeholder="당기 금액" value={adding.cur} onChange={(e) => setAdding({ ...adding, cur: e.target.value })} style={{ width: 130, textAlign: 'right' }} />
              <input className="btn-sm" placeholder="공시 계정(비우면 윗줄과 같게)" value={adding.fsli} onChange={(e) => setAdding({ ...adding, fsli: e.target.value })} style={{ width: 190 }} />
              <button className="btn-sm btn-sm-navy" disabled={!adding.g || !adding.label.trim()} onClick={() => { addRow(adding.g, adding.label, parse(adding.cur), { fsli: adding.fsli.trim() }); setAdding(null); }}>넣기</button>
              <button className="btn-sm" onClick={() => setAdding(null)}>취소</button>
            </div>
          )}
          <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)', marginTop: 4 }}>
            새 줄은 고른 분류의 맨 끝에 들어갑니다 — 반영할 때 엑셀에도 그 자리에 줄을 끼우고, 분류 합계 범위와 증감·비율 수식을 이어 줍니다.
          </div>
        </div>
      )}
      <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-4)', marginTop: 6 }}>
        노란 줄은 증감이 1천만원 이상이면서 20% 이상인 줄입니다(비고 칸에 사유를 적어 두면 편합니다). 합계·비율 줄은 엑셀 수식이 계산합니다.
      </div>
    </div>
  );
}

function FragmentRows({ head, children }: { head: string | null; children: React.ReactNode }) {
  return <>{head && <tr><td colSpan={7} style={{ fontWeight: 700, background: 'var(--surface-2)' }}>{head}</td></tr>}{children}</>;
}
