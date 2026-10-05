// 주석·DSD 관리 › ② 중간감사 · 주석 엑셀 준비 — **감사 나가기 전에 만들어 두는 것 둘**
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
import { useEffect, useMemo, useState } from 'react';
import { unzipSync, zipSync } from 'fflate';
import { layoutIndex, INDEX_SHEET } from '../../lib/noteSheet';
import {
  pickAll, pickNotes, planNotes, sheetsToInject, isAnyNoteSheet, LONG_SHEET,
  type SheetLayout,
} from '../../lib/notePick';
import { findLinks, layoutTieSheet } from '../../lib/noteLink';
import { inheritFormulas } from '../../lib/noteInherit';
import { injectSheets } from '../../lib/xlsxInject';
import { readWorkbook, sheetNames, type SheetData } from '../../lib/xlsxRead';
import { removeSheets } from '../../lib/xlsxTransplant';
import { wtbSources, linkToWtb, linkListSheet, leftoverSheets } from '../../lib/noteWtbLink';
import { readLayout } from '../../lib/wtbRoll';
import { writeNotes, buildDsd, sheetsFromPlans, contentsOf } from '../../lib/dsdWrite';
import { rollStatements } from '../../lib/dsdRoll';
import { findEngagement, updateEngagement, type Engagement, type NoteRow } from '../../lib/dsdApi';
import { getNoteBook, noteBookBytes, type NoteBook } from '../../lib/dsdBookApi';
import { StepHead, Opt, Note, type LoadedDsd, type NoteFrom } from './DsdShell';
import { safeName, download } from './dsdUi';

