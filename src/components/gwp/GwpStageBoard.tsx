// 일반조서 단계 보드 — 1차(중간감사 전)·2차(중간감사 후)·3차(기말감사 완료 후) 세 칸에 그 단계의 웹 조서를 늘어놓고,
// 칸마다 [N차 확정]. 위에는 자료함(전기 DSD·확정 정산표)과 엑셀 조서 탭 색 개수.
// 사용자 2026-09-27: 「일반조서 작성 절차를 편리하게 하기 위함」 — 지금 할 일이 한눈에 보이게.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Engagement } from '../../lib/dsdApi';
import { fileBytes, fileUrl, fmtKb, type GwpBook, type GwpTemplate } from '../../lib/gwpApi';
import { readWorkbook, sheetNames } from '../../lib/xlsxRead';
import { pickSheet } from '../../lib/gwpWeb';
import { STAGES, stageStates, currentStage, confirmBlockers, stageLocked, type StageNo, type StageEvent } from '../../lib/gwpStage';
import { WEB_PAPERS, type WebPaperEntry } from '../../lib/gwpWebPapers';
import {
  listFiles, uploadFile, latestFile, listPapers, listStageEvents, addStageEvent, FILE_KINDS,
  type EngFile, type FileKind, type PaperRow,
} from '../../lib/gwpStageApi';
import { readDsd, readContents } from '../../lib/dsdFile';
import { parseStatements } from '../../lib/fsParse';
import { tabStateOf } from '../../lib/xlsxMark';
import GwpPaperModal from './GwpPaperModal';

type Props = {
  eng: Engagement;
  latest: GwpBook | null;
  /** 올해 표준양식 — 웹 조서 반영 때 옛 모양 시트를 갈아끼운다 */ tpl: GwpTemplate | null;
  canWrite: boolean;
  partner: string;
  author: string | null;
  /** 판이 늘었을 수 있다 — 부모가 판 목록을 다시 읽는다 */ onBooks: () => Promise<void>;
  setMsg: (m: string | null) => void;
  setErr: (m: string | null) => void;
};

