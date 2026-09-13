// 주석·DSD 관리 › ④ DSD 만들기
//
// 채워 넣은 엑셀의 글자를 **작년 DSD 제자리에 도로 넣어** 새 .dsd 를 만든다. 원본을 틀로 두고
// 글자만 갈아끼우므로 표 너비·정렬·글꼴이 하나도 상하지 않는다 — 아무것도 안 고치면 원본과
// 바이트 단위로 같다(명진·알티스트·넵튠 실측 2026-09-13).
//
// ⚠️ **안 채운 칸이 남아 있으면 만들지 않는다.** 작년 숫자가 올해 보고서로 나가는 것이
//    이 일에서 가장 큰 사고다.
import { useState } from 'react';
import { readContents } from '../../lib/dsdFile';
import { parseNoteBlocks, type NoteBlocks } from '../../lib/dsdBlocks';
import { pickNotes, planNotes } from '../../lib/notePick';
import { readWorkbook } from '../../lib/xlsxRead';
import { writeNotes, buildDsd, contentsOf } from '../../lib/dsdWrite';
import { rollStatements } from '../../lib/dsdRoll';
import type { NoteRow } from '../../lib/dsdApi';

export default function NoteDsdCard({ notes }: { notes: NoteRow[] }) {
  const [dsd, setDsd] = useState<{ name: string; bytes: Uint8Array; blocks: NoteBlocks[] } | null>(null);
  const [xl, setXl] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [roll, setRoll] = useState(true);
  const [force, setForce] = useState(false);
  const [rollFs, setRollFs] = useState(true);
  const [say, setSay] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function takeDsd(f: File | undefined) {
    if (!f) return;
    setSay(null); setDone(null);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const blocks = parseNoteBlocks(await readContents(f));
      setDsd({ name: f.name, bytes, blocks });
      if (!blocks.length) setSay('이 파일에서 주석을 찾지 못했습니다.');
    } catch (e) {
      setDsd(null);
      setSay(e instanceof Error ? e.message : 'DSD 를 읽지 못했습니다.');
    }
  }

  async function takeXl(f: File | undefined) {
    if (!f) return;
    setSay(null); setDone(null);
    setXl({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  }

  function make() {
    if (!dsd) return setSay('작년 감사보고서(.dsd)를 먼저 고르세요.');
    if (!xl) return setSay('채워 넣은 엑셀(.xlsx)을 고르세요.');
    setBusy(true); setSay(null); setDone(null);
    try {
      const picked = pickNotes(dsd.blocks, notes);
      if (!picked.length) throw new Error('켜 둔 주석이 없습니다. ① 에서 골라 주세요.');
      const plans = planNotes(picked, roll);
      const sheets = readWorkbook(xl.bytes, (n) => /^N\d\d /.test(n));
      if (!sheets.length) {
        throw new Error('이 엑셀에 주석 시트(N01 … 꼴)가 없습니다. ② 에서 만든 파일인지 보십시오.');
      }
      // 재무제표·표지를 먼저 민다 — **④ 가 갈아끼울 자리는 뺀다.** 거기는 ② 가 이미 밀었다.
      let xml = contentsOf(dsd.bytes);
      let fsTold = '';
      if (roll && rollFs) {
        const skip = new Set<number>();
        for (const p of plans) for (const b of p.back ?? []) skip.add(b.slot);
        const rolled = rollStatements(xml, 1, skip);
        xml = rolled.xml;
        const why = new Map<string, number>();
        for (const l of rolled.leftovers) why.set(l.why, (why.get(l.why) ?? 0) + 1);
        fsTold = ` 재무제표·표지는 기수·연도 ${rolled.terms}칸을 올리고 금액 ${rolled.amounts}칸을 전기로 내렸습니다.`
          + (why.size ? ` 다만 ${[...why].map(([k, v]) => `${v}곳은 ${k}`).join(', ')} — 편집기에서 보십시오.` : '');
      }
      const r = writeNotes(xml, plans, sheets);

      if (r.blank.length && !force) {
        setSay(
          `아직 채우지 않은 칸이 ${r.blank.length}개 있습니다 — 그대로 만들면 작년 숫자가 올해 보고서로 나갑니다. `
          + `먼저 ③ 검증으로 어디인지 보십시오. 그래도 만들려면 아래를 켜 주세요.`
          + ` (${r.blank.slice(0, 3).map((b) => b.at).join(' · ')}${r.blank.length > 3 ? ' …' : ''})`,
        );
        return;
      }

      const out = buildDsd(dsd.bytes, r.xml);
      const blob = new Blob([out as unknown as BlobPart], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = dsd.name.replace(/\.dsd$/i, '').concat('_새로.dsd');
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDone(
        `주석 ${r.changed}칸을 갈아끼워 새 DSD 를 만들었습니다.` + fsTold
        + (r.blank.length ? ` 안 채운 칸 ${r.blank.length}개는 작년 글자가 그대로 남았습니다.` : '')
        + (r.skipped.length ? ` 손대지 못한 칸이 ${r.skipped.length}개 있습니다 — ${r.skipped[0].why}` : ''),
      );
    } catch (e) {
      setSay(e instanceof Error ? e.message : '만들지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="chdr">
        ④ DSD 만들기
        <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>
          채워 넣은 엑셀을 DSD 로 되돌립니다
        </span>
      </div>

      <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7, marginBottom: 12 }}>
        작년 DSD 를 <b>틀로 두고 글자만 갈아끼웁니다</b> — 표 너비·정렬·글꼴이 하나도 상하지 않습니다.

        <span style={{ color: 'var(--ink-3)' }}> 파일은 브라우저 안에서만 열립니다.</span>
      </div>

      <div className="frow"><span className="fl">작년 감사보고서</span>
        <div>
          <input type="file" accept=".dsd" style={{ fontSize: 'var(--fs-1)' }}
            onChange={(e) => void takeDsd(e.target.files?.[0])} />
          {dsd && <div style={{ fontSize: 'var(--fs-1)', color: 'var(--good)', marginTop: 3 }}>
            {dsd.name} · 주석 {dsd.blocks.length}개
          </div>}
        </div>
      </div>

      <div className="frow"><span className="fl">채워 넣은 엑셀</span>
        <div>
          <input type="file" accept=".xlsx" style={{ fontSize: 'var(--fs-1)' }}
            onChange={(e) => void takeXl(e.target.files?.[0])} />
          {xl && <div style={{ fontSize: 'var(--fs-1)', color: 'var(--good)', marginTop: 3 }}>
            {xl.name} · {Math.round(xl.bytes.length / 1024)}KB
          </div>}
        </div>
      </div>

      <div className="frow"><span className="fl">이월해서 만든 것</span>
        <label style={{ fontSize: 'var(--fs-2)' }}>
          <input type="checkbox" checked={roll} onChange={(e) => setRoll(e.target.checked)} />{' '}
          ② 에서 <b>「다음 해로 이월」을 켜고</b> 만든 파일입니다
        </label>
      </div>

      <div className="frow"><span className="fl">재무제표·표지</span>
        <label style={{ fontSize: 'var(--fs-2)', opacity: roll ? 1 : 0.5 }}>
          <input type="checkbox" checked={rollFs} disabled={!roll}
            onChange={(e) => setRollFs(e.target.checked)} />{' '}
          <b>기수·연도를 올리고 금액을 전기로 내립니다</b>
          <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-4)', marginTop: 2, lineHeight: 1.6 }}>
            「제 18(당) 기 2025년 12월 31일」 → 「제 19(당) 기 2026년 12월 31일」.
            <b> 본문 서술 속의 연도는 건드리지 않습니다</b> — 「2015년의 증자를 거쳐」를 바꾸면 안 되기 때문입니다.
            감사보고서 본문과 자본변동표는 손대지 않고 몇 곳인지 알려 드립니다.
          </div>
        </label>
      </div>

      {say && (
        <div style={{
          marginTop: 10, padding: '8px 11px', borderRadius: 'var(--r-sm)',
          background: 'var(--bad-bg)', color: 'var(--bad)', fontSize: 'var(--fs-2)', lineHeight: 1.6,
        }}>{say}</div>
      )}
      {done && (
        <div style={{
          marginTop: 10, padding: '9px 11px', borderRadius: 'var(--r-sm)',
          background: 'var(--good-bg)', color: 'var(--good)', fontSize: 'var(--fs-2)', lineHeight: 1.7,
        }}>
          {done}
          <div style={{ marginTop: 7, paddingTop: 7, borderTop: '1px solid currentColor', opacity: 0.85 }}>
            <b>다음에 할 일</b> — 내려받은 .dsd 를 <b>DART 편집기에서 열어</b> 확인하십시오.
            감사보고서 본문(의견·기간)과 자본변동표는 손대지 않았으니 거기서 고치시면 됩니다.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end', marginTop: 12 }}>
        <label style={{ fontSize: 'var(--fs-1)', color: force ? 'var(--bad)' : 'var(--ink-3)' }}>
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />{' '}
          안 채운 칸이 있어도 만들기
        </label>
        <button className="btn-p" disabled={busy} onClick={make}>
          {busy ? '만드는 중…' : 'DSD 내려받기'}
        </button>
      </div>
    </div>
  );
}
