// 일반업무관리 › 📘 일반조서 관리 — 한공회 표준 일반조서(1000~9000)를 회사·사업연도마다 짓고 이어 간다.
//
// 사무소가 손으로 하던 일(사용자 2026-09-15): 전기 일반조서 + 당기 양식이 바뀌었는지 확인 + 당기 내용 기재.
//   ① 작업 건(주석·DSD 와 같은 거래처×사업연도)을 고른다.
//   ② 표준양식(연도×기준)이 등록돼 있어야 한다.
//   ③ 전기 파일이 있으면 「이월본 만들기」, 없으면(초도) 「양식으로 새로 만들기」 — 둘 다 브라우저에서 짓고
//      서버에 1판으로 올린 뒤 내려받는다.
//   ④ 채운 파일을 다시 올리면 판이 쌓인다. 마지막에 최종본으로 표시한다 — 내년의 「전기 파일」이 된다.
// 조서 파일은 판이 쌓일 뿐 지우지 않는다(외감법 제19조). 열람은 감사팀(최고관리자·회계사)만.
import { Fragment, useEffect, useMemo, useState } from 'react';
import Empty from '../common/Empty';
import { useAuth } from '../../context/AuthContext';
import { listBizEntities, type BizEntityFull } from '../../lib/bizRegistryApi';
import {
  listEngagements, listAuditEntityIds, findEngagement,
  type Engagement,
} from '../../lib/dsdApi';
import { defaultAuditFy } from '../../lib/dsdNotes';
import { AUDIT_BASIS_LABEL, basisMismatch, rollBlockedBy } from '../../lib/gwpSetup';
import { listYears, auditContractCpa, type GwpYear } from '../../lib/gwpYearApi';
import GwpSetupCard from './GwpSetupCard';
import {
  listTemplates, listBooks, addBook, setBookKind, pickBase, fileBytes, fileUrl, fmtKb,
  type GwpTemplate, type GwpBook, type BookKind,
} from '../../lib/gwpApi';
import { readBundle } from '../../lib/gwpTemplate';
import { readWorkbook } from '../../lib/xlsxRead';
import { buildCatalog, sectionOf, type Catalog, type CatalogSheet } from '../../lib/gwpCatalog';
import { rollWorkbook, type RollReport } from '../../lib/gwpRoll';
import { assembleWorkbook, type AssembleReport } from '../../lib/gwpAssemble';
import { tabStateOf } from '../../lib/xlsxMark';
import NewEngagementModal from '../dsd/NewEngagementModal';
import { safeName, download } from '../dsd/dsdUi';
import GwpTemplatesCard from './GwpTemplatesCard';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// 상태는 **시트 탭 색**으로 읽는다 — 사무소 관행(사용자 2026-09-27): 빨강 = 올해 아직 손 안 댐 · 노랑 = 수정함 ·
// 초록 = 확인했고 새로 넣을 것 없음. 탭 색이 없는 옛 파일만 머리의 작성자·일자로 짐작한다.
type Status = '손 안 댐' | '수정함' | '변경 없음' | '작성중' | '작성완료' | '숨김';
const STATUS_ORDER: Status[] = ['손 안 댐', '수정함', '변경 없음', '작성중', '작성완료', '숨김'];
const STATUS_TONE: Record<Status, { bg: string; ink: string; dot?: string }> = {
  '손 안 댐': { bg: 'var(--bad-bg)', ink: 'var(--bad)', dot: '#FF0000' },
  수정함: { bg: 'var(--warn-bg)', ink: 'var(--warn)', dot: '#FFFF00' },
  '변경 없음': { bg: 'var(--good-bg)', ink: 'var(--good)', dot: '#00B050' },
  작성중: { bg: 'var(--warn-bg)', ink: 'var(--warn)' },
  작성완료: { bg: 'var(--good-bg)', ink: 'var(--good)' },
  숨김: { bg: 'transparent', ink: 'var(--ink-4)' },
};
/** 머리 값 가운데 깨진 것(0·#REF!)은 없는 것으로 — 전기 파일의 끊긴 링크다. */
const clean = (v: string | undefined) => (!v || v === '0' || v.startsWith('#') ? '' : v);
function statusOf(s: CatalogSheet, fromRoll = false): Status {
  if (s.hidden) return '숨김';
  const t = tabStateOf(s.tab);
  if (t === 'red') return '손 안 댐';
  if (t === 'yellow') return '수정함';
  if (t === 'green') return '변경 없음';
  // 이월본은 아직 아무도 쓰지 않은 판이다 — 작년 날짜가 박힌 시트를 「작성완료」로 읽지 않는다(2026-09-27).
  if (fromRoll) return '손 안 댐';
  if (s.head.date) return '작성완료';
  if (s.head.author) return '작성중';
  return '손 안 댐';
}
const KIND_TONE: Record<BookKind, { bg: string; ink: string }> = {
  이월본: { bg: 'var(--surface-2)', ink: 'var(--ink-2)' },
  작업중: { bg: 'var(--warn-bg)', ink: 'var(--warn)' },
  최종본: { bg: 'var(--good-bg)', ink: 'var(--good)' },
};
/** 표지 회사명과 작업 건 거래처명이 같은 회사인가 — 「주식회사·㈜·(주)·공백」은 떼고 한쪽이 다른 쪽을 품으면 같다고 본다. */
function sameCompany(a: string, b: string): boolean {
  const n = (s: string) => s.replace(/\s|주식회사|㈜|\(주\)/g, '');
  return n(a).includes(n(b)) || n(b).includes(n(a));
}
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
  // 당기 세팅(조서 양식 기준·검토자·작성자) — 작업 건 id → 세팅. 0152.
  const [yearsBy, setYearsBy] = useState<Map<string, GwpYear>>(new Map());
  const [setupOpen, setSetupOpen] = useState(false);
  const [prior, setPrior] = useState<{ fy: number; year: GwpYear } | null>(null);
  const [contractCpa, setContractCpa] = useState<string | null>(null);
  // 전기 조서가 시스템에 없을 때(첫 해) — 이월 버튼이 파일을 직접 받는다. 전기 작업 건을 따로 만들 필요가 없다.
  const [askPrior, setAskPrior] = useState(false);
  // 마지막 이월에 쓴 전기 파일 — 「고른 것 반영해 다시 만들기」가 같은 전기에서 다시 짓는다.
  const [lastPrior, setLastPrior] = useState<{ bytes: Uint8Array; label: string } | null>(null);
  const [pickReplace, setPickReplace] = useState<Set<string>>(new Set());
  const [pickAdd, setPickAdd] = useState<Set<string>>(new Set());
  /** 이월 결과에서 「다른 문구」를 펼친 시트 */
  const [openDiff, setOpenDiff] = useState<string | null>(null);

  async function load(keep?: string) {
    try {
      setErr(null);
      const [list, es, aud, tpls, ys] = await Promise.all([listEngagements(), listBizEntities(), listAuditEntityIds(), listTemplates(), listYears()]);
      const live = list.filter((e) => !e.isDemo);
      setEngs(live);
      setEnts(es); setAuditIds(aud); setTemplates(tpls); setYearsBy(ys);
      const id = keep ?? pickedId ?? null;
      setPickedId(id);
      setBooks(id ? await listBooks(id) : []);
      const pe = id ? live.find((e) => e.id === id) : null;
      if (pe) await loadSetupContext(pe, ys);
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
  const year = picked ? yearsBy.get(picked.id) ?? null : null;
  // 표준양식은 **조서 양식 기준**으로 고른다(재무제표 회계기준이 아니다).
  const tpl = useMemo(() => (picked && year ? templates.find((t) => t.fy === picked.fy && t.basis === year.auditBasis) ?? null : null), [templates, picked, year]);
  const latest = books[0] ?? null;

  /** 세팅 대화에 쓸 것 — 전기 건의 세팅과 감사계약의 담당회계사. */
  async function loadSetupContext(e: Engagement, ys: Map<string, GwpYear> = yearsBy) {
    const [prev, cpa] = await Promise.all([findEngagement(e.entityId, e.fy - 1, e.scope), auditContractCpa(e.entityId, e.fy)]);
    const py = prev ? ys.get(prev.id) ?? null : null;
    setPrior(prev && py ? { fy: prev.fy, year: py } : null);
    setContractCpa(cpa);
  }

  async function pick(id: string) {
    setPickedId(id); setReport(null); setAssembled(null); setMsg(null); setSetupOpen(false); setAskPrior(false); setLastPrior(null); setPickReplace(new Set()); setPickAdd(new Set());
    try {
      setBooks(await listBooks(id));
      const e = engs.find((x) => x.id === id);
      if (e) await loadSetupContext(e);
    } catch (e) { setErr(e instanceof Error ? e.message : '불러오지 못했습니다.'); }
  }

  /** 이월본 — 전기 건의 최종본(없으면 최신 판) + 당기 양식. */
  async function makeRoll() {
    if (!picked || !tpl || !year) return;
    const blocked = rollBlockedBy(prior?.year.auditBasis, year.auditBasis);
    if (blocked) { setErr(blocked); return; }
    setBusy('roll'); setErr(null); setMsg(null); setReport(null); setAssembled(null);
    try {
      const prev = await findEngagement(picked.entityId, picked.fy - 1, picked.scope);
      const base = prev ? pickBase(await listBooks(prev.id)) : null;
      if (!prev || !base) { setAskPrior(true); return; }   // 첫 해 — 전기 파일을 직접 고르게 한다
      await rollFrom(await fileBytes(base.storagePath), `FY${prev.fy} ${base.kind} v${base.version}(${base.fileName})`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '만들지 못했습니다.');
    } finally {
      setBusy('');
    }
  }

  /** 드롭박스 등에서 고른 전기 파일로 이월 — 첫 해에만 쓴다. 회사명이 맞는지 먼저 본다. */
  async function rollFromFile(f: File | undefined) {
    if (!f || !picked) return;
    setBusy('roll'); setErr(null); setMsg(null);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const cat = buildCatalog(readWorkbook(bytes));
      if (!cat.sheets.some((s) => s.kind === 'paper')) throw new Error('이 파일에서 조서 시트(1100·2110 … 꼴)를 찾지 못했습니다.');
      if (cat.company && !sameCompany(cat.company, picked.entityName)) {
        throw new Error(`고른 파일의 표지 회사명이 「${cat.company}」입니다 — ${picked.entityName} 의 전기 조서가 맞는지 확인하세요.`);
      }
      setAskPrior(false);
      await rollFrom(bytes, `전기 파일 직접 선택 — ${f.name}(FY${picked.fy - 1}, 시스템 밖)`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '만들지 못했습니다.');
    } finally {
      setBusy('');
    }
  }

  /** 전기 워크북 바이트 + 당기 양식 → 이월본을 짓고 올리고 내려받는다. */
  async function rollFrom(priorBytes: Uint8Array, source: string, pick: { replace?: string[]; addCodes?: string[] } = {}) {
    if (!picked || !tpl || !year) return;
    setBusy('roll'); setErr(null);
    setLastPrior({ bytes: priorBytes, label: source });
    try {
      const { catalog, files } = readBundle(await fileBytes(tpl.storagePath));
      const r = rollWorkbook(priorBytes, catalog, files, { fy: picked.fy, closing: picked.periodTo ?? undefined, reviewer: year.partner, replace: pick.replace, addCodes: pick.addCodes });
      const name = `일반조서_${safeName(picked.entityName)}_FY${picked.fy}_이월본.xlsx`;
      const book = await addBook(picked.id, '이월본', { name, bytes: r.bytes }, r.catalog,
        `${source} + ${tpl.fy} ${tpl.basis} 양식${pick.replace?.length ? ` · 갈아끼움 ${pick.replace.join(',')}` : ''}${pick.addCodes?.length ? ` · 넣음 ${pick.addCodes.join(',')}` : ''}`);
      download(r.bytes, name, XLSX);
      setBooks(await listBooks(picked.id));
      setReport(r.report);
      setPickReplace(new Set()); setPickAdd(new Set());
      const by = (a: string) => r.report.sheets.filter((s) => s.action === a).length;
      setMsg(`이월본 v${book.version}을 만들어 올리고 내려받았습니다 — 작년 그대로 ${by('그대로') + by('양식 없음')} · 숨김 ${by('숨김 그대로')}${by('갈아끼움') ? ` · 갈아끼움 ${by('갈아끼움')}` : ''}${by('새 조서') ? ` · 새 조서 ${by('새 조서')}` : ''}. 아래 「이월 결과」에서 확인하세요.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '만들지 못했습니다.');
    } finally {
      setBusy('');
    }
  }

  /**
   * 올해 양식 참고 파일 — 작년과 문구가 다른 조서만 올해 양식으로 모아, 다른 문구에 노란 바탕을 칠해 내려받는다.
   * 사용자 2026-09-27: 「올해 수정된 표준조서양식이 있다면 참고는 할 수 있어야 합니다」. 판으로 올리지 않는다(참고용).
   */
  async function downloadReference(differ: RollReport['sheets']) {
    if (!picked || !tpl || !year) return;
    setBusy('ref'); setErr(null);
    try {
      const { catalog, files } = readBundle(await fileBytes(tpl.storagePath));
      const highlight: Record<string, string[]> = {};
      for (const d of differ) highlight[d.tplCode ?? d.code] = d.differRefs ?? [];
      const period = `제${picked.termNo ?? ''}기 ${kdate(picked.periodFrom)} ～ ${kdate(picked.periodTo)}`;
      const r = assembleWorkbook(catalog, files, {
        company: picked.entityName, closing: picked.periodTo ?? '', period, basis: year.auditBasis, firstYear: false,
        only: differ.map((d) => d.tplCode ?? d.code), highlight,
      });
      download(r.bytes, `참고_${tpl.fy}양식_${safeName(picked.entityName)}_다른조서${r.report.added.length}개.xlsx`, XLSX);
      setMsg(`올해(${tpl.fy}) 양식 참고 파일을 내려받았습니다 — 조서 ${r.report.added.length}개, 작년과 다른 문구는 노란 바탕입니다. 이 파일은 참고용이라 판으로 올리지 않았습니다.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '만들지 못했습니다.');
    } finally {
      setBusy('');
    }
  }

  /** 초도 — 양식만으로. */
  async function makeNew() {
    if (!picked || !tpl || !year) return;
    setBusy('new'); setErr(null); setMsg(null); setReport(null); setAssembled(null);
    try {
      const { catalog, files } = readBundle(await fileBytes(tpl.storagePath));
      const period = `제${picked.termNo ?? ''}기 ${kdate(picked.periodFrom)} ～ ${kdate(picked.periodTo)}`;
      const r = assembleWorkbook(catalog, files, {
        company: picked.entityName, closing: picked.periodTo ?? '', period, basis: year.auditBasis, firstYear: true,
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
  const fromRoll = latest?.kind === '이월본';
  const counts = papers.reduce((m, s) => { const k = statusOf(s, fromRoll); m[k] = (m[k] ?? 0) + 1; return m; }, {} as Record<Status, number>);

  return (
    <div>
      <div className="card">
        <div className="chdr">
          📘 일반조서 관리
          <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>
            {picked ? `${picked.entityName} · FY${picked.fy} ${picked.scope} · 조서 ${year ? AUDIT_BASIS_LABEL[year.auditBasis] : '세팅 전'}` : '작업 건을 고르세요'}
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
                  <div style={{ fontSize: 'var(--fs-1)', color: yearsBy.get(e.id) ? 'var(--ink-3)' : 'var(--warn)', marginTop: 2 }}>
                    {e.scope} · {yearsBy.get(e.id) ? `조서 ${AUDIT_BASIS_LABEL[yearsBy.get(e.id)!.auditBasis]}` : '세팅 전'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {!picked ? (
            <div className="card"><Empty text="위에서 회사를 고르세요." /></div>
          ) : (
            <>
              {(!year || setupOpen) && (
                <GwpSetupCard key={`${picked.id}:${year?.updatedAt ?? 'new'}`} eng={picked} year={year} prior={prior} contractCpa={contractCpa} canWrite={canWrite}
                  onCancel={year ? () => setSetupOpen(false) : undefined}
                  onSaved={(y) => {
                    setYearsBy((m) => new Map(m).set(y.engagementId, y)); setSetupOpen(false);
                    setMsg(`당기 세팅을 저장했습니다 — 조서 ${AUDIT_BASIS_LABEL[y.auditBasis]} · 검토자 ${y.partner} · 작성자 ${y.authorDefault ?? '-'}.`);
                  }} />
              )}
              <div className="card">
                <div className="chdr">
                  {picked.entityName}
                  <span style={{ fontSize: 'var(--fs-2)', fontWeight: 400, color: 'var(--ink-2)' }}>
                    FY{picked.fy} · {picked.scope}{picked.periodFrom ? ` · ${picked.periodFrom} ~ ${picked.periodTo}` : ''}
                  </span>
                  {year && (
                    <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-1)', color: 'var(--ink-2)', display: 'flex', gap: 8, alignItems: 'center' }}>
                      조서 <b>{AUDIT_BASIS_LABEL[year.auditBasis]}</b> · 검토자 <b>{year.partner}</b> · 작성자 <b>{year.authorDefault ?? '-'}</b>
                      {year.basisConfirmedAt && <span style={{ color: 'var(--ink-4)' }}>· 확인 {year.basisConfirmedAt.slice(0, 10)}</span>}
                      {canWrite && <button className="btn-sm" onClick={() => setSetupOpen(true)}>세팅 고치기</button>}
                    </span>
                  )}
                </div>
                {year && basisMismatch(year.auditBasis, picked.basis) && (
                  <div style={{ color: 'var(--bad)', fontSize: 'var(--fs-2)', marginBottom: 8 }}>
                    조서는 「{AUDIT_BASIS_LABEL[year.auditBasis]}」인데 주석·DSD 의 재무제표 회계기준은 「{picked.basis}」입니다 — 둘 중 하나를 확인하세요.
                  </div>
                )}

                <div style={{ fontSize: 'var(--fs-2)', lineHeight: 1.7, marginBottom: 10 }}>
                  <b>표준양식</b>{' '}
                  {!year ? (
                    <span style={{ color: 'var(--warn)' }}>당기 세팅을 먼저 마치세요 — 조서 기준이 정해져야 양식이 골라집니다.</span>
                  ) : tpl ? (
                    <span style={{ color: 'var(--good)' }}>{tpl.fy} {tpl.basis} · {tpl.fileName} · 조서 시트 {tpl.catalog.sheets.filter((s) => s.code).length}장</span>
                  ) : (
                    <span style={{ color: 'var(--warn)' }}>FY{picked.fy} {year.auditBasis} 묶음이 없습니다 — ② 표준양식에서 등록하십시오.</span>
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

                {askPrior && (
                  <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 12, background: 'var(--surface-2)', fontSize: 'var(--fs-2)', lineHeight: 1.7 }}>
                    <b>FY{picked.fy - 1} 조서가 시스템에 아직 없습니다</b> — 이 시스템을 처음 쓰는 해라 그렇습니다.
                    드롭박스에 있는 <b>전기 최종 일반조서 파일</b>을 골라 주시면 그 파일로 이월합니다.
                    <span style={{ color: 'var(--ink-3)' }}> 고른 파일은 이월본을 짓는 데만 쓰고 따로 저장하지 않습니다. 내년부터는 올해 최종본에서 저절로 이어집니다.</span>
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <label className="btn-p" style={{ cursor: busy ? 'default' : 'pointer' }}>
                        {busy === 'roll' ? '이월하는 중…' : '전기 파일 고르기'}
                        <input type="file" accept=".xlsx" style={{ display: 'none' }} disabled={!!busy}
                          onChange={(e) => { void rollFromFile(e.target.files?.[0]); e.target.value = ''; }} />
                      </label>
                      <button className="btn-sm" disabled={!!busy} onClick={() => setAskPrior(false)}>취소</button>
                    </div>
                  </div>
                )}

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
                  {/* 무엇을 했는지 먼저 한 줄로 — 사용자 2026-09-27 「이월결과 내용을 이해를 잘 못하겠어」 */}
                  <div style={{ fontSize: 'var(--fs-2)', lineHeight: 1.75, background: 'var(--surface-2)', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>
                    <b>작년 조서를 그대로 이어 올해 파일을 만들었습니다.</b> 조서마다 머리의 회사명·결산일은 표지로, 작성자·일자는 조서목록으로 이어 두었고
                    검토자는 <b>{year?.partner ?? '-'}</b>로 채웠습니다. 조서목록의 작성일은 비워 두었으니 날짜를 적으면 각 조서에 따라 들어갑니다.
                    <div style={{ marginTop: 4 }}>
                      본문의 <b>기간 날짜·기수·연도</b>(결산일·개시일, 「제18기」, 「FY2025」, 「2024_4Q」)는 한 해 올렸고, 2120A·8110ARP 같은 분석 시트는 <b>당기 숫자를 전기 열로 옮겼습니다</b>.
                      시스템이 바꾼 칸은 <span style={{ background: '#FFFF00', color: '#000', padding: '0 4px' }}>노란 바탕</span>, 조서 탭은 모두 <span style={{ color: '#FF0000', fontWeight: 700 }}>빨강</span>(올해 아직 손 안 댐)으로 두었습니다
                      — 수정하면 노랑, 확인했는데 새로 넣을 것이 없으면 초록으로 바꿔 주세요.
                      <span style={{ color: 'var(--ink-3)' }}> 날짜 칸 {report.sheets.reduce((n, s) => n + (s.dates ?? 0), 0)}개 · 전기 이동 {report.sheets.reduce((n, s) => n + (s.carried ?? 0), 0)}줄 · 노란 칸 {report.marks.cells}개</span>
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', gap: 14, flexWrap: 'wrap', color: 'var(--ink-2)' }}>
                      {(['그대로', '양식 없음', '숨김 그대로', '양식에만 있음', '갈아끼움', '새 조서'] as const).map((a) => {
                        const n = report.sheets.filter((s) => s.action === a).length;
                        return n ? <span key={a}><b>{a}</b> {n}</span> : null;
                      })}
                    </div>
                    <div style={{ marginTop: 6, fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
                      그대로 = 작년 시트를 이음 · 양식 없음 = 올해 양식에 같은 번호가 없어 작년 그대로 · 숨김 그대로 = 작년에 숨긴 안 쓰는 조서 ·
                      양식에만 있음 = 올해 양식에만 있어 넣지 않음 · 갈아끼움·새 조서 = 아래에서 골라 반영한 것
                    </div>
                  </div>
                  {report.warnings.map((w) => <div key={w} style={{ color: 'var(--warn)', fontSize: 'var(--fs-2)' }}>{w}</div>)}
                  {(() => {
                    const differ = report.sheets.filter((s) => s.action === '그대로' && s.templateDiffers);
                    const extra = report.sheets.filter((s) => s.action === '양식에만 있음');
                    if (!differ.length && !extra.length) return null;
                    return (
                      <div style={{ fontSize: 'var(--fs-2)', lineHeight: 1.7, marginBottom: 8 }}>
                        <b>고를 것(선택)</b> — 올해 양식과 문구가 다른 조서 {differ.length}개는 작년 그대로 두었고, 올해 양식에만 있는 조서 {extra.length}개는 넣지 않았습니다.
                        「다른 문구」 칸의 숫자는 <b>올해 양식 문구 가운데 작년 시트에 없는 것</b>의 수입니다(줄 자리만 밀린 것은 세지 않습니다). 눌러 보면 무엇이 다른지 나오고,
                        <b>「올해 양식 참고 파일」</b>은 그 조서들의 올해 양식을 다른 문구에 노란 바탕을 칠해 내려받습니다.
                        올해 양식으로 바꾸거나 넣고 싶은 조서만 아래 표에서 체크한 뒤 <b>「고른 것 반영해 다시 만들기」</b>를 누르세요. 대부분은 그대로 두시면 됩니다.
                        <span style={{ color: 'var(--ink-3)' }}> 다시 만들면 새 판이 하나 더 쌓입니다.</span>
                        <div style={{ marginTop: 6 }}>
                          <button className="btn-p" disabled={!canWrite || !!busy || !lastPrior || (!pickReplace.size && !pickAdd.size)}
                            onClick={() => lastPrior && void rollFrom(lastPrior.bytes, lastPrior.label, { replace: [...pickReplace], addCodes: [...pickAdd] })}>
                            {busy === 'roll' ? '만드는 중…' : `고른 것 반영해 다시 만들기 (갈아끼움 ${pickReplace.size} · 넣기 ${pickAdd.size})`}
                          </button>{' '}
                          <button className="btn-sm" disabled={!!busy || !differ.length} onClick={() => void downloadReference(differ)}>
                            {busy === 'ref' ? '만드는 중…' : `📄 올해 양식 참고 파일 (${differ.length}개 조서)`}
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                  <div className="tbl-wide">
                    <table className="tbl">
                      <thead><tr style={{ background: 'var(--surface-2)' }}>
                        <th style={{ width: 54 }}>고르기</th><th style={{ width: 96 }}>처리</th><th style={{ width: 110 }}>조서</th><th>시트</th><th style={{ width: 90 }} title="올해 양식 문구 가운데 작년 시트에 없는 것">다른 문구</th><th style={{ width: 64 }}>날짜 올림</th><th style={{ width: 64 }}>전기 이동</th><th style={{ width: 60 }}>옮김</th><th style={{ width: 70 }}>못 옮김</th><th>비고</th>
                      </tr></thead>
                      <tbody>
                        {report.sheets.map((s) => {
                          const canReplace = s.action === '그대로' && s.templateDiffers;
                          const canAdd = s.action === '양식에만 있음';
                          const on = canReplace ? pickReplace.has(s.code) : canAdd ? pickAdd.has(s.code) : false;
                          const toggle = () => {
                            const set = canReplace ? setPickReplace : setPickAdd;
                            set((prev) => { const n = new Set(prev); if (n.has(s.code)) n.delete(s.code); else n.add(s.code); return n; });
                          };
                          return (
                            <Fragment key={s.name + s.action}>
                            <tr style={{ opacity: s.action === '숨김 그대로' || s.action === '양식에만 있음' ? 0.6 : 1 }}>
                              <td style={{ textAlign: 'center' }}>
                                {(canReplace || canAdd) && (
                                  <input type="checkbox" checked={on} disabled={!canWrite} onChange={toggle}
                                    title={canReplace ? '올해 양식으로 갈아끼우고 작년 값을 옮깁니다' : '올해 양식의 이 조서를 넣습니다'} />
                                )}
                              </td>
                              <td style={{ fontWeight: s.action === '갈아끼움' || s.action === '새 조서' ? 700 : 400, color: s.action === '양식 없음' ? 'var(--ink-2)' : undefined }}>{s.action}</td>
                              <td>{s.code}</td>
                              <td>{s.name}</td>
                              <td style={{ textAlign: 'right' }}>
                                {s.templateDiffers
                                  ? <button className="btn-sm" style={{ color: 'var(--warn)' }} onClick={() => setOpenDiff(openDiff === s.name ? null : s.name)} title="무엇이 다른지 보기">{s.differ}개 {openDiff === s.name ? '▲' : '▼'}</button>
                                  : s.score != null ? <span style={{ color: 'var(--ink-3)' }}>같음</span> : ''}
                              </td>
                              <td style={{ textAlign: 'right' }}>{s.dates || ''}</td>
                              <td style={{ textAlign: 'right' }}>{s.carried != null ? `${s.carried}줄` : ''}</td>
                              <td style={{ textAlign: 'right' }}>{s.moved ?? ''}</td>
                              <td style={{ textAlign: 'right', color: s.left?.length ? 'var(--warn)' : undefined }}>{s.left?.length || ''}</td>
                              <td style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-3)' }}>{s.note ?? (s.template ? s.template.split('/').pop() : '')}</td>
                            </tr>
                            {openDiff === s.name && s.diffs && (
                              <tr><td colSpan={10} style={{ background: 'var(--surface-2)', fontSize: 'var(--fs-0)', lineHeight: 1.6 }}>
                                <div style={{ color: 'var(--ink-3)', marginBottom: 4 }}>올해 양식 문구 가운데 작년 시트에 없는 것{s.differ! > s.diffs.length ? ` (앞 ${s.diffs.length}개 / 모두 ${s.differ}개)` : ''} — 같은 칸의 작년 글자를 옆에 둡니다.</div>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                  <tbody>
                                    {s.diffs.map((d) => (
                                      <tr key={d.ref}>
                                        <td style={{ width: 50, color: 'var(--ink-4)', verticalAlign: 'top' }}>{d.ref}</td>
                                        <td style={{ verticalAlign: 'top', paddingRight: 8 }}><b>올해</b> {d.tpl.slice(0, 120)}</td>
                                        <td style={{ verticalAlign: 'top', color: 'var(--ink-3)' }}><b>작년</b> {d.prior ? d.prior.slice(0, 120) : '(비어 있음)'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td></tr>
                            )}
                            </Fragment>
                          );
                        })}
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
                    {latest ? `v${latest.version} ${latest.kind} 기준 · ${STATUS_ORDER.filter((k) => counts[k]).map((k) => `${k} ${counts[k]}`).join(' · ')}` : '올린 파일이 없습니다'}
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
                          const st = statusOf(s, fromRoll);
                          const ix = indexBy.get((s.code ?? '').replace(/\(.*$/, ''));
                          return (
                            <tr key={s.name} style={{ opacity: s.hidden ? 0.5 : 1 }}>
                              <td style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-0)' }}>{sectionOf(s.code ?? '')}</td>
                              <td>{s.code}</td>
                              <td>{ix?.title ?? ''}</td>
                              <td style={{ color: 'var(--ink-3)' }}>{s.name}</td>
                              <td style={{ textAlign: 'center' }}>{ix?.performed ? 'O' : ''}</td>
                              <td>{fromRoll ? '' : clean(s.head.author)}</td>
                              <td>{clean(s.head.reviewer)}</td>
                              <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fromRoll ? '' : clean(s.head.date)}</td>
                              <td><span style={{ padding: '1px 8px', borderRadius: 999, fontSize: 'var(--fs-0)', fontWeight: 600, background: STATUS_TONE[st].bg, color: STATUS_TONE[st].ink, whiteSpace: 'nowrap' }}>
                                {STATUS_TONE[st].dot && <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: STATUS_TONE[st].dot, border: '1px solid var(--line)', marginRight: 4, verticalAlign: 'middle' }} />}{st}
                              </span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-4)', marginTop: 6 }}>
                  상태는 <b>시트 탭 색</b>으로 읽습니다 — 빨강 = 손 안 댐 · 노랑 = 수정함 · 초록 = 확인했고 새로 넣을 것 없음. 엑셀에서 탭 색을 바꿔 저장한 뒤 「채운 파일 올리기」로 올리면 여기에 반영됩니다.
                  {fromRoll
                    ? <> 지금 판은 <b>이월본</b>이라 작성자·일자를 비워 보입니다(조서목록에 날짜를 적으면 각 조서로 따라 들어갑니다).</>
                    : <> 작성자·일자는 각 조서 머리에서 읽습니다(조서목록 링크의 계산값).</>}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {adding && (
        <NewEngagementModal purpose="gwp"
          entities={ents} auditIds={auditIds}
          onClose={() => setAdding(false)}
          onDone={async (id) => { setAdding(false); await load(id); setMsg('작업 건을 만들었습니다.'); }}
          onError={(m) => setErr(m)}
        />
      )}
    </div>
  );
}
