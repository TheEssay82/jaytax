// 웹 조서 입력 창 — 조서마다 폼을 띄우고 [저장] · [확인하고 엑셀에 반영]. 반영하면 최신 판에 써 넣은 새 판이 쌓인다.
import { useEffect, useState } from 'react';
import type { Engagement } from '../../lib/dsdApi';
import { listBooks, addBook, fileBytes } from '../../lib/gwpApi';
import { readWorkbook, type SheetData } from '../../lib/xlsxRead';
import { buildCatalog } from '../../lib/gwpCatalog';
import { findPaperSheet } from '../../lib/gwpWeb';
import { applyWebPapers } from '../../lib/gwpApply';
import { savePaper, markApplied, type PaperRow } from '../../lib/gwpStageApi';
import { STAGES } from '../../lib/gwpStage';
import type { WebPaperEntry } from '../../lib/gwpWebPapers';
import type { Paper2110A } from '../../lib/gwpPaper2110A';
import Form2110A from './Form2110A';

export default function GwpPaperModal({ entry, eng, saved, locked, canWrite, partner, author, onClose, onChanged }: {
  entry: WebPaperEntry;
  eng: Engagement;
  saved: PaperRow | undefined;
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
  const [dirty, setDirty] = useState(false);
  const readOnly = locked || !canWrite;

  // 최신 판의 이 조서 시트 — 처음 여는 조서는 여기서 작년(이월) 값을 읽어 채운다.
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const books = await listBooks(eng.id);
        if (!books[0]) throw new Error('조서 판이 없습니다 — 이월본을 먼저 만드세요.');
        const sheets = readWorkbook(await fileBytes(books[0].storagePath));
        const s = findPaperSheet(sheets, def.sheetCode);
        if (off) return;
        setVersion(books[0].version);
        setSheet(s);
        if (!s) setErr(`최신 판(v${books[0].version})에 ${def.sheetCode} 시트가 없습니다.`);
        else if (saved?.data == null) setData(def.read(s));
      } catch (e) {
        if (!off) setErr(e instanceof Error ? e.message : '조서를 읽지 못했습니다.');
      }
    })();
    return () => { off = true; };
  }, [eng.id, def, saved?.data]);

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
      const r = applyWebPapers(await fileBytes(base.storagePath), [{ def, data }]);
      if (r.missing.length) throw new Error(`최신 판(v${base.version})에 ${def.sheetCode} 시트가 없습니다.`);
      const changed = r.done[0].changed;
      const book = await addBook(eng.id, '작업중', { name: base.fileName, bytes: r.bytes }, buildCatalog(readWorkbook(r.bytes)),
        `웹 조서 반영: ${def.code} ${def.title} — ${changed ? `바뀐 칸 ${changed}개(노랑), 탭 노랑` : '바뀐 것 없음, 탭 초록'}`);
      await markApplied(eng.id, def.code, data, book.version);
      setDirty(false);
      await onChanged(`${def.code} ${def.title}을 엑셀에 반영해 v${book.version}을 만들었습니다 — ${changed ? `바뀐 칸 ${changed}개는 노랗게, 탭은 노랑(수정함)` : '바뀐 것이 없어 탭을 초록(확인·새로 넣을 것 없음)'}으로 두었습니다.`);
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : '반영하지 못했습니다.'); } finally { setBusy(''); }
  }

  const stage = STAGES[entry.stage - 1];
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
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {data == null ? <div style={{ color: 'var(--ink-3)', padding: 12 }}>{err ? '' : '조서를 읽는 중…'}</div>
            : def.code === '2110A' ? (
              <Form2110A value={data as Paper2110A} onChange={change} readOnly={readOnly} partner={partner} author={author}
                onReset={sheet ? () => change(def.read(sheet)) : undefined} />
            ) : null}
        </div>
        {!readOnly && data != null && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginRight: 'auto' }}>
              {saved?.status === '확인' && !dirty ? `v${saved.appliedVersion}에 반영돼 있습니다.` : dirty ? '고친 것이 있습니다.' : ''}
            </span>
            <button className="btn-s" disabled={!!busy || !dirty} onClick={() => void save()}>{busy === 'save' ? '저장하는 중…' : '저장'}</button>
            <button className="btn-p" disabled={!!busy || !sheet} onClick={() => void apply()}
              title="최신 판에 이 조서를 써 넣은 새 판을 만듭니다. 바뀐 칸은 노랗게, 탭은 노랑(바뀐 게 없으면 초록).">
              {busy === 'apply' ? '반영하는 중…' : '확인하고 엑셀에 반영'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
