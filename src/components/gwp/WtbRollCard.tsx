// 정산표 이월 — 작년 확정 정산표 + 회사 재무제표(합계잔액시산표, 없으면 재무상태표·손익계산서) → 올해 중간감사 정산표.
//
// 사용자 2026-10-03: 이월 순서 16단계(wtbRoll.ts)를 버튼으로. 새 계정은 2120A 처럼 「이 줄에 더하기」 또는 「과목 끝에 새 줄」.
// 파일 이름 「WTB_개별|별도|연결_회사명_FY26_중간|기말_261003」 — 개별 = 일반기업 비연결, 별도 = K-IFRS 비연결, 연결 = 연결.
// 만든 파일은 내려받고 자료함(이월정산표)에도 남긴다. 작년 확정 정산표는 작년 작업 건 자료함에 있으면 그것을 쓴다.
import { useEffect, useMemo, useState } from 'react';
import type { Engagement } from '../../lib/dsdApi';
import { findEngagement } from '../../lib/dsdApi';
import { readWorkbook, type SheetData } from '../../lib/xlsxRead';
import { unzip, zip } from '../../lib/xlsxTransplant';
import { rollWtb, tbFromSheet, fsFromSheet, wtbOutline, wtbA500People, type TbLine, type WtbPlace, type WtbRollReport, type WtbRow } from '../../lib/wtbRoll';
import { listFiles, latestFile, uploadFile, type EngFile } from '../../lib/gwpStageApi';
import { fileBytes, fileUrl } from '../../lib/gwpApi';
import { safeName, download } from '../dsd/dsdUi';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
type Src = { name: string; bytes: Uint8Array; from: string };
type Choice = { to: 'row'; label: string } | { to: 'new'; fsli: string } | { to: 'skip' };

