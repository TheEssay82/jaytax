// 웹 조서 입력 창 — 조서마다 폼을 띄우고 [저장] · [확인하고 엑셀에 반영]. 반영하면 최신 판에 써 넣은 새 판이 쌓인다.
//
// 처음 여는 조서는 최신 판(이월본)의 시트에서 작년 값을 읽어 채운다. 옛 모양 시트도 읽는다.
// 반영할 때 시트가 올해 양식 모양이 아니면(명진 2700A-2(소규모)) 표준양식으로 갈아끼운 뒤 쓴다.
import { useEffect, useState } from 'react';
import { unzipSync, strFromU8 } from 'fflate';
import type { Engagement } from '../../lib/dsdApi';
import { listBooks, addBook, fileBytes, type GwpTemplate } from '../../lib/gwpApi';
import { readWorkbook, type SheetData } from '../../lib/xlsxRead';
import { buildCatalog } from '../../lib/gwpCatalog';
import { pickSheet } from '../../lib/gwpWeb';
import { applyWebPapers } from '../../lib/gwpApply';
import { readBundle } from '../../lib/gwpTemplate';
import { parseStatements } from '../../lib/fsParse';
import { savePaper, markApplied, latestFile, type PaperRow, type EngFile } from '../../lib/gwpStageApi';
import { STAGES } from '../../lib/gwpStage';
import type { WebPaperEntry } from '../../lib/gwpWebPapers';
import type { Paper2110A } from '../../lib/gwpPaper2110A';
import { amountsFromFs, type Paper2700, type Paper2700A1 } from '../../lib/gwpPaper2700A';
import Form2110A from './Form2110A';
import Form2110 from './Form2110';
import Form2120A from './Form2120A';
import { fillFromFs, type Paper2120A, type FillReport } from '../../lib/gwpPaper2120A';
import type { Paper2110 } from '../../lib/gwpPaper2110';
import Form2700A from './Form2700A';
import Form2700A1 from './Form2700A1';

/** 앞 단계 중요성 — 2700A-3 은 2700A-2, 2700A-4 는 2700A-3 에서 시작한다. */
const PREV_STAGE: Record<string, string> = { '2700A-3': '2700A-2', '2700A-4': '2700A-3' };