export default function GwpStageBoard({ eng, latest, tpl, canWrite, partner, author, onBooks, setMsg, setErr }: Props) {
  const [papers, setPapers] = useState<Map<string, PaperRow>>(new Map());
  const [events, setEvents] = useState<StageEvent[]>([]);
  const [files, setFiles] = useState<EngFile[]>([]);
  const [open, setOpen] = useState<WebPaperEntry | null>(null);
  const [busy, setBusy] = useState('');
  const [reopen, setReopen] = useState<{ stage: StageNo; reason: string } | null>(null);
  /** 반영 뒤 엑셀 판이 바뀌어 웹 값과 달라진 조서 */
  const [drift, setDrift] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const [p, e, f] = await Promise.all([listPapers(eng.id), listStageEvents(eng.id), listFiles(eng.id)]);
    setPapers(p); setEvents(e); setFiles(f);
  }, [eng.id]);
  useEffect(() => { void load().catch((e) => setErr(e instanceof Error ? e.message : '단계 정보를 읽지 못했습니다.')); }, [load, setErr]);

  // 반영한 뒤에 누가 엑셀을 올렸으면(판이 늘었으면) 웹 값과 엑셀이 같은지 본다.
  useEffect(() => {
    const stale = WEB_PAPERS.filter((w) => w.def && papers.get(w.code)?.status === '확인'
      && latest && (papers.get(w.code)?.appliedVersion ?? 0) < latest.version);
    if (!latest || !stale.length) { setDrift(new Set()); return; }
    let off = false;
    void (async () => {
      const sheets = readWorkbook(await fileBytes(latest.storagePath));
      const d = new Set<string>();
      for (const w of stale) {
        const s = pickSheet(w.def!, sheets);
        if (s && JSON.stringify(w.def!.read(s)) !== JSON.stringify(papers.get(w.code)!.data)) d.add(w.code);
      }
      if (!off) setDrift(d);
    })().catch(() => undefined);
    return () => { off = true; };
  }, [latest, papers]);

  const states = useMemo(() => stageStates(events), [events]);
  const now = currentStage(states);
  const rows = WEB_PAPERS.map((w) => ({ ...w, status: papers.get(w.code)?.status ?? null }));

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
      let meta: Record<string, unknown> = {};
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (kind === '정산표') {
        const names = sheetNames(bytes);
        meta = { sheets: names.slice(0, 80), sheetCount: names.length };
      } else {
        const info = await readDsd(f);
        const lines = parseStatements(await readContents(f));
        meta = { docName: info.docName, period: info.period, notes: info.notes.length, fsLines: lines.length };
        if (!lines.length) throw new Error('이 DSD 에서 재무제표를 읽지 못했습니다 — 감사보고서 DSD 가 맞는지 확인하세요.');
      }
      await uploadFile(eng.id, kind, { name: f.name, bytes }, meta);
      await load();
      setMsg(`자료함에 ${FILE_KINDS.find((k) => k.kind === kind)!.label}을 올렸습니다 — ${f.name}.`);
    } catch (e) { setErr(e instanceof Error ? e.message : '올리지 못했습니다.'); } finally { setBusy(''); }
  }

  async function confirmStage(no: StageNo) {
    if (!latest) return;
    const st = STAGES[no - 1];
    if (!confirm(`${st.label}(${st.when})을 합니다.\n지금 최신 판 v${latest.version}을 ${st.label}본으로 고정하고, 이 단계의 웹 조서를 잠급니다.`)) return;
    setBusy(`stage:${no}`); setErr(null);
    try {
      await addStageEvent(eng.id, no, '확정', latest.version);
      await load();
      setMsg(`${st.label} — v${latest.version} 판을 ${st.when} 확정본으로 고정했습니다.`);
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
    if (drift.has(w.code)) return <span style={{ color: 'var(--warn)', fontWeight: 700 }} title="반영한 뒤 올라온 엑셀 판과 웹 값이 다릅니다">⚠️ 엑셀과 다름</span>;
    if (w.status === '확인') return <span style={{ color: 'var(--good)', fontWeight: 700 }}>✅ 반영함{papers.get(w.code)?.appliedVersion ? ` v${papers.get(w.code)!.appliedVersion}` : ''}</span>;
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

      {/* 자료함 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8, marginBottom: 12 }}>
        {FILE_KINDS.filter((k) => k.kind !== '당기DSD').map((k) => {
          const f = latestFile(files, k.kind);
          return (
            <div key={k.kind} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', fontSize: 'var(--fs-1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <b>📁 {k.label}</b>
                <label className="btn-sm" style={{ marginLeft: 'auto', cursor: canWrite && !busy ? 'pointer' : 'default', opacity: canWrite ? 1 : 0.5 }}>
                  {busy === `file:${k.kind}` ? '올리는 중…' : f ? '새로 올리기' : '올리기'}
                  <input type="file" accept={k.accept} style={{ display: 'none' }} disabled={!canWrite || !!busy}
                    onChange={(e) => { void upload(k.kind, e.target.files?.[0]); e.target.value = ''; }} />
                </label>
              </div>
              <div style={{ color: 'var(--ink-3)', marginTop: 2 }}>{k.use}</div>
              {f ? (
                <div style={{ marginTop: 4 }}>
                  <button className="btn-link" style={{ background: 'none', border: 'none', padding: 0, color: 'var(--navy)', cursor: 'pointer', textAlign: 'left' }}
                    onClick={() => void fileUrl(f.storagePath, f.fileName).then((u) => window.open(u, '_blank', 'noopener')).catch((e) => setErr(e instanceof Error ? e.message : '내려받지 못했습니다.'))}>
                    {f.fileName}
                  </button>
                  <span style={{ color: 'var(--ink-4)' }}> · {fmtKb(f.fileSize)} · {f.createdAt.slice(0, 10)}</span>
                </div>
              ) : <div style={{ marginTop: 4, color: 'var(--ink-4)' }}>아직 없음</div>}
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
                      onClick={() => void confirmStage(st.no)}>
                      {busy === `stage:${st.no}` ? '확정하는 중…' : `${st.label}`}
                    </button>
                    {blockers.length > 0 && isNow && (
                      <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.5 }}>
                        {blockers.map((b) => <div key={b}>· {b}</div>)}
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
        웹 조서는 [열기] → 확인·수정 → <b>「확인하고 엑셀에 반영」</b>하면 최신 판에 써 넣은 새 판이 쌓입니다(바뀐 칸 노랑, 탭 노랑 · 바뀐 게 없으면 탭 초록).
        단계의 웹 조서를 모두 반영하면 [N차 확정]이 열립니다 — 그때의 최신 판이 그 단계의 확정본이 되고, 그 단계 웹 조서는 잠깁니다.
      </div>

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