/** 「WTB_개별_제이스튜디오_FY26_중간_261003」 */
export function wtbFileName(eng: Engagement, phase: '중간' | '기말', today = new Date()): string {
  const kind = eng.scope === '연결' ? '연결' : eng.basis === 'K-IFRS' ? '별도' : '개별';
  const ymd = `${String(today.getFullYear()).slice(2)}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  return `WTB_${kind}_${safeName(eng.entityName)}_FY${String(eng.fy).slice(2)}_${phase}_${ymd}.xlsx`;
}

/** 「제 11기 2026년 08월 31일 현재」 → 2026-08-31 */
function dateOf(sh: SheetData): string | null {
  for (const v of sh.cells.values()) {
    const m = /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(현재|까지)/.exec(v.text ?? '');
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  return null;
}
const has = (sh: SheetData, re: RegExp) => re.test(sh.name.replace(/\s/g, ''))
  || [...sh.cells.values()].slice(0, 60).some((v) => re.test((v.text ?? '').replace(/\s/g, '')));

/**
 * 회사 재무제표 파일 → 시산표 줄. 사용자 2026-10-03 「모든 회사의 제시재무제표에 시산표가 있지 않다」 —
 *   ① 합계잔액시산표 시트가 있으면 그것, ② 없으면 재무상태표 + 손익계산서 시트, ③ 그것도 못 찾으면 시트를 골라 달라고 한다(null).
 */
function readTb(sheets: SheetData[], pick?: { bs: string; pl: string }): { tb: TbLine[]; date: string | null; from: string } | null {
  if (!pick) {
    const tbSh = sheets.find((s) => has(s, /합계잔액시산표|^시산표$/));
    if (tbSh) return { tb: tbFromSheet(tbSh), date: dateOf(tbSh), from: `시트 「${tbSh.name}」(합계잔액시산표)` };
  }
  const bs = pick ? sheets.find((s) => s.name === pick.bs) : sheets.find((s) => has(s, /재무상태표|대차대조표/));
  const pl = pick ? sheets.find((s) => s.name === pick.pl) : sheets.find((s) => has(s, /손익계산서|포괄손익/));
  if (!bs || !pl) return null;
  return { tb: [...fsFromSheet(bs, 'BS'), ...fsFromSheet(pl, 'PL')], date: dateOf(bs), from: `시트 「${bs.name}」+「${pl.name}」(재무제표)` };
}

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');
/** 시산표면 차대 합, 재무제표면 재무상태표 차대(손익은 이익잉여금에 이미 들어 있다). */
function balanceNote(fs: { from: string; tb: TbLine[] }): string {
  const sum = (xs: TbLine[]) => Math.round(xs.reduce((a, t) => a + t.bal, 0));
  if (/시산표/.test(fs.from)) { const d = sum(fs.tb); return `차대 ${d === 0 ? '일치' : `차이 ${fmt(d)}`}`; }
  const d = sum(fs.tb.filter((t) => t.section !== '손익'));
  return `재무상태표 차대 ${d === 0 ? '일치' : `차이 ${fmt(d)}`}`;
}

export default function WtbRollCard({ eng, canWrite }: { eng: Engagement; canWrite: boolean }) {
  const [prior, setPrior] = useState<Src | null>(null);
  const [fs, setFs] = useState<(Src & { tb: TbLine[] }) | null>(null);
  const [closing, setClosing] = useState(`${eng.fy}-08-31`);
  const [preview, setPreview] = useState<WtbRollReport | null>(null);
  const [outline, setOutline] = useState<WtbRow[]>([]);
  const [choice, setChoice] = useState<Record<string, Choice>>({});
  const [made, setMade] = useState<WtbRollReport | null>(null);
  const [saved, setSaved] = useState<EngFile[]>([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // A500 작성자·검토자 = **회사 담당**(사용자 2026-10-03). 작년 값을 보여 주고 올해 담당을 묻는다 — 확인해야 만든다.
  const [lastPeople, setLastPeople] = useState<{ author: string | null; reviewer: string | null }>({ author: null, reviewer: null });
  const [companyAuthor, setCompanyAuthor] = useState('');
  const [companyReviewer, setCompanyReviewer] = useState('');
  // 시트를 못 찾았을 때 — 사람이 재무상태표·손익계산서 시트를 고른다.
  const [fsBook, setFsBook] = useState<{ name: string; bytes: Uint8Array; sheets: SheetData[] } | null>(null);
  const [pickBs, setPickBs] = useState('');
  const [pickPl, setPickPl] = useState('');

  // 작년 확정 정산표 — 작년 작업 건 자료함에서. 만든 이월 정산표 목록.
  useEffect(() => {
    let off = false;
    setPrior(null); setFs(null); setPreview(null); setMade(null); setChoice({});
    void (async () => {
      const mine = await listFiles(eng.id);
      if (!off) setSaved(mine.filter((f) => f.kind === '이월정산표' && !f.meta.void));
      const prev = await findEngagement(eng.entityId, eng.fy - 1, eng.scope);
      if (!prev) return;
      const f = latestFile(await listFiles(prev.id), '정산표', prev.fy);
      if (!f || off) return;
      const bytes = await fileBytes(f.storagePath);
      if (!off) setPrior({ name: f.fileName, bytes, from: `작년(FY${prev.fy}) 자료함의 확정 정산표` });
    })().catch(() => undefined);
    return () => { off = true; };
  }, [eng.id, eng.entityId, eng.fy, eng.scope]);

  useEffect(() => { setPreview(null); setMade(null); }, [prior, fs, closing]);
  useEffect(() => {
    if (!prior) { setOutline([]); return; }
    try { setOutline(wtbOutline(prior.bytes).rows); } catch { setOutline([]); }
    try { const p = wtbA500People(prior.bytes); setLastPeople(p); setCompanyAuthor(p.author ?? ''); setCompanyReviewer(p.reviewer ?? ''); } catch { /* 없으면 빈칸 */ }
  }, [prior]);

  const opts = useMemo(() => ({
    closing, yearEnd: `${eng.fy}-12-31`, prevEnd: `${eng.fy - 1}-12-31`,
    companyAuthor: companyAuthor.trim() && companyAuthor.trim() !== lastPeople.author ? companyAuthor.trim() : undefined,
    companyReviewer: companyReviewer.trim() && companyReviewer.trim() !== lastPeople.reviewer ? companyReviewer.trim() : undefined,
    tb: fs?.tb,
  }), [closing, eng.fy, companyAuthor, companyReviewer, lastPeople, fs]);

  async function pickPrior(f: File | undefined) {
    if (!f) return;
    setErr(null);
    setPrior({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), from: '직접 고른 파일' });
  }
  async function pickFs(f: File | undefined) {
    if (!f) return;
    setErr(null);
    if (/\.xls$/i.test(f.name)) { setErr('옛 엑셀(.xls)은 읽지 못합니다 — 엑셀에서 열어 .xlsx 로 저장한 뒤 올리세요.'); return; }
    setFsBook(null); setFs(null);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const sheets = readWorkbook(bytes);
      const r = readTb(sheets);
      if (!r) { setFsBook({ name: f.name, bytes, sheets }); setPickBs(''); setPickPl(''); return; }
      setFs({ name: f.name, bytes, from: r.from, tb: r.tb });
      if (r.date) setClosing(r.date);
    } catch (e) { setErr(e instanceof Error ? e.message : '재무제표를 읽지 못했습니다.'); }
  }
  function usePicked() {
    if (!fsBook || !pickBs || !pickPl) return;
    setErr(null);
    try {
      const r = readTb(fsBook.sheets, { bs: pickBs, pl: pickPl });
      if (!r) return;
      setFs({ name: fsBook.name, bytes: fsBook.bytes, from: r.from, tb: r.tb });
      if (r.date) setClosing(r.date);
      setFsBook(null);
    } catch (e) { setErr(e instanceof Error ? e.message : '재무제표를 읽지 못했습니다.'); }
  }

  function check() {
    if (!prior || !fs) return;
    setBusy('preview'); setErr(null); setMsg(null);
    setTimeout(() => {
      try {
        const r = rollWtb(prior.bytes, opts, unzip, zip).report;
        setPreview(r);
        if (r.term && r.term !== eng.termNo && eng.termNo) setMsg(`정산표 기수로 올해는 제${r.term}기인데 작업 건은 제${eng.termNo}기입니다 — 확인하세요.`);
      } catch (e) { setErr(e instanceof Error ? e.message : '읽지 못했습니다.'); } finally { setBusy(''); }
    }, 10);
  }

  const places = (): WtbPlace[] => (preview?.unmatched ?? []).flatMap((t) => {
    const c = choice[t.name];
    const sheet: 'WBS' | 'WPL' = t.section === '손익' ? 'WPL' : 'WBS';
    if (!c || c.to === 'skip') return [];
    return [c.to === 'row' ? { name: t.name, sheet, to: 'row' as const, label: c.label } : { name: t.name, sheet, to: 'new' as const, fsli: c.fsli }];
  });

  async function make() {
    if (!prior || !fs || !preview) return;
    // A500 작성자·검토자 = 회사 담당 — 만들 때 한 번 묻는다(사용자 2026-10-03 「당기 회사담당을 질문하는 절차」).
    const a = companyAuthor.trim() || '(비움)', rv = companyReviewer.trim() || '(비움)';
    const changed = a !== (lastPeople.author ?? '(비움)') || rv !== (lastPeople.reviewer ?? '(비움)');
    if (!confirm(`A500 의 회사 담당을 확인해 주세요.\n\n  작성자: ${a}\n  검토자: ${rv}\n\n${changed ? `작년(${lastPeople.author ?? '—'} · ${lastPeople.reviewer ?? '—'})과 다르게 고쳐 넣습니다.` : '작년과 같습니다.'}\n올해 회사 담당이 맞으면 [확인], 아니면 [취소]를 누르고 ④ 칸을 고치세요.`)) return;
    setBusy('make'); setErr(null); setMsg(null);
    try {
      const r = rollWtb(prior.bytes, { ...opts, place: places() }, unzip, zip);
      const name = wtbFileName(eng, '중간');
      download(r.bytes, name, XLSX);
      if (canWrite) {
        await uploadFile(eng.id, '이월정산표', { name, bytes: r.bytes }, {
          fy: eng.fy, periodEnd: closing, inspected: true, source: `${prior.name} + ${fs.name}`,
          unmatched: r.report.unmatched.length, notes: r.report.notes,
        });
        setSaved((await listFiles(eng.id)).filter((f) => f.kind === '이월정산표' && !f.meta.void));
      }
      setMade(r.report);
      setMsg(`「${name}」을 만들어 내려받았습니다${canWrite ? ' — 자료함에도 남겼습니다' : ''}. 엑셀에서 WBS 101행(차대)·110행(이익잉여금)·SCE 검증을 한 번 보세요.`);
    } catch (e) { setErr(e instanceof Error ? e.message : '만들지 못했습니다.'); } finally { setBusy(''); }
  }

  async function open(f: EngFile) {
    window.open(await fileUrl(f.storagePath, f.fileName), '_blank');
  }

  const rowsOf = (t: TbLine) => outline.filter((r) => (t.section === '손익' ? r.sheet === 'WPL' : r.sheet === 'WBS' && r.section === t.section));
  const fslis = (t: TbLine) => [...new Set(rowsOf(t).map((r) => r.fsli).filter(Boolean))];
  const unresolved = (preview?.unmatched ?? []).filter((t) => !choice[t.name]).length;

  const box = { padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)', marginTop: 8 } as const;
  return (
    <div className="card">
      <div className="chdr">정산표 이월
        <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>작년 확정 정산표 + 회사 시산표 → 올해 중간감사 정산표(WBS·WPL·A500·SCE·보고서·WCF를 한 해 밀어 둠)</span>
      </div>
      {err && <div style={{ color: 'var(--bad)', fontSize: 'var(--fs-2)', marginBottom: 6 }}>{err}</div>}
      {msg && <div style={{ color: 'var(--good)', fontSize: 'var(--fs-2)', marginBottom: 6 }}>{msg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '8px 12px', alignItems: 'center', fontSize: 'var(--fs-2)' }}>
        <b>① 작년 확정 정산표</b>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {prior ? <span>{prior.name} <span style={{ color: 'var(--ink-3)' }}>({prior.from})</span></span> : <span style={{ color: 'var(--ink-3)' }}>작년 작업 건 자료함에 없습니다 — 파일을 고르세요</span>}
          <label className="btn-sm" style={{ cursor: 'pointer' }}>{prior ? '다른 파일' : '파일 고르기'}
            <input type="file" accept=".xlsx,.xlsm" style={{ display: 'none' }} onChange={(e) => { void pickPrior(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
        <b>② 회사 재무제표</b>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {fs ? <span>{fs.name} <span style={{ color: 'var(--ink-3)' }}>({fs.from} · 계정 {fs.tb.length}줄 · {balanceNote(fs)})</span></span>
            : <span style={{ color: 'var(--ink-3)' }}>회사 제시 재무제표 엑셀(.xlsx) — 합계잔액시산표 시트가 있으면 그것, 없으면 재무상태표·손익계산서 시트를 읽습니다</span>}
          {fsBook && (
            <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', color: 'var(--warn)' }}>
              「{fsBook.name}」에서 시산표·재무제표 시트를 못 찾았습니다 — 재무상태표
              <select className="btn-sm" value={pickBs} onChange={(e) => setPickBs(e.target.value)}>
                <option value="">— 시트 —</option>{fsBook.sheets.map((x) => <option key={x.name}>{x.name}</option>)}
              </select>
              손익계산서
              <select className="btn-sm" value={pickPl} onChange={(e) => setPickPl(e.target.value)}>
                <option value="">— 시트 —</option>{fsBook.sheets.map((x) => <option key={x.name}>{x.name}</option>)}
              </select>
              <button className="btn-sm btn-sm-navy" disabled={!pickBs || !pickPl} onClick={usePicked}>이 시트로 읽기</button>
            </span>
          )}
          <label className="btn-sm" style={{ cursor: 'pointer' }}>{fs ? '다른 파일' : '파일 고르기'}
            <input type="file" accept=".xlsx,.xlsm,.xls" style={{ display: 'none' }} onChange={(e) => { void pickFs(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
        <b>③ 기준일</b>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" className="btn-sm" value={closing} onChange={(e) => setClosing(e.target.value)} />
          <span style={{ color: 'var(--ink-3)' }}>중간감사 기준월 말 — 재무제표·시산표 제목에서 읽습니다. A500 의 FS일은 {eng.fy}-12-31 로 미리 둡니다.</span>
        </div>
        <b>④ 회사 담당</b>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--ink-3)' }}>A500 작성자</span>
          <input className="btn-sm" style={{ width: 110 }} value={companyAuthor} onChange={(e) => setCompanyAuthor(e.target.value)} placeholder="회사 작성자" />
          <span style={{ color: 'var(--ink-3)' }}>검토자</span>
          <input className="btn-sm" style={{ width: 110 }} value={companyReviewer} onChange={(e) => setCompanyReviewer(e.target.value)} placeholder="회사 검토자" />
          <span style={{ color: 'var(--ink-3)' }}>{prior ? `작년 A500 값입니다 — 올해 회사 담당이 바뀌었으면 고치세요. 만들 때 한 번 더 묻습니다.` : ''}</span>
        </div>
      </div>

      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn-p" disabled={!prior || !fs || !!busy} onClick={check}>{busy === 'preview' ? '맞춰 보는 중…' : '시산표 맞춰 보기'}</button>
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>기말감사 정산표 갱신(열 밀기 없이 회사제시만 바꾸기)은 다음에 붙입니다.</span>
      </div>

      {preview && (
        <div style={box}>
          <div style={{ fontSize: 'var(--fs-2)' }}>
            <b>제{preview.term}기</b> · 시산표 {preview.filled.length}줄을 정산표 줄에 맞췄습니다
            {preview.tables.map((t) => <span key={t.sheet}> · {t.sheet} {t.insertedAt}열에 작년 수정후({t.prior}) 끼움{t.hidden ? `, ${t.hidden} 숨김` : ''}</span>)}
            {preview.renamed.length > 0 && <span> · 시트 이름 {preview.renamed.map(([a, b]) => `${a}→${b}`).join(', ')}</span>}
          </div>
          {preview.notes.filter((n) => !/새 계정/.test(n)).map((n) => <div key={n} style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>{n}</div>)}
          {preview.unmatched.length > 0 ? (
            <div style={{ marginTop: 8, fontSize: 'var(--fs-2)' }}>
              <div style={{ color: 'var(--warn)', fontWeight: 700 }}>정산표에 받을 줄이 없는 계정 {preview.unmatched.length}개 — 이대로면 합계가 이만큼 어긋납니다. 어디에 넣을지 고르세요:</div>
              {preview.unmatched.map((t) => {
                const c = choice[t.name];
                const v = c?.to === 'row' ? `row:${c.label}` : c?.to === 'new' ? `new:${c.fsli}` : c?.to === 'skip' ? 'skip' : '';
                return (
                  <div key={t.name} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                    <span style={{ minWidth: 220, whiteSpace: 'nowrap' }}><b>{t.name}</b> {fmt(Math.abs(t.bal))} <span style={{ color: 'var(--ink-3)' }}>({t.section} · {t.bal >= 0 ? '차변' : '대변'})</span></span>
                    <select className="btn-sm" style={{ maxWidth: 420 }} value={v} onChange={(e) => {
                      const x = e.target.value;
                      setChoice({ ...choice, [t.name]: x.startsWith('row:') ? { to: 'row', label: x.slice(4) } : x.startsWith('new:') ? { to: 'new', fsli: x.slice(4) } : { to: 'skip' } });
                    }}>
                      <option value="">— 고르세요 —</option>
                      <optgroup label="과목 끝에 새 줄로(새 계정)">
                        {fslis(t).map((f) => <option key={`n${f}`} value={`new:${f}`}>＋ 새 줄 — 과목 「{f}」</option>)}
                      </optgroup>
                      <optgroup label="이미 있는 줄에 더하기">
                        {rowsOf(t).map((r) => <option key={`r${r.row}`} value={`row:${r.label}`}>{r.label} ({r.fsli})</option>)}
                      </optgroup>
                      <option value="skip">넣지 않기(차이 남김)</option>
                    </select>
                  </div>
                );
              })}
            </div>
          ) : <div style={{ marginTop: 6, color: 'var(--good)', fontSize: 'var(--fs-2)' }}>시산표 계정이 모두 정산표 줄에 맞았습니다.</div>}
          <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn-p" disabled={!!busy || unresolved > 0} onClick={() => void make()}>
              {busy === 'make' ? '만드는 중…' : `이월 정산표 만들기 — ${wtbFileName(eng, '중간')}`}
            </button>
            {unresolved > 0 && <span style={{ color: 'var(--warn)', fontSize: 'var(--fs-1)' }}>받을 줄이 없는 계정 {unresolved}개를 먼저 고르세요</span>}
          </div>
        </div>
      )}

      {made && (made.notes.length > 0 || made.unmatched.length > 0) && (
        <div style={{ ...box, fontSize: 'var(--fs-1)' }}>
          {made.notes.map((n) => <div key={n}>{n}</div>)}
          {made.unmatched.length > 0 && <div style={{ color: 'var(--warn)' }}>넣지 않은 계정: {made.unmatched.map((t) => `${t.name} ${fmt(Math.abs(t.bal))}`).join(', ')}</div>}
        </div>
      )}

      {saved.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
          만든 정산표: {saved.slice(0, 5).map((f) => (
            <button key={f.id} className="btn-sm" style={{ marginLeft: 6 }} onClick={() => void open(f)}>{f.fileName} · {new Date(f.createdAt).toLocaleString('sv-SE').slice(0, 16)}</button>
          ))}
        </div>
      )}
    </div>
  );
}
