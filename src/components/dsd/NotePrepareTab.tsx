// 주석·DSD 관리 › ② 준비 — **감사 나가기 전에 만들어 두는 것 둘**
//
//   가. 주석 서식 엑셀 — 올해 정산표에 노란 칸 서식과 대사표를 얹는다
//   나. 사전작성 DSD  — 작년 것을 한 해 밀어 껍데기만 만든다
//
// 둘 다 **감사 전 산출물**이라 한자리에 둔다. 전에는 나가 ④ 에 있어서 「④ 가 두 가지 일을
// 한다」는 혼란을 낳았다(사용자 지적 2026-09-13).
//
// 가 는 **작년에 등록한 표준주석엑셀**이 있으면 노란 칸에 그 수식을 이어받는다(noteInherit).
// 재무제표·TB 링크를 해마다 다시 걸지 않게 하려는 것이다(2026-09-14).
//
// ⚠️ **원본 정산표는 손대지 않는다.** 새 파일로 내려받는다.
import { useEffect, useState } from 'react';
import { layoutIndex, INDEX_SHEET } from '../../lib/noteSheet';
import {
  pickAll, pickNotes, planNotes, sheetsToInject, isAnyNoteSheet, LONG_SHEET, LAYOUT_LABEL,
  type SheetLayout,
} from '../../lib/notePick';
import { findLinks, layoutTieSheet } from '../../lib/noteLink';
import { inheritFormulas } from '../../lib/noteInherit';
import { injectSheets } from '../../lib/xlsxInject';
import { readWorkbook, sheetNames } from '../../lib/xlsxRead';
import { writeNotes, buildDsd, sheetsFromPlans, contentsOf } from '../../lib/dsdWrite';
import { rollStatements } from '../../lib/dsdRoll';
import { findEngagement, type Engagement, type NoteRow } from '../../lib/dsdApi';
import { getNoteBook, noteBookBytes, type NoteBook } from '../../lib/dsdBookApi';
import type { LoadedDsd, NoteFrom } from './DsdShell';
import { safeName, download } from './dsdUi';