export default function NotePrepareTab(
  { eng, notes, dsd, from, spare, layout, roll, canWrite, onStarted, onWtb }:
  {
    eng: Engagement; notes: NoteRow[]; dsd: LoadedDsd; from: NoteFrom; spare: number;
    layout: SheetLayout;
    /** 다음 해로 이월 — ②③④ 공통(DsdShell.WorkSettings) */ roll: boolean;
    /** 서버에 쓸 수 있나(건 상태를 「진행」으로) */ canWrite: boolean;
    /** 주석 엑셀을 내려받아 건이 「진행」이 되었을 때 — 목록 색을 다시 칠한다 */ onStarted: () => void;
    /** 📒 정산표 관리로(이 회사를 골라 둔 채) */ onWtb: () => void;
  },
) {
  const [wtb, setWtb] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [busy, setBusy] = useState('');
  const [say, setSay] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // 작년 건에 등록된 표준주석엑셀 — 있으면 수식을 이어받는다. 없으면 이 줄은 화면에 없다.
  const [prevBook, setPrevBook] = useState<NoteBook | null>(null);
  const [inherit, setInherit] = useState(true);
  // 올해 정산표 — 시트를 읽어 둔다(옛 작업 시트 빼기 · 당기 칸 미리 연결, 2026-10-05).
  const [book, setBook] = useState<SheetData[] | null>(null);
  const [drop, setDrop] = useState<Set<string>>(new Set());
  const [link, setLink] = useState(true);
  /** 정산표 표·보고서가 아닌 시트 — 빼기 후보. 남는 시트의 수식이 가리키면 뺄 수 없다. */
  const extras = useMemo(() => (book ? leftoverSheets(book, drop).filter((x) => !x.core) : []), [book, drop]);

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
    // 옛 작업 시트(지난 주석 시도·메모)는 처음부터 빼기로 골라 둔다 — 조서 번호 시트(2110A 등)와 다른 시트가 가리키는 것은 남긴다.
    try {
      const b = readWorkbook(bytes);
      setBook(b);
      // 정산표가 아닌 파일(회사 재무제표 등)을 넣는 일이 있다(2026-10-06 체험) — 알려만 준다.
      if (!b.some((sh) => readLayout(sh))) setSay('이 파일에서 정산표 표(WBS·WPL — 머리 「과목」, 「DR | CR」 묶음)를 찾지 못했습니다. 회사 재무제표가 아니라 📒 정산표 관리에서 만든 정산표를 넣으셨는지 보세요.');
      setDrop(new Set(leftoverSheets(b).filter((x) => !x.core && !x.refBy.length && !/^\d{4}[A-Z]/.test(x.name)).map((x) => x.name)));
    } catch { setBook(null); setDrop(new Set()); }
    // **이미 주석 시트가 있는 파일에 또 얹으면 시트가 두 벌이 된다** — 이름이 「N01 …(2)」가 된다.
    try {
      const had = sheetNames(bytes).filter((n) => isAnyNoteSheet(n) || /^대사표|^주석목록\(생성\)/.test(n)).length;
      if (had) {
        setSay(`이 파일에는 이미 주석 시트가 ${had}장 있습니다. 아래 「정산표에서 뺄 시트」에 골라 두었습니다`
          + ' — 남겨 두면 시트가 두 벌이 됩니다.');
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
      // 옛 작업 시트를 뺀 정산표 — 원본 파일은 그대로다(새 파일로 내려받는다).
      let base = wtb.bytes;
      const kept = (book ?? []).filter((x) => !drop.has(x.name));
      const blocked = extras.filter((x) => drop.has(x.name) && x.refBy.length);
      if (blocked.length) throw new Error(`${blocked.map((x) => `「${x.name}」(${x.refBy.join('·')} 가 가리킴)`).join(', ')} 는 뺄 수 없습니다.`);
      let dropped: string[] = [];
      if (drop.size) { const files = unzipSync(base); dropped = removeSheets(files, [...drop]); base = zipSync(files); }
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
          ...sheetNames(base), ...plans.map((x) => x.name), INDEX_SHEET, '대사표',
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

      // 당기 칸을 정산표에 미리 연결 — 작년 금액이 같은 정산표 줄의 당기 칸(noteWtbLink). 이어받은 수식이 있으면 그대로 둔다.
      let linked = 0, ambiguous = 0;
      const extra: ReturnType<typeof linkListSheet>[] = [];
      if (roll && link && kept.length) {
        const r = linkToWtb(plans, planNotes(p, false, spare, layout), wtbSources(kept, eng.fy - 1));
        plans = r.plans; linked = r.links.length; ambiguous = r.ambiguous;
        if (r.links.length) extra.push(linkListSheet(r.links));
      }

      const index = layoutIndex(p.map(({ title }, i) => ({
        no: i + 1, title, enabled: true, sheet: plans[i].name,
        // 종단형은 시트가 하나라 **몇 행인지**까지 가리켜야 한다.
        at: layout === 'long' ? `B${plans[i].cells.find((c) => c.kind === 'title')?.row ?? 2}` : undefined,
      })));
      // 목록이 **주석 1번 왼쪽**에 선다 — 맨 뒤에 있으면 스무 장을 지나 찾아가야 한다(2026-09-14).
      const out = injectSheets(base, [index, ...sheetsToInject(plans), layoutTieSheet(links), ...extra]);
      download(out, `${wtb.name.replace(/\.xlsx$/i, '')}_주석시트.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const yellow = plans.flatMap((x) => x.cells).filter((c) => c.kind === 'input').length;
      // 주석 엑셀을 내려받으면 그 회사는 「진행 중」(사용자 2026-10-05). 건 상태 「준비」 → 「진행」. 못 써도 내려받기는 된 것이다.
      if (canWrite && eng.status === '준비') void updateEngagement(eng.id, { status: '진행' }).then(onStarted).catch(() => undefined);
      setDone((layout === 'long'
        ? `주석 ${plans.length}개를 「${LONG_SHEET}」 시트 한 장에 세로로 내리고 목록 한 장을 그 앞에 두었습니다`
        : `주석 시트 ${plans.length}장을 얹고 목록 한 장을 그 앞에 두었습니다`)
        + ' — 목록의 제목을 누르면 그 주석으로, 주석 맨 위 「◀ 주석목록」을 누르면 목록으로 갑니다.'
        + (roll ? ` 당기 값을 전기로 밀고 채워 넣을 칸 ${yellow}개를 노랗게 두었습니다.` : '')
        + told
        + (linked ? ` 당기 칸 ${linked}개는 작년 금액이 같은 정산표 줄에 미리 연결했습니다(파란 칸 — 「정산표연결」 시트에 목록).`
          + (ambiguous ? ` ${ambiguous}칸은 같은 금액 줄이 여럿이라 비워 두었습니다.` : '') : '')
        + (dropped.length ? ` 정산표에서 ${dropped.join(' · ')} 시트를 뺐습니다.` : '')
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


  return (
    <div>
      <div className="card">
        <StepHead no="②" title="주석 엑셀 준비" when="중간감사"
          line={<>올해 <b>정산표</b>(중간감사 것이면 충분)를 넣으면 주석 시트를 얹은 엑셀을 줍니다. 현장에서는 <b>노란 칸</b>만 채우면 됩니다.</>}
          more={<>
            <b>가. 주석 엑셀</b> — 올해 정산표에 주석 시트·주석목록·대사표를 얹어 <b>새 파일</b>로 내려받습니다(원본은 그대로). 한 파일에 한 번만 얹으십시오.
            「당기 칸 미리 연결」을 켜 두면 작년 금액이 같은 정산표 줄의 당기 칸을 가리키는 수식이 파란 칸으로 들어가, 기말에 정산표만 갱신해도 주석이 따라옵니다.
            <br /><b>나. 사전작성 DSD</b> — 작년 것을 한 해 밀어(기수·연도↑, 재무제표 금액→전기, 당기 칸 비움) 편집기에서 이어 쓸 껍데기를 만듭니다. 정산표가 없어도 됩니다.
            ④ 완성본은 이 파일이 아니라 작년 감사보고서를 틀로 씁니다.
          </>}
        />
        {!roll && (
          <div style={{ fontSize: 'var(--fs-2)', color: 'var(--warn)', marginLeft: 38 }}>
            지금 「다음 해로 이월」이 꺼져 있습니다 — 작년 보고서를 그대로 옮긴 엑셀이 나옵니다(위 작업 설정).
          </div>
        )}
        {prevBook && (
          <div style={{ marginLeft: 38 }}>
            <Opt label="작년 수식" hint="주석 제목 → 행 라벨 → 열로 짝을 지어 수식만 가져옵니다(값은 안 가져옴). 올해 정산표의 시트 이름이 작년과 같아야 링크가 삽니다.">
              <label style={{ opacity: roll ? 1 : 0.5 }}>
                <input type="checkbox" checked={inherit} disabled={!roll} onChange={(e) => setInherit(e.target.checked)} />{' '}
                FY{eng.fy - 1} 표준주석엑셀(<b>{prevBook.fileName}</b>)의 수식을 노란 칸에 이어받기
              </label>
            </Opt>
          </div>
        )}
      </div>

      {say && <Note tone="bad">{say}</Note>}
      {done && <Note tone="good">{done}</Note>}

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'minmax(0, 3fr) minmax(280px, 2fr)', alignItems: 'start' }}>
        <div className="card">
          <div className="chdr">가. 주석 엑셀 <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>정산표에 주석 시트를 얹어 새 파일로</span></div>
          <Opt label="올해 정산표">
            <label className="btn-sm btn-sm-navy" style={{ cursor: 'pointer' }}>
              {wtb ? '다른 파일' : '파일 고르기'}
              <input type="file" accept=".xlsx" style={{ display: 'none' }} onChange={(e) => { void takeWtb(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {wtb
              ? <span style={{ marginLeft: 8, color: 'var(--good)' }}>✓ <b>{wtb.name}</b> · {Math.round(wtb.bytes.length / 1024)}KB</span>
              : <span style={{ marginLeft: 8, color: 'var(--ink-3)', fontSize: 'var(--fs-1)' }}>정산표 이월로 만든 중간 정산표를 그대로 넣으면 됩니다</span>}
            <button className="btn-sm" style={{ marginLeft: 8 }} onClick={onWtb} title="📒 정산표 관리 — 중간 이월 · 기말 갱신">📒 정산표 만들기 ›</button>
          </Opt>
          {extras.length > 0 && (
            <Opt label="뺄 시트" hint="정산표 표(WBS·WPL·WMS)·보고서·SCE·SCF·WCF·A500 이 아닌 시트입니다. 다른 시트의 수식이 가리키는 시트는 빼면 #REF! 가 되어 막아 둡니다. 원본 파일은 그대로입니다.">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
                {extras.map((x) => (
                  <label key={x.name} style={{ opacity: x.refBy.length && !drop.has(x.name) ? 0.55 : 1 }}
                    title={x.refBy.length ? `${x.refBy.join(' · ')} 시트의 수식이 이 시트를 가리킵니다` : ''}>
                    <input type="checkbox" checked={drop.has(x.name)} disabled={!!x.refBy.length && !drop.has(x.name)}
                      onChange={(e) => setDrop((d) => { const n = new Set(d); if (e.target.checked) n.add(x.name); else n.delete(x.name); return n; })} />{' '}
                    {x.name}{x.refBy.length > 0 && <span style={{ color: 'var(--ink-4)' }}> (← {x.refBy.join('·')})</span>}
                  </label>
                ))}
              </div>
              <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginTop: 3 }}>지난 주석 시도·메모 시트는 빼고 만드십시오.</div>
            </Opt>
          )}
          <Opt label="미리 연결" hint="작년 금액이 같은 정산표 줄(보고서BS·PL 먼저, 없으면 WBS·WPL)을 찾아 당기 칸에 수식을 겁니다. 같은 금액 줄이 여럿이거나 증감·기초·날짜 줄, 약정·현금흐름 주석은 노랗게 둡니다. 「정산표연결」 시트에 목록이 붙습니다.">
            <label style={{ opacity: roll ? 1 : 0.5 }}>
              <input type="checkbox" checked={link} disabled={!roll} onChange={(e) => setLink(e.target.checked)} />{' '}
              당기 칸을 정산표에 미리 연결 <span style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-1)' }}>(파란 칸 — 기말에 정산표만 고치면 따라옴)</span>
            </label>
          </Opt>
          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 10, borderTop: '1px solid var(--rule-2)' }}>
            <button className="btn-p" disabled={!!busy || !wtb} onClick={() => void makeSheet()}>
              {busy === 'sheet' ? '만드는 중…' : '주석 엑셀 내려받기'}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="chdr">나. 사전작성 DSD <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>편집기용 껍데기</span></div>
          <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7 }}>
            작년 보고서를 한 해 밀어 둡니다 — 민 자리는 <b style={{ color: 'var(--bad)' }}>붉게</b>. 정산표는 필요 없습니다.
          </div>
          <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', margin: '8px 0', fontFamily: 'var(--font-num)', wordBreak: 'break-all' }}>
            감사보고서_{safeName(eng.entityName)}_FY{eng.fy}_사전작성.DSD
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn-p" disabled={!!busy} onClick={makeDsd}>
              {busy === 'dsd' ? '만드는 중…' : '사전작성 DSD 내려받기'}
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7 }}>
        <b>다음</b> — 내려받은 엑셀의 <b>노란 칸</b>을 채웁니다(파란 칸은 정산표를 따라옴). 「대사표」 시트를 옆에 띄우면 맞아야 하는 숫자의 차이가 채우는 대로 0 이 됩니다.
        기말감사 때 다 채우면 <b>③ 검증</b>으로 오십시오.
      </div>
    </div>
  );
}
