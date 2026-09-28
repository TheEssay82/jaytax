// 업무 폴더에서 가져오기 — 내 PC 업무 폴더(회사/연도_회계감사/…)에서 전기 조서·전기 DSD·정산표를 찾아 한 번에 쓴다.
//
// 사용자 2026-09-28: 「폴더에서 자동으로 업로드는 제 거래처만, 다른 거래처는 각 담당자가 직접 파일 올리기도 가능하게」.
// → 이 카드는 **내가 담당회계사인 작업 건**에만 보인다. 직접 올리기(자료함·전기 파일 고르기)는 그대로 있다.
// 말없이 올리지 않는다 — 찾은 파일을 보여 주고 [올리기]를 누를 때 읽어 올린다(올린 기록은 누른 사람 이름).
import { useCallback, useEffect, useState } from 'react';
import type { Engagement } from '../../lib/dsdApi';
import { classify, matchCompany, pickYearFolder, sure, type Candidate, type Found } from '../../lib/gwpFolder';
import {
  folderSupported, savedRoot, connectRoot, canRead, subdirs, dirAt, listFiles as listDirFiles, readAt,
  rememberedFolder, rememberFolder, type DirHandle,
} from '../../lib/folderAccess';
import { listFiles, uploadFile, type EngFile } from '../../lib/gwpStageApi';
import { checkForKind, type FileKind } from '../../lib/gwpFiles';

interface Side { year: string | null; found: Found | null }