export default function NotePrepareTab(
  { eng, notes, dsd, from, spare, layout }:
  {
    eng: Engagement; notes: NoteRow[]; dsd: LoadedDsd; from: NoteFrom; spare: number;
    layout: SheetLayout;
  },
) {
  const [wtb, setWtb] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [roll, setRoll] = useState(true);
  const [busy, setBusy] = useState('');
  const [say, setSay] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // 작년 건에 등록된 표준주석엑셀 — 있으면 수식을 이어받는다. 없으면 이 줄은 화면에 없다.
  const [prevBook, setPrevBook] = useState<NoteBook | null>(null);
  const [inherit, setInherit] = useState(true);

  useEffect(() => {
    let alive = true;
    setPrevBook(null);
    // 외부인 시연은 작년 건도 파일도 서버가 내주지 않는다 — 조용히 없는 것으로 둔다.
    void findEngagement(eng.entityId, eng.fy - 1, eng.scope)
      .then((prev) => (prev ? getNoteBook(prev.id) : null))
      .then((b) => { if (alive) setPrevBook(b); })
      .catch(() => { if (alive) setPrevBook(null); });
    return () => { alive = false; };
  }, [eng.entityId, eng.fy, eng.scope]);

  async function takeWtb(f: File | undefined) {
    if (!f) return;
    setSay(null); setDone(null);
    const bytes = new Uint8Array(await f.arrayBuffer());
    setWtb({ name: f.name, bytes });
    // **이미 주석 시트가 있는 파일에 또 얹으면 시트가 두 벌이 된다** — 이름이 「N01 …(2)」가 된다.
    try {
      const had = sheetNames(bytes).filter((n) => isAnyNoteSheet(n) || /^대사표|^주석목록\(생성\)/.test(n)).length;
      if (had) {
        setSay(`이 파일에는 이미 주석 시트가 ${had}장 있습니다. 그대로 만들면 시트가 두 벌이 됩니다`
          + ' — 주석 시트를 얹기 전의 원본 정산표를 넣으십시오.');
      }
    } catch { /* 못 읽어도 만들기는 해 본다 */ }
  }

  /**
   * 뜰 주석을 고른다.
   *
   * 보통은 ① 이 정한 목록이다 — 해마다 켜고 끈 것이 그대로 살아 있다. 다만 **① 목록과
   * 파일이 서로 남일 때**가 있다: 첫 해라 목록을 아직 안 세웠거나, 남의 보고서를 그냥
   * 떠 보는 자리다. 그때 제목으로 짝을 지으면 하나도 안 맞아 **빈 서식만 잔뜩** 나온다
   * (pickNotes 는 제목이 열쇠다). 그래서 파일에 든 것을 그대로 쓰는 길을 둔다.
   */
  function picked() {
    if (from === 'file') {
      const all = pickAll(dsd.blocks);
      if (!all.length) throw new Error('이 파일에서 주석을 찾지 못했습니다.');
      return all;
    }
    const p = pickNotes(dsd.blocks, notes);
    if (!p.length) throw new Error('켜 둔 주석이 없습니다. ① 대상에서 골라 주세요.');
    return p;
  }

  /** 가. 주석 서식 엑셀 */
  async function makeSheet() {
    if (!wtb) return setSay('올해 정산표 엑셀(.xlsx)을 고르세요.');
    setBusy('sheet'); setSay(null); setDone(null);
    try {
      const p = picked();
      const fresh = p.filter((x) => !x.note).map((x) => x.title);
      let plans = planNotes(p, roll, spare, layout);
      // 맞아야 하는 숫자 짝은 **작년 값이 든 배치**에서 배운다. 자리는 이월한 것과 같다.
      const links = findLinks(roll ? planNotes(p, false, spare, layout) : plans, dsd.fs);

      // 작년 표준주석엑셀의 수식을 노란 칸에 미리 넣는다.
      let told = '';
      if (roll && inherit && prevBook) {
        const old = readWorkbook(await noteBookBytes(prevBook), isAnyNoteSheet);
        const known = new Set([
          ...sheetNames(wtb.bytes), ...plans.map((x) => x.name), INDEX_SHEET, '대사표',
        ]);
        const r = inheritFormulas(plans, old, known);
        plans = r.plans;
        told = r.got
          ? ` 작년 표준주석엑셀(${prevBook.fileName})에서 수식 ${r.got}개를 이어받아 노란 칸에 넣었습니다`
            + `(주석 ${r.notes}개에서).`
            + (r.unknownSheets.length
              ? ` 다만 그 수식이 가리키는 시트 ${r.unknownSheets.slice(0, 4).join(' · ')}${r.unknownSheets.length > 4 ? ' …' : ''}`
                + ' 가 올해 정산표에 없습니다 — 엑셀에서 #REF! 로 보이니 시트 이름을 맞춰 주십시오.'
              : '')
          : ` 작년 표준주석엑셀(${prevBook.fileName})에서 이어받을 수식을 찾지 못했습니다`
            + (r.notes ? ' — 노란 칸에 수식이 아니라 값이 들어 있었던 것 같습니다.' : ' — 주석 제목이 하나도 맞지 않습니다.');
      }

      const index = layoutIndex(p.map(({ title }, i) => ({
        no: i + 1, title, enabled: true, sheet: plans[i].name,
        // 종단형은 시트가 하나라 **몇 행인지**까지 가리켜야 한다.
        at: layout === 'long' ? `B${plans[i].cells.find((c) => c.kind === 'title')?.row ?? 2}` : undefined,
      })));
      // 목록이 **주석 1번 왼쪽**에 선다 — 맨 뒤에 있으면 스무 장을 지나 찾아가야 한다(2026-09-14).
      const out = injectSheets(wtb.bytes, [index, ...sheetsToInject(plans), layoutTieSheet(links)]);
      download(out, `${wtb.name.replace(/\.xlsx$/i, '')}_주석시트.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const yellow = plans.flatMap((x) => x.cells).filter((c) => c.kind === 'input').length;
      setDone((layout === 'long'
        ? `주석 ${plans.length}개를 「${LONG_SHEET}」 시트 한 장에 세로로 내리고 목록 한 장을 그 앞에 두었습니다`
        : `주석 시트 ${plans.length}장을 얹고 목록 한 장을 그 앞에 두었습니다`)
        + ' — 목록의 제목을 누르면 그 주석으로, 주석 맨 위 「◀ 주석목록」을 누르면 목록으로 갑니다.'
        + (roll ? ` 당기 값을 전기로 밀고 채워 넣을 칸 ${yellow}개를 노랗게 두었습니다.` : '')
        + told
        + (links.length ? ` 맞아야 하는 숫자 짝 ${links.length}개를 「대사표」 시트에 걸어 두었습니다.` : '')
        + (fresh.length ? ` 그 가운데 ${fresh.length}개는 작년 보고서에 없어 빈 서식으로 두었습니다 — ${fresh.join(' · ')}` : ''));
    } catch (e) {
      setSay(e instanceof Error ? e.message : '만들지 못했습니다.');
    } finally {
      setBusy('');
    }
  }

  /** 나. 사전작성 DSD — 엑셀 없이 작년 것을 한 해 민다 */
  function makeDsd() {
    setBusy('dsd'); setSay(null); setDone(null);
    try {
      const p = picked();
      const plans = planNotes(p, true, spare, layout);
      let xml = contentsOf(dsd.bytes);
      const skip = new Set<number>();
      for (const x of plans) for (const b of x.back ?? []) skip.add(b.slot);
      // 민 자리를 붉게 — 무엇이 바뀌었는지 편집기에서 바로 보인다.
      const rolled = rollStatements(xml, 1, skip, true);
      xml = rolled.xml;
      const r = writeNotes(xml, plans, sheetsFromPlans(plans));
      download(buildDsd(dsd.bytes, r.xml),
        `감사보고서_${safeName(eng.entityName)}_FY${eng.fy}_사전작성.DSD`, 'application/octet-stream');

      const why = new Map<string, number>();
      for (const l of rolled.leftovers) why.set(l.why, (why.get(l.why) ?? 0) + 1);
      setDone(`작년 것을 한 해 밀어 빈 서식을 만들었습니다 — 주석 ${r.changed}칸 · `
        + `기수·연도 ${rolled.terms}칸 · 재무제표 금액 ${rolled.amounts}칸. `
        + '기수·연도를 민 자리는 붉은 글자로 표시했습니다.'
        + (why.size ? ` 다만 ${[...why].map(([k, v]) => `${v}곳은 ${k}`).join(', ')} — 편집기에서 보십시오.` : ''));
    } catch (e) {
      setSay(e instanceof Error ? e.message : '만들지 못했습니다.');
    } finally {
      setBusy('');
    }
  }

  const on = notes.filter((n) => n.enabled).length;

  return (
    <div>
      <div className="card">
        <div className="chdr">
          ② 준비
          <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>
            감사 나가기 전에 만들어 둡니다
          </span>
        </div>
        <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7 }}>
          <b>주석 서식 엑셀</b>과 <b>사전작성 DSD</b> 둘을 냅니다. 현장에서는 엑셀의 노란 칸만
          채우시면 되고, DSD 는 껍데기라 편집기에서 이어 작업하실 수 있습니다.
          <span style={{ color: 'var(--ink-3)' }}>
            {' '}주석 {from === 'file' ? `${dsd.blocks.length}개(파일에 든 것 전부)` : `${on}개(① 에서 켜 둔 것)`}
            {' '}· 금액은 {eng.moneyUnit} 단위로 적힌 그대로 · 시트 구성은 <b>{LAYOUT_LABEL[layout]}</b>(① 에서 정함)
          </span>
        </div>

        <div className="frow" style={{ marginTop: 10 }}><span className="fl">다음 해로 이월</span>
          <label style={{ fontSize: 'var(--fs-2)' }}>
            <input type="checkbox" checked={roll} onChange={(e) => setRoll(e.target.checked)} />{' '}
            <b>당기 값을 전기로 밀고, 당기 칸은 비워 노랗게</b>
            <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-4)', marginTop: 2 }}>
              끄면 작년 보고서를 그대로 옮깁니다 — 작년 것을 확인할 때 씁니다. ③ 검증에서도 같게 두십시오.
            </div>
          </label>
        </div>

        {prevBook && (
          <div className="frow"><span className="fl">작년 수식</span>
            <label style={{ fontSize: 'var(--fs-2)', opacity: roll ? 1 : 0.5 }}>
              <input type="checkbox" checked={inherit} disabled={!roll} onChange={(e) => setInherit(e.target.checked)} />{' '}
              <b>FY{eng.fy - 1} 표준주석엑셀의 수식을 노란 칸에 이어받기</b>
              <span style={{ color: 'var(--ink-3)' }}> — {prevBook.fileName}</span>
              <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-4)', marginTop: 2, lineHeight: 1.6 }}>
                주석 제목 → 행 라벨 → 열로 짝을 지어 <b>수식만</b> 가져옵니다. 값은 가져오지 않습니다.
                올해 정산표의 시트 이름이 작년과 같아야 링크가 삽니다.
              </div>
            </label>
          </div>
        )}
      </div>

      {say && (
        <div className="card" style={{ background: 'var(--bad-bg)', color: 'var(--bad)', fontSize: 'var(--fs-2)', lineHeight: 1.6 }}>
          {say}
        </div>
      )}
      {done && (
        <div className="card" style={{ background: 'var(--good-bg)', color: 'var(--good)', fontSize: 'var(--fs-2)', lineHeight: 1.7 }}>
          {done}
        </div>
      )}

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <div className="card">
          <div className="chdr">가. 주석 서식 엑셀</div>
          <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7, marginBottom: 10 }}>
            올해 정산표에 <b>주석 시트와 대사표</b>를 얹습니다. <b>원본은 손대지 않고</b> 새 파일로
            내려받습니다. <b>한 파일에 한 번만</b> 얹으십시오.
          </div>
          <div className="frow"><span className="fl">올해 정산표</span>
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
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="btn-p" disabled={!!busy} onClick={() => void makeSheet()}>
              {busy === 'sheet' ? '만드는 중…' : '주석 시트 얹은 엑셀 내려받기'}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="chdr">나. 사전작성 DSD</div>
          <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7, marginBottom: 10 }}>
            작년 것을 <b>한 해 밀어</b> 껍데기를 만듭니다 — 기수·연도를 올리고, 재무제표 금액을
            전기로 내리고, 당기 칸을 비웁니다. <b>민 자리는 붉게</b> 표시합니다.
            <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-4)', marginTop: 5 }}>
              정산표가 없어도 됩니다 — 작년 감사보고서 하나로 만듭니다.
            </div>
          </div>
          <div className="frow"><span className="fl">나올 이름</span>
            <span style={{ fontSize: 'var(--fs-1)', fontFamily: 'var(--font-num)' }}>
              감사보고서_{safeName(eng.entityName)}_FY{eng.fy}_사전작성.DSD
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="btn-p" disabled={!!busy} onClick={makeDsd}>
              {busy === 'dsd' ? '만드는 중…' : '사전작성 DSD 내려받기'}
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7 }}>
        <b>다음에 할 일</b> — 내려받은 엑셀을 열어 <b>노란 칸</b>을 채웁니다. 대개 재무제표 시트에서
        링크를 겁니다. <b>「대사표」 시트</b>를 옆에 띄워 두시면 맞아야 하는 숫자의 「차이」가 채우는
        대로 0 이 됩니다. 다 채우면 <b>③ 검증</b>으로 오십시오. 검증까지 마친 엑셀은 ① 에
        <b> 표준주석엑셀</b>로 등록해 두면 내년에 수식을 이어받습니다.
      </div>
    </div>
  );
}
