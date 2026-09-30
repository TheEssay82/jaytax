// ③ 표준 절차 — 2120A 주요 감사절차(K열) 표준을 화면에서 고친다(사용자 2026-09-30 「(나) 화면에서 직접」).
//
// 한 줄 = 계정(동의어) × 판정(항상·Material·Unexpected) × 업종(공통·제조업 …) × 절차 문구 하나.
// 2120A 의 [표준 절차 넣기]가 공통 + 그 회사 업종 줄만 골라 ①②③ 으로 잇는다. 계정 「*」 은 계정별 줄이 없을 때의 기본.
// 문구의 {증감액}·{증감률}·{잔액} 은 그 줄 금액으로 채워진다.
import { useEffect, useMemo, useState } from 'react';
import { listProcStd, saveProcStd, deleteProcStd } from '../../lib/gwpProcStdApi';
import { INDUSTRIES, TRIGGERS, suggestProc, type ProcStd, type Trigger } from '../../lib/gwpProcStd';

type Draft = Omit<ProcStd, 'id'> & { id?: string; aliasText: string };
const blank = (account = ''): Draft => ({ account, aliases: [], aliasText: '', trigger: 'Material', industry: '공통', body: '', sort: 100, active: true, note: null });
const toDraft = (s: ProcStd): Draft => ({ ...s, aliasText: s.aliases.join(', ') });

