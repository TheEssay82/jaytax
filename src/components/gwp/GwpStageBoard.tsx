// 일반조서 단계 보드 — 1차(중간감사 전)·2차(중간감사 후)·3차(기말감사 완료 후) 세 칸에 그 단계의 웹 조서를 늘어놓고,
// 칸마다 [N차 확정]. 위에는 자료함(전기 DSD·수정전 정산표·확정 정산표).
//
// 사용자 2026-09-27:
//   · 「하나씩 저장할 때마다 판 번호가 올라갈 필요가 있을까요? [1차 확정] 때 한꺼번에」 — 웹 조서는 저장·확인만 하고,
//     [N차 확정]이 그 단계 조서를 한 번에 엑셀에 써 넣어 **판을 하나만** 만든다. 그 판이 확정본이다.
//   · 「엑셀과 다름이 계속 뜹니다」 — 없앴다(웹에서 고치면 옛 판과 다른 게 당연하다).
//   · FY2026 건에 FY2025 정산표를 올린 실수 — 파일마다 몇 년 것인지 크게 보이고, 해가 다르면 막고 쓰지 않는다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Engagement } from '../../lib/dsdApi';
import { fileBytes, fileUrl, fmtKb, listBooks, addBook, type GwpBook, type GwpTemplate } from '../../lib/gwpApi';
import { readWorkbook } from '../../lib/xlsxRead';
import { buildCatalog } from '../../lib/gwpCatalog';
import { readBundle } from '../../lib/gwpTemplate';
import { applyWebPapers } from '../../lib/gwpApply';
import { STAGES, stageStates, currentStage, confirmBlockers, stageLocked, type StageNo, type StageEvent } from '../../lib/gwpStage';
import { WEB_PAPERS, webPapersFor, type WebPaperEntry } from '../../lib/gwpWebPapers';
import type { AuditBasis } from '../../lib/gwpSetup';
import {
  listFiles, uploadFile, latestFile, updateFileMeta, listPapers, listStageEvents, addStageEvent, markApplied, FILE_KINDS,
  type EngFile, type FileKind, type PaperRow,
} from '../../lib/gwpStageApi';
import { inspectFile, expectedFy, fitsEngagement } from '../../lib/gwpFiles';
import { tabStateOf } from '../../lib/xlsxMark';
import { safeName, download } from '../dsd/dsdUi';
import GwpPaperModal from './GwpPaperModal';
import { STAGE_SERIES, stagePapers, closeStage, planDate } from '../../lib/gwpStageClose';
import type { Paper2110 } from '../../lib/gwpPaper2110';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type Props = {
  eng: Engagement;
  latest: GwpBook | null;
  /** 올해 표준양식 — 웹 조서 반영 때 옛 모양 시트를 갈아끼운다 */ tpl: GwpTemplate | null;
  /** 조서 기준 — 소규모만 보이는 웹 조서(2520·2530)가 있다 */ basis: AuditBasis;
  canWrite: boolean;
  partner: string;
  author: string | null;
  /** 판이 늘었을 수 있다 — 부모가 판 목록을 다시 읽는다 */ onBooks: () => Promise<void>;
  setMsg: (m: string | null) => void;
  setErr: (m: string | null) => void;
};