export default function GwpFolderCard({ eng, canWrite, canRoll, hasBook, onRoll, onMsg }: {
  eng: Engagement;
  canWrite: boolean;
  /** 세팅·양식이 되어 이월본을 지을 수 있다 */ canRoll: boolean;
  /** 올해 판이 이미 있다 — 이월은 다시 만들기 */ hasBook: boolean;
  onRoll: (bytes: Uint8Array, label: string) => Promise<void>;
  onMsg: (m: string) => void;
}) {
  const [root, setRoot] = useState<DirHandle | null>(null);
  const [ok, setOk] = useState(false);
  const [companies, setCompanies] = useState<string[]>([]);
  const [company, setCompany] = useState<string | null>(null);
  const [prior, setPrior] = useState<Side>({ year: null, found: null });
  const [cur, setCur] = useState<Side>({ year: null, found: null });
  const [pick, setPick] = useState<Record<string, string>>({});
  const [uploaded, setUploaded] = useState<EngFile[]>([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { void savedRoot().then(async (h) => { if (!h) return; setRoot(h); setOk(await canRead(h, false)); }); }, []);
  useEffect(() => { void listFiles(eng.id).then(setUploaded).catch(() => undefined); }, [eng.id]);

  // 허락되면 — 회사 폴더 목록, 회사 짝.
  useEffect(() => {
    if (!root || !ok) return;
    let off = false;
    void (async () => {
      const cs = await subdirs(root);
      if (off) return;
      setCompanies(cs);
      setCompany(matchCompany(cs, eng.entityName, rememberedFolder(eng.entityId)).pick);
    })().catch((e) => setErr(e instanceof Error ? e.message : '폴더를 읽지 못했습니다.'));
    return () => { off = true; };
  }, [root, ok, eng.entityName, eng.entityId]);

  // 회사가 정해지면 — 전기·당기 폴더를 훑는다.
  useEffect(() => {
    if (!root || !ok || !company) { setPrior({ year: null, found: null }); setCur({ year: null, found: null }); return; }
    let off = false;
    setBusy('scan');
    void (async () => {
      const cdir = await dirAt(root, [company]);
      const years = await subdirs(cdir);
      const side = async (fy: number): Promise<Side> => {
        const y = pickYearFolder(years, fy);
        if (!y) return { year: null, found: null };
        return { year: y, found: classify(await listDirFiles(await dirAt(cdir, [y])), fy) };
      };
      const [p, c] = await Promise.all([side(eng.fy - 1), side(eng.fy)]);
      if (off) return;
      setPrior(p); setCur(c); setPick({});
    })().catch((e) => setErr(e instanceof Error ? e.message : '폴더를 읽지 못했습니다.')).finally(() => { if (!off) setBusy(''); });
    return () => { off = true; };
  }, [root, ok, company, eng.fy]);

  /** again = 다른 폴더로 바꾸기(잘못 고른 폴더 — 사용자 2026-09-28 「다시 고르기가 없어요」). */
  const connect = useCallback(async (again = false) => {
    setErr(null);
    try {
      if (!again && root && !ok) { setOk(await canRead(root, true)); return; }
      const h = await connectRoot();
      setCompany(null); setCompanies([]);
      setRoot(h); setOk(await canRead(h, true));
    } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) setErr(e instanceof Error ? e.message : '폴더를 연결하지 못했습니다.'); }
  }, [root, ok]);

  if (!folderSupported()) {
    return <div className="card" style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>업무 폴더에서 가져오기는 PC 의 크롬·엣지에서만 됩니다 — 여기서는 파일을 직접 올리세요.</div>;
  }

  const chosen = (key: string, list: Candidate[]): Candidate | null => (pick[key] ? list.find((c) => c.path === pick[key]) ?? null : sure(list) ?? null);
  const already = (name: string, kind?: FileKind) => uploaded.some((f) => f.fileName === name && !f.meta.void && (!kind || f.kind === kind));

  async function read(side: 'prior' | 'cur', c: Candidate) {
    const y = side === 'prior' ? prior.year : cur.year;
    return readAt(await dirAt(root!, [company!, y!]), c.path);
  }
  async function roll(c: Candidate) {
    setBusy('roll'); setErr(null);
    try {
      const f = await read('prior', c);
      await onRoll(f.bytes, `업무 폴더 — ${company}/${prior.year}/${c.path}`);
    } catch (e) { setErr(e instanceof Error ? e.message : '이월하지 못했습니다.'); } finally { setBusy(''); }
  }
  async function up(side: 'prior' | 'cur', c: Candidate, kind: FileKind, label: string) {
    setBusy(`up:${kind}`); setErr(null);
    try {
      const f = await read(side, c);
      const r = checkForKind(kind, eng.fy, f.bytes);
      if (r.wrong) throw new Error(r.wrong);
      if (r.meta.fy == null && !confirm(`이 파일이 몇 년 것인지 알아내지 못했습니다(${r.meta.note}).\nFY${r.want} 파일이 맞으면 [확인]을 누르세요.`)) return;
      await uploadFile(eng.id, kind, f, { ...r.meta, inspected: true, source: `업무 폴더 ${company}/${side === 'prior' ? prior.year : cur.year}/${c.path}` });
      setUploaded(await listFiles(eng.id));
      onMsg(`자료함에 ${label}을 올렸습니다 — ${f.name}${r.meta.fy ? ` (FY${r.meta.fy} · ${r.meta.periodEnd})` : ''}.`);
    } catch (e) { setErr(e instanceof Error ? e.message : '올리지 못했습니다.'); } finally { setBusy(''); }
  }

  const row = (title: string, key: string, list: Candidate[] | undefined, action: (c: Candidate) => React.ReactNode) => {
    const c = chosen(key, list ?? []);
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: 8, alignItems: 'center', padding: '5px 0', borderTop: '1px solid var(--line)' }}>
        <b>{title}</b>
        <div style={{ minWidth: 0 }}>
          {!list?.length ? <span style={{ color: 'var(--ink-4)' }}>못 찾음 — 직접 올리세요</span> : (
            <select className="btn-sm" style={{ maxWidth: '100%' }} value={c?.path ?? ''} onChange={(e) => setPick({ ...pick, [key]: e.target.value })}>
              {!c && <option value="">— {list.length}개 중 고르세요 —</option>}
              {list.map((x) => <option key={x.path} value={x.path}>{x.path}{x.why.length ? `  (${x.why.join('·')})` : ''}</option>)}
            </select>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>{c && action(c)}</div>
      </div>
    );
  };

  return (
    <div className="card">
      <div className="chdr">업무 폴더에서 가져오기
        <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>내 담당 거래처만 — 찾은 파일을 확인하고 누르면 올립니다</span>
      </div>
      {err && <div style={{ color: 'var(--bad)', fontSize: 'var(--fs-2)', marginBottom: 6 }}>{err}</div>}
      {!root || !ok ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 'var(--fs-2)' }}>
          <button className="btn-p" onClick={() => void connect()}>{root ? `폴더 다시 허락 (${root.name})` : '업무파일 폴더 연결'}</button>
          {root && <button className="btn-sm" onClick={() => void connect(true)}>다른 폴더 고르기</button>}
          <span style={{ color: 'var(--ink-3)' }}>
            {root ? '브라우저를 새로 열면 한 번 다시 허락해야 합니다.' : <>회사 폴더들이 들어 있는 폴더를 고르세요(예: <code>D:\Dropbox\0_우철업무\1000.업무\업무파일</code>). 읽기만 합니다.</>}
          </span>
        </div>
      ) : (
        <div style={{ fontSize: 'var(--fs-2)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ color: 'var(--ink-3)' }}>연결한 폴더 <b>{root.name}</b></span>
            <button className="btn-sm" onClick={() => void connect(true)} title="회사 폴더들이 든 폴더(업무파일)를 다시 고릅니다">폴더 바꾸기</button>
            <span style={{ color: 'var(--ink-3)' }}>/</span>
            <select className="btn-sm" value={company ?? ''} onChange={(e) => { setCompany(e.target.value || null); if (e.target.value) rememberFolder(eng.entityId, e.target.value); }}>
              <option value="">— 회사 폴더 고르기 —</option>
              {companies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {!company && (companies.length < 10
              ? <span style={{ color: 'var(--warn)' }}>「{root.name}」 아래에 회사 폴더가 거의 없습니다 — 회사 폴더들이 든 <b>업무파일</b> 폴더를 고르셨는지 보시고, 아니면 [폴더 바꾸기]를 누르세요.</span>
              : <span style={{ color: 'var(--warn)' }}>「{eng.entityName}」 폴더를 이름으로 찾지 못했습니다 — 한 번 골라 주시면 기억합니다.</span>)}
            {busy === 'scan' && <span style={{ color: 'var(--ink-3)' }}>찾는 중…</span>}
          </div>
          {company && (
            <>
              <div style={{ fontWeight: 700, marginTop: 6 }}>전기 FY{eng.fy - 1} — {prior.year ?? <span style={{ color: 'var(--warn)', fontWeight: 400 }}>{eng.fy - 1}_회계감사 폴더가 없습니다</span>}</div>
              {prior.found && (
                <>
                  {row('전기 일반조서', 'gwp', prior.found.일반조서, (c) => !canRoll ? (
                    <span style={{ color: 'var(--ink-3)' }}>↑ 위의 <b>당기 세팅</b>을 먼저 저장하세요 — 그러면 이월본 버튼이 생깁니다</span>
                  ) : (
                    <button className="btn-sm btn-sm-navy" disabled={!canWrite || !canRoll || !!busy} title={canRoll ? '' : '당기 세팅·표준양식이 먼저 필요합니다'}
                      onClick={() => { if (!hasBook || confirm('올해 판이 이미 있습니다. 이 파일로 이월본을 다시 만들까요? (새 판이 생깁니다)')) void roll(c); }}>
                      {busy === 'roll' ? '만드는 중…' : !canRoll ? '이월본은 당기 세팅 저장 뒤에' : hasBook ? '이 파일로 이월본 다시 만들기' : '이 파일로 이월본 만들기'}
                    </button>
                  ))}
                  {row('전기 DSD', 'dsd', prior.found.감사보고서, (c) => already(c.name, '전기DSD')
                    ? <span style={{ color: 'var(--good)' }}>자료함에 있음 ✓</span>
                    : <button className="btn-sm btn-sm-navy" disabled={!canWrite || !!busy} onClick={() => void up('prior', c, '전기DSD', '전기 DSD')}>{busy === 'up:전기DSD' ? '올리는 중…' : '자료함에 올리기'}</button>)}
                </>
              )}
              <div style={{ fontWeight: 700, marginTop: 10 }}>당기 FY{eng.fy} — {cur.year ?? <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>아직 폴더가 없습니다(정산표는 기말감사 때)</span>}</div>
              {cur.found && row('정산표', 'wtb', cur.found.정산표, (c) => (
                <>
                  {already(c.name, '수정전정산표') ? <span style={{ color: 'var(--good)' }}>수정전 ✓</span>
                    : <button className="btn-sm" disabled={!canWrite || !!busy} onClick={() => void up('cur', c, '수정전정산표', '정산표(수정전)')}>수정전으로 올리기(2차)</button>}
                  {already(c.name, '정산표') ? <span style={{ color: 'var(--good)' }}>확정 ✓</span>
                    : <button className="btn-sm btn-sm-navy" disabled={!canWrite || !!busy} onClick={() => void up('cur', c, '정산표', '확정 정산표')}>확정으로 올리기(3차)</button>}
                </>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