export default function GwpProcStdCard({ canWrite }: { canWrite: boolean }) {
  const [list, setList] = useState<ProcStd[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [q, setQ] = useState('');
  const [ind, setInd] = useState<string>('전체');
  const [trig, setTrig] = useState<string>('전체');
  const [edit, setEdit] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<string>('제조업');

  const load = () => listProcStd().then(setList).catch((e) => setErr(e instanceof Error ? e.message : '읽지 못했습니다.'));
  useEffect(() => { void load(); }, []);

  const shown = useMemo(() => list.filter((s) => {
    const t = q.trim();
    if (t && !`${s.account} ${s.aliases.join(' ')} ${s.body}`.includes(t)) return false;
    if (ind !== '전체' && s.industry !== ind) return false;
    if (trig !== '전체' && s.trigger !== trig) return false;
    return true;
  }), [list, q, ind, trig]);
  const accounts = useMemo(() => [...new Set(shown.map((s) => s.account))].sort((a, b) => (a === '*' ? 1 : b === '*' ? -1 : a.localeCompare(b, 'ko'))), [shown]);

  async function save() {
    if (!edit) return;
    if (!edit.account.trim() || !edit.body.trim()) { setErr('계정과 절차 문구는 비울 수 없습니다.'); return; }
    setBusy('save'); setErr(null);
    try {
      await saveProcStd({ ...edit, aliases: edit.aliasText.split(/[,，]/).map((a) => a.trim()).filter(Boolean) });
      setEdit(null); await load();
    } catch (e) { setErr(e instanceof Error ? e.message : '저장하지 못했습니다.'); } finally { setBusy(''); }
  }
  async function remove(s: ProcStd) {
    if (!confirm(`「${s.account} · ${s.trigger} · ${s.industry}」 줄을 지웁니다.\n${s.body}\n\n잠시 빼 두려면 지우지 말고 [고치기]에서 「쓰지 않음」으로 두세요.`)) return;
    setBusy(s.id); setErr(null);
    try { await deleteProcStd(s.id); await load(); } catch (e) { setErr(e instanceof Error ? e.message : '지우지 못했습니다.'); } finally { setBusy(''); }
  }

  return (
    <div className="card">
      <div style={{ fontWeight: 700, marginBottom: 4 }}>③ 표준 절차 <span style={{ fontWeight: 400, color: 'var(--ink-3)', fontSize: 'var(--fs-1)' }}>— 2120A 주요 감사절차(K열)</span></div>
      <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7, marginBottom: 8 }}>
        2120A 에서 <b>Material</b>(잔액 {'>'} 2700A-2 중요성) · <b>Unexpected</b>(증감 {'>'} 중요성×90%)가 뜬 줄은 주요 감사절차를 적어야 합니다.
        [표준 절차 넣기]는 이 표에서 <b>공통 + 그 회사 업종</b> 줄만 골라 ①②③ 으로 잇습니다 — 업종 줄은 그 업종 회사에만 붙습니다.
        「항상」 줄은 판정과 관계없이(미수수익·선급비용 재계산), 계정 <b>*</b> 는 계정별 줄이 없을 때의 기본입니다.
        문구의 <code>{'{증감액}'}</code> · <code>{'{증감률}'}</code> · <code>{'{잔액}'}</code> 은 그 줄 금액으로 채워집니다(숫자를 문장에 고정하지 마세요).
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <input className="btn-sm" placeholder="계정·동의어·문구 찾기" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
        <select className="btn-sm" value={ind} onChange={(e) => setInd(e.target.value)}>
          {['전체', '공통', ...INDUSTRIES].map((x) => <option key={x}>{x}</option>)}
        </select>
        <select className="btn-sm" value={trig} onChange={(e) => setTrig(e.target.value)}>
          {['전체', ...TRIGGERS].map((x) => <option key={x}>{x}</option>)}
        </select>
        <span style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-1)' }}>{shown.length}줄 · 계정 {accounts.length}개</span>
        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-1)' }}>
          미리보기 업종 <select className="btn-sm" value={preview} onChange={(e) => setPreview(e.target.value)}>{INDUSTRIES.map((x) => <option key={x}>{x}</option>)}</select>
        </span>
        {canWrite && <button className="btn-sm btn-sm-navy" onClick={() => setEdit(blank())}>+ 줄 추가</button>}
      </div>
      {err && <div style={{ color: 'var(--bad)', marginBottom: 6 }}>{err}</div>}

      {edit && (
        <div style={{ padding: 10, border: '1.5px solid var(--navy)', borderRadius: 10, marginBottom: 10, display: 'grid', gridTemplateColumns: '90px 1fr', gap: '6px 10px', fontSize: 'var(--fs-2)', alignItems: 'center' }}>
          <b>계정</b><input className="btn-sm" value={edit.account} onChange={(e) => setEdit({ ...edit, account: e.target.value })} placeholder="대표 계정(「*」 = 기본)" />
          <b>동의어</b><input className="btn-sm" value={edit.aliasText} onChange={(e) => setEdit({ ...edit, aliasText: e.target.value })} placeholder="쉼표로 — 외상매출금, 받을어음" />
          <b>판정</b>
          <select className="btn-sm" value={edit.trigger} onChange={(e) => setEdit({ ...edit, trigger: e.target.value as Trigger })} style={{ width: 160 }}>{TRIGGERS.map((x) => <option key={x}>{x}</option>)}</select>
          <b>업종</b>
          <select className="btn-sm" value={edit.industry} onChange={(e) => setEdit({ ...edit, industry: e.target.value })} style={{ width: 160 }}>{['공통', ...INDUSTRIES].map((x) => <option key={x}>{x}</option>)}</select>
          <b>절차 문구</b><textarea className="btn-sm" rows={2} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} placeholder="예: 조회확인 — 잔액 상위 거래처 중심 샘플선정(E/O, A)" />
          <b>차례</b><input className="btn-sm" type="number" value={edit.sort} onChange={(e) => setEdit({ ...edit, sort: Number(e.target.value) || 0 })} style={{ width: 90 }} />
          <b>쓰기</b><label><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> 쓴다(끄면 [표준 절차 넣기]에서 빠짐)</label>
          <span />
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn-p" disabled={!!busy} onClick={() => void save()}>{busy === 'save' ? '저장 중…' : '저장'}</button>
            <button className="btn-sm" onClick={() => setEdit(null)}>취소</button>
          </div>
        </div>
      )}

      <div className="tbl-wide">
        <table className="tbl">
          <thead><tr style={{ background: 'var(--surface-2)' }}>
            <th style={{ width: 130 }}>계정</th><th style={{ width: 90 }}>판정</th><th style={{ width: 90 }}>업종</th><th>절차 문구</th><th style={{ width: 120 }}></th>
          </tr></thead>
          <tbody>
            {accounts.map((a) => {
              const rows = shown.filter((s) => s.account === a);
              const all = list.filter((s) => s.account === a);
              const sample = a === '*' ? null : suggestProc({ label: a, prev: 1e9, cur: 1.3e9 }, { material: true, unexpected: true }, all, preview);
              return rows.map((s, i) => (
                <tr key={s.id} style={{ opacity: s.active ? 1 : 0.45 }}>
                  {i === 0 && (
                    <td rowSpan={rows.length} style={{ verticalAlign: 'top' }}>
                      <b>{a === '*' ? '* (기본)' : a}</b>
                      {s.aliases.length > 0 && <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)' }}>{[...new Set(all.flatMap((x) => x.aliases))].join(', ')}</div>}
                      {sample && <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-2)', marginTop: 4 }} title={`${preview} 회사 · Material+Unexpected 일 때 넣어질 문구(잔액 13억·증감 +3억 예)`}>미리보기({preview}): {sample.slice(0, 160)}{sample.length > 160 ? '…' : ''}</div>}
                    </td>
                  )}
                  <td>{s.trigger}</td>
                  <td style={{ color: s.industry === '공통' ? 'var(--ink-3)' : 'var(--navy)' }}>{s.industry}</td>
                  <td>{s.body}{!s.active && <span style={{ color: 'var(--ink-3)' }}> (쓰지 않음)</span>}</td>
                  <td>
                    {canWrite && <>
                      <button className="btn-sm" disabled={!!busy} onClick={() => setEdit(toDraft(s))}>고치기</button>{' '}
                      <button className="btn-sm" disabled={!!busy} onClick={() => setEdit({ ...blank(s.account), aliasText: s.aliases.join(', '), aliases: s.aliases, sort: s.sort + 1 })} title="같은 계정에 줄 더하기">+</button>{' '}
                      <button className="btn-sm" disabled={!!busy} onClick={() => void remove(s)}>지우기</button>
                    </>}
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
