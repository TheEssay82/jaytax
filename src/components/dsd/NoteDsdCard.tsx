// 주석·DSD 관리 › ④ DSD 만들기 — **완성본**
//
// 채워 넣은 엑셀의 글자를 **작년 DSD 제자리에 도로 넣어** 새 .dsd 를 만든다. 원본을 틀로 두고
// 글자만 갈아끼우므로 표 너비·정렬·글꼴이 하나도 상하지 않는다 — 아무것도 안 고치면 원본과
// 바이트 단위로 같다(명진·알티스트·넵튠 실측 2026-09-13).
//
// **기준선은 언제나 작년 DSD 다.** ② 가 만든 사전작성 DSD 를 여기에 넣지 않는다 — 그것은
// 나갈 때 들고 가는 곁가지 산출물이지 중간물이 아니다(사용자와 정리 2026-09-13).
//
// ⚠️ **안 채운 칸이 남아 있으면 만들지 않는다.** 작년 숫자가 올해 보고서로 나가는 것이
//    이 일에서 가장 큰 사고다.
//
// 만들고 나면 그 엑셀을 **표준주석엑셀로 등록**할 수 있다 — 완성본을 낸 파일이 곧 최종본이다.
import { useState } from 'react';
import { pickAll, pickNotes, planNotes, isNoteSheet, LAYOUT_LABEL, type SheetLayout } from '../../lib/notePick';
import { readWorkbook } from '../../lib/xlsxRead';
import { writeNotes, buildDsd, contentsOf } from '../../lib/dsdWrite';
import { rollStatements } from '../../lib/dsdRoll';
import type { Engagement, NoteRow } from '../../lib/dsdApi';
import { registerNoteBook, type NoteBook } from '../../lib/dsdBookApi';
import type { LoadedDsd, NoteFrom } from './DsdShell';
import type { Filled } from './NoteVerifyCard';
import { safeName, download } from './dsdUi';