export default function GwpStageBoard({ eng, latest, tpl, basis, canWrite, partner, author, onBooks, setMsg, setErr }: Props) {
  const [papers, setPapers] = useState<Map<string, PaperRow>>(new Map());
  const [events, setEvents] = useState<StageEvent[]>([]);
  const [files, setFiles] = useState<EngFile[]>([]);
  const [open, setOpen] = useState<WebPaperEntry | null>(null);
  const [busy, setBusy] = useState('');
  const [reopen, setReopen] = useState<{ stage: StageNo; reason: string } | null>(null);
  /** 확정 창 — 1차는 계획조서(1000·2000번대) 마감을 함께 보여 준다 */
  const [closing, setClosing] = useState<{ no: StageNo; date: string; author: string } | null>(null);

  const load = useCallback(async () => {
    const [p, e, f] = await Promise.all([listPapers(eng.id), listStageEvents(eng.id), listFiles(eng.id)]);
    setPapers(p); setEvents(e); setFiles(f);
  }, [eng.id]);
  useEffect(() => { void load().catch((e) => setErr(e instanceof Error ? e.message : '단계 정보를 읽지 못했습니다.')); }, [load, setErr]);

  // 해를 모르는 파일(이 기능 전에 올린 것)은 한 번 읽어 적어 둔다.
  useEffect(() => {
    const unknown = files.filter((f) => typeof f.meta.fy !== 'number' && !f.meta.void && !f.meta.inspected);
    if (!unknown.length) return;
    let off = false;
    void (async () => {
      for (const f of unknown) {
        const m = inspectFile(f.kind, await fileBytes(f.storagePath));
        await updateFileMeta(f.id, { ...f.meta, ...m, inspected: true });
      }
      if (!off) await load();
    })().catch(() => undefined);
    return () => { off = true; };
  }, [files, load]);

  const states = useMemo(() => stageStates(events), [events]);
  // 2110 감사일정 — 단계 머리에 예정일을 보인다(1차 = 중간감사 전, 2차 = 기말감사 전, 3차 = 보고서).
  const plan = papers.get('2110')?.data as Paper2110 | undefined;
  const when = (lab: string) => plan?.schedule.find((x) => x.label === lab)?.value || '';
  const due: Record<StageNo, string> = {
    1: when('중간감사') ? `중간감사 ${when('중간감사')}` : '',
    2: when('기말감사') ? `기말감사 ${when('기말감사')}` : '',
    3: plan?.reportDue ? `보고서 ${plan.reportDue}` : '',
  };
  const now = currentStage(states);
  const mineAll = webPapersFor(basis);
  const rows = mineAll.map((w) => ({ ...w, status: papers.get(w.code)?.status ?? null }));

  // 엑셀 조서 탭 색 — 최신 판 목록에서.
  const tabs = useMemo(() => {
    const m = { red: 0, yellow: 0, green: 0, none: 0 };
    for (const s of latest?.catalog.sheets ?? []) {
      if (s.kind !== 'paper' || s.hidden) continue;
      const t = tabStateOf(s.tab);
      m[t ?? 'none'] += 1;
    }
    return m;
  }, [latest]);

  async function upload(kind: FileKind, f: File | undefined) {
    if (!f) return;
    setBusy(`file:${kind}`); setErr(null);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const m = inspectFile(kind, bytes);
      const want = expectedFy(kind, eng.fy);
      const label = FILE_KINDS.find((k) => k.kind === kind)!.label;
      if (m.fy != null && m.fy !== want) {
        throw new Error(`이 파일은 FY${m.fy}(${m.periodEnd}) 것입니다 — FY${eng.fy} 작업 건의 「${label}」에는 FY${want} 파일을 올리세요. 올리지 않았습니다.`);
      }
      if (m.fy == null && !confirm(`이 파일이 몇 년 것인지 알아내지 못했습니다(${m.note}).\nFY${want} 파일이 맞으면 [확인]을 누르세요.`)) return;
      await uploadFile(eng.id, kind, { name: f.name, bytes }, { ...m, inspected: true });
      await load();
      setMsg(`자료함에 ${label}을 올렸습니다 — ${f.name}${m.fy ? ` (FY${m.fy} · ${m.periodEnd})` : ''}.`);
    } catch (e) { setErr(e instanceof Error ? e.message : '올리지 못했습니다.'); } finally { setBusy(''); }
  }

  async function voidFile(f: EngFile) {
    if (!confirm(`「${f.fileName}」을 쓰지 않게 뺍니다(파일은 기록으로 남습니다).`)) return;
    try {
      await updateFileMeta(f.id, { ...f.meta, void: true }, '잘못 올림 — 쓰지 않음');
      await load();
      setMsg(`「${f.fileName}」을 뺐습니다 — 이제 쓰지 않습니다.`);
    } catch (e) { setErr(e instanceof Error ? e.message : '빼지 못했습니다.'); }
  }

  /** N차 확정 — 이 단계에서 확인한 웹 조서를 한꺼번에 엑셀에 써 넣어 판 하나를 만들고, 그 판을 확정본으로 둔다. */
  /** 다른 단계의 웹 조서 코드 — 단계 마감에서 뺀다(2700A-3·4 는 2000번대지만 2·3차). */
  const otherStageCodes = (no: StageNo) => WEB_PAPERS.filter((w) => w.stage !== no).map((w) => w.code);

  /** [N차 확정] — 확인 창을 연다. 기본 작성일은 2110 의 감사계획일, 없으면 오늘. */
  function openConfirm(no: StageNo) {
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    setClosing({ no, date: (no === 1 ? planDate(when('감사계획')) : null) ?? today, author: author ?? '' });
  }

  async function confirmStage(no: StageNo) {
    if (!latest || !closing) return;
    const st = STAGES[no - 1];
    const items = mineAll.filter((w) => w.def && w.stage === no && papers.get(w.code)?.status === '확인');
    const codes = items.map((w) => w.code).join(', ');
    const close = !!STAGE_SERIES[no];
    setBusy(`stage:${no}`); setErr(null);
    try {
      const base = (await listBooks(eng.id))[0];
      if (!base) throw new Error('조서 판이 없습니다.');
      let version = base.version;
      let changed = 0;
      let closed = { dated: [] as string[], tabbed: [] as string[] };
      if (items.length || close) {
        let bytes = await fileBytes(base.storagePath);
        if (items.length) {
          const template = tpl ? { ...readBundle(await fileBytes(tpl.storagePath)), reviewer: partner } : undefined;
          const r = applyWebPapers(bytes, items.map((w) => ({ def: w.def!, data: papers.get(w.code)!.data })), template);
          if (r.missing.length) throw new Error(`최신 판(v${base.version})에 ${r.missing.join(', ')} 시트가 없습니다 — 표준양식이 등록돼 있는지 보세요.`);
          changed = r.done.reduce((n, d) => n + d.changed, 0);
          bytes = r.bytes;
        }
        // 계획조서 마감 — 조서목록 작성자·작성일, 빨간 탭 → 노랑(사용자 2026-09-27 「1000·2000번대가 1차로 반영 완료」).
        if (close) {
          const c = closeStage(bytes, no, { date: closing.date, author: closing.author, exclude: otherStageCodes(no) });
          bytes = c.bytes;
          closed = c;
        }
        const name = `일반조서_${safeName(eng.entityName)}_FY${eng.fy}_${no}차확정.xlsx`;
        const book = await addBook(eng.id, '작업중', { name, bytes }, buildCatalog(readWorkbook(bytes)),
          `${st.label}본(${st.when})${items.length ? ` — 웹 조서 반영 ${codes} · 바뀐 칸 ${changed}개(노랑)` : ''}${close ? ` · 조서목록 작성일 ${closing.date} ${closed.dated.length}줄 · 빨간 탭 → 노랑 ${closed.tabbed.length}개` : ''}`);
        version = book.version;
        for (const w of items) await markApplied(eng.id, w.code, papers.get(w.code)!.data, version);
        download(bytes, name, XLSX);
      }
      await addStageEvent(eng.id, no, '확정', version);
      setClosing(null);
      await load();
      await onBooks();
      setMsg(`${st.label} — v${version}을 ${st.when} 확정본으로 고정하고 내려받았습니다.${items.length ? ` 웹 조서 ${items.length}개 반영.` : ''}${close ? ` 계획조서 조서목록 작성일 ${closed.dated.length}줄을 채우고 빨간 탭 ${closed.tabbed.length}개를 노랑으로 바꿨습니다.` : ''}`);
    } catch (e) { setErr(e instanceof Error ? e.message : '확정하지 못했습니다.'); } finally { setBusy(''); }
  }

  async function cancelStage() {
    if (!reopen || !reopen.reason.trim()) return;
    setBusy(`stage:${reopen.stage}`); setErr(null);
    try {
      await addStageEvent(eng.id, reopen.stage, '확정 취소', null, reopen.reason.trim());
      const st = STAGES[reopen.stage - 1];
      setReopen(null);
      await load();
      setMsg(`${st.label}을 취소했습니다 — 이 단계의 웹 조서를 다시 고칠 수 있습니다. 확정했던 판은 그대로 남습니다.`);
    } catch (e) { setErr(e instanceof Error ? e.message : '취소하지 못했습니다.'); } finally { setBusy(''); }
  }

  const statusChip = (w: (typeof rows)[number]) => {
    if (!w.def) return <span style={{ color: 'var(--ink-4)' }}>준비 중</span>;
    const p = papers.get(w.code);
    if (w.status === '확인') return <span style={{ color: 'var(--good)', fontWeight: 700 }}>✅ 확인{p?.appliedVersion ? ` · v${p.appliedVersion}` : ''}</span>;
    if (w.status === '엑셀로 넘김') return <span style={{ color: 'var(--ink-2)' }}>📎 엑셀로 넘김</span>;
    if (w.status === '작성중') return <span style={{ color: 'var(--warn)' }}>✏️ 작성 중</span>;
    return <span style={{ color: 'var(--ink-3)' }}>○ 할 차례</span>;
  };

  return (
    <div className="card">
      <div className="chdr">
        단계 진행
        <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>
          {now ? `지금은 ${STAGES[now - 1].label} · ${STAGES[now - 1].when}` : '3차 확정까지 마쳤습니다'}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-1)', color: 'var(--ink-2)', display: 'flex', gap: 10, alignItems: 'center' }}
          title="최신 판의 조서 시트 탭 색 — 빨강 손 안 댐 · 노랑 수정함 · 초록 확인·새로 넣을 것 없음">
          엑셀 조서 <Dot c="#FF0000" /> {tabs.red} <Dot c="#FFFF00" /> {tabs.yellow} <Dot c="#00B050" /> {tabs.green}
          {tabs.none ? <span style={{ color: 'var(--ink-4)' }}>· 색 없음 {tabs.none}</span> : null}
        </span>
      </div>

      {/* 자료함 — 단계 순서대로 */}
      <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginBottom: 4 }}>📁 자료함 — 파일마다 몇 년 것인지 보입니다. 이 작업 건(FY{eng.fy})과 맞지 않는 파일은 쓰지 않습니다.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8, marginBottom: 12 }}>
        {FILE_KINDS.filter((k) => k.kind !== '당기DSD').map((k) => {
          const use = latestFile(files, k.kind, eng.fy);
          const newest = files.find((f) => f.kind === k.kind);
          const bad = newest && newest !== use ? newest : null;     // 가장 최근에 올린 것이 맞지 않거나 뺀 것
          const want = expectedFy(k.kind, eng.fy);
          const fyTag = (f: EngFile) => {
            const ok = fitsEngagement(k.kind, f.meta, eng.fy);
            const fy = typeof f.meta.fy === 'number' ? `FY${f.meta.fy}` : '해 모름';
            return (
              <span style={{ padding: '0 8px', borderRadius: 999, fontWeight: 700, fontSize: 'var(--fs-1)',
                background: f.meta.void || ok === false ? 'var(--bad-bg)' : ok ? 'var(--good-bg)' : 'var(--surface-2)',
                color: f.meta.void || ok === false ? 'var(--bad)' : ok ? 'var(--good)' : 'var(--ink-3)' }}>
                {fy}{typeof f.meta.periodEnd === 'string' ? ` · ${f.meta.periodEnd}` : ''}
              </span>
            );
          };
          const link = (f: EngFile) => (
            <button style={{ background: 'none', border: 'none', padding: 0, color: 'var(--navy)', cursor: 'pointer', textAlign: 'left' }}
              onClick={() => void fileUrl(f.storagePath, f.fileName).then((u) => window.open(u, '_blank', 'noopener')).catch((e) => setErr(e instanceof Error ? e.message : '내려받지 못했습니다.'))}>
              {f.fileName}
            </button>
          );
          return (
            <div key={k.kind} style={{ border: `1px solid ${bad && !use ? 'var(--bad)' : 'var(--line)'}`, borderRadius: 10, padding: '8px 10px', fontSize: 'var(--fs-1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <b>{k.stage}차 · {k.label}</b>
                <label className="btn-sm" style={{ marginLeft: 'auto', cursor: canWrite && !busy ? 'pointer' : 'default', opacity: canWrite ? 1 : 0.5 }}>
                  {busy === `file:${k.kind}` ? '올리는 중…' : use ? '새로 올리기' : '올리기'}
                  <input type="file" accept={k.accept} style={{ display: 'none' }} disabled={!canWrite || !!busy}
                    onChange={(e) => { void upload(k.kind, e.target.files?.[0]); e.target.value = ''; }} />
                </label>
              </div>
              <div style={{ color: 'var(--ink-3)', marginTop: 2 }}>{k.use} · <b>FY{want}</b> 파일</div>
              {use ? (
                <div style={{ marginTop: 4, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {fyTag(use)} {link(use)}
                  <span style={{ color: 'var(--ink-4)' }}>· {fmtKb(use.fileSize)} · {use.createdAt.slice(0, 10)}</span>
                  {canWrite && <button className="btn-sm" style={{ fontSize: 'var(--fs-0)' }} onClick={() => void voidFile(use)}>잘못 올림 — 빼기</button>}
                </div>
              ) : <div style={{ marginTop: 4, color: 'var(--ink-4)' }}>쓸 파일 없음</div>}
              {bad && (
                <div style={{ marginTop: 4, color: 'var(--bad)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {fyTag(bad)} {bad.fileName} — {bad.meta.void ? '뺀 파일' : `이 작업 건(FY${eng.fy})과 맞지 않아 쓰지 않습니다`}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 세 단계 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
        {STAGES.map((st) => {
          const s = states[st.no - 1];
          const mine = rows.filter((w) => w.stage === st.no);
          const blockers = confirmBlockers(st.no, states, rows.filter((w) => w.def));
          const isNow = now === st.no;
          return (
            <div key={st.no} style={{
              border: `1.5px solid ${isNow ? 'var(--navy)' : 'var(--line)'}`, borderRadius: 12, padding: '10px 12px',
              background: s.confirmed ? 'var(--good-bg)' : undefined, display: 'flex', flexDirection: 'column',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
                <b>{st.label}</b><span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-2)' }}>{st.when}</span>
                <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-0)', color: s.confirmed ? 'var(--good)' : isNow ? 'var(--navy)' : 'var(--ink-4)', fontWeight: 700 }}>
                  {s.confirmed ? `확정 v${s.version} · ${s.at?.slice(0, 10)}` : isNow ? '진행 중' : '대기'}
                </span>
              </div>
              {due[st.no] && !s.confirmed && <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)', marginBottom: 4 }}>📅 {due[st.no]} 전까지</div>}
              {s.reopenReason && !s.confirmed && <div style={{ fontSize: 'var(--fs-0)', color: 'var(--warn)', marginBottom: 4 }}>확정 취소됨 — {s.reopenReason}</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                {mine.map((w) => (
                  <div key={w.code} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-1)', opacity: w.def ? 1 : 0.55 }} title={w.note}>
                    <span style={{ width: 62, fontWeight: 700 }}>{w.code}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>{w.title}</span>
                    <span style={{ fontSize: 'var(--fs-0)', whiteSpace: 'nowrap' }}>{statusChip(w)}</span>
                    {w.def && <button className="btn-sm" onClick={() => setOpen(w)}>{stageLocked(st.no, states) || !canWrite ? '보기' : '열기'}</button>}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 8 }}>
                {s.confirmed ? (
                  canWrite && (reopen?.stage === st.no ? (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input className="btn-sm" style={{ flex: 1 }} placeholder="취소 사유(필수)" value={reopen.reason} autoFocus
                        onChange={(e) => setReopen({ stage: st.no, reason: e.target.value })} />
                      <button className="btn-sm" disabled={!reopen.reason.trim() || !!busy} onClick={() => void cancelStage()}>취소하기</button>
                      <button className="btn-sm" onClick={() => setReopen(null)}>닫기</button>
                    </div>
                  ) : (
                    <button className="btn-sm" onClick={() => setReopen({ stage: st.no, reason: '' })}>확정 취소…</button>
                  ))
                ) : (
                  <>
                    <button className="btn-p" style={{ width: '100%' }} disabled={!canWrite || !latest || blockers.length > 0 || !!busy}
                      onClick={() => openConfirm(st.no)}>
                      {busy === `stage:${st.no}` ? '엑셀에 반영하고 확정하는 중…' : `${st.label} — 엑셀에 반영하고 고정`}
                    </button>
                    {blockers.length > 0 && isNow && (
                      <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.5 }}>
                        {blockers.map((b) => <div key={b}>· {b.replace('아직 엑셀에 반영하지 않았습니다', '아직 확인하지 않았습니다')}</div>)}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-4)', marginTop: 8, lineHeight: 1.6 }}>
        웹 조서는 [열기] → 고치고 <b>「확인」</b>만 누르면 됩니다(엑셀은 아직 그대로, 판 번호도 그대로). 단계의 웹 조서를 모두 확인하면 <b>[N차 확정]</b>이
        그 조서들을 <b>한꺼번에</b> 엑셀에 써 넣어 판 하나를 만들고(바뀐 칸 노랑·탭 노랑, 바뀐 게 없으면 탭 초록) 그 판을 확정본으로 고정합니다.
        확정 전에 엑셀을 보고 싶으면 조서 창의 「엑셀 미리보기」를 누르세요(판을 만들지 않습니다).
      </div>

      {closing && latest && (() => {
        const st = STAGES[closing.no - 1];
        const items = mineAll.filter((w) => w.def && w.stage === closing.no && papers.get(w.code)?.status === '확인');
        const excel = STAGE_SERIES[closing.no] ? stagePapers(latest.catalog, closing.no, otherStageCodes(closing.no)) : [];
        const red = excel.filter((s) => { const t = tabStateOf(s.tab); return t !== 'yellow' && t !== 'green'; });
        const emptyIdx = latest.catalog.index.filter((r) => /^[12]/.test(r.code) && !r.date).length;
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div className="card" style={{ maxWidth: 660, width: '100%', maxHeight: '88vh', overflowY: 'auto', marginBottom: 0, fontSize: 'var(--fs-2)', lineHeight: 1.7 }}>
              <div className="chdr">{st.label}
                <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>{st.when} — 지금 판 v{latest.version}에 아래를 반영해 새 판 하나를 만들고 확정본으로 고정합니다</span>
              </div>
              <div><b>① 웹 조서 {items.length}개</b> {items.length ? `— ${items.map((w) => w.code).join(' · ')} (바뀐 칸 노랑)` : '— 없음'}</div>
              {STAGE_SERIES[closing.no] && (
                <div style={{ marginTop: 8 }}>
                  <b>② 엑셀 계획조서 {excel.length}개</b>(1000·2000번대) — 🔴 손 안 댐 {red.length} · 🟡🟢 {excel.length - red.length}
                  <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                    <li>조서목록 작성자·작성일이 빈 줄({emptyIdx}개)을 아래 값으로 채웁니다(노랑) — 각 조서 머리에 따라 들어갑니다. 이미 적힌 것은 둡니다.</li>
                    <li>빨간 탭 {red.length}개를 노랑으로 바꿉니다 — 이번 단계에 확인했다는 표시입니다.
                      {red.length > 0 && <span style={{ color: 'var(--ink-3)' }}> ({red.map((s) => s.code).join(', ')})</span>}</li>
                  </ul>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                    작성일 <input type="date" className="btn-sm" value={closing.date} onChange={(e) => setClosing({ ...closing, date: e.target.value })} />
                    작성자 <input className="btn-sm" style={{ width: 110 }} value={closing.author} onChange={(e) => setClosing({ ...closing, author: e.target.value })} />
                    <span style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-1)' }}>기본 작성일은 2110 의 감사계획일(없으면 오늘)</span>
                  </div>
                  {red.length > 0 && (
                    <div style={{ color: 'var(--warn)', marginTop: 6 }}>
                      빨간 탭은 엑셀에서 아직 손대지 않은 조서입니다. 올해 내용을 적어야 하는 조서가 있으면 먼저 엑셀에서 쓰고 「채운 파일 올리기」로 올린 뒤 확정하세요.
                    </div>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="btn-s" disabled={!!busy} onClick={() => setClosing(null)}>닫기</button>
                <button className="btn-p" disabled={!!busy || (!!STAGE_SERIES[closing.no] && !closing.date)} onClick={() => void confirmStage(closing.no)}>
                  {busy ? '반영하고 확정하는 중…' : `${st.label} — v${latest.version + 1} 만들고 고정`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {open && open.def && (
        <GwpPaperModal entry={open} eng={eng} saved={papers.get(open.code)} papers={papers} files={files} tpl={tpl} locked={stageLocked(open.stage, states)} canWrite={canWrite}
          partner={partner} author={author} onClose={() => setOpen(null)}
          onChanged={async (m) => { await load(); await onBooks(); setMsg(m); }} />
      )}
    </div>
  );
}

function Dot({ c }: { c: string }) {
  return <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: c, border: '1px solid var(--line)', verticalAlign: 'middle' }} />;
}
