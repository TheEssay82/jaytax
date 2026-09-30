// 웹 조서 입력 창 — 조서마다 폼을 띄우고 [임시 저장] · [확인]. 엑셀 반영은 [N차 확정] 때 단계째 한꺼번에(판 하나).
// 확정 전에 보고 싶으면 [엑셀 미리보기](판을 만들지 않는다).
//
// 처음 여는 조서는 최신 판(이월본)의 시트에서 작년 값을 읽어 채운다. 옛 모양 시트도 읽는다.
// 반영할 때 시트가 올해 양식 모양이 아니면(명진 2700A-2(소규모)) 표준양식으로 갈아끼운 뒤 쓴다.
import { useEffect, useState } from 'react';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
import { unzipSync, strFromU8 } from 'fflate';
import type { Engagement } from '../../lib/dsdApi';
import { listBooks, addBook, fileBytes, borrowedBooks, type GwpTemplate } from '../../lib/gwpApi';
import { readWorkbook, type SheetData } from '../../lib/xlsxRead';
import { buildCatalog } from '../../lib/gwpCatalog';
import { pickSheet } from '../../lib/gwpWeb';
import { applyWebPapers } from '../../lib/gwpApply';
import { readBundle } from '../../lib/gwpTemplate';
import { parseStatements, statementsUnit } from '../../lib/fsParse';
import { savePaper, markApplied, markChecked, setPaperStatus, latestFile, borrowCandidates, type PaperRow, type EngFile, type BorrowCandidate } from '../../lib/gwpStageApi';
import { amountsFromWtb } from '../../lib/gwpFiles';
import { download } from '../dsd/dsdUi';
import { STAGES } from '../../lib/gwpStage';
import type { WebPaperEntry } from '../../lib/gwpWebPapers';
import type { Paper2110A } from '../../lib/gwpPaper2110A';
import { amountsFromFs, decidedMateriality, type Paper2700, type Paper2700A1 } from '../../lib/gwpPaper2700A';
import Form2110A from './Form2110A';
import Form2110 from './Form2110';
import Form2120A from './Form2120A';
import Form8110 from './Form8110';
import Form2301 from './Form2301';
import FormQA from './FormQA';
import { withDraft, QA_DRAFTS, fsFacts, blanksLeft, BLANK, type PaperQA, type FsFact } from '../../lib/gwpPaperQA';
import { readLibrary, type Paper2301, type LibCase } from '../../lib/gwpPaper2301';
import { PAPER_2301G, readExamples, type Paper2301G, type FsRisk } from '../../lib/gwpPaper2301G';
import Form2301G from './Form2301G';
import type { AuditBasis } from '../../lib/gwpSetup';
import { fillFromWtb, type Paper8110, type WtbReport } from '../../lib/gwpPaper8110';
import { fillFromFs, balance, PAPER_2120A, isBlank2120, fromBorrowed, placeUnplaced, type Paper2120A, type FillReport } from '../../lib/gwpPaper2120A';
import type { Paper2110 } from '../../lib/gwpPaper2110';
import { guessIndustry, missingProcs, type ProcStd } from '../../lib/gwpProcStd';
import { listProcStd } from '../../lib/gwpProcStdApi';
import { listYears, saveYearIndustry } from '../../lib/gwpYearApi';
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
  const [wtbRep, setWtbRep] = useState<WtbReport | null>(null);
  /** 📎 엑셀로 넘긴 조서 — 엑셀이 정본, 웹은 읽기만 */
  const handedOff = saved?.status === '엑셀로 넘김';
  const readOnly = locked || !canWrite || handedOff;
  const prevCode = PREV_STAGE[def.code];
  const prevSaved = prevCode ? papers.get(prevCode) : undefined;
  // 2520·2530 초안 재료 — 저장한 2120A(없으면 판의 2120A 시트), 짝 조서에서 고른 「회계처리를 누가」.
  const saved2120 = papers.get('2120A')?.data as Paper2120A | undefined;
  const pairKeeper = (papers.get(def.code === '2520' ? '2530' : '2520')?.data as PaperQA | undefined)?.keeper ?? null;
  const [qaFs, setQaFs] = useState<FsFact[] | null>(null);

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
        let fsl: FsFact[] | null = null;
        if (QA_DRAFTS[def.code]) {
          const s2120 = pickSheet(PAPER_2120A, sheets);
          fsl = fsFacts(saved2120) ?? (s2120 ? fsFacts(PAPER_2120A.read(s2120)) : null);
          setQaFs(fsl);
        }
        if (saved?.data != null) {
          if (def.code === '2120A' && s) {
            // 저장 뒤에 생긴 칸(부분 sec · 분류 group)은 시트에서 채운다.
            const by = new Map((def.read(s) as Paper2120A).rows.map((r) => [r.key, r]));
            setData((cur: unknown) => { const d = (cur ?? saved.data) as Paper2120A; return { ...d, rows: d.rows.map((r) => ({ ...r, sec: r.sec ?? by.get(r.key)?.sec, group: r.group ?? by.get(r.key)?.group })) }; });
          }
          return;
        }
        let d: unknown;
        if (prevSaved?.data != null) { d = structuredClone(prevSaved.data); setNote(`${prevCode}(앞 단계)에 저장한 값에서 시작합니다.`); }
        else if (s) {
          d = def.readBook ? def.readBook(sheets) : def.read(s);
          setNote('작년(이월본) 값을 불러왔습니다 — 올해 것으로 고치세요.');
          // 질문·기재형(소규모 2520·2530) — 빈 칸은 초안으로(사용자 2026-09-28 「지금 초안을 반영해 주세요」).
          if (QA_DRAFTS[def.code]) {
            d = { ...withDraft(d as PaperQA, QA_DRAFTS[def.code]({ fs: fsl, keeper: pairKeeper }), author), keeper: pairKeeper };
            setNote(`빈 칸을 초안으로 채웠습니다${pairKeeper ? '' : ' — 맨 위에서 「회계처리는 누가?」를 고르면 문장이 맞춰집니다'}. 회사 사실과 맞는지 확인하고 [확인]을 누르세요.`);
          }
          // 2120A 가 숨긴 빈 양식뿐이면 「틀 빌리기」 안내가 대신 뜬다.
          if (s.hidden && def.code !== '2120A') setErr(`${s.name} 시트가 숨겨져 있습니다 — ① 올해 파일의 「소규모 짝 정리」를 먼저 하세요.`);
        }
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
  }, [eng.id, def, saved?.data, prevSaved?.data, prevCode, author, saved2120, pairKeeper]);

  const change = (d: unknown) => { setData(d); setDirty(true); };

  // 2301 — 올해 양식의 「참고자료」(계정별 왜곡표시위험 사례).
  const [lib2301, setLib2301] = useState<LibCase[]>([]);
  /** 일반·K-IFRS 2301 — 양식의 작성 예시 줄 */
  const [ex2301, setEx2301] = useState<FsRisk[]>([]);
  useEffect(() => {
    if (def.code !== '2301' || !tpl) return;
    let off = false;
    void (async () => {
      const { catalog, files: tf } = readBundle(await fileBytes(tpl.storagePath));
      const t = catalog.sheets.find((s) => s.code?.replace(/\(.*$/, '') === '2301' && !s.hidden);
      const s = t ? readWorkbook(tf[t.file]).find((x) => x.name === t.name) : null;
      if (!off && s) { setLib2301(readLibrary(s)); setEx2301(readExamples(s)); }
    })().catch(() => undefined);
    return () => { off = true; };
  }, [def.code, tpl]);

  async function save() {
    setBusy('save'); setErr(null);
    try {
      await savePaper(eng.id, def.code, with2120(data));
      setDirty(false);
      await onChanged(`${def.code} ${def.title}을 저장했습니다 — 아직 엑셀에는 반영하지 않았습니다.`);
    } catch (e) { setErr(e instanceof Error ? e.message : '저장하지 못했습니다.'); } finally { setBusy(''); }
  }

  /** 최신 판에 이 조서를 써 넣은 바이트 — 미리보기·엑셀로 넘기기가 쓴다(확정은 보드가 단계째 한꺼번에). */
  async function build() {
    const base = (await listBooks(eng.id))[0];
    if (!base) throw new Error('조서 판이 없습니다.');
    const template = tpl ? { ...readBundle(await fileBytes(tpl.storagePath)), reviewer: partner } : undefined;
    const r = applyWebPapers(await fileBytes(base.storagePath), [{ def, data }], template, await borrowedBooks([{ def, data }]));
    if (r.missing.length) throw new Error(`최신 판(v${base.version})에 ${def.sheetCode} 시트가 없고 표준양식에서도 찾지 못했습니다.`);
    return { base, r };
  }

  /** 확인 — 저장하고 「확인」으로 둔다. 엑셀·판 번호는 그대로([N차 확정] 때 한꺼번에). */
  async function check() {
    if (def.code === '2120A') {
      for (const w of ['prev', 'cur'] as const) {
        const b = balance((data as Paper2120A).rows, w);
        if (b && Math.abs(b.diff) >= 1 && !confirm(`${w === 'prev' ? '전기' : '당기'} 자산이 부채+자본과 ${b.diff.toLocaleString('ko-KR')}원 다릅니다.\n그래도 확인할까요?`)) return;
      }
      // Material·Unexpected 가 떴는데 주요 감사절차가 빈 줄(사용자 2026-09-30).
      const miss = missingProcs(data as Paper2120A, om2120);
      if (miss.length) { setErr(`판정(Material·Unexpected)이 났는데 주요 감사절차가 빈 줄 ${miss.length}개 — ${miss.slice(0, 6).join(', ')}${miss.length > 6 ? ' …' : ''}. 적거나 [표준 절차 넣기]를 누르세요.`); return; }
      if (om2120 == null && (data as Paper2120A).hasProc && !confirm('2700A-2 중요성이 아직 없어 Material·Unexpected 판정을 못 했습니다.\n그래도 확인할까요? (2700A-2 를 확인한 뒤 다시 보는 것을 권합니다)')) return;
    }
    if (QA_DRAFTS[def.code] && blanksLeft(data as PaperQA)) { setErr(`${BLANK} 자리가 ${blanksLeft(data as PaperQA)}곳 남았습니다 — 채우고 [확인]하세요(빨간 칸).`); return; }
    setBusy('check'); setErr(null);
    try {
      await markChecked(eng.id, def.code, with2120(data));
      setDirty(false);
      await onChanged(`${def.code} ${def.title}을 확인했습니다 — [${stage.label}] 때 다른 조서와 함께 엑셀에 반영됩니다.`);
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : '확인하지 못했습니다.'); } finally { setBusy(''); }
  }

  /** 엑셀 미리보기 — 판을 만들지 않고, 이 조서를 써 넣은 파일을 내려받는다. */
  async function preview() {
    setBusy('preview'); setErr(null);
    try {
      const { base, r } = await build();
      download(r.bytes, `미리보기_${def.code}_v${base.version}.xlsx`, XLSX);
      setNote(`미리보기를 내려받았습니다 — 판은 만들지 않았습니다(바뀐 칸 ${r.done[0]?.changed ?? 0}개 노랑).`);
    } catch (e) { setErr(e instanceof Error ? e.message : '미리보기를 만들지 못했습니다.'); } finally { setBusy(''); }
  }

  /** 📎 — 별도조서를 붙일 조서. 지금 엑셀에 써 넣은 판을 만들고 정본을 엑셀로 넘긴다. */
  async function handOff() {
    if (!confirm(`${def.code} ${def.title}을 지금 엑셀에 써 넣은 새 판을 만들고, 이 조서의 정본을 엑셀로 넘깁니다.\n그 판을 내려받아 별도조서를 붙이고 「채운 파일 올리기」로 올리세요.`)) return;
    setBusy('hand'); setErr(null);
    try {
      const { r } = await build();
      const book = await addBook(eng.id, '작업중', { name: `일반조서_${eng.entityName}_FY${eng.fy}_${def.code}_엑셀로.xlsx`, bytes: r.bytes },
        buildCatalog(readWorkbook(r.bytes)), `📎 엑셀로 넘김: ${def.code} ${def.title} — 별도조서를 붙여 올릴 판`);
      await markApplied(eng.id, def.code, data, book.version);
      await setPaperStatus(eng.id, def.code, '엑셀로 넘김');
      download(r.bytes, book.fileName, XLSX);
      await onChanged(`${def.code} ${def.title}을 엑셀로 넘겼습니다 — v${book.version}을 내려받았습니다. 별도조서를 붙여 「채운 파일 올리기」로 올리세요.`);
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : '넘기지 못했습니다.'); } finally { setBusy(''); }
  }

  /** 웹으로 되돌리기 — 엑셀의 지금 값을 웹으로 읽어 온다. */
  async function takeBack() {
    setBusy('back'); setErr(null);
    try {
      const books = await listBooks(eng.id);
      const sheets = readWorkbook(await fileBytes(books[0].storagePath));
      const s = pickSheet(def, sheets);
      const d = s ? (def.readBook ? def.readBook(sheets) : def.read(s)) : data;
      await setPaperStatus(eng.id, def.code, '작성중', d);
      await onChanged(`${def.code} ${def.title}을 웹으로 되돌렸습니다 — 엑셀(v${books[0].version})의 지금 값을 읽어 왔습니다.`);
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : '되돌리지 못했습니다.'); } finally { setBusy(''); }
  }

  /** 2700A-3(수정전 정산표)·2700A-4(확정 정산표) 기준 금액 — 사용자 2026-09-27 「2차는 기말감사 전 숫자(수정전)」. */
  async function fillFromWtbTotals(kind: '수정전정산표' | '정산표') {
    const f = latestFile(files, kind, eng.fy);
    if (!f) return;
    setBusy('wtbm'); setErr(null);
    try {
      const sheets = readWorkbook(await fileBytes(f.storagePath), (n) => /^W(BS|PL)$/i.test(n.replace(/\s/g, '')));
      const side = kind === '수정전정산표' ? 'left' : 'right';
      const { amounts, cols } = amountsFromWtb(sheets, eng.periodTo ?? `${eng.fy}-12-31`, side);
      const n = Object.keys(amounts).length;
      if (!n) throw new Error(`정산표에서 ${eng.periodTo ?? eng.fy} 결산일 열이나 자산총계·자본총계·영업수익·세전이익 줄을 찾지 못했습니다.`);
      const d = data as Paper2700;
      change({ ...d, amounts: { ...d.amounts, ...amounts } });
      setNote(`${kind === '수정전정산표' ? '수정전' : '확정(수정후)'} 정산표(${f.fileName}) ${side === 'left' ? '수정전' : '수정후'} 열(WBS ${cols.WBS ?? '-'} · WPL ${cols.WPL ?? '-'})에서 ${n}개 금액을 백만원으로 채웠습니다.`);
    } catch (e) { setErr(e instanceof Error ? e.message : '읽지 못했습니다.'); } finally { setBusy(''); }
  }

  /** 자료함의 전기 DSD 재무제표. */
  async function dsdLines() {
    const f = latestFile(files, '전기DSD', eng.fy)!;
    const z = unzipSync(await fileBytes(f.storagePath));
    if (!z['contents.xml']) throw new Error('DSD 안에 본문이 없습니다.');
    const xml = strFromU8(z['contents.xml']);
    // 재무제표의 「(단위 : 원)」 — 작업 건 설정(천원)과 다를 수 있다(아비즈). 못 찾으면 원으로 본다.
    return { f, lines: parseStatements(xml), unit: statementsUnit(xml) ?? 1 };
  }

  /** 빌린 틀 — 전기 DSD 로 전기·당기 두 열을 채우고, 틀에 없는 계정은 알맞은 분류 끝에 새 줄로. */
  async function fillBorrowed(d: Paper2120A): Promise<{ data: Paper2120A; report: FillReport; placed: number; fileName: string }> {
    const { f, lines, unit } = await dsdLines();
    const r = fillFromFs(d, lines, { both: true, scale: unit });
    const p = placeUnplaced(r.data, lines, unit);
    return { data: p.data, report: fillFromFs(p.data, lines, { both: true, scale: unit }).report, placed: p.placed.length, fileName: f.fileName };
  }

  /** 2120A 당기 열을 전기 DSD 로. 손으로 고친 줄은 둔다. 빌린 틀이면 두 열 모두. */
  async function fill2120() {
    setBusy('dsd'); setErr(null);
    try {
      const d = data as Paper2120A;
      if (d.borrow) {
        const b = await fillBorrowed(d);
        change(b.data); setFillRep(b.report);
        setNote(`전기 DSD(${b.fileName})로 전기·당기 두 열을 채웠습니다${b.placed ? ` — 틀에 없던 계정 ${b.placed}개는 분류 끝에 새 줄로 넣었습니다` : ''}.`);
        return;
      }
      const { f, lines } = await dsdLines();
      const r = fillFromFs(d, lines);
      change(r.data);
      setFillRep(r.report);
      setNote(`전기 DSD(${f.fileName})로 당기 열을 채웠습니다.`);
    } catch (e) { setErr(e instanceof Error ? e.message : '읽지 못했습니다.'); } finally { setBusy(''); }
  }

  // 2120A 주요 감사절차 — 판정 기준 = 2700A-2 계획단계 중요성(원), 표준 절차 표, 업종(사용자 2026-09-30).
  const mat2700 = papers.get('2700A-2')?.data as Paper2700 | undefined;
  const omM = mat2700 ? decidedMateriality(mat2700) : null;           // 백만원
  const om2120 = omM != null ? omM * 1e6 : null;
  const pm2120 = om2120 != null ? om2120 * (mat2700?.pmRate ?? 0.75) : null;
  const [procStd, setProcStd] = useState<ProcStd[]>([]);
  const [industry, setIndustry] = useState<string | null>(null);
  const [industryGuessed, setIndustryGuessed] = useState(false);
  useEffect(() => {
    if (def.code !== '2120A') return;
    let off = false;
    void (async () => {
      const [std, years] = await Promise.all([listProcStd(), listYears()]);
      if (off) return;
      setProcStd(std);
      const saved = years.get(eng.id)?.industry ?? null;
      if (saved) { setIndustry(saved); setIndustryGuessed(false); return; }
      // 추정 — 2120A 계정 + 전기 DSD 재무제표 과목(2120A 에는 「재고자산」 한 줄뿐인 회사가 많다).
      let labels = ((data as Paper2120A | null)?.rows ?? []).map((r) => r.label);
      if (latestFile(files, '전기DSD', eng.fy)) { try { labels = [...labels, ...(await dsdLines()).lines.map((l) => l.label)]; } catch { /* DSD 못 읽으면 2120A 만 */ } }
      if (!off) { setIndustry(guessIndustry(labels, eng.entityName)); setIndustryGuessed(true); }
    })().catch(() => undefined);
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.code, eng.id, files]);
  async function pickIndustry(v: string) {
    setIndustry(v); setIndustryGuessed(false);
    try { await saveYearIndustry(eng.id, v); } catch (e) { setErr(e instanceof Error ? e.message : '업종을 저장하지 못했습니다.'); }
  }
  /** 저장·확인할 2120A — 판정 기준 중요성을 함께 담는다(반영 때 시트의 Overall·Planning Materiality 칸에 쓴다). */
  const with2120 = (d: unknown) => (def.code === '2120A' && d ? { ...(d as Paper2120A), om: om2120, pm: pm2120 } : d);

  // 2120A 가 빈 양식이면(작년에 안 씀) — 다른 회사 틀 빌리기(사용자 2026-09-30).
  const [cands, setCands] = useState<BorrowCandidate[] | null>(null);
  const [candPick, setCandPick] = useState('');
  const blank2120 = def.code === '2120A' && data != null && isBlank2120(data as Paper2120A);
  useEffect(() => {
    if (!blank2120 || cands) return;
    void borrowCandidates('2120A', eng.id).then((c) => { setCands(c); setCandPick(c[0]?.engagementId ?? ''); }).catch(() => setCands([]));
  }, [blank2120, cands, eng.id]);

  async function borrow2120() {
    const c = cands?.find((x) => x.engagementId === candPick);
    if (!c) return;
    setBusy('borrow'); setErr(null);
    try {
      const book = (await listBooks(c.engagementId))[0];
      if (!book) throw new Error(`${c.entity} 에 조서 판이 없습니다.`);
      const s = pickSheet(PAPER_2120A, readWorkbook(await fileBytes(book.storagePath)));
      if (!s || s.hidden) throw new Error(`${c.entity} v${book.version} 에 보이는 2120A 시트가 없습니다.`);
      let d = fromBorrowed(s, { engagementId: c.engagementId, entity: c.entity, version: book.version, sheet: s.name });
      if (d.rows.length < 10) throw new Error(`${c.entity} 2120A 에 계정 줄이 ${d.rows.length}개뿐입니다 — 다른 회사를 고르세요.`);
      let msg = `${c.entity}(FY${c.fy}) v${book.version} 의 2120A 틀을 빌렸습니다 — 그 회사 금액·비고는 비웠습니다.`;
      if (dsd) {
        const b = await fillBorrowed(d);
        d = b.data; setFillRep(b.report);
        msg += ` 전기 DSD 로 전기·당기 두 열을 채웠고${b.placed ? `, 틀에 없던 계정 ${b.placed}개는 분류 끝에 새 줄로 넣었습니다` : ''}. 자산 = 부채 + 자본을 확인하세요.`;
      } else msg += ' 자료함에 전기 DSD 를 올리고 [전기 DSD 로 채우기]를 누르세요.';
      change(d); setNote(msg);
    } catch (e) { setErr(e instanceof Error ? e.message : '빌리지 못했습니다.'); } finally { setBusy(''); }
  }

  /** 8110ARP 당기(와 링크였던 전기)를 자료함의 확정 정산표로. */
  async function fill8110() {
    const f = latestFile(files, '정산표', eng.fy);
    if (!f) return;
    setBusy('wtb'); setErr(null);
    try {
      const wtb = readWorkbook(await fileBytes(f.storagePath), (n) => /^W(BS|PL)$/i.test(n.replace(/\s/g, '')));
      if (!wtb.length) throw new Error('정산표에서 WBS·WPL 시트를 찾지 못했습니다.');
      const r = fillFromWtb(data as Paper8110, wtb, eng.periodTo ?? `${eng.fy}-12-31`);
      if (!r.report.curCol.BS && !r.report.curCol.PL) throw new Error(`정산표 머리에서 ${eng.periodTo ?? eng.fy} 결산일 열을 찾지 못했습니다 — 올해 확정 정산표가 맞는지 보세요.`);
      change(r.data);
      setWtbRep(r.report);
      setNote(`확정 정산표(${f.fileName})로 채웠습니다.`);
    } catch (e) { setErr(e instanceof Error ? e.message : '읽지 못했습니다.'); } finally { setBusy(''); }
  }

  /** 자료함의 전기 DSD 에서 기준 금액을 채운다(백만원). */
  async function fillFromDsd() {
    const f = latestFile(files, '전기DSD', eng.fy);
    if (!f) return;
    setBusy('dsd'); setErr(null);
    try {
      const z = unzipSync(await fileBytes(f.storagePath));
      if (!z['contents.xml']) throw new Error('DSD 안에 본문이 없습니다.');
      const xml = strFromU8(z['contents.xml']);
      // 단위는 DSD 재무제표 표기로(작업 건 설정은 틀릴 수 있다 — 아비즈 설정 천원·DSD 원, 2026-09-30).
      const u = statementsUnit(xml);
      const got = amountsFromFs(parseStatements(xml), u === 1 ? '원' : u === 1000 ? '천원' : eng.moneyUnit);
      const n = Object.keys(got).length;
      if (!n) throw new Error('전기 DSD 재무제표에서 자산총계·자본총계·매출액·세전이익을 찾지 못했습니다.');
      const d = data as Paper2700;
      change({ ...d, amounts: { ...d.amounts, ...got } });
      setNote(`전기 DSD(${f.fileName})에서 ${n}개 금액을 채웠습니다 — ${eng.moneyUnit} 단위를 백만원으로 반올림했습니다.`);
    } catch (e) { setErr(e instanceof Error ? e.message : '읽지 못했습니다.'); } finally { setBusy(''); }
  }

  const stage = STAGES[entry.stage - 1];
  const dsd = latestFile(files, '전기DSD', eng.fy);
  const factors = (papers.get('2700A-1')?.data as Paper2700A1 | undefined) ?? null;
  const is2700 = /^2700A-[234]$/.test(def.code);
  // 2301 추천 재료 — 2120A 에서 크게 변한 계정(1천만원·20% 이상).
  const big2120 = new Map<string, string>();
  for (const r of ((papers.get('2120A')?.data as Paper2120A | undefined)?.rows ?? [])) {
    if (r.prev == null || r.cur == null) continue;
    const g = r.cur - r.prev;
    if (Math.abs(g) >= 10_000_000 && (r.prev === 0 || Math.abs(g / r.prev) >= 0.2)) {
      big2120.set(r.label, `전기 대비 ${g > 0 ? '+' : ''}${r.prev ? `${Math.round((g / r.prev) * 100)}%` : '신규'} (${g.toLocaleString('ko-KR')}원)`);
    }
  }
  const wtb = latestFile(files, '정산표', eng.fy);
  // 8110ARP 기준 — 2700A-4 의 수행중요성(백만원 → 원). 사용자 2026-09-27 「8110 의 중요성은 2700A-4 에 연결」.
  const m4 = papers.get('2700A-4')?.data as Paper2700 | undefined;
  const m4mat = m4 ? decidedMateriality(m4) : null;
  const pm8110 = m4mat != null && m4?.pmRate != null
    ? { pm: m4mat * m4!.pmRate! * 1_000_000, note: `(2700A-4 ${m4mat.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}백만원 × ${Math.round(m4!.pmRate! * 100)}%)` }
    : { pm: null, note: '— 2700A-4(중요성 감사완결단계)를 먼저 저장하세요.' };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="card" style={{ maxWidth: 920, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
        <div className="chdr">
          {def.code} {def.title}
          <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>{stage.label} · {stage.when}{version ? ` · 최신 판 v${version}` : ''}</span>
          <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => { if (!dirty || confirm('저장하지 않은 입력이 있습니다. 닫을까요?')) onClose(); }}>닫기</button>
        </div>
        {locked && <div style={{ color: 'var(--warn)', fontSize: 'var(--fs-2)', marginBottom: 6 }}>{stage.label}이 끝나 잠겨 있습니다 — 고치려면 보드에서 확정을 취소하세요.</div>}
        {handedOff && !locked && (
          <div style={{ fontSize: 'var(--fs-2)', marginBottom: 6, padding: '6px 10px', borderRadius: 8, background: 'var(--surface-2)', lineHeight: 1.7 }}>
            📎 <b>엑셀로 넘긴 조서</b>입니다 — 지금은 엑셀이 정본입니다. ① 판 목록에서 최신 판을 내려받아 ② 별도조서 시트를 붙이고 보완한 뒤 ③ 「채운 파일 올리기」로 올리면 됩니다.
            {canWrite && <button className="btn-sm" style={{ marginLeft: 8 }} disabled={!!busy} onClick={() => void takeBack()}>웹으로 되돌리기</button>}
          </div>
        )}
        {err && <div style={{ color: 'var(--bad)', fontSize: 'var(--fs-2)', marginBottom: 6 }}>{err}</div>}
        {note && !readOnly && <div style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-1)', marginBottom: 6 }}>{note}</div>}
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {data == null ? <div style={{ color: 'var(--ink-3)', padding: 12 }}>{err ? '' : '조서를 읽는 중…'}</div>
            : def.code === '2110A' ? (
              <Form2110A value={data as Paper2110A} onChange={change} readOnly={readOnly} partner={partner} author={author}
                onReset={sheet ? () => change(def.read(sheet)) : undefined} />
            ) : def.code === '2110' ? (
              <Form2110 value={data as Paper2110} onChange={change} readOnly={readOnly} fy={eng.fy} author={author} />
            ) : def.code === '2120A' && blank2120 && !readOnly ? (
              <div style={{ padding: '12px 14px', border: '1.5px solid var(--warn)', borderRadius: 10, fontSize: 'var(--fs-2)', lineHeight: 1.7 }}>
                <b>작년 2120A 가 비어 있습니다</b> — 작년 조서에 분석표가 없어(빈 양식) 채울 계정 줄이 없습니다.
                같은 조서 기준의 다른 회사 2120A <b>틀(계정 줄·분류·수식)</b>을 빌려 오고, 금액은 이 회사 <b>전기 DSD</b> 로 전기·당기 두 열을 채웁니다.
                빌린 회사의 금액·비고는 남기지 않습니다. 틀에 없는 계정은 분류 끝에 새 줄로 넣습니다.
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                  {cands == null ? <span style={{ color: 'var(--ink-3)' }}>빌릴 수 있는 회사를 찾는 중…</span>
                    : !cands.length ? <span style={{ color: 'var(--bad)' }}>2120A 를 [확인]까지 해 둔 같은 기준의 회사가 아직 없습니다.</span>
                    : <>
                      <select value={candPick} onChange={(e) => setCandPick(e.target.value)} disabled={!!busy}>
                        {cands.map((c) => <option key={c.engagementId} value={c.engagementId}>{c.entity} (FY{c.fy} · {c.status})</option>)}
                      </select>
                      <button className="btn-p" disabled={!canWrite || !!busy || !candPick} onClick={() => void borrow2120()}>
                        {busy === 'borrow' ? '빌리는 중…' : '이 회사 2120A 틀 빌리기'}
                      </button>
                    </>}
                  {!dsd && <span style={{ color: 'var(--warn)' }}>자료함에 전기 DSD 가 없습니다 — 빌린 뒤 올리고 채우세요.</span>}
                </div>
              </div>
            ) : def.code === '2120A' ? (
              <Form2120A value={data as Paper2120A} onChange={change} readOnly={readOnly} report={fillRep}
                om={om2120} std={procStd} industry={industry} industryGuessed={industryGuessed} onIndustry={(v) => void pickIndustry(v)}
                fill={<button className="btn-sm btn-sm-navy" disabled={!dsd || !!busy} onClick={() => void fill2120()}
                  title={dsd ? dsd.fileName : '자료함에 전기 DSD 를 먼저 올리세요'}>
                  {busy === 'dsd' ? '읽는 중…' : !dsd ? '전기 DSD 없음(자료함에 올리세요)' : (data as Paper2120A).borrow ? '전기 DSD 로 전기·당기 채우기' : '전기 DSD 로 당기 열 채우기'}
                </button>} />
            ) : QA_DRAFTS[def.code] ? (
              <FormQA value={data as PaperQA} onChange={change} readOnly={readOnly} draft={QA_DRAFTS[def.code]} fs={qaFs} author={author} />
            ) : def === PAPER_2301G ? (
              <Form2301G value={data as Paper2301G} onChange={change} readOnly={readOnly} examples={ex2301} big={big2120} basis={eng.basis as AuditBasis} />
            ) : def.code === '2301' ? (
              <Form2301 value={data as Paper2301} onChange={change} readOnly={readOnly} big={big2120} lib={lib2301} />
            ) : def.code === '8110ARP' ? (
              <Form8110 value={data as Paper8110} onChange={change} readOnly={readOnly} report={wtbRep} pm={pm8110.pm} pmNote={pm8110.note}
                fill={<button className="btn-sm btn-sm-navy" disabled={!wtb || !!busy} onClick={() => void fill8110()}
                  title={wtb ? wtb.fileName : '자료함에 확정 정산표를 먼저 올리세요'}>
                  {busy === 'wtb' ? '읽는 중…' : wtb ? '확정 정산표로 당기 채우기' : '확정 정산표 없음(자료함에 올리세요)'}
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
                  {(def.code === '2700A-3' || def.code === '2700A-4') && (() => {
                    const kind = def.code === '2700A-3' ? '수정전정산표' as const : '정산표' as const;
                    const f = latestFile(files, kind, eng.fy);
                    const label = kind === '수정전정산표' ? '수정전 정산표' : '확정 정산표';
                    return (
                      <button className="btn-sm btn-sm-navy" disabled={!f || !!busy} onClick={() => void fillFromWtbTotals(kind)}
                        title={f ? f.fileName : `자료함에 FY${eng.fy} ${label}를 먼저 올리세요`}>
                        {busy === 'wtbm' ? '읽는 중…' : f ? `${label}에서 금액 채우기(${kind === '수정전정산표' ? '수정전' : '수정후'} 열)` : `${label} 없음(자료함)`}
                      </button>
                    );
                  })()}
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
              {saved?.status === '확인' && !dirty ? `확인해 두었습니다 — [${stage.label}] 때 엑셀에 반영됩니다.` : dirty ? '고친 것이 있습니다.' : ''}
              {!tpl && (is2700 || def.code === '2301') ? ' 표준양식이 없어 옛 모양 시트는 반영하지 못합니다.' : ''}
            </span>
            {saved?.status === '확인' && !dirty && (
              <button className="btn-s" disabled={!!busy} onClick={() => void handOff()}
                title="기말에 별도조서를 붙여야 하는 조서 — 지금 엑셀에 써 넣은 판을 만들고 정본을 엑셀로 넘깁니다. 웹은 읽기 전용이 됩니다.">
                {busy === 'hand' ? '넘기는 중…' : '📎 엑셀로 넘기기'}
              </button>
            )}
            <button className="btn-s" disabled={!!busy} onClick={() => void preview()} title="판을 만들지 않고, 이 조서를 써 넣은 엑셀을 내려받아 봅니다.">
              {busy === 'preview' ? '만드는 중…' : '엑셀 미리보기'}
            </button>
            <button className="btn-s" disabled={!!busy || !dirty} onClick={() => void save()}>{busy === 'save' ? '저장하는 중…' : '임시 저장'}</button>
            <button className="btn-p" disabled={!!busy} onClick={() => void check()}
              title={`저장하고 「확인」으로 둡니다. 엑셀·판 번호는 그대로 — [${stage.label}] 때 이 단계 조서를 한꺼번에 엑셀에 씁니다.`}>
              {busy === 'check' ? '저장하는 중…' : '확인'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