export default function NoteDsdCard(
  { eng, notes, dsd, xl, setXl, from, spare, layout, book, onBook, readOnly }:
  {
    eng: Engagement; notes: NoteRow[]; dsd: LoadedDsd;
    xl: Filled | null; setXl: (v: Filled | null) => void; from: NoteFrom; spare: number;
    layout: SheetLayout; book: NoteBook | null; onBook: (b: NoteBook) => void; readOnly: boolean;
  },
) {
  const [roll, setRoll] = useState(true);
  const [rollFs, setRollFs] = useState(true);
  const [force, setForce] = useState(false);
  const [say, setSay] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [madeWith, setMadeWith] = useState<Filled | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  async function takeXl(f: File | undefined) {
    if (!f) return;
    setSay(null); setDone(null); setMadeWith(null); setSaved(null);
    setXl({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  }

  function make() {
    if (!xl) return setSay('채워 넣은 엑셀(.xlsx)을 고르세요.');
    setBusy(true); setSay(null); setDone(null); setMadeWith(null); setSaved(null);
    try {
      // ② 와 **같은 규칙으로** 골라야 시트 이름이 맞는다(DsdShell.NoteFrom · 작업 건의 시트 구성).
      const picked = from === 'file' ? pickAll(dsd.blocks) : pickNotes(dsd.blocks, notes);
      if (!picked.length) throw new Error('켜 둔 주석이 없습니다. ① 대상에서 골라 주세요.');
      const plans = planNotes(picked, roll, spare, layout);
      const sheets = readWorkbook(xl.bytes, (n) => isNoteSheet(n, layout));
      if (!sheets.length) {
        throw new Error(layout === 'long'
          ? '이 엑셀에 「주석(생성)」 시트가 없습니다. 이 건은 한 시트 종단형입니다 — ② 준비에서 만든 파일인지 보십시오.'
          : '이 엑셀에 주석 시트(N01 … 꼴)가 없습니다. ② 준비에서 만든 파일인지 보십시오.');
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
          + '먼저 ③ 검증으로 어디인지 보십시오. 그래도 만들려면 아래를 켜 주세요.'
          + ` (${r.blank.slice(0, 3).map((b) => b.at).join(' · ')}${r.blank.length > 3 ? ' …' : ''})`,
        );
        return;
      }

      download(buildDsd(dsd.bytes, r.xml),
        `감사보고서_${safeName(eng.entityName)}_FY${eng.fy}.DSD`, 'application/octet-stream');
      // **행을 짓거나 없앴으면 반드시 말해 준다.** 사람이 첫 열을 잘못 지워 줄이 사라지는
      // 일을 막을 유일한 방법이다 — 무엇이 없어졌는지 눈으로 보고 알아채야 한다.
      const rowTold = (r.added.length || r.removed.length)
        ? ` 행을 ${r.added.length ? `${r.added.length}줄 지었고(${r.added.slice(0, 5).join(' · ')}${r.added.length > 5 ? ' …' : ''})` : ''}`
          + `${r.added.length && r.removed.length ? ',' : ''}`
          + `${r.removed.length ? ` ${r.removed.length}줄 없앴습니다(${r.removed.slice(0, 5).join(' · ')}${r.removed.length > 5 ? ' …' : ''})` : ''}.`
          + ' 없앤 줄이 뜻밖이면 엑셀에서 첫 열이 지워졌는지 보십시오.'
        : '';
      setDone(
        `주석 ${r.changed}칸을 갈아끼워 새 DSD 를 만들었습니다.` + fsTold + rowTold
        + (r.blank.length ? ` 안 채운 칸 ${r.blank.length}개는 작년 글자가 그대로 남았습니다.` : '')
        + (r.skipped.length ? ` 손대지 못한 칸이 ${r.skipped.length}개 있습니다 — ${r.skipped[0].why}` : ''),
      );
      setMadeWith(xl);
    } catch (e) {
      setSay(e instanceof Error ? e.message : '만들지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  /** 완성본을 낸 그 엑셀을 표준주석엑셀로 — 내년 ② 가 수식을 이어받는다. */
  async function keep() {
    if (!madeWith) return;
    setSaving(true); setSaved(null);
    try {
      const b = await registerNoteBook(eng, madeWith);
      onBook(b);
      setSaved(`표준주석엑셀로 등록했습니다 — ${b.fileName}. FY${eng.fy + 1} 의 ② 가 이 파일의 수식을 이어받습니다.`);
    } catch (e) {
      setSay(e instanceof Error ? e.message : '등록하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="chdr">
        ④ DSD 만들기
        <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>
          검증이 끝난 엑셀로 완성본을 냅니다
        </span>
      </div>

      <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7, marginBottom: 12 }}>
        <b>작년 DSD 를 틀로 두고 글자만 갈아끼웁니다</b> — 표 너비·정렬·글꼴이 하나도 상하지 않습니다.
        <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginTop: 5 }}>
          ② 가 만든 <b>사전작성 DSD 는 여기에 넣지 않습니다</b> — 그것은 나갈 때 들고 가는 것이고,
          완성본은 언제나 <b>위에서 고른 작년 감사보고서</b>를 틀로 씁니다.
          {' '}시트 구성은 <b>{LAYOUT_LABEL[layout]}</b>으로 읽습니다(① 에서 정함).
        </div>
      </div>

      <div className="frow"><span className="fl">채워 넣은 엑셀</span>
        <div>
          <input type="file" accept=".xlsx" style={{ fontSize: 'var(--fs-1)' }}
            onChange={(e) => void takeXl(e.target.files?.[0])} />
          {xl ? (
            <div style={{ fontSize: 'var(--fs-1)', color: 'var(--good)', marginTop: 3 }}>
              {xl.name} · {Math.round(xl.bytes.length / 1024)}KB
            </div>
          ) : (
            <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-4)', marginTop: 3 }}>
              ③ 검증에서 고른 파일이 있으면 여기에도 그대로 잡힙니다.
            </div>
          )}
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
            <b> 본문 서술 속의 연도는 건드리지 않습니다.</b>
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
          {madeWith && !readOnly && (
            <div style={{ marginTop: 7, paddingTop: 7, borderTop: '1px solid currentColor', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>
                이 엑셀(<b>{madeWith.name}</b>)을 <b>표준주석엑셀</b>로 등록해 두면 FY{eng.fy + 1} 의 ② 가 수식을 이어받습니다.
                {book && <span style={{ opacity: 0.8 }}> 지금 등록된 것({book.fileName})을 바꿉니다.</span>}
              </span>
              <button className="btn-sm btn-sm-navy" style={{ marginLeft: 'auto' }} disabled={saving}
                onClick={() => void keep()}>
                {saving ? '올리는 중…' : book ? '표준주석엑셀 바꾸기' : '표준주석엑셀로 등록'}
              </button>
            </div>
          )}
          {saved && <div style={{ marginTop: 6 }}>{saved}</div>}
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
