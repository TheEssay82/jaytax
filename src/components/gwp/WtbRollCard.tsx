// 정산표 이월 — 작년 확정 정산표 + 회사 제시 재무제표 → 올해 중간감사 정산표.
//
// 사용자 2026-10-03: 이월 순서 16단계(wtbRoll.ts)를 버튼으로. 새 계정은 2120A 처럼 「이 줄에 더하기」 또는 「과목 끝에 새 줄」.
// 사용자 2026-10-05(아비즈): ERP 재무제표는 형식이 다르다 · 제조원가명세서가 3종 · **파일을 여러 개** 올릴 수 있어야 한다.
//   → 파일을 여러 개 받아 시트마다 종류(시산표·재무상태표·손익계산서·제조원가명세서)를 알아보고(고칠 수 있음),
//     정산표의 제조원가 표(WMS-CSI·WMS-sys·WMS-디텍 …)마다 회사 자료 시트를 짝짓는다.
// 파일 이름 「WTB_개별|별도|연결_회사명_FY26_중간|기말_261003」 — 개별 = 일반기업 비연결, 별도 = K-IFRS 비연결, 연결 = 연결.
// 만든 파일은 내려받고 자료함(이월정산표)에도 남긴다. 작년 확정 정산표는 작년 작업 건 자료함에 있으면 그것을 쓴다.
import { useEffect, useMemo, useState } from 'react';
import type { Engagement } from '../../lib/dsdApi';
import { findEngagement } from '../../lib/dsdApi';
import { readWorkbook, type SheetData } from '../../lib/xlsxRead';
import { unzip, zip } from '../../lib/xlsxTransplant';
import { rollWtb, tbFromSheet, fsFromSheet, wtbOutline, wtbA500People, type TbLine, type WtbPlace, type WtbRollReport, type WtbRow, type TableKind } from '../../lib/wtbRoll';
import { listFiles, latestFile, uploadFile, type EngFile } from '../../lib/gwpStageApi';
import { fileBytes, fileUrl } from '../../lib/gwpApi';
import { safeName, download } from '../dsd/dsdUi';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
type Src = { name: string; bytes: Uint8Array; from: string };
type Choice = { to: 'row'; label: string; row: number } | { to: 'new'; fsli: string } | { to: 'skip' };
type SrcKind = 'TB' | 'BS' | 'PL' | 'MC' | 'skip';
const KIND_LABEL: Record<SrcKind, string> = { TB: '합계잔액시산표', BS: '재무상태표', PL: '손익계산서', MC: '제조원가명세서', skip: '쓰지 않음' };
type SrcSheet = { key: string; file: string; sheet: SheetData; kind: SrcKind };