export default function GwpPaperModal({ entry, eng, saved, papers, files, tpl, locked, canWrite, partner, author, onClose, onChanged }: {
  entry: WebPaperEntry;
  eng: Engagement;
  saved: PaperRow | undefined;
  /** 다른 웹 조서 — 2700A-1 판단·앞 단계 값을 쓴다 */ papers: Map<string, PaperRow>;
  /** 자료함 */ files: EngFile[];
  /** 올해 표준양식 — 반영 때 옛 모양 시트를 갈아끼운다 */ tpl: GwpTemplate | null;
  /** 이 조서의 단계가 확정됐다 — 읽기만 */ locked: boolean;
  canWrite: boolean;
  partner: string;
  author: string | null;
  onClose: () => void;
  /** 저장·반영 뒤 — 보드가 다시 읽는다. msg 는 알릴 말 */ onChanged: (msg: string) => Promise<void>;
}) {
  const def = entry.def!;
  const [data, setData] = useState<unknown>(saved?.data ?? null);
  const [sheet, setSheet] = useState<SheetData | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [fillRep, setFillRep] = useState<FillReport | null>(null);
  const readOnly = locked || !canWrite;
  const prevCode = PREV_STAGE[def.code];
  const prevSaved = prevCode ? papers.get(prevCode) : undefined;

  // 최신 판의 이 조서 시트 — 처음 여는 조서는 여기서 작년(이월) 값을 읽어 채운다.
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const books = await listBooks(eng.id);
        if (!books[0]) throw new Error('조서 판이 없습니다 — 이월본을 먼저 만드세요.');
        const sheets = readWorkbook(await fileBytes(books[0].storagePath));
        const s = pickSheet(def, sheets);
        if (off) return;
        setVersion(books[0].version);
        setSheet(s);
        if (saved?.data != null) return;
        let d: unknown;
        if (prevSaved?.data != null) { d = structuredClone(prevSaved.data); setNote(`${prevCode}(앞 단계)에 저장한 값에서 시작합니다.`); }
        else if (s) { d = def.read(s); setNote('작년(이월본) 값을 불러왔습니다 — 올해 것으로 고치세요.'); }
        else { d = def.empty(); setNote(`최신 판(v${books[0].version})에 ${def.sheetCode} 시트가 없습니다 — 반영할 때 올해 양식으로 새로 넣습니다.`); }
        // 회계기간은 올해 것으로(표지의 대상기간).
        const period = books[0].catalog.period;
        if (period && d && typeof d === 'object' && 'period' in d) (d as { period: string }).period = period;
        setData((cur: unknown) => cur ?? d);   // 고치던 입력을 덮지 않는다
      } catch (e) {
        if (!off) setErr(e instanceof Error ? e.message : '조서를 읽지 못했습니다.');
      }
    })();
    return () => { off = true; };
  }, [eng.id, def, saved?.data, prevSaved?.data, prevCode]);

  const change = (d: unknown) => { setData(d); setDirty(true); };

  async function save() {
    setBusy('save'); setErr(null);
    try {
      await savePaper(eng.id, def.code, data);
      setDirty(false);
      await onChanged(`${def.code} ${def.title}을 저장했습니다 — 아직 엑셀에는 반영하지 않았습니다.`);
    } catch (e) { setErr(e instanceof Error ? e.message : '저장하지 못했습니다.'); } finally { setBusy(''); }
  }

  async function apply() {
    setBusy('apply'); setErr(null);
    try {
      // 반영은 늘 그 순간의 최신 판 위에 — 그 사이 누가 채운 파일을 올렸을 수 있다.
      const books = await listBooks(eng.id);
      const base = books[0];
      if (!base) throw new Error('조서 판이 없습니다.');
      const template = tpl ? { ...readBundle(await fileBytes(tpl.storagePath)), reviewer: partner } : undefined;
      const r = applyWebPapers(await fileBytes(base.storagePath), [{ def, data }], template);
      if (r.missing.length) throw new Error(`최신 판(v${base.version})에 ${def.sheetCode} 시트가 없고 표준양식에서도 찾지 못했습니다.`);
      const changed = r.done[0].changed;
      const prep = [
        r.prepared.replaced.length ? `올해 양식으로 갈아끼움 ${r.prepared.replaced.join(', ')}` : '',
        r.prepared.added.length ? `새로 넣음 ${r.prepared.added.join(', ')}` : '',
        r.prepared.hidden.length ? `숨김 ${r.prepared.hidden.join(', ')}` : '',
      ].filter(Boolean).join(' · ');
      const book = await addBook(eng.id, '작업중', { name: base.fileName, bytes: r.bytes }, buildCatalog(readWorkbook(r.bytes)),
        `웹 조서 반영: ${def.code} ${def.title} — ${changed ? `바뀐 칸 ${changed}개(노랑)` : '바뀐 것 없음(탭 초록)'}${prep ? ` · ${prep}` : ''}`);
      await markApplied(eng.id, def.code, data, book.version);
      setDirty(false);
      await onChanged(`${def.code} ${def.title}을 엑셀에 반영해 v${book.version}을 만들었습니다 — ${changed ? `바뀐 칸 ${changed}개는 노랗게, 탭은 노랑(수정함)` : '바뀐 것이 없어 탭을 초록(확인·새로 넣을 것 없음)'}으로 두었습니다.${prep ? ` (${prep})` : ''}`);
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : '반영하지 못했습니다.'); } finally { setBusy(''); }
  }

  /** 자료함의 전기 DSD 재무제표. */
  async function dsdLines() {
    const f = latestFile(files, '전기DSD')!;
    const z = unzipSync(await fileBytes(f.storagePath));
    if (!z['contents.xml']) throw new Error('DSD 안에 본문이 없습니다.');
    return { f, lines: parseStatements(strFromU8(z['contents.xml'])) };
  }

  /** 2120A 당기 열을 전기 DSD 로. 손으로 고친 줄은 둔다. */
  async function fill2120() {
    setBusy('dsd'); setErr(null);
    try {
      const { f, lines } = await dsdLines();
      const r = fillFromFs(data as Paper2120A, lines);
      change(r.data);
      setFillRep(r.report);
      setNote(`전기 DSD(${f.fileName})로 당기 열을 채웠습니다.`);
    } catch (e) { setErr(e instanceof Error ? e.message : '읽지 못했습니다.'); } finally { setBusy(''); }
  }

  /** 자료함의 전기 DSD 에서 기준 금액을 채운다(백만원). */
  async function fillFromDsd() {
    const f = latestFile(files, '전기DSD');
    if (!f) return;
    setBusy('dsd'); setErr(null);
    try {
      const z = unzipSync(await fileBytes(f.storagePath));
      if (!z['contents.xml']) throw new Error('DSD 안에 본문이 없습니다.');
      const got = amountsFromFs(parseStatements(strFromU8(z['contents.xml'])), eng.moneyUnit);
      const n = Object.keys(got).length;
      if (!n) throw new Error('전기 DSD 재무제표에서 자산총계·자본총계·매출액·세전이익을 찾지 못했습니다.');
      const d = data as Paper2700;
      change({ ...d, amounts: { ...d.amounts, ...got } });
      setNote(`전기 DSD(${f.fileName})에서 ${n}개 금액을 채웠습니다 — ${eng.moneyUnit} 단위를 백만원으로 반올림했습니다.`);
    } catch (e) { setErr(e instanceof Error ? e.message : '읽지 못했습니다.'); } finally { setBusy(''); }
  }

  const stage = STAGES[entry.stage - 1];
  const dsd = latestFile(files, '전기DSD');
  const factors = (papers.get('2700A-1')?.data as Paper2700A1 | undefined) ?? null;
  const is2700 = /^2700A-[234]$/.test(def.code);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="card" style={{ maxWidth: 920, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
        <div className="chdr">
          {def.code} {def.title}
          <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>{stage.label} · {stage.when}{version ? ` · 최신 판 v${version}` : ''}</span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => { if (!dirty || confirm('저장하지 않은 입력이 있습니다. 닫을까요?')) onClose(); }}>닫기</button>
        </div>
        {locked && <div style={{ color: 'var(--warn)', fontSize: 'var(--fs-2)', marginBottom: 6 }}>{stage.label}이 끝나 잠겨 있습니다 — 고치려면 보드에서 확정을 취소하세요.</div>}
        {err && <div style={{ color: 'var(--bad)', fontSize: 'var(--fs-2)', marginBottom: 6 }}>{err}</div>}
        {note && !readOnly && <div style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-1)', marginBottom: 6 }}>{note}</div>}
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {data == null ? <div style={{ color: 'var(--ink-3)', padding: 12 }}>{err ? '' : '조서를 읽는 중…'}</div>
            : def.code === '2110A' ? (
              <Form2110A value={data as Paper2110A} onChange={change} readOnly={readOnly} partner={partner} author={author}
                onReset={sheet ? () => change(def.read(sheet)) : undefined} />
            ) : def.code === '2110' ? (
              <Form2110 value={data as Paper2110} onChange={change} readOnly={readOnly} fy={eng.fy} author={author} />
            ) : def.code === '2120A' ? (
              <Form2120A value={data as Paper2120A} onChange={change} readOnly={readOnly} report={fillRep}
                fill={<button className="btn-sm btn-sm-navy" disabled={!dsd || !!busy} onClick={() => void fill2120()}
                  title={dsd ? dsd.fileName : '자료함에 전기 DSD 를 먼저 올리세요'}>
                  {busy === 'dsd' ? '읽는 중…' : dsd ? '전기 DSD 로 당기 열 채우기' : '전기 DSD 없음(자료함에 올리세요)'}
                </button>} />
            ) : def.code === '2700A-1' ? (
              <Form2700A1 value={data as Paper2700A1} onChange={change} readOnly={readOnly} />
            ) : is2700 ? (
              <Form2700A value={data as Paper2700} onChange={change} readOnly={readOnly} factors={factors}
                tools={<>
                  {def.code === '2700A-2' && (
                    <button className="btn-sm" disabled={!dsd || !!busy} onClick={() => void fillFromDsd()}
                      title={dsd ? dsd.fileName : '자료함에 전기 DSD 를 먼저 올리세요'}>
                      {busy === 'dsd' ? '읽는 중…' : dsd ? '전기 DSD 에서 금액 채우기' : '전기 DSD 없음(자료함)'}
                    </button>
                  )}
                  {prevSaved?.data != null && (
                    <button className="btn-sm" onClick={() => change({ ...(structuredClone(prevSaved.data) as Paper2700), period: (data as Paper2700).period })}>
                      {prevCode}(앞 단계) 값 가져오기
                    </button>
                  )}
                  {sheet && <button className="btn-sm" onClick={() => change({ ...def.read(sheet), period: (data as Paper2700).period })}>엑셀(최신 판) 값으로 되돌리기</button>}
                </>} />
            ) : null}
        </div>
        {!readOnly && data != null && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginRight: 'auto' }}>
              {saved?.status === '확인' && !dirty ? `v${saved.appliedVersion}에 반영돼 있습니다.` : dirty ? '고친 것이 있습니다.' : ''}
              {!tpl && is2700 ? ' 표준양식이 없어 옛 모양 시트는 반영하지 못합니다.' : ''}
            </span>
            <button className="btn-s" disabled={!!busy || !dirty} onClick={() => void save()}>{busy === 'save' ? '저장하는 중…' : '저장'}</button>
            <button className="btn-p" disabled={!!busy} onClick={() => void apply()}
              title="최신 판에 이 조서를 써 넣은 새 판을 만듭니다. 바뀐 칸은 노랗게, 탭은 노랑(바뀐 게 없으면 초록).">
              {busy === 'apply' ? '반영하는 중…' : '확인하고 엑셀에 반영'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
