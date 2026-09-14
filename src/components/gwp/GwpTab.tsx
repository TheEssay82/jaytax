// 일반업무관리 › 📘 일반조서 관리 — 한공회 표준 일반조서(1000~9000)를 회사·사업연도마다 짓고 이어 간다.
//
// 사무소가 손으로 하던 일(사용자 2026-09-15): 전기 일반조서 + 당기 양식이 바뀌었는지 확인 + 당기 내용 기재.
//   ① 작업 건(주석·DSD 와 같은 거래처×사업연도)을 고른다.
//   ② 표준양식(연도×기준)이 등록돼 있어야 한다.
//   ③ 전기 파일이 있으면 「이월본 만들기」, 없으면(초도) 「양식으로 새로 만들기」 — 둘 다 브라우저에서 짓고
//      서버에 1판으로 올린 뒤 내려받는다.
//   ④ 채운 파일을 다시 올리면 판이 쌓인다. 마지막에 최종본으로 표시한다 — 내년의 「전기 파일」이 된다.
// 조서 파일은 판이 쌓일 뿐 지우지 않는다(외감법 제19조). 열람은 감사팀(최고관리자·회계사)만.
import { useEffect, useMemo, useState } from 'react';
import Empty from '../common/Empty';
import { useAuth } from '../../context/AuthContext';
import { listBizEntities, type BizEntityFull } from '../../lib/bizRegistryApi';
import {
  listEngagements, listAuditEntityIds, findEngagement, updateEngagement,
  type Engagement, type Basis,
} from '../../lib/dsdApi';
import { BASES, defaultAuditFy } from '../../lib/dsdNotes';
import {
  listTemplates, listBooks, addBook, setBookKind, pickBase, fileBytes, fileUrl, fmtKb,
  type GwpTemplate, type GwpBook, type BookKind,
} from '../../lib/gwpApi';
import { readBundle } from '../../lib/gwpTemplate';
import { readWorkbook } from '../../lib/xlsxRead';
import { buildCatalog, sectionOf, type Catalog, type CatalogSheet } from '../../lib/gwpCatalog';
import { rollWorkbook, type RollReport } from '../../lib/gwpRoll';
import { assembleWorkbook, type AssembleReport } from '../../lib/gwpAssemble';
import NewEngagementModal from '../dsd/NewEngagementModal';
import { safeName, download } from '../dsd/dsdUi';
import GwpTemplatesCard from './GwpTemplatesCard';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type Status = '미착수' | '작성중' | '작성완료' | '숨김';
const STATUS_TONE: Record<Status, { bg: string; ink: string }> = {
  미착수: { bg: 'var(--surface-2)', ink: 'var(--ink-3)' },
  작성중: { bg: 'var(--warn-bg)', ink: 'var(--warn)' },
  작성완료: { bg: 'var(--good-bg)', ink: 'var(--good)' },
  숨김: { bg: 'transparent', ink: 'var(--ink-4)' },
};
function statusOf(s: CatalogSheet): Status {
  if (s.hidden) return '숨김';
  if (s.head.date) return '작성완료';
  if (s.head.author) return '작성중';
  return '미착수';
}
const KIND_TONE: Record<BookKind, { bg: string; ink: string }> = {
  이월본: { bg: 'var(--surface-2)', ink: 'var(--ink-2)' },
  작업중: { bg: 'var(--warn-bg)', ink: 'var(--warn)' },
  최종본: { bg: 'var(--good-bg)', ink: 'var(--good)' },
};
function kdate(iso: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일` : iso;
}

export default function GwpTab() {
  const { role, readonly } = useAuth();
  const canWrite = !readonly && (role === 'superuser' || role === 'accountant');
  const [engs, setEngs] = useState<Engagement[]>([]);
  const [ents, setEnts] = useState<BizEntityFull[]>([]);
  const [auditIds, setAuditIds] = useState<Set<string>>(new Set());
  const [templates, setTemplates] = useState<GwpTemplate[]>([]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [books, setBooks] = useState<GwpBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [adding, setAdding] = useState(false);
  const [sub, setSub] = useState<'work' | 'tpl'>('work');
  const [report, setReport] = useState<RollReport | null>(null);
  const [assembled, setAssembled] = useState<AssembleReport | null>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [asFinal, setAsFinal] = useState(false);
  const [fyAt, setFyAt] = useState<number | null>(null);

  async function load(keep?: string) {
    try {
      setErr(null);
      const [list, es, aud, tpls] = await Promise.all([listEngagements(), listBizEntities(), listAuditEntityIds(), listTemplates()]);
      setEngs(list.filter((e) => !e.isDemo));
      setEnts(es); setAuditIds(aud); setTemplates(tpls);
      const id = keep ?? pickedId ?? null;
      setPickedId(id);
      setBooks(id ? await listBooks(id) : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const picked = useMemo(() => engs.find((e) => e.id === pickedId) ?? null, [engs, pickedId]);
  const years = useMemo(() => [...new Set(engs.map((e) => e.fy))].sort((a, b) => b - a), [engs]);
  const fy = fyAt ?? years[0] ?? defaultAuditFy();
  const inYear = useMemo(() => engs.filter((e) => e.fy === fy), [engs, fy]);
  const tpl = useMemo(() => (picked ? templates.find((t) => t.fy === picked.fy && t.basis === picked.basis) ?? null : null), [templates, picked]);
  const latest = books[0] ?? null;

  async function pick(id: string) {
    setPickedId(id); setReport(null); setAssembled(null); setMsg(null);
    try { setBooks(await listBooks(id)); } catch (e) { setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'); }
  }

  /** 이월본 — 전기 건의 최종본(없으면 최신 판) + 당기 양식. */
  async function makeRoll() {
    if (!picked || !tpl) return;
    setBusy('roll'); setErr(null); setMsg(null); setReport(null); setAssembled(null);
    try {
      const prev = await findEngagement(picked.entityId, picked.fy - 1, picked.scope);
      if (!prev) throw new Error(`FY${picked.fy - 1} 작업 건이 없습니다. 초도면 「양식으로 새로 만들기」를 쓰십시오.`);
      const base = pickBase(await listBooks(prev.id));
      if (!base) throw new Error(`FY${picked.fy - 1} 건에 올린 조서 파일이 없습니다. 전기 파일을 그 건에 먼저 올리십시오.`);
      const { catalog, files } = readBundle(await fileBytes(tpl.storagePath));
      const prior = await fileBytes(base.storagePath);
      const r = rollWorkbook(prior, catalog, files, { fy: picked.fy, closing: picked.periodTo ?? undefined });
      const name = `일반조서_${safeName(picked.entityName)}_FY${picked.fy}_이월본.xlsx`;
      const book = await addBook(picked.id, '이월본', { name, bytes: r.bytes }, r.catalog,
        `FY${prev.fy} ${base.kind} v${base.version}(${base.fileName}) + ${tpl.fy} ${tpl.basis} 양식`);
      download(r.bytes, name, XLSX);
      setBooks(await listBooks(picked.id));
      setReport(r.report);
      const by = (a: string) => r.report.sheets.filter((s) => s.action === a).length;
      setMsg(`이월본 v${book.version}을 만들어 올리고 내려받았습니다 — 그대로 ${by('그대로')} · 갈아끼움 ${by('갈아끼움')} · 새 조서 ${by('새 조서')} · 양식 없음 ${by('양식 없음')} · 숨김 ${by('숨김 그대로')}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '만들지 못했습니다.');
    } finally {
      setBusy('');
    }
  }

  /** 초도 — 양식만으로. */
  async function makeNew() {
    if (!picked || !tpl) return;
    setBusy('new'); setErr(null); setMsg(null); setReport(null); setAssembled(null);
    try {
      const { catalog, files } = readBundle(await fileBytes(tpl.storagePath));
      const period = `제${picked.termNo ?? ''}기 ${kdate(picked.periodFrom)} ～ ${kdate(picked.periodTo)}`;
      const r = assembleWorkbook(catalog, files, {
        company: picked.entityName, closing: picked.periodTo ?? '', period, basis: picked.basis, firstYear: true,
      });
      const name = `일반조서_${safeName(picked.entityName)}_FY${picked.fy}_초도.xlsx`;
      const cat = buildCatalog(readWorkbook(r.bytes));
      const book = await addBook(picked.id, '이월본', { name, bytes: r.bytes }, cat, `${tpl.fy} ${tpl.basis} 양식으로 새로 지음(초도)`);
      download(r.bytes, name, XLSX);
      setBooks(await listBooks(picked.id));
      setAssembled(r.report);
      setMsg(`양식으로 새 워크북 v${book.version}을 지어 올리고 내려받았습니다 — 조서 시트 ${r.report.added.length}장.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '만들지 못했습니다.');
    } finally {
      setBusy('');
    }
  }

  /** 사람이 채운 파일을 새 판으로. */
  async function upload(f: File | undefined) {
    if (!f || !picked) return;
    setBusy('up'); setErr(null); setMsg(null);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const cat = buildCatalog(readWorkbook(bytes));
      const papers = cat.sheets.filter((s) => s.kind === 'paper').length;
      if (!papers) throw new Error('이 파일에서 조서 시트(1100·2110 … 꼴)를 찾지 못했습니다.');
      if (cat.company && !cat.company.replace(/\s|주식회사|㈜|\(주\)/g, '').includes(picked.entityName.replace(/\s|주식회사|㈜|\(주\)/g, ''))
        && !picked.entityName.replace(/\s|주식회사|㈜|\(주\)/g, '').includes(cat.company.replace(/\s|주식회사|㈜|\(주\)/g, ''))) {
        throw new Error(`표지의 회사명이 「${cat.company}」입니다 — 고른 작업 건(${picked.entityName})과 다릅니다.`);
      }
      const book = await addBook(picked.id, asFinal ? '최종본' : '작업중', { name: f.name, bytes }, cat);
      setBooks(await listBooks(picked.id));
      setMsg(`v${book.version}(${book.kind})으로 올렸습니다 — 조서 시트 ${papers}장.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '올리지 못했습니다.');
    } finally {
      setBusy('');
    }
  }

  async function markFinal(b: GwpBook) {
    try {
      await setBookKind(b.id, '최종본');
      setBooks(await listBooks(b.engagementId));
      setMsg(`v${b.version}을 최종본으로 표시했습니다. 내년 이월은 이 판에서 시작합니다.`);
    } catch (e) { setErr(e instanceof Error ? e.message : '바꾸지 못했습니다.'); }
  }

  if (loading) return <div className="card">불러오는 중…</div>;

  // 조서 목록·상태 — 최신 판의 목록에서.
  const cat: Catalog | null = latest?.catalog ?? null;
  const papers = (cat?.sheets ?? []).filter((s) => s.kind === 'paper');
  const indexBy = new Map((cat?.index ?? []).map((r) => [r.code, r]));
  const counts = papers.reduce((m, s) => { const k = statusOf(s); m[k] = (m[k] ?? 0) + 1; return m; }, {} as Record<Status, number>);

  return (
    <div>
      <div className="card">
        <div className="chdr">
          📘 일반조서 관리
          <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>
            {picked ? `${picked.entityName} · FY${picked.fy} ${picked.scope} · ${picked.basis}` : '작업 건을 고르세요'}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button className={`btn-sm${sub === 'work' ? ' btn-sm-navy' : ''}`} onClick={() => setSub('work')}>① 작업 건·조서</button>
            <button className={`btn-sm${sub === 'tpl' ? ' btn-sm-navy' : ''}`} onClick={() => setSub('tpl')}>② 표준양식 ({templates.length})</button>
            {canWrite && <button className="btn-sm" onClick={() => setAdding(true)}>+ 새 건 만들기</button>}
          </span>
        </div>
        <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7 }}>
          <b>전기 파일 + 당기 표준양식 → 당기 시작 파일.</b> 양식이 안 바뀐 조서는 그대로 두고, 바뀐 조서는 당기 양식으로
          갈아끼운 뒤 전기에 적은 것을 줄 이름으로 짝지어 옮깁니다. 못 옮긴 것은 알려 드립니다.
          <span style={{ color: 'var(--ink-3)' }}> 조서 파일은 판이 쌓일 뿐 지우지 않습니다(외부감사법 제19조). 감사팀만 봅니다.</span>
        </div>
      </div>

      {err && <div className="card" style={{ color: 'var(--bad)', background: 'var(--bad-bg)' }}>{err}</div>}
      {msg && (
        <div className="card" style={{ color: 'var(--good)', background: 'var(--good-bg)', display: 'flex' }}>
          {msg}<button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setMsg(null)}>닫기</button>
        </div>
      )}

      {sub === 'tpl' && <GwpTemplatesCard templates={templates} onChange={() => load(pickedId ?? undefined)} />}

      {sub === 'work' && (
        <>
          <div className="card" style={{ padding: '10px 12px 12px' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 9 }}>
              <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', letterSpacing: '.04em' }}>사업연도</span>
              {years.map((y) => (
                <button key={y} onClick={() => setFyAt(y)} style={{
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--fs-1)',
                  border: `1px solid ${y === fy ? 'var(--navy)' : 'var(--rule)'}`, background: y === fy ? 'var(--navy)' : '#fff',
                  color: y === fy ? '#fff' : 'var(--ink-2)', fontWeight: y === fy ? 700 : 400, borderRadius: 999, padding: '3px 11px',
                }}>FY{y}<span style={{ opacity: 0.7, marginLeft: 6, fontWeight: 400 }}>· {engs.filter((e) => e.fy === y).length}건</span></button>
              ))}
            </div>
            {engs.length === 0 && <Empty text="아직 작업 건이 없습니다. 「새 건 만들기」로 시작하세요." />}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {inYear.map((e) => (
                <button key={e.id} onClick={() => void pick(e.id)} style={{
                  textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', minWidth: 156,
                  border: `1px solid ${e.id === pickedId ? 'var(--navy)' : 'var(--rule)'}`,
                  background: e.id === pickedId ? 'var(--navy-bg)' : '#fff', borderRadius: 'var(--r-sm)', padding: '7px 11px',
                }}>
                  <div style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--navy)' }}>{e.entityName}</div>
                  <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginTop: 2 }}>{e.scope} · {e.basis}</div>
                </button>
              ))}
            </div>
          </div>

          {!picked ? (
            <div className="card"><Empty text="위에서 회사를 고르세요." /></div>
          ) : (
            <>
              <div className="card">
                <div className="chdr">
                  {picked.entityName}
                  <span style={{ fontSize: 'var(--fs-2)', fontWeight: 400, color: 'var(--ink-2)' }}>
                    FY{picked.fy} · {picked.scope}{picked.periodFrom ? ` · ${picked.periodFrom} ~ ${picked.periodTo}` : ''}
                  </span>
                  <label style={{ marginLeft: 'auto', fontSize: 'var(--fs-1)', color: 'var(--ink-3)', display: 'flex', gap: 5, alignItems: 'center' }}>
                    기준
                    <select className="btn-sm" value={picked.basis} disabled={!canWrite}
                      title="전기 일반기업이 당기 소규모가 될 수도, 반대도 됩니다. 양식 묶음이 이 값으로 정해집니다."
                      onChange={(ev) => void updateEngagement(picked.id, { basis: ev.target.value as Basis }).then(() => load(picked.id))}>
                      {BASES.map((b) => <option key={b}>{b}</option>)}
                    </select>
                  </label>
                </div>

                <div style={{ fontSize: 'var(--fs-2)', lineHeight: 1.7, marginBottom: 10 }}>
                  <b>표준양식</b>{' '}
                  {tpl ? (
                    <span style={{ color: 'var(--good)' }}>{tpl.fy} {tpl.basis} · {tpl.fileName} · 조서 시트 {tpl.catalog.sheets.filter((s) => s.code).length}장</span>
                  ) : (
                    <span style={{ color: 'var(--warn)' }}>FY{picked.fy} {picked.basis} 묶음이 없습니다 — ② 표준양식에서 등록하십시오.</span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button className="btn-p" disabled={!canWrite || !tpl || !!busy} onClick={() => void makeRoll()}
                    title="FY 전기 건의 최종본(없으면 최신 판)에 당기 양식을 맞춰 당기 시작 파일을 짓습니다.">
                    {busy === 'roll' ? '만드는 중…' : `이월본 만들기 (FY${picked.fy - 1} → FY${picked.fy})`}
                  </button>
                  <button className="btn-s" disabled={!canWrite || !tpl || !!busy} onClick={() => void makeNew()}
                    title="전기 파일이 없는 초도 외감 — 양식만으로 표지·목록·조서 시트를 짓습니다.">
                    {busy === 'new' ? '만드는 중…' : '양식으로 새로 만들기 (초도)'}
                  </button>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', fontSize: 'var(--fs-1)' }}>
                    <label style={{ color: 'var(--ink-3)' }}>
                      <input type="checkbox" checked={asFinal} onChange={(e) => setAsFinal(e.target.checked)} /> 최종본으로
                    </label>
                    <label className="btn-sm btn-sm-navy" style={{ cursor: canWrite && !busy ? 'pointer' : 'default', opacity: canWrite ? 1 : 0.5 }}>
                      {busy === 'up' ? '올리는 중…' : '채운 파일 올리기'}
                      <input type="file" accept=".xlsx" style={{ display: 'none' }} disabled={!canWrite || !!busy}
                        onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
                    </label>
                  </span>
                </div>

                {books.length > 0 && (
                  <div className="tbl-wide" style={{ marginTop: 12 }}>
                    <table className="tbl">
                      <thead>
                        <tr style={{ background: 'var(--surface-2)' }}>
                          <th style={{ width: 40 }}>판</th><th style={{ width: 70 }}>종류</th><th>파일</th>
                          <th style={{ width: 90 }}>올린 날</th><th style={{ width: 150 }}>올린 사람</th><th style={{ width: 170 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {books.map((b) => (
                          <tr key={b.id}>
                            <td style={{ textAlign: 'center' }}>v{b.version}</td>
                            <td><span style={{ padding: '1px 8px', borderRadius: 999, fontSize: 'var(--fs-0)', fontWeight: 700, background: KIND_TONE[b.kind].bg, color: KIND_TONE[b.kind].ink }}>{b.kind}</span></td>
                            <td>{b.fileName} <span style={{ color: 'var(--ink-3)' }}>· {fmtKb(b.fileSize)}</span>{b.memo && <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-4)' }}>{b.memo}</div>}</td>
                            <td style={{ color: 'var(--ink-3)' }}>{b.createdAt.slice(0, 10)}</td>
                            <td style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-0)' }}>{b.uploadedEmail ?? ''}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <button className="btn-sm" onClick={() => void fileUrl(b.storagePath, b.fileName).then((u) => window.open(u, '_blank', 'noopener')).catch((e) => setErr(e instanceof Error ? e.message : '내려받지 못했습니다.'))}>내려받기</button>{' '}
                              {canWrite && b.kind !== '최종본' && <button className="btn-sm" onClick={() => void markFinal(b)}>최종본으로</button>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {report && (
                <div className="card">
                  <div className="chdr">이월 결과<span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>
                    결산일 {report.cover.closing ?? '-'} · 대상기간 {report.cover.period ?? '-'} · 감사보고서일 비움 · 조서목록 작성일 {report.index.datesCleared}칸 비움
                  </span></div>
                  {report.warnings.map((w) => <div key={w} style={{ color: 'var(--warn)', fontSize: 'var(--fs-2)' }}>{w}</div>)}
                  <div className="tbl-wide">
                    <table className="tbl">
                      <thead><tr style={{ background: 'var(--surface-2)' }}>
                        <th style={{ width: 90 }}>처리</th><th style={{ width: 110 }}>조서</th><th>시트</th><th style={{ width: 70 }}>양식 일치</th><th style={{ width: 60 }}>옮김</th><th style={{ width: 70 }}>못 옮김</th><th>비고</th>
                      </tr></thead>
                      <tbody>
                        {report.sheets.map((s) => (
                          <tr key={s.name} style={{ opacity: s.action === '숨김 그대로' ? 0.55 : 1 }}>
                            <td style={{ fontWeight: s.action === '갈아끼움' || s.action === '새 조서' ? 700 : 400, color: s.action === '양식 없음' ? 'var(--warn)' : undefined }}>{s.action}</td>
                            <td>{s.code}</td>
                            <td>{s.name}</td>
                            <td style={{ textAlign: 'right' }}>{s.score != null ? `${Math.round(s.score * 100)}%` : ''}</td>
                            <td style={{ textAlign: 'right' }}>{s.moved ?? ''}</td>
                            <td style={{ textAlign: 'right', color: s.left?.length ? 'var(--warn)' : undefined }}>{s.left?.length || ''}</td>
                            <td style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)' }}>{s.note ?? (s.template ? s.template.split('/').pop() : '')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {report.sheets.some((s) => s.left?.length) && (
                    <div style={{ marginTop: 8 }}>
                      <button className="btn-sm" onClick={() => setShowLeft(!showLeft)}>
                        {showLeft ? '못 옮긴 것 접기' : `못 옮긴 것 펴기 (${report.sheets.reduce((n, s) => n + (s.left?.length ?? 0), 0)}칸)`}
                      </button>
                      {showLeft && (
                        <div style={{ marginTop: 6, maxHeight: 320, overflow: 'auto', fontSize: 'var(--fs-0)', color: 'var(--ink-2)', lineHeight: 1.6 }}>
                          {report.sheets.filter((s) => s.left?.length).map((s) => (
                            <div key={s.name} style={{ marginBottom: 6 }}>
                              <b>{s.name}</b>
                              {s.left!.map((l) => <div key={l.from} style={{ paddingLeft: 10 }}>{l.from} = {l.value.slice(0, 60)} <span style={{ color: 'var(--ink-4)' }}>— {l.why}</span></div>)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {assembled && (
                <div className="card" style={{ fontSize: 'var(--fs-2)', lineHeight: 1.7 }}>
                  <b>양식으로 지은 시트 {assembled.added.length}장</b> — {assembled.added.map((a) => a.code).join(' · ')}
                  {assembled.skipped.length > 0 && <div style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-0)' }}>뺀 것: {assembled.skipped.map((s) => `${s.name}(${s.why})`).join(' · ')}</div>}
                </div>
              )}

              <div className="card">
                <div className="chdr">
                  조서 목록·상태
                  <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>
                    {latest ? `v${latest.version} ${latest.kind} 기준 · ${(['미착수', '작성중', '작성완료', '숨김'] as Status[]).map((k) => `${k} ${counts[k] ?? 0}`).join(' · ')}` : '올린 파일이 없습니다'}
                  </span>
                </div>
                {!cat ? (
                  <Empty text="이월본을 만들거나 파일을 올리면 조서마다 작성자·검토자·일자가 여기에 보입니다." />
                ) : (
                  <div className="tbl-wide">
                    <table className="tbl">
                      <thead><tr style={{ background: 'var(--surface-2)' }}>
                        <th style={{ width: 90 }}>묶음</th><th style={{ width: 90 }}>조서</th><th>조서명</th><th style={{ width: 110 }}>시트</th>
                        <th style={{ width: 40 }}>수행</th><th style={{ width: 80 }}>작성자</th><th style={{ width: 80 }}>검토자</th><th style={{ width: 100 }}>일자</th><th style={{ width: 80 }}>상태</th>
                      </tr></thead>
                      <tbody>
                        {papers.map((s) => {
                          const st = statusOf(s);
                          const ix = indexBy.get((s.code ?? '').replace(/\(.*$/, ''));
                          return (
                            <tr key={s.name} style={{ opacity: s.hidden ? 0.5 : 1 }}>
                              <td style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-0)' }}>{sectionOf(s.code ?? '')}</td>
                              <td>{s.code}</td>
                              <td>{ix?.title ?? ''}</td>
                              <td style={{ color: 'var(--ink-3)' }}>{s.name}</td>
                              <td style={{ textAlign: 'center' }}>{ix?.performed ? 'O' : ''}</td>
                              <td>{s.head.author}</td>
                              <td>{s.head.reviewer}</td>
                              <td style={{ fontVariantNumeric: 'tabular-nums' }}>{s.head.date}</td>
                              <td><span style={{ padding: '1px 8px', borderRadius: 999, fontSize: 'var(--fs-0)', fontWeight: 600, background: STATUS_TONE[st].bg, color: STATUS_TONE[st].ink }}>{st}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-4)', marginTop: 6 }}>
                  작성자·일자는 각 조서 머리에서 읽습니다(조서목록 링크의 계산값). 엑셀에서 저장한 파일이어야 값이 보입니다.
                </div>
              </div>
            </>
          )}
        </>
      )}

      {adding && (
        <NewEngagementModal
          entities={ents} auditIds={auditIds}
          onClose={() => setAdding(false)}
          onDone={async (id) => { setAdding(false); await load(id); setMsg('작업 건을 만들었습니다.'); }}
          onError={(m) => setErr(m)}
        />
      )}
    </div>
  );
}
