// 주석·DSD 관리 › ② 주석 시트 만들기
//
// 작년 감사보고서(.dsd)와 그 회사 정산표(.xlsx)를 넣으면, **정산표에 주석 시트를 얹은 새 파일**을
// 내려받는다. 배치는 명진 정산표가 이미 쓰던 모양 그대로다 — B2 주석명 · C열 문단 · 표는 C열부터.
//
// ⚠️ **원본 정산표는 손대지 않는다.** 새 파일로 내려받는다. 그리고 엑셀 라이브러리로 읽고
//    다시 쓰지 않는다 — 명진 정산표를 exceljs 로 왕복시키면 정의된 이름 4,880개가 337개로
//    줄어든다(2026-09-12 실측). ZIP 안에서 시트 부품만 더한다(lib/xlsxInject.ts).
import { useState } from 'react';
import { readDsd, readContents } from '../../lib/dsdFile';
import { parseNoteBlocks, type NoteBlocks } from '../../lib/dsdBlocks';
import { layoutIndex } from '../../lib/noteSheet';
import { pickNotes, planNotes } from '../../lib/notePick';
import { injectSheets } from '../../lib/xlsxInject';
import type { Engagement, NoteRow } from '../../lib/dsdApi';

export default function NoteSheetExport({ eng, notes }: { eng: Engagement; notes: NoteRow[] }) {
  const [blocks, setBlocks] = useState<NoteBlocks[] | null>(null);
  const [dsdName, setDsdName] = useState('');
  const [wtb, setWtb] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  // 기본은 **이월**이다 — ①에서 만든 건은 올해이고 씨앗은 작년 보고서이기 때문이다.
  const [roll, setRoll] = useState(true);
  const [busy, setBusy] = useState(false);
  const [say, setSay] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function takeDsd(f: File | undefined) {
    if (!f) return;
    setSay(null); setDone(null);
    try {
      const info = await readDsd(f);
      const xml = await readContents(f);
      const bs = parseNoteBlocks(xml);
      setBlocks(bs);
      setDsdName(`${f.name} · ${info.docName || 'DSD'} · 주석 ${bs.length}개`);
      if (!bs.length) setSay('이 파일에서 주석을 찾지 못했습니다.');
    } catch (e) {
      setBlocks(null);
      setSay(e instanceof Error ? e.message : 'DSD 를 읽지 못했습니다.');
    }
  }

  async function takeWtb(f: File | undefined) {
    if (!f) return;
    setSay(null); setDone(null);
    setWtb({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  }

  function make() {
    if (!blocks) return setSay('작년 감사보고서(.dsd)를 먼저 고르세요.');
    if (!wtb) return setSay('정산표 엑셀(.xlsx)을 고르세요.');
    setBusy(true); setSay(null);
    try {
      const picked = pickNotes(blocks, notes);
      if (!picked.length) throw new Error('켜 둔 주석이 없습니다. ① 에서 만들 주석을 골라 주세요.');
      const fresh = picked.filter((p) => !p.note).map((p) => p.title);
      const plans = planNotes(picked, roll);
      plans.push(layoutIndex(picked.map(({ title }, i) => ({
        no: i + 1, title, enabled: true, sheet: plans[i].name,
      }))));

      const out = injectSheets(wtb.bytes, plans);
      const base = wtb.name.replace(/\.xlsx$/i, '');
      download(out, `${base}_주석시트.xlsx`);
      const yellow = plans.flatMap((p) => p.cells).filter((c) => c.kind === 'input').length;
      setDone(`주석 시트 ${picked.length}장과 목록 한 장을 얹었습니다.`
        + (roll ? ` 당기 값을 전기로 밀고 채워 넣을 칸 ${yellow}개를 노랗게 두었습니다.` : '')
        + (fresh.length
          ? ` 그 가운데 ${fresh.length}개는 작년 보고서에 없어 빈 서식으로 두었습니다 — ${fresh.join(' · ')}`
          : ''));
    } catch (e) {
      setSay(e instanceof Error ? e.message : '만들지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  const on = notes.filter((n) => n.enabled).length;

  return (
    <div className="card">
      <div className="chdr">
        ② 주석 시트 만들기
        <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>
          정산표에 주석 시트를 얹습니다
        </span>
      </div>

      <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7, marginBottom: 12 }}>
        작년 감사보고서에서 <b>서술·표·각주를 통째로</b> 가져와 <b>한 주석 한 시트</b>로 만듭니다.
        <b> 원본 정산표는 손대지 않고</b> 새 파일로 내려받습니다.
        <span style={{ color: 'var(--ink-3)' }}> 파일은 브라우저 안에서만 열립니다.</span>
      </div>

      <div className="frow"><span className="fl">작년 감사보고서</span>
        <div>
          <input type="file" accept=".dsd" style={{ fontSize: 'var(--fs-1)' }}
            onChange={(e) => void takeDsd(e.target.files?.[0])} />
          {dsdName && <div style={{ fontSize: 'var(--fs-1)', color: 'var(--good)', marginTop: 3 }}>{dsdName}</div>}
        </div>
      </div>

      <div className="frow"><span className="fl">정산표 엑셀</span>
        <div>
          <input type="file" accept=".xlsx" style={{ fontSize: 'var(--fs-1)' }}
            onChange={(e) => void takeWtb(e.target.files?.[0])} />
          {wtb && (
            <div style={{ fontSize: 'var(--fs-1)', color: 'var(--good)', marginTop: 3 }}>
              {wtb.name} · {Math.round(wtb.bytes.length / 1024)}KB
            </div>
          )}
        </div>
      </div>

      <div className="frow"><span className="fl">다음 해로 이월</span>
        <label style={{ fontSize: 'var(--fs-2)' }}>
          <input type="checkbox" checked={roll} onChange={(e) => setRoll(e.target.checked)} />{' '}
          <b>당기 값을 전기로 밀고, 당기 칸은 비워 노랗게</b>
          <span style={{ color: 'var(--ink-3)' }}> — 노란 칸이 올해 채워 넣을 자리입니다(대개 재무제표에서 링크)</span>
          <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-4)', marginTop: 2 }}>
            끄면 작년 보고서를 그대로 옮깁니다 — 작년 것을 확인할 때 씁니다.
          </div>
        </label>
      </div>

      <div className="frow"><span className="fl">만들 주석</span>
        <div style={{ fontSize: 'var(--fs-2)' }}>
          <b>{on}개</b>
          <span style={{ color: 'var(--ink-3)' }}> — ①에서 켜 둔 것만 · 금액은 {eng.moneyUnit} 단위로 적힌 그대로</span>
        </div>
      </div>

      {say && (
        <div style={{
          marginTop: 10, padding: '8px 11px', borderRadius: 'var(--r-sm)',
          background: 'var(--bad-bg)', color: 'var(--bad)', fontSize: 'var(--fs-2)',
        }}>{say}</div>
      )}
      {done && (
        <div style={{
          marginTop: 10, padding: '8px 11px', borderRadius: 'var(--r-sm)',
          background: 'var(--good-bg)', color: 'var(--good)', fontSize: 'var(--fs-2)', lineHeight: 1.6,
        }}>{done}</div>
      )}

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn-p" disabled={busy} onClick={make}>
          {busy ? '만드는 중…' : '주석 시트 얹은 엑셀 내려받기'}
        </button>
      </div>
    </div>
  );
}

function download(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as unknown as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