/** 「WTB_개별_제이스튜디오_FY26_중간_261003」 */
export function wtbFileName(eng: Engagement, phase: '중간' | '기말', today = new Date()): string {
  const kind = eng.scope === '연결' ? '연결' : eng.basis === 'K-IFRS' ? '별도' : '개별';
  const ymd = `${String(today.getFullYear()).slice(2)}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  return `WTB_${kind}_${safeName(eng.entityName)}_FY${String(eng.fy).slice(2)}_${phase}_${ymd}.xlsx`;
}

/** 「제 11기 2026년 08월 31일 현재」·「제 15기 당기: 2026년 08월 31일」·「… ~ 2026년 08월 31일」 → 2026-08-31 */
function dateOf(sh: SheetData): string | null {
  for (const v of [...sh.cells.values()].slice(0, 80)) {
    const all = [...(v.text ?? '').matchAll(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)];
    if (all.length && /현재|까지|당기|~/.test(v.text ?? '')) { const m = all[all.length - 1]; return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; }
  }
  return null;
}
const has = (sh: SheetData, re: RegExp) => re.test(sh.name.replace(/\s/g, ''))
  || [...sh.cells.values()].slice(0, 60).some((v) => re.test((v.text ?? '').replace(/\s/g, '')));
/** 시트 종류 — 제목(앞쪽 칸 글자)·시트 이름으로. */
function kindOf(sh: SheetData): SrcKind {
  if (has(sh, /합계잔액시산표|^시산표$/)) return 'TB';
  if (has(sh, /제조원가명세서|^WMS/i)) return 'MC';
  if (has(sh, /재무상태표|대차대조표/)) return 'BS';
  if (has(sh, /손익계산서|포괄손익/)) return 'PL';
  return 'skip';
}
const nameKey = (s: string) => s.replace(/[\s_\-.()]/g, '').toUpperCase();

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');

export default function WtbRollCard({ eng, canWrite }: { eng: Engagement; canWrite: boolean }) {
  const [prior, setPrior] = useState<Src | null>(null);
  const [srcs, setSrcs] = useState<SrcSheet[]>([]);
  const [pair, setPair] = useState<Record<string, string>>({});
  const [closing, setClosing] = useState(`${eng.fy}-08-31`);
  const [preview, setPreview] = useState<WtbRollReport | null>(null);
  const [outline, setOutline] = useState<{ rows: WtbRow[]; tables: { sheet: string; kind: TableKind; hidden: boolean }[] }>({ rows: [], tables: [] });
  const [choice, setChoice] = useState<Record<string, Choice>>({});
  const [made, setMade] = useState<WtbRollReport | null>(null);
  const [saved, setSaved] = useState<EngFile[]>([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // A500 작성자·검토자 = **회사 담당**(사용자 2026-10-03). 작년 값을 보여 주고, 만들 때 한 번 묻는다.
  const [lastPeople, setLastPeople] = useState<{ author: string | null; reviewer: string | null }>({ author: null, reviewer: null });
  const [companyAuthor, setCompanyAuthor] = useState('');
  const [companyReviewer, setCompanyReviewer] = useState('');

  // 작년 확정 정산표 — 작년 작업 건 자료함에서. 만든 이월 정산표 목록.
  useEffect(() => {
    let off = false;
    setPrior(null); setSrcs([]); setPreview(null); setMade(null); setChoice({});
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

  useEffect(() => { setPreview(null); setMade(null); }, [prior, srcs, closing, pair]);
  useEffect(() => {
    if (!prior) { setOutline({ rows: [], tables: [] }); return; }
    try { const o = wtbOutline(prior.bytes); setOutline({ rows: o.rows, tables: o.tables }); } catch { setOutline({ rows: [], tables: [] }); }
    try { const p = wtbA500People(prior.bytes); setLastPeople(p); setCompanyAuthor(p.author ?? ''); setCompanyReviewer(p.reviewer ?? ''); } catch { /* 없으면 빈칸 */ }
  }, [prior]);

  const mcTables = outline.tables.filter((t) => t.kind === 'MC');
  // 제조원가 표 ↔ 회사 자료 시트 — 이름이 같으면 저절로, 하나씩뿐이면 그것끼리. 사람이 고친 것은 그대로.
  useEffect(() => {
    const mcSrc = srcs.filter((s) => s.kind === 'MC');
    setPair((old) => {
      const next: Record<string, string> = {};
      for (const t of mcTables) {
        if (old[t.sheet] && mcSrc.some((s) => s.key === old[t.sheet])) { next[t.sheet] = old[t.sheet]; continue; }
        const same = mcSrc.find((s) => nameKey(s.sheet.name) === nameKey(t.sheet));
        if (same) next[t.sheet] = same.key;
        else if (mcSrc.length === 1 && mcTables.filter((x) => !x.hidden).length === 1 && !t.hidden) next[t.sheet] = mcSrc[0].key;
      }
      return next;
    });
  }, [srcs, outline]); // eslint-disable-line react-hooks/exhaustive-deps

  // 회사 자료 → 시산표 줄. 시산표가 있으면 재무상태표·손익계산서는 쓰지 않는다(겹친다). 제조원가명세서는 늘 따로.
  const built = useMemo(() => {
    const out: TbLine[] = [];
    const errs: string[] = [];
    const hasTb = srcs.some((s) => s.kind === 'TB');
    for (const s of srcs) {
      try {
        if (s.kind === 'TB') out.push(...tbFromSheet(s.sheet).map((t) => ({ ...t, src: 'TB' })));
        else if ((s.kind === 'BS' || s.kind === 'PL') && !hasTb) out.push(...fsFromSheet(s.sheet, s.kind, s.kind));
        else if (s.kind === 'MC') out.push(...fsFromSheet(s.sheet, 'MC', `MC:${s.key}`));
      } catch (e) { errs.push(`${s.file} · ${s.sheet.name}: ${e instanceof Error ? e.message : '읽지 못함'}`); }
    }
    return { tb: out, errs, hasTb };
  }, [srcs]);
  const bsCheck = useMemo(() => {
    // 시산표면 시산표 줄 전체(차대 합 0), 재무제표면 재무상태표 줄(자산 = 부채 + 자본).
    const xs = built.tb.filter((t) => !t.subtotal && (built.hasTb ? t.src === 'TB' : t.src === 'BS'));
    return Math.round(xs.reduce((a, t) => a + t.bal, 0));
  }, [built]);

  const opts = useMemo(() => ({
    closing, yearEnd: `${eng.fy}-12-31`, prevEnd: `${eng.fy - 1}-12-31`, term: eng.termNo ?? undefined,
    companyAuthor: companyAuthor.trim() && companyAuthor.trim() !== lastPeople.author ? companyAuthor.trim() : undefined,
    companyReviewer: companyReviewer.trim() && companyReviewer.trim() !== lastPeople.reviewer ? companyReviewer.trim() : undefined,
    tb: built.tb,
    pair: Object.fromEntries(Object.entries(pair).map(([t, k]) => [t, `MC:${k}`])),
  }), [closing, eng.fy, eng.termNo, companyAuthor, companyReviewer, lastPeople, built, pair]);

  async function pickPrior(f: File | undefined) {
    if (!f) return;
    setErr(null);
    setPrior({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), from: '직접 고른 파일' });
  }
  /** 회사 자료 — 여러 파일을 한꺼번에, 또는 나눠서 더한다. */
  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setErr(null);
    const add: SrcSheet[] = [];
    for (const f of [...list]) {
      if (/\.xls$/i.test(f.name)) { setErr(`「${f.name}」 — 옛 엑셀(.xls)은 읽지 못합니다. 엑셀에서 열어 .xlsx 로 저장한 뒤 올리세요.`); continue; }
      try {
        for (const sh of readWorkbook(new Uint8Array(await f.arrayBuffer()))) {
          if (!sh.cells.size) continue;
          add.push({ key: `${f.name}::${sh.name}`, file: f.name, sheet: sh, kind: kindOf(sh) });
        }
      } catch (e) { setErr(`「${f.name}」: ${e instanceof Error ? e.message : '읽지 못했습니다.'}`); }
    }
    setSrcs((old) => {
      const next = [...old.filter((o) => !add.some((a) => a.key === o.key)), ...add];
      const d = next.filter((s) => s.kind === 'BS' || s.kind === 'TB').map((s) => dateOf(s.sheet)).find(Boolean);
      if (d) setClosing(d);
      return next;
    });
  }

  function check() {
    if (!prior || !built.tb.length) return;
    setBusy('preview'); setErr(null); setMsg(null);
    setTimeout(() => {
      try {
        const r = rollWtb(prior.bytes, opts, unzip, zip).report;
        setPreview(r);
      } catch (e) { setErr(e instanceof Error ? e.message : '읽지 못했습니다.'); } finally { setBusy(''); }
    }, 10);
  }

  const ckey = (t: { sheet: string; name: string }) => `${t.sheet}|${t.name}`;
  const places = (): WtbPlace[] => (preview?.unmatched ?? []).flatMap((t) => {
    const c = choice[ckey(t)];
    if (!c || c.to === 'skip') return [];
    return [c.to === 'row' ? { name: t.name, sheet: t.sheet, to: 'row' as const, label: c.label, row: c.row } : { name: t.name, sheet: t.sheet, to: 'new' as const, fsli: c.fsli }];
  });

  async function make() {
    if (!prior || !preview) return;
    // A500 작성자·검토자 = 회사 담당 — 만들 때 한 번 묻는다(사용자 2026-10-03 「당기 회사담당을 질문하는 절차」).
    const a = companyAuthor.trim() || '(비움)', rv = companyReviewer.trim() || '(비움)';
    const changed = a !== (lastPeople.author ?? '(비움)') || rv !== (lastPeople.reviewer ?? '(비움)');
    if (!confirm(`A500(수정사항집계표)의 회사 담당을 확인해 주세요.\n\n  작성자: ${a}\n  검토자: ${rv}\n\n${changed ? `작년(${lastPeople.author ?? '—'} · ${lastPeople.reviewer ?? '—'})과 다르게 고쳐 넣습니다.` : '작년과 같습니다.'}\n올해 회사 담당이 맞으면 [확인], 아니면 [취소]를 누르고 ④ 칸을 고치세요.`)) return;
    setBusy('make'); setErr(null); setMsg(null);
    try {
      const r = rollWtb(prior.bytes, { ...opts, place: places() }, unzip, zip);
      const name = wtbFileName(eng, '중간');
      download(r.bytes, name, XLSX);
      if (canWrite) {
        await uploadFile(eng.id, '이월정산표', { name, bytes: r.bytes }, {
          fy: eng.fy, periodEnd: closing, inspected: true, source: `${prior.name} + ${[...new Set(srcs.filter((s) => s.kind !== 'skip').map((s) => s.file))].join(', ')}`,
          unmatched: r.report.unmatched.length, notes: r.report.notes,
        });
        setSaved((await listFiles(eng.id)).filter((f) => f.kind === '이월정산표' && !f.meta.void));
      }
      setMade(r.report);
      setMsg(`「${name}」을 만들어 내려받았습니다${canWrite ? ' — 자료함에도 남겼습니다' : ''}. 엑셀에서 WBS 차대·이익잉여금 검증·SCE·WCF 검증을 한 번 보세요.`);
    } catch (e) { setErr(e instanceof Error ? e.message : '만들지 못했습니다.'); } finally { setBusy(''); }
  }

  async function open(f: EngFile) {
    window.open(await fileUrl(f.storagePath, f.fileName), '_blank');
  }

  const rowsOf = (t: TbLine & { sheet: string }) => outline.rows.filter((r) => r.sheet === t.sheet && (r.kind !== 'BS' || r.section === t.section || t.section === '원가'));
  const fslis = (t: TbLine & { sheet: string }) => [...new Set(rowsOf(t).map((r) => r.fsli).filter(Boolean))];
  const unresolved = (preview?.unmatched ?? []).filter((t) => !choice[ckey(t)]).length;
  const files = [...new Set(srcs.map((s) => s.file))];

  const box = { padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)', marginTop: 8 } as const;
  return (
    <div className="card">
      <div className="chdr">정산표 이월
        <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>작년 확정 정산표 + 회사 제시 재무제표 → 올해 중간감사 정산표(WBS·WPL·제조원가·A500·SCE·보고서·WCF를 한 해 밀어 둠)</span>
      </div>
      {err && <div style={{ color: 'var(--bad)', fontSize: 'var(--fs-2)', marginBottom: 6 }}>{err}</div>}
      {msg && <div style={{ color: 'var(--good)', fontSize: 'var(--fs-2)', marginBottom: 6 }}>{msg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '8px 12px', alignItems: 'start', fontSize: 'var(--fs-2)' }}>
        <b>① 작년 확정 정산표</b>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {prior ? <span>{prior.name} <span style={{ color: 'var(--ink-3)' }}>({prior.from}{outline.tables.length ? ` · 표 ${outline.tables.map((t) => t.sheet + (t.hidden ? '(숨김)' : '')).join('·')}` : ''})</span></span>
            : <span style={{ color: 'var(--ink-3)' }}>작년 작업 건 자료함에 없습니다 — 파일을 고르세요</span>}
          <label className="btn-sm" style={{ cursor: 'pointer' }}>{prior ? '다른 파일' : '파일 고르기'}
            <input type="file" accept=".xlsx,.xlsm" style={{ display: 'none' }} onChange={(e) => { void pickPrior(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>

        <b>② 회사 재무제표</b>
        <div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="btn-sm" style={{ cursor: 'pointer' }}>{srcs.length ? '파일 더하기' : '파일 고르기(여러 개 가능)'}
              <input type="file" multiple accept=".xlsx,.xlsm,.xls" style={{ display: 'none' }} onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
            </label>
            {srcs.length > 0 && <button className="btn-sm" onClick={() => setSrcs([])}>모두 빼기</button>}
            <span style={{ color: 'var(--ink-3)' }}>
              {srcs.length ? `${files.length}개 파일 · 시트 ${srcs.length}장 · 계정 ${built.tb.filter((t) => !t.subtotal).length}줄 · ${built.hasTb ? '시산표' : '재무상태표'} 차대 ${bsCheck === 0 ? '일치' : `차이 ${fmt(bsCheck)}`}`
                : '합계잔액시산표, 또는 재무상태표·손익계산서(+ 제조원가명세서) — ERP 에서 내려받은 엑셀 그대로. 파일이 나뉘어 있으면 여러 개를 함께 고르세요.'}
            </span>
          </div>
          {srcs.length > 0 && (
            <table className="tbl" style={{ marginTop: 6, fontSize: 'var(--fs-1)' }}>
              <thead><tr style={{ background: 'var(--surface-2)' }}><th>파일</th><th>시트</th><th style={{ width: 170 }}>종류(고칠 수 있음)</th><th>기준일</th></tr></thead>
              <tbody>
                {srcs.map((s) => (
                  <tr key={s.key} style={{ opacity: s.kind === 'skip' ? 0.5 : 1 }}>
                    <td>{s.file}</td><td>{s.sheet.name}</td>
                    <td>
                      <select className="btn-sm" value={s.kind} onChange={(e) => setSrcs(srcs.map((x) => (x.key === s.key ? { ...x, kind: e.target.value as SrcKind } : x)))}>
                        {(Object.keys(KIND_LABEL) as SrcKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                      </select>
                    </td>
                    <td>{dateOf(s.sheet) ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {built.hasTb && srcs.some((s) => s.kind === 'BS' || s.kind === 'PL') && <div style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-1)' }}>합계잔액시산표가 있어 재무상태표·손익계산서 시트는 쓰지 않습니다(겹침).</div>}
          {built.errs.map((x) => <div key={x} style={{ color: 'var(--bad)', fontSize: 'var(--fs-1)' }}>{x}</div>)}
          {mcTables.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-1)' }}>제조원가명세서 짝 — 정산표의 제조원가 표마다 회사 자료 시트를 고르세요(이름이 같으면 저절로):</div>
              {mcTables.map((t) => (
                <div key={t.sheet} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                  <span style={{ minWidth: 150 }}><b>{t.sheet}</b>{t.hidden ? <span style={{ color: 'var(--ink-3)' }}> (숨김)</span> : null}</span>
                  <select className="btn-sm" value={pair[t.sheet] ?? ''} onChange={(e) => setPair({ ...pair, [t.sheet]: e.target.value })}>
                    <option value="">— 짝 없음(회사제시 0) —</option>
                    {srcs.filter((s) => s.kind === 'MC').map((s) => <option key={s.key} value={s.key}>{s.file} · {s.sheet.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>

        <b>③ 기준일</b>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" className="btn-sm" value={closing} onChange={(e) => setClosing(e.target.value)} />
          <span style={{ color: 'var(--ink-3)' }}>중간감사 기준월 말 — 재무제표·시산표 제목에서 읽습니다. A500 의 FS일은 {eng.fy}-12-31 로 미리 둡니다.{eng.termNo ? ` 올해 제${eng.termNo}기.` : ''}</span>
        </div>
        <b>④ 회사 담당</b>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--ink-3)' }}>A500 작성자</span>
          <input className="btn-sm" style={{ width: 120 }} value={companyAuthor} onChange={(e) => setCompanyAuthor(e.target.value)} placeholder="회사 작성자" />
          <span style={{ color: 'var(--ink-3)' }}>검토자</span>
          <input className="btn-sm" style={{ width: 120 }} value={companyReviewer} onChange={(e) => setCompanyReviewer(e.target.value)} placeholder="회사 검토자" />
          <span style={{ color: 'var(--ink-3)' }}>{prior ? '작년 A500 값입니다 — 올해 회사 담당이 바뀌었으면 고치세요. 만들 때 한 번 더 묻습니다.' : ''}</span>
        </div>
      </div>

      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn-p" disabled={!prior || !built.tb.length || !!busy} onClick={check}>{busy === 'preview' ? '맞춰 보는 중…' : '회사 자료 맞춰 보기'}</button>
        <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>기말감사 정산표 갱신(열 밀기 없이 회사제시만 바꾸기)은 다음에 붙입니다.</span>
      </div>

      {preview && (
        <div style={box}>
          <div style={{ fontSize: 'var(--fs-2)' }}>
            {preview.term ? <b>제{preview.term}기 · </b> : null}회사 자료 {preview.filled.length}줄을 정산표 줄에 맞췄습니다
            {(() => { const n = preview.filled.filter((f) => f.how === '전기 금액').length; return n ? <span style={{ color: 'var(--ink-3)' }}> (그 가운데 {n}줄은 이름이 달라 <b>전기 금액</b>으로 찾음)</span> : null; })()}
          </div>
          <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
            {preview.tables.map((t) => <span key={t.sheet}>{t.sheet} {t.insertedAt}열에 작년 수정후 끼움{t.hidden ? ` · ${t.hidden} 숨김` : ''}; </span>)}
            {preview.renamed.length > 0 && <span>시트 이름 {preview.renamed.map(([a, b]) => `${a}→${b}`).join(', ')}</span>}
          </div>
          {preview.notes.filter((n) => !/새 계정/.test(n)).map((n) => <div key={n} style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>{n}</div>)}
          {preview.filled.some((f) => f.how === '전기 금액') && (
            <details style={{ fontSize: 'var(--fs-1)', marginTop: 4 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--ink-3)' }}>전기 금액으로 찾은 짝 보기 — 회사 자료의 이름이 정산표와 다른 줄</summary>
              {preview.filled.filter((f) => f.how === '전기 금액').map((f) => <div key={`${f.sheet}${f.row}`}>{f.sheet} {f.row}행 「{f.label}」 ← {f.from.join(' + ')} · {fmt(f.value)}</div>)}
            </details>
          )}
          {preview.unmatched.length > 0 ? (
            <div style={{ marginTop: 8, fontSize: 'var(--fs-2)' }}>
              <div style={{ color: 'var(--warn)', fontWeight: 700 }}>정산표에 받을 줄이 없는 계정 {preview.unmatched.length}개 — 이대로면 합계가 이만큼 어긋납니다. 어디에 넣을지 고르세요:</div>
              {preview.unmatched.map((t) => {
                const k = ckey(t);
                const c = choice[k];
                const v = c?.to === 'row' ? `row:${c.row}` : c?.to === 'new' ? `new:${c.fsli}` : c?.to === 'skip' ? 'skip' : '';
                const rows = rowsOf(t);
                const mc = rows[0]?.kind === 'MC' || t.section === '원가';
                return (
                  <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                    <span style={{ minWidth: 300 }}>
                      <span style={{ color: 'var(--ink-3)' }}>{t.sheet} · </span><b>{t.name}</b> {fmt(t.section === '원가' ? t.bal : Math.abs(t.bal))}
                      <span style={{ color: 'var(--ink-3)' }}> ({t.group ? `${t.group} · ` : ''}전기 {t.prior != null ? fmt(t.prior) : '—'})</span>
                    </span>
                    <select className="btn-sm" style={{ maxWidth: 460 }} value={v} onChange={(e) => {
                      const x = e.target.value;
                      if (x.startsWith('row:')) { const r = rows.find((y) => String(y.row) === x.slice(4))!; setChoice({ ...choice, [k]: { to: 'row', label: r.label, row: r.row } }); }
                      else setChoice({ ...choice, [k]: x.startsWith('new:') ? { to: 'new', fsli: x.slice(4) } : { to: 'skip' } });
                    }}>
                      <option value="">— 고르세요 —</option>
                      <optgroup label={mc ? '이 줄 아래에 새 줄로(새 계정)' : '과목 끝에 새 줄로(새 계정)'}>
                        {(mc ? rows.map((r) => r.label) : fslis(t)).map((f) => <option key={`n${f}`} value={`new:${f}`}>＋ 새 줄 — {mc ? `「${f}」 아래` : `과목 「${f}」`}</option>)}
                      </optgroup>
                      <optgroup label="이미 있는 줄에 더하기">
                        {rows.map((r) => <option key={`r${r.row}`} value={`row:${r.row}`}>{r.row}행 {r.label}{r.fsli && r.fsli !== r.label ? ` (${r.fsli})` : ''}</option>)}
                      </optgroup>
                      <option value="skip">넣지 않기(차이 남김)</option>
                    </select>
                  </div>
                );
              })}
            </div>
          ) : <div style={{ marginTop: 6, color: 'var(--good)', fontSize: 'var(--fs-2)' }}>회사 자료 계정이 모두 정산표 줄에 맞았습니다.</div>}
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
          {made.unmatched.length > 0 && <div style={{ color: 'var(--warn)' }}>넣지 않은 계정: {made.unmatched.map((t) => `${t.sheet} ${t.name} ${fmt(Math.abs(t.bal))}`).join(', ')}</div>}
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
