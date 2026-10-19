// 일반업무관리 › 📊 팀결산보고시스템 › 💳 경비귀속처리 — ERP 지출결의서를 올려 줄마다 업무/개인을 정한다(사용자 2026-10-19).
//
// 해마다 엑셀(ERP경비반영분_정리_FY{연도}년_{이름}_…)로 하던 일을 옮겼다.
//   · 바구니(예산집단): 정우철(송현주 포함) · 조현규 · 김준성. 송현주 결산은 정우철 결산에 속한다.
//   · 줄마다 클라이언트(거래처명 · 기장 · 기타) + 업무 금액. 「기장」 업무 = 기장비용 안분, 그 밖의 업무 = 3인 공동, 나머지 = 개인.
//   · 화면은 **올리는 사람(작성자) 한 명씩** 본다 — 산출물도 사람마다 「ERP경비반영분_정리_{이름}_{시작}~{끝}_…xlsx」.
//   · 기간은 연도 대신 「2025.07.01 ~ 2026.06.30」으로만 적는다(사용자 2026-10-19 — FY 표기가 헷갈린다).
//   · **적요로 「제안」만 채운다. 확정은 사람이 줄마다(또는 직접 고른 줄만) 누른다** — 적요와 실제가 다른 일이 많다.
// 보는 사람: 정우철 · 조현규 · 김준성 · 송현주(서버 expense_member_name 과 같은 선).
import { useEffect, useMemo, useState } from 'react';
import Empty from '../common/Empty';
import { confirmDanger } from '../common/DangerConfirm';
import { useAuth } from '../../context/AuthContext';
import { parseExpenseFile, fyRange, defaultFy, basketOf, periodLabel, erpDetailXlsUrl, erpListXlsUrl, erpLoginUrl, type ParsedExpense } from '../../lib/expenseParse';
import { exportWriterXlsx } from '../../lib/expenseExport';
import { personalOf, summarize, type ClientRef } from '../../lib/expenseSuggest';
import {
  listExpenseLines, listExpenseYears, loadClientRefs, saveExpenseUpload, updateExpenseLine,
  confirmExpenseLines, unconfirmExpenseLine, resuggest, listExpenseVouchers, saveExpenseVouchers, type ExpenseLine, type LinePatch,
} from '../../lib/expenseApi';

const MEMBERS = ['정우철', '송현주', '조현규', '김준성'] as const;
const won = (n: number) => Math.round(n).toLocaleString();
const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  미분류: { bg: '#F3F4F6', fg: '#6B7280' }, 제안: { bg: '#FEF3C7', fg: '#92400E' }, 확정: { bg: '#DCFCE7', fg: '#166534' },
};

/** 금액 칸 — 세 자리마다 쉼표(사용자 2026-10-19). 고칠 때만 숫자로 풀고, 나가면 다시 쉼표. */
function MoneyInput({ value, onCommit, width = 96 }: { value: number | null; onCommit: (v: number | null) => void; width?: number }) {
  const [txt, setTxt] = useState(value == null ? '' : won(value));
  useEffect(() => { setTxt(value == null ? '' : won(value)); }, [value]);
  return (
    <input inputMode="numeric" value={txt}
      onFocus={() => setTxt(value == null ? '' : String(value))}
      onChange={(e) => setTxt(e.target.value.replace(/[^0-9-]/g, ''))}
      onBlur={() => { const v = txt.trim() === '' ? null : Number(txt.replace(/,/g, '')); setTxt(v == null ? '' : won(v)); if (v !== value) onCommit(v); }}
      style={{ width, textAlign: 'right', fontFamily: 'inherit', fontSize: 'var(--fs-1)', padding: '2px 4px', border: '1px solid var(--rule)', borderRadius: 3 }} />
  );
}

type Preview = { rows: ParsedExpense[]; outside: ParsedExpense[]; fileName: string; writer: string; basket: string; sheet: string; priorCount: number };

