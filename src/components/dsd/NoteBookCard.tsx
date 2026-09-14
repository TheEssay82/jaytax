// 주석·DSD 관리 › ① 대상 › **표준주석엑셀** — 다 채우고 검증까지 마친 엑셀을 이 건에 등록한다.
//
// 등록해 두면 다음 해 ② 가 노란 칸의 수식을 이어받고(noteInherit), 다른 회사의 틀로 내려받아
// 볼 수도 있다. 파일을 서버에 두는 유일한 자리다(사용자 결정 2026-09-14 — 주석은 공시 정보다).
import { useState } from 'react';
import { confirmDanger } from '../common/DangerConfirm';
import {
  registerNoteBook, deleteNoteBook, noteBookUrl, type NoteBook,
} from '../../lib/dsdBookApi';
import { LAYOUT_LABEL } from '../../lib/notePick';
import type { Engagement } from '../../lib/dsdApi';

function fmtKb(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
}

export default function NoteBookCard(
  { eng, book, onChange, readOnly }:
  { eng: Engagement; book: NoteBook | null; onChange: (b: NoteBook | null) => void; readOnly: boolean },
) {
  const [busy, setBusy] = useState(false);
  const [say, setSay] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function take(f: File | undefined) {
    if (!f) return;
    setBusy(true); setSay(null); setDone(null);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const b = await registerNoteBook(eng, { name: f.name, bytes });
      onChange(b);
      setDone(`등록했습니다 — ${b.fileName} · 주석 시트 ${b.noteSheets}장. FY${eng.fy + 1} 의 ② 가 이 파일의 수식을 이어받습니다.`);
    } catch (e) {
      setSay(e instanceof Error ? e.message : '등록하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function open() {
    if (!book) return;
    try {
      window.open(await noteBookUrl(book), '_blank', 'noopener');
    } catch (e) {
      setSay(e instanceof Error ? e.message : '내려받지 못했습니다.');
    }
  }

  async function remove() {
    if (!book) return;
    const ok = await confirmDanger({
      level: 'delete',
      title: '표준주석엑셀을 지웁니다',
      target: `${eng.entityName} · FY${eng.fy} ${eng.scope} — ${book.fileName}`,
      detail: '파일이 서버에서 사라집니다. 다음 해 ② 는 이어받을 수식이 없어 노란 칸이 비어서 나옵니다.',
    });
    if (!ok) return;
    setBusy(true); setSay(null); setDone(null);
    try {
      await deleteNoteBook(book);
      onChange(null);
      setDone('지웠습니다.');
    } catch (e) {
      setSay(e instanceof Error ? e.message : '지우지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      margin: '4px 0 12px', padding: '9px 11px', borderRadius: 'var(--r-sm)',
      border: '1px solid var(--rule)', background: 'var(--surface-2)',
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--navy)' }}>표준주석엑셀</span>
        {book ? (
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--good)' }}>
            <b>{book.fileName}</b> · {fmtKb(book.fileSize)} · 주석 시트 {book.noteSheets}장
            {' '}· {LAYOUT_LABEL[book.sheetLayout]}
            <span style={{ color: 'var(--ink-3)' }}>
              {' '}· {book.updatedAt.slice(0, 10)}{book.uploadedEmail ? ` · ${book.uploadedEmail}` : ''}
            </span>
          </span>
        ) : (
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
            아직 없습니다 — 다 채우고 ③ 검증까지 마친 엑셀을 등록해 두십시오.
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {book && <button className="btn-sm" disabled={busy} onClick={() => void open()}>내려받기</button>}
          {!readOnly && (
            <label className="btn-sm" style={{ cursor: busy ? 'default' : 'pointer' }}>
              {busy ? '올리는 중…' : book ? '바꾸기' : '등록'}
              <input type="file" accept=".xlsx" style={{ display: 'none' }} disabled={busy}
                onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          )}
          {!readOnly && book && (
            <button className="btn-sm btn-sm-del" disabled={busy} onClick={() => void remove()}>지우기</button>
          )}
        </span>
      </div>
      <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-4)', marginTop: 4, lineHeight: 1.6 }}>
        다음 해 ② 준비가 이 파일에서 <b>노란 칸에 걸었던 수식</b>(재무제표·TB 링크)을 이어받습니다.
        값은 이어받지 않습니다. 다른 회사의 틀로 볼 때는 내려받아 쓰십시오.
        {' '}<span style={{ color: 'var(--ink-3)' }}>주석은 공시되는 정보라 서버에 둡니다 — 재무제표·DSD 는 여전히 올리지 않습니다.</span>
      </div>
      {say && <div style={{ marginTop: 6, fontSize: 'var(--fs-1)', color: 'var(--bad)' }}>{say}</div>}
      {done && <div style={{ marginTop: 6, fontSize: 'var(--fs-1)', color: 'var(--good)' }}>{done}</div>}
    </div>
  );
}