export default function ExpenseTab() {
  const { profileName, readonly } = useAuth();
  const canWrite = !readonly;
  const [fy, setFy] = useState(defaultFy());
  const [years, setYears] = useState<number[]>([]);
  const [lines, setLines] = useState<ExpenseLine[]>([]);
  const [clients, setClients] = useState<ClientRef[]>([]);
  const [writer, setWriter] = useState<string>((MEMBERS as readonly string[]).includes(profileName) ? profileName : '정우철');
  const [guide, setGuide] = useState(false);
  const [statusF, setStatusF] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [showSplit, setShowSplit] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function reload(y = fy) {
    try { setLines(await listExpenseLines(y)); } catch (e) { setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'); }
  }
  useEffect(() => {
    void (async () => {
      try {
        const [ys, cl] = await Promise.all([listExpenseYears(), loadClientRefs()]);
        setYears(ys); setClients(cl);
        await reload(fy);
      } finally { setLoading(false); }
    })();
  }, []);
  useEffect(() => { setSel(new Set()); void reload(fy); }, [fy]);

  const inBasket = useMemo(() => lines.filter((l) => l.writer === writer), [lines, writer]);
  const owner = basketOf(writer) ?? writer;
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return inBasket.filter((l) => (!statusF || l.status === statusF)
      && (!k || `${l.description} ${l.vendor ?? ''} ${l.account ?? ''} ${l.client ?? ''} ${l.exjunpyo_no} ${l.memo ?? ''}`.toLowerCase().includes(k)));
  }, [inBasket, statusF, q]);
  const sum = useMemo(() => summarize(inBasket), [inBasket]);
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000); };
  const clientOptions = useMemo(() => ['기장', '기타', ...[...new Set([...lines.map((l) => l.client).filter(Boolean) as string[], ...clients.map((c) => c.name)])].filter((x) => x !== '기장' && x !== '기타').sort((a, b) => a.localeCompare(b, 'ko'))], [lines, clients]);

  /** 여러 파일을 한꺼번에 놓아도 된다 — 리스트는 바로 저장, 상세는 미리보기. */
  async function onFiles(fs: FileList | File[]) {
    const arr = [...fs];
    for (const f of arr) await onFile(f, arr.length > 1);
  }
  async function onFile(f: File, many = false) {
    setErr(null); setBusy(true);
    try {
      const parsed = await parseExpenseFile(f);
      if (parsed.kind === 'list') {
        const n = await saveExpenseVouchers(parsed.vouchers);
        flash(`② 지출결의서번호별리스트 ${n}건을 저장했습니다 — 산출물 첫 시트의 자금집행예정일자·결재진행상태에 씁니다.`);
        return;
      }
      if (many && preview) { setErr('상세 파일은 한 번에 하나씩 저장합니다 — 먼저 열린 미리보기를 저장한 뒤 나머지를 올려 주세요.'); return;
      }
      const { rows, sheet } = parsed;
      const { from, to } = fyRange(fy);
      const inside = rows.filter((r) => !r.evidDate || (r.evidDate >= from && r.evidDate <= to));
      const outside = rows.filter((r) => r.evidDate && (r.evidDate < from || r.evidDate > to));
      const ws = [...new Set(inside.map((r) => r.writer).filter(Boolean))];
      const w = ws.length === 1 ? ws[0] : writer;
      setPreview({ rows: inside, outside, fileName: f.name, writer: w, basket: basketOf(w) ?? '정우철', sheet, priorCount: inside.filter((r) => r.prior).length });
    } catch (e) { setErr(e instanceof Error ? e.message : '읽지 못했습니다.'); } finally { setBusy(false); }
  }
  async function savePreview() {
    if (!preview) return;
    setBusy(true); setErr(null);
    try {
      const r = await saveExpenseUpload(fy, preview.writer, preview.basket, preview.rows, preview.fileName, profileName, clients, lines);
      setPreview(null); setWriter(preview.writer); await reload(); setYears(await listExpenseYears());
      flash(`새 줄 ${r.inserted} · 이미 있던 줄 ${r.updated}(판단 유지${r.reset ? ` · 금액이 바뀌어 확정 푼 줄 ${r.reset}` : ''})`);
    } catch (e) { setErr(e instanceof Error ? e.message : '저장하지 못했습니다.'); } finally { setBusy(false); }
  }
  async function patch(l: ExpenseLine, p: LinePatch) {
    setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, ...p, ...(('client' in p || 'work_amount' in p || 'excluded' in p) ? { status: '제안' as const, suggest_reason: '직접 입력' } : {}) } : x)));
    try { await updateExpenseLine(l.id, p); } catch (e) { setErr(e instanceof Error ? e.message : '저장하지 못했습니다.'); await reload(); }
  }
  async function confirmRows(rows: ExpenseLine[]) {
    if (!rows.length) return;
    if (rows.length > 1 && !await confirmDanger({ title: `고른 ${rows.length}줄을 확정합니다`, level: 'bulk', targets: rows.map((l) => `${l.evid_date ?? ''} ${l.description} · ${won(l.supply)} → ${l.client ?? '?'} 업무 ${won(l.work_amount ?? 0)}`), detail: '적요와 실제가 다를 수 있으니 한 줄씩 보셨는지 확인하세요. 확정한 줄은 「풀기」 전에는 고칠 수 없습니다.' })) return;
    setBusy(true);
    try {
      const r = await confirmExpenseLines(rows, profileName);
      await reload(); setSel(new Set());
      flash(`확정 ${r.done}줄${r.skipped ? ` · 건너뜀 ${r.skipped}줄(클라이언트·업무 금액이 비었거나 금액이 맞지 않음)` : ''}`);
    } catch (e) { setErr(e instanceof Error ? e.message : '확정하지 못했습니다.'); } finally { setBusy(false); }
  }
  async function doResuggest() {
    setBusy(true);
    try { const n = await resuggest(inBasket, lines, clients); await reload(); flash(`제안 다시 만듦 ${n}줄(확정·작업본·직접 입력 줄은 그대로)`); }
    catch (e) { setErr(e instanceof Error ? e.message : '실패했습니다.'); } finally { setBusy(false); }
  }
  async function exportXlsx() {
    setBusy(true);
    try { await exportWriterXlsx(fy, writer, inBasket, await listExpenseVouchers([...new Set(inBasket.map((l) => l.exjunpyo_no))])); }
    catch (e) { setErr(e instanceof Error ? e.message : '내려받지 못했습니다.'); } finally { setBusy(false); }
  }

  if (loading) return <div className="card">불러오는 중…</div>;
  const chip = (on: boolean) => ({ cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--fs-1)', border: `1px solid ${on ? 'var(--navy)' : 'var(--rule)'}`, background: on ? 'var(--navy-bg)' : '#fff', color: 'var(--ink-2)', fontWeight: on ? 700 : 400, borderRadius: 999, padding: '2px 10px' } as const);
  const selRows = shown.filter((l) => sel.has(l.id));
  const yearsShown = [...new Set([defaultFy(), ...years])].sort((a, b) => b - a);
  const { from, to } = fyRange(fy);

  return (
    <div>
      <div className="card">
        <div className="chdr">💳 경비귀속처리
          <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>팀결산보고시스템 · {writer} · 지출일 {periodLabel(fy)}</span>
        </div>
        <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7 }}>
          ERP 지출결의서를 올리면 줄마다 <b>클라이언트·업무 금액을 제안</b>합니다. 제안은 적요로 만든 것이라 <b>실제와 다를 수 있습니다 — 확정은 줄마다 직접</b> 누르세요.
          「기장」 업무는 기장비용으로 안분, 그 밖의 업무는 3인 공동, 나머지는 바구니 주인 개인입니다. <b>송현주 결의서는 정우철 바구니</b>에 들어갑니다.
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>지출일 기간</span>
          {yearsShown.map((y) => <button key={y} style={chip(y === fy)} onClick={() => setFy(y)}>{periodLabel(y)}</button>)}
          <span style={{ marginLeft: 12, fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>작성자</span>
          {/* 정우철·송현주는 한 바구니(예산집단) — 큰 상자로 묶는다(사용자 2026-10-19). */}
          {[['정우철', '송현주'], ['조현규'], ['김준성']].map((grp) => {
            const btns = grp.map((w) => (
              <button key={w} style={chip(w === writer)} onClick={() => { setWriter(w); setSel(new Set()); }}>
                {w} <span style={{ opacity: 0.6 }}>{lines.filter((l) => l.writer === w).length}</span>
              </button>
            ));
            return grp.length > 1
              ? <span key={grp.join()} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', border: '1.5px solid var(--navy)', borderRadius: 10, padding: '3px 6px' }}>{btns}</span>
              : btns;
          })}
        </div>
      </div>

      <div className="card" style={{ padding: '10px 14px' }}>
        <button className="btn-sm" onClick={() => setGuide(!guide)}>{guide ? '▲' : '▼'} ERP에서 어떤 파일을 받아 올리나요?</button>
        {guide && (
          <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.8, marginTop: 8 }}>
            <b>결의서를 쓴 사람 본인 계정</b>으로 인덕 ERP(induk.ibcenter.kr)에 로그인합니다 — 지출결의서는 작성자 본인 것만 보입니다.
            <div style={{ margin: '6px 0', padding: '6px 10px', background: 'var(--navy-bg)', borderRadius: 6 }}>가장 쉬운 방법 — ERP에 로그인해 둔 채로 위 <b>「ERP에서 바로 받기」</b>의 ① · ② 단추를 누르면 아래 두 파일이 바로 내려받아집니다. 메뉴를 찾아 들어갈 필요가 없습니다.</div>
            직접 받을 때는:
            <div style={{ margin: '8px 0 4px', fontWeight: 700, color: 'var(--navy)' }}>① 지출결의서 상세 (꼭 필요)</div>
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              <li>상단 <b>회계관리</b> 메뉴 › <b>지출결의서</b> › <b>검색</b></li>
              <li><b>작성자</b> 칸에 본인 이름(예: 송현주)</li>
              <li>아래 상세검색 칸의 <b>지출일자</b>를 <b>{from} ~ {to}</b> 로</li>
              <li><b>[상세검색]</b> 단추 → 「검색결과 지출결의서 상세리스트」 화면 오른쪽 위 <b>엑셀 아이콘</b>으로 내려받기</li>
              <li>받은 파일을 아래 점선 상자에 끌어다 놓기 → 미리보기 확인 후 <b>저장</b></li>
            </ol>
            <div style={{ margin: '8px 0 4px', fontWeight: 700, color: 'var(--navy)' }}>② 지출결의서번호별리스트 (산출물 첫 시트용, 있으면 좋음)</div>
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              <li><b>회계관리</b> › <b>지출결의서</b> › <b>리스트</b> → 엑셀 아이콘</li>
              <li>같은 점선 상자에 올리면 자금집행예정일자·결재진행상태를 산출물 첫 시트에 씁니다(없으면 상세에서 만들어 채웁니다).</li>
            </ol>
            <div style={{ marginTop: 8, color: 'var(--ink-3)' }}>작년 정리 파일(클라이언트명·업무사용 칸이 있는 것)을 올려도 됩니다 — 그 판단은 <b>제안</b>으로만 가져옵니다.</div>
          </div>
        )}
      </div>

      {err && <div className="alert-w">{err}</div>}
      {msg && <div className="card" style={{ color: 'var(--good)', padding: '8px 14px' }}>{msg}</div>}

      {canWrite && (
        <div className="card" style={{ padding: '10px 14px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <b style={{ fontSize: 'var(--fs-2)', color: 'var(--navy)' }}>ERP에서 바로 받기</b>
          <button className="btn-sm btn-sm-navy" onClick={() => window.open(erpDetailXlsUrl(writer, fy), '_blank', 'noopener')} title={`작성자 ${writer} · 지출일 ${from} ~ ${to}`}>① 상세 엑셀 받기 ({writer} · {periodLabel(fy)})</button>
          <button className="btn-sm" onClick={() => window.open(erpListXlsUrl(), '_blank', 'noopener')}>② 리스트 엑셀 받기</button>
          <a className="btn-sm" href={erpLoginUrl()} target="_blank" rel="noopener noreferrer">ERP 로그인 열기</a>
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', lineHeight: 1.6, flex: '1 1 260px' }}>
            이 컴퓨터 브라우저에서 ERP에 <b>{writer} 계정으로 로그인</b>돼 있으면 누르는 즉시 파일이 내려받아집니다. 로그인 화면이 나오면 로그인한 뒤 다시 누르세요.
            받은 파일(둘 다 한꺼번에 가능)을 아래 상자에 놓으면 끝입니다.
            {writer !== profileName && <><br /><span style={{ color: '#B45309' }}>지금 고른 작성자({writer})와 JAYTAX 사용자({profileName})가 다릅니다 — ERP가 {writer} 계정으로 로그인돼 있을 때만 받아집니다.</span></>}
          </span>
        </div>
      )}

      {canWrite && !preview && (
        <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) void onFiles(e.dataTransfer.files); }}
          style={{ display: 'block', border: '2px dashed #c9b98a', borderRadius: 8, background: '#fdfaf3', padding: '12px 16px', textAlign: 'center', cursor: 'pointer', margin: '0 0 10px' }}>
          <div style={{ fontSize: 'var(--fs-3)', fontWeight: 700, color: 'var(--navy)' }}>받은 ERP 엑셀(① 상세 · ② 리스트)을 끌어다 놓으세요 — 둘 다 한꺼번에 놓아도 됩니다</div>
          <div style={{ fontSize: 'var(--fs-1)', color: '#777', lineHeight: 1.7, marginTop: 4 }}>
            지출일 <b>{periodLabel(fy)}</b> 기간 밖의 줄은 넣지 않습니다. 받는 방법은 위 「ERP에서 어떤 파일을…」을 펼쳐 보세요. 다시 올려도 이미 정한 줄은 그대로 둡니다.
          </div>
          <input type="file" multiple accept=".xls,.xlsx" style={{ display: 'none' }} disabled={busy} onChange={(e) => { const fs = e.target.files ? [...e.target.files] : []; e.target.value = ''; if (fs.length) void onFiles(fs); }} />
        </label>
      )}

      {preview && (
        <div className="card" style={{ border: '1px solid #c9b98a', background: '#fdfaf3' }}>
          <div style={{ fontSize: 'var(--fs-3)', fontWeight: 700, color: 'var(--navy)' }}>읽었습니다 — {preview.rows.length}줄 · 공급가액 {won(preview.rows.reduce((s, r) => s + r.supply, 0))}</div>
          <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.8, margin: '6px 0 10px' }}>
            {preview.fileName} · 시트 「{preview.sheet}」
            {preview.outside.length > 0 && <><br /><span style={{ color: '#B45309' }}>정산기간 밖 {preview.outside.length}줄은 넣지 않습니다({preview.outside.map((r) => r.evidDate).slice(0, 3).join(', ')}{preview.outside.length > 3 ? ' …' : ''}).</span></>}
            {preview.priorCount > 0 && <><br />파일에 적힌 판단 {preview.priorCount}줄은 <b>제안</b>으로 가져옵니다(확정 아님).</>}
            <br />작성자 <select value={preview.writer} onChange={(e) => setPreview({ ...preview, writer: e.target.value, basket: basketOf(e.target.value) ?? preview.basket })}>
              {[...new Set([preview.writer, '정우철', '송현주', '조현규', '김준성'])].filter(Boolean).map((w) => <option key={w}>{w}</option>)}
            </select>
            {' → '}바구니 <b>{preview.basket}</b>{preview.writer === '송현주' ? ' (송현주는 정우철 바구니)' : ''}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-p" disabled={busy || !preview.rows.length} onClick={() => void savePreview()}>{busy ? '저장 중…' : '저장'}</button>
            <button className="btn-s" onClick={() => setPreview(null)}>그만두기</button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: '10px 14px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
          {([['공급가액', sum.supply, 'var(--ink-1)'], ['기장 → 기장비용', sum.bookkeeping, '#2F7BD8'], ['3인 공동 업무', sum.team, '#7C3AED'], [`개인 → ${owner}`, sum.personal, '#B45309'], ['김준성·조현규 몫', sum.kjs + sum.jhg, '#0F766E'], ['결산 제외', sum.excluded, '#6B7280'], ['아직 정하지 않음', sum.unset, '#DC2626']] as const).map(([k, v, c]) => (
            <div key={k} style={{ border: '1px solid var(--rule)', borderRadius: 6, padding: '6px 10px' }}>
              <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>{k}</div>
              <div style={{ fontSize: 'var(--fs-3)', fontWeight: 700, color: c }}>{won(v)}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginTop: 6 }}>
          확정 {sum.confirmed} · 제안 {sum.suggested} · 미분류 {sum.open}줄
          {' · '}검산 {Math.abs(sum.bookkeeping + sum.team + sum.personal + sum.kjs + sum.jhg + sum.excluded + sum.unset - sum.supply) < 1 ? <b style={{ color: 'var(--good)' }}>맞음</b> : <b style={{ color: 'var(--bad)' }}>안 맞음</b>}
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          {(['미분류', '제안', '확정'] as const).map((s) => <button key={s} style={chip(statusF === s)} onClick={() => setStatusF(statusF === s ? null : s)}>{s} {inBasket.filter((l) => l.status === s).length}</button>)}
          <input placeholder="🔍 적요·가맹점·클라이언트·결의서" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: '1 1 160px', minWidth: 140, fontFamily: 'inherit', fontSize: 'var(--fs-2)', padding: '3px 8px', border: '1px solid var(--rule)', borderRadius: 4 }} />
          <label style={{ fontSize: 'var(--fs-1)', display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={showSplit} onChange={(e) => setShowSplit(e.target.checked)} /> 김준성·조현규 몫 칸</label>
          {canWrite && <button className="btn-sm" disabled={busy} onClick={() => void doResuggest()} title="확정·작업본·직접 입력 줄은 건드리지 않습니다">제안 다시 만들기</button>}
          {inBasket.length > 0 && <button className="btn-sm" onClick={() => void exportXlsx()}>엑셀로 내려받기</button>}
          {canWrite && selRows.length > 0 && <button className="btn-sm btn-sm-navy" disabled={busy} onClick={() => void confirmRows(selRows)}>고른 {selRows.length}줄 확정</button>}
        </div>
        <datalist id="exp-clients">{clientOptions.map((c) => <option key={c} value={c} />)}</datalist>
        {inBasket.length === 0 ? <Empty text={`${writer} — 지출일 ${periodLabel(fy)} 에 올린 지출결의서가 없습니다`} hint="위 「ERP에서 어떤 파일을…」 안내대로 받아 점선 상자에 올리세요." /> : shown.length === 0 ? <Empty text="거른 조건에 맞는 줄이 없습니다" action={{ label: '거르기 풀기', onClick: () => { setStatusF(null); setQ(''); } }} /> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-1)', minWidth: 1100 }}>
              <thead>
                <tr style={{ background: 'var(--surface-3)', color: 'var(--ink-2)' }}>
                  <th style={{ padding: 5 }}><input type="checkbox" checked={shown.every((l) => sel.has(l.id) || l.status === '확정') && shown.some((l) => l.status !== '확정')} onChange={(e) => setSel(e.target.checked ? new Set(shown.filter((l) => l.status !== '확정').map((l) => l.id)) : new Set())} title="보이는 줄 중 확정 안 된 줄 고르기" /></th>
                  {['일자', '작성자', '지출내역 · 제안 근거', '계정', '가맹점', '공급가액', '카드', '클라이언트', '업무', '개인', ...(showSplit ? ['김준성', '조현규'] : []), '제외', '메모', '상태'].map((h) => <th key={h} style={{ padding: '5px 6px', textAlign: 'left', whiteSpace: 'nowrap', fontWeight: 600 }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => {
                  const locked = l.status === '확정' || !canWrite;
                  const st = STATUS_STYLE[l.status];
                  const td = { padding: '4px 6px', borderTop: '1px solid var(--rule)', verticalAlign: 'top' as const };
                  return (
                    <tr key={l.id} style={{ background: sel.has(l.id) ? 'var(--navy-bg)' : l.excluded ? '#F9FAFB' : '#fff', opacity: l.excluded ? 0.7 : 1 }}>
                      <td style={td}>{l.status !== '확정' && canWrite && <input type="checkbox" checked={sel.has(l.id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(l.id); else n.delete(l.id); return n; })} />}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{l.evid_date}<div style={{ color: 'var(--ink-4)' }}>{l.exjunpyo_no}-{l.line_no}</div></td>
                      <td style={td}>{l.writer}</td>
                      <td style={{ ...td, minWidth: 220 }}><b style={{ color: 'var(--ink-1)', fontWeight: 600 }}>{l.description}</b>{l.suggest_reason && <div style={{ color: 'var(--ink-3)' }}>↳ {l.suggest_reason}</div>}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{l.account}</td>
                      <td style={td}>{l.vendor}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{won(l.supply)}{l.vat ? <div style={{ color: 'var(--ink-4)' }}>+{won(l.vat)}</div> : null}</td>
                      <td style={td}>{l.card_type}</td>
                      <td style={td}>{locked ? (l.client ?? '') : (
                        <input list="exp-clients" defaultValue={l.client ?? ''} key={`c${l.id}${l.client}`} onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== l.client) void patch(l, { client: v }); }} style={{ width: 130, fontFamily: 'inherit', fontSize: 'var(--fs-1)', padding: '2px 4px', border: '1px solid var(--rule)', borderRadius: 3 }} />)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{locked ? (l.work_amount == null ? '' : won(l.work_amount)) : (
                        <span>
                          <MoneyInput value={l.work_amount} onCommit={(v) => void patch(l, { work_amount: v })} />
                          <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
                            <button className="btn-sm" style={{ padding: '0 5px' }} onClick={() => void patch(l, { work_amount: l.supply - l.split_kjs - l.split_jhg })}>업무</button>
                            <button className="btn-sm" style={{ padding: '0 5px' }} onClick={() => void patch(l, { work_amount: 0 })}>개인</button>
                          </div>
                        </span>)}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', color: '#B45309' }}>{l.excluded || l.work_amount == null ? '' : won(personalOf(l))}</td>
                      {showSplit && (['split_kjs', 'split_jhg'] as const).map((k) => (
                        <td key={k} style={td}>{locked ? (l[k] ? won(l[k]) : '') : <MoneyInput value={l[k] || null} width={84} onCommit={(v) => void patch(l, { [k]: v ?? 0 } as LinePatch)} />}</td>
                      ))}
                      <td style={td}><input type="checkbox" checked={l.excluded} disabled={locked} onChange={(e) => void patch(l, { excluded: e.target.checked, ...(e.target.checked ? { work_amount: 0, client: l.client ?? '기타' } : {}) })} title="비용이 아닌 줄(결산 제외)" /></td>
                      <td style={td}>{locked ? (l.memo ?? '') : <input defaultValue={l.memo ?? ''} key={`m${l.id}${l.memo}`} onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== l.memo) void patch(l, { memo: v }); }} style={{ width: 150, fontFamily: 'inherit', fontSize: 'var(--fs-1)', padding: '2px 4px', border: '1px solid var(--rule)', borderRadius: 3 }} />}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <span style={{ background: st.bg, color: st.fg, borderRadius: 999, padding: '1px 8px', fontWeight: 700 }}>{l.status}</span>
                        {canWrite && l.status !== '확정' && <div style={{ marginTop: 3 }}><button className="btn-sm btn-sm-grn" disabled={busy || !l.client || l.work_amount == null} onClick={() => void confirmRows([l])} title={!l.client || l.work_amount == null ? '클라이언트와 업무 금액을 먼저 정하세요' : '이 줄 확정'}>확정</button></div>}
                        {canWrite && l.status === '확정' && <div style={{ color: 'var(--ink-4)', marginTop: 2 }}>{l.decided_name} <button className="btn-sm" style={{ padding: '0 5px' }} onClick={() => void unconfirmExpenseLine(l.id).then(() => reload())}>풀기</button></div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
