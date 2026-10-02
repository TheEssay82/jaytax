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
import { readBundle, templateCodes, findTemplateSheet } from '../../lib/gwpTemplate';
import { planSmall, applySmall, planLarge, applyLarge, planTidy, planToSmall, applyToSmall } from '../../lib/gwpSmall';
import { isCodeOrdered, sortSheetsByCode } from '../../lib/gwpOrder';
import { missingPapers, addPapers } from '../../lib/gwpAddPapers';
import { unzip, zip } from '../../lib/xlsxTransplant';
import { readWorkbook } from '../../lib/xlsxRead';
import { buildCatalog, sectionOf, type Catalog, type CatalogSheet } from '../../lib/gwpCatalog';
import { rollWorkbook, type RollReport } from '../../lib/gwpRoll';
import { assembleWorkbook, type AssembleReport } from '../../lib/gwpAssemble';
import { tabStateOf } from '../../lib/xlsxMark';
import NewEngagementModal from '../dsd/NewEngagementModal';
import { safeName, download } from '../dsd/dsdUi';
import GwpTemplatesCard from './GwpTemplatesCard';
import GwpProcStdCard from './GwpProcStdCard';
import GwpStageBoard from './GwpStageBoard';
import GwpFolderCard from './GwpFolderCard';
import { listProgress } from '../../lib/gwpStageApi';
import { progressOf, PROGRESS, type StageNo } from '../../lib/gwpStage';

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
  const { role, readonly, profileName } = useAuth();
  // 감사팀 = 최고관리자·회계사·인당회계사(사용자 2026-10-02 — 조현규·김준성). 서버 is_audit_staff() 와 같은 선.
  const canWrite = !readonly && (role === 'superuser' || role === 'accountant' || role === 'per_head_accountant');
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
  const [sub, setSub] = useState<'work' | 'tpl' | 'proc'>('work');
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
  // 화면 순서 — ① 올해 파일 → ② 단계 진행 → ③ 엑셀 조서 현황(사용자 2026-09-27 「순서와 UI 를 직관적으로」).
  const [view, setView] = useState<'file' | 'stage' | 'status'>('file');
  const [rollDetail, setRollDetail] = useState(false);
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  // 거래처 목록 — 진행 정도(세팅·판·확정 단계)와 접기(사용자 2026-10-01 「선택하면 나머지는 사라지고 접히게」).
  const [progressBy, setProgressBy] = useState<Map<string, { confirmed: StageNo[]; books: number }>>(new Map());
  const [listOpen, setListOpen] = useState(true);
  /** 진행 정도로 거르기 — 범례 칩을 눌러(사용자 2026-10-01) */
  const [progFilter, setProgFilter] = useState<keyof typeof PROGRESS | null>(null);
  const refreshProgress = () => listProgress().then(setProgressBy).catch(() => undefined);

  async function load(keep?: string) {
    try {
      setErr(null);
      const [list, es, aud, tpls, ys, pg] = await Promise.all([listEngagements(), listBizEntities(), listAuditEntityIds(), listTemplates(), listYears(), listProgress().catch(() => new Map())]);
      setProgressBy(pg);
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
  // 가나다 순(사용자 2026-10-01).
  const inYear = useMemo(() => engs.filter((e) => e.fy === fy).sort((a, b) => a.entityName.localeCompare(b.entityName, 'ko')), [engs, fy]);
  const progOf = (id: string) => { const p = progressBy.get(id); return progressOf(yearsBy.has(id), p?.books ?? 0, p?.confirmed ?? []); };
  const year = picked ? yearsBy.get(picked.id) ?? null : null;
  // 표준양식은 **조서 양식 기준**으로 고른다(재무제표 회계기준이 아니다).
  const tpl = useMemo(() => (picked && year ? templates.find((t) => t.fy === picked.fy && t.basis === year.auditBasis) ?? null : null), [templates, picked, year]);
  const latest = books[0] ?? null;
  const final = books.find((b) => b.kind === '최종본') ?? null;
  // 소규모 짝(「2511(소규모)」 숨김 + 「2511」 보임) — 소규모 감사일 때만.
  const smallPlan = useMemo(() => {
    if (!latest || year?.auditBasis !== '소규모감사기준') return null;
    const tc = tpl ? new Set(templateCodes(tpl.catalog).map((c) => c.replace(/\(.*$/, ''))) : undefined;
    const p = planSmall(latest.catalog.sheets.map((s) => ({ name: s.name, hidden: s.hidden })), tc);
    return p.pairs.length || p.hide.length ? p : null;
  }, [latest, year?.auditBasis, tpl]);
  // 소규모 감사인데 작년 조서가 일반 양식이었다(알엑스씨 — 소규모 계약, 조서는 일반으로 진행, 2026-10-02) → 「번호(소규모)」로.
  const toSmallPlan = useMemo(() => {
    if (!latest || !tpl || year?.auditBasis !== '소규모감사기준') return null;
    const p = planToSmall(latest.catalog.sheets.map((s) => ({ name: s.name, hidden: s.hidden })), tpl.catalog.sheets);
    return p.steps.length ? p : null;
  }, [latest, year?.auditBasis, tpl]);
  // 반대 — 일반·K-IFRS 감사인데 「번호(소규모)」 시트를 쓰고 있다(평안정공: 작년 소규모 → 올해 일반, 2026-09-28).
  const largePlan = useMemo(() => {
    if (!latest || !tpl || !year || year.auditBasis === '소규모감사기준') return null;
    const list = latest.catalog.sheets.map((s) => ({ name: s.name, hidden: s.hidden }));
    const p = planLarge(list, (c) => findTemplateSheet(tpl.catalog, c), tpl.catalog.sheets);
    const t = planTidy(list);
    const unsorted = !isCodeOrdered(list.map((x) => x.name));
    return p.steps.length || t.show.length ? { ...p, tidy: t, unsorted } : null;
  }, [latest, year, tpl]);
  // 시트 차례 — 조서 번호 순서가 아니면(사용자 2026-09-28 「조서시트의 번호별로 순서가 이어져야」). 다른 정리 카드가 없을 때만 따로 띄운다.
  const needSort = useMemo(() => !!latest && !isCodeOrdered(latest.catalog.sheets.map((s) => s.name)), [latest]);
  // 올해 양식에 있는데 파일에 없는 조서(아비즈 3000번대, 사용자 2026-09-30) — 3000번대만 미리 체크.
  const missing = useMemo(() => (latest && tpl ? missingPapers(latest.catalog, tpl.catalog) : []), [latest, tpl]);
  const [pickMissing, setPickMissing] = useState<Set<string>>(new Set());
  const [showAllMissing, setShowAllMissing] = useState(false);
  useEffect(() => { setPickMissing(new Set(missing.filter((m) => m.suggested).map((m) => m.code))); setShowAllMissing(false); }, [missing]);
  // 회사를 바꾸면 — 올해 파일이 있으면 ② 단계 진행부터, 없으면 ① 올해 파일부터.
  const hasBook = !!latest;
  // 방금 이월·새로 만들었으면(report·assembled) ① 에 머물러 요약을 보인다.
  const justMade = !!report || !!assembled;
  useEffect(() => {
    if (justMade) { setView('file'); return; }
    setView(hasBook ? 'stage' : 'file'); setRollDetail(false); setStatusFilter('all');
  }, [pickedId, hasBook, justMade]);

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
    if (!f) return;
    await rollFromBytes(new Uint8Array(await f.arrayBuffer()), `전기 파일 직접 선택 — ${f.name}(FY${(picked?.fy ?? 0) - 1}, 시스템 밖)`);
  }

  /** 전기 파일 바이트로 이월 — 직접 고른 파일·업무 폴더에서 찾은 파일. 회사명이 맞는지 먼저 본다. */
  async function rollFromBytes(bytes: Uint8Array, label: string) {
    if (!picked) return;
    setBusy('roll'); setErr(null); setMsg(null);
    try {
      const cat = buildCatalog(readWorkbook(bytes));
      if (!cat.sheets.some((s) => s.kind === 'paper')) throw new Error('이 파일에서 조서 시트(1100·2110 … 꼴)를 찾지 못했습니다.');
      if (cat.company && !sameCompany(cat.company, picked.entityName)) {
        throw new Error(`고른 파일의 표지 회사명이 「${cat.company}」입니다 — ${picked.entityName} 의 전기 조서가 맞는지 확인하세요.`);
      }
      setAskPrior(false);
      await rollFrom(bytes, label);
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
      // 소규모 감사면 「번호(소규모)」 시트를 쓰고 일반 짝은 숨긴다(사용자 2026-09-28 — 번호 중복).
      let outBytes = r.bytes;
      let outCat = r.catalog;
      let smallNote = '';
      if (year.auditBasis === '소규모감사기준') {
        const tc = new Set(templateCodes(catalog).map((c) => c.replace(/\(.*$/, '')));
        const plan = planSmall(readWorkbook(r.bytes).map((s) => ({ name: s.name, hidden: s.hidden })), tc);
        if (plan.pairs.length || plan.hide.length) {
          const uf = unzip(r.bytes);
          const sr = applySmall(uf, plan, year.partner);
          outBytes = zip(uf);
          outCat = buildCatalog(readWorkbook(outBytes));
          smallNote = ` · 소규모 짝 정리 ${sr.done.map((d) => d.small).join(',')}${sr.hidden.length ? ` · 숨김 ${sr.hidden.join(',')}` : ''}`;
        }
        // 작년 조서가 일반 양식이었다 — 올해 소규모 양식의 「번호(소규모)」로(알엑스씨).
        const tp = planToSmall(readWorkbook(outBytes).map((s) => ({ name: s.name, hidden: s.hidden })), catalog.sheets);
        if (tp.steps.length) {
          const uf = unzip(outBytes);
          const tr = applyToSmall(uf, tp, { catalog, files }, year.partner, unzip);
          outBytes = zip(uf);
          outCat = buildCatalog(readWorkbook(outBytes));
          smallNote += ` · 일반 → 소규모 ${tr.done.map((d) => d.to).join(',')}${tr.hidden.length ? ` · 숨김 ${tr.hidden.join(',')}` : ''}`;
        }
      } else {
        // 일반·K-IFRS 감사인데 작년 조서가 「번호(소규모)」 시트였다 — 올해 기준 양식 시트로(평안정공).
        const plan = planLarge(readWorkbook(r.bytes).map((s) => ({ name: s.name, hidden: s.hidden })), (c) => findTemplateSheet(catalog, c), catalog.sheets);
        if (plan.steps.length) {
          const uf = unzip(r.bytes);
          const lr = applyLarge(uf, plan, { catalog, files }, year.partner, unzip);
          outBytes = zip(uf);
          outCat = buildCatalog(readWorkbook(outBytes));
          smallNote = ` · 소규모 → ${year.auditBasis} 정리 ${lr.done.map((d) => d.to).join(',')}`;
        }
      }
      // 조서 번호 순서로(양식에서 넣은 시트는 맨 뒤에 붙는다) — 사용자 2026-09-28.
      {
        const uf = unzip(outBytes);
        if (sortSheetsByCode(uf)) { outBytes = zip(uf); outCat = buildCatalog(readWorkbook(outBytes)); }
      }
      const name = `일반조서_${safeName(picked.entityName)}_FY${picked.fy}_이월본.xlsx`;
      const book = await addBook(picked.id, '이월본', { name, bytes: outBytes }, outCat,
        `${source} + ${tpl.fy} ${tpl.basis} 양식${pick.replace?.length ? ` · 갈아끼움 ${pick.replace.join(',')}` : ''}${pick.addCodes?.length ? ` · 넣음 ${pick.addCodes.join(',')}` : ''}${smallNote}`);
      download(outBytes, name, XLSX);
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

  /** 소규모 짝 정리 — 이미 만든 판에서 「번호(소규모)」를 쓰고 일반 짝은 숨긴 새 판을 만든다(사용자 2026-09-28). */
  async function fixSmall() {
    if (!picked || !year || !latest || !smallPlan) return;
    setBusy('small'); setErr(null);
    try {
      const uf = unzip(await fileBytes(latest.storagePath));
      const sr = applySmall(uf, smallPlan, year.partner);
      const bytes = zip(uf);
      const book = await addBook(picked.id, '작업중', { name: latest.fileName, bytes }, buildCatalog(readWorkbook(bytes)),
        `소규모 짝 정리 — ${sr.done.map((d) => `${d.small} 보임·${d.plain} 숨김(작년 값 ${d.moved}칸 옮김)`).join(' · ')}${sr.hidden.length ? ` · 숨김 ${sr.hidden.join(',')}` : ''}`);
      download(bytes, book.fileName, XLSX);
      setBooks(await listBooks(picked.id));
      setMsg(`소규모 짝을 정리해 v${book.version}을 만들고 내려받았습니다 — ${sr.done.map((d) => d.small).join(', ')} 을 쓰고 일반 양식 ${[...sr.done.map((d) => d.plain), ...sr.hidden].join(', ')} 은 숨겼습니다(지우지 않음).`);
    } catch (e) { setErr(e instanceof Error ? e.message : '정리하지 못했습니다.'); } finally { setBusy(''); }
  }

  /** 일반 → 소규모 정리 — 이미 만든 판에서 일반 시트를 올해 소규모 양식 「번호(소규모)」로 바꾼 새 판(사용자 2026-10-02 알엑스씨). */
  async function fixToSmall() {
    if (!picked || !year || !latest || !tpl || !toSmallPlan) return;
    setBusy('tosmall'); setErr(null);
    try {
      const t = readBundle(await fileBytes(tpl.storagePath));
      const uf = unzip(await fileBytes(latest.storagePath));
      const tr = applyToSmall(uf, toSmallPlan, t, year.partner, unzip);
      const bytes = zip(uf);
      const book = await addBook(picked.id, '작업중', { name: latest.fileName, bytes }, buildCatalog(readWorkbook(bytes)),
        `일반 → 소규모 정리 — ${tr.done.map((d) => `${d.to}(←${d.plain}, 작년 값 ${d.moved}칸)`).join(' · ')}${tr.hidden.length ? ` · 숨김 ${tr.hidden.join(',')}` : ''}`);
      download(bytes, book.fileName, XLSX);
      setBooks(await listBooks(picked.id));
      setMsg(`v${book.version}을 만들고 내려받았습니다 — 일반 시트 ${tr.done.length}장을 소규모 양식 시트로 바꾸고 일반 시트는 숨겼습니다(지우지 않음). 1차 확정을 하면 웹 조서 값이 소규모 시트에 들어갑니다.`);
    } catch (e) { setErr(e instanceof Error ? e.message : '정리하지 못했습니다.'); } finally { setBusy(''); }
  }

  /** 소규모 → 일반 정리 — 이미 만든 판에서 「번호(소규모)」를 올해 기준 양식 시트로 바꾼 새 판(사용자 2026-09-28 평안정공). */
  async function fixLarge() {
    if (!picked || !year || !latest || !tpl || !largePlan) return;
    setBusy('large'); setErr(null);
    try {
      const t = readBundle(await fileBytes(tpl.storagePath));
      const uf = unzip(await fileBytes(latest.storagePath));
      const lr = applyLarge(uf, largePlan, t, year.partner, unzip);
      const bytes = zip(uf);
      const book = await addBook(picked.id, '작업중', { name: latest.fileName, bytes }, buildCatalog(readWorkbook(bytes)),
        `소규모 → ${year.auditBasis} 정리 — ${lr.done.map((d) => `${d.to}${d.small ? `(←${d.small}, 작년 값 ${d.moved}칸)` : '(새로)'}`).join(' · ')}`);
      download(bytes, book.fileName, XLSX);
      setBooks(await listBooks(picked.id));
      setMsg(`v${book.version}을 만들고 내려받았습니다 — 소규모 시트 ${lr.done.filter((d) => d.small).length}장을 ${year.auditBasis} 양식 시트로 바꾸고 소규모 시트는 숨겼습니다(지우지 않음). 1차 확정을 다시 하면 웹 조서 값이 새 시트에 들어갑니다.`);
    } catch (e) { setErr(e instanceof Error ? e.message : '정리하지 못했습니다.'); } finally { setBusy(''); }
  }

  /** 올해 양식에 있는데 파일에 없는 조서를 골라 넣은 새 판(사용자 2026-09-30). */
  async function addMissing() {
    if (!picked || !latest || !tpl || !year) return;
    const pick = missing.filter((m) => pickMissing.has(m.code));
    if (!pick.length) return;
    setBusy('add'); setErr(null);
    try {
      const t = readBundle(await fileBytes(tpl.storagePath));
      const r = addPapers(await fileBytes(latest.storagePath), pick, t.files, year.partner);
      const book = await addBook(picked.id, '작업중', { name: latest.fileName, bytes: r.bytes }, buildCatalog(readWorkbook(r.bytes)),
        `올해 양식에서 조서 넣음 — ${r.added.join(', ')}`);
      download(r.bytes, book.fileName, XLSX);
      setBooks(await listBooks(picked.id));
      setMsg(`v${book.version}을 만들고 내려받았습니다 — ${r.added.length}개 조서(${r.added.join(', ')})를 올해 양식에서 넣었습니다(빨간 탭, 조서 번호 순서 자리).`);
    } catch (e) { setErr(e instanceof Error ? e.message : '넣지 못했습니다.'); } finally { setBusy(''); }
  }

  /** 시트 차례만 조서 번호 순서로 — 새 판(사용자 2026-09-28). */
  async function fixOrder() {
    if (!picked || !latest) return;
    setBusy('order'); setErr(null);
    try {
      const uf = unzip(await fileBytes(latest.storagePath));
      if (!sortSheetsByCode(uf)) { setMsg('이미 조서 번호 순서입니다.'); return; }
      const bytes = zip(uf);
      const book = await addBook(picked.id, '작업중', { name: latest.fileName, bytes }, buildCatalog(readWorkbook(bytes)), '시트 차례를 조서 번호 순서로');
      download(bytes, book.fileName, XLSX);
      setBooks(await listBooks(picked.id));
      setMsg(`v${book.version}을 만들고 내려받았습니다 — 시트를 조서 번호 순서로 늘어놓았습니다(내용은 그대로).`);
    } catch (e) { setErr(e instanceof Error ? e.message : '정리하지 못했습니다.'); } finally { setBusy(''); }
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
      // 📎 엑셀로 넘긴 조서에 붙인 별도조서 — 앞 판에 없던 시트를 알려 준다.
      const before = new Set((latest?.catalog.sheets ?? []).map((s) => s.name));
      const added = latest ? cat.sheets.filter((s) => !before.has(s.name)).map((s) => s.name) : [];
      setMsg(`v${book.version}(${book.kind})으로 올렸습니다 — 조서 시트 ${papers}장.${added.length ? ` 새로 붙은 시트: ${added.join(', ')}.` : ''}`);
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
            <button className={`btn-sm${sub === 'proc' ? ' btn-sm-navy' : ''}`} onClick={() => setSub('proc')} title="2120A 주요 감사절차(K열) 표준">③ 표준 절차</button>
            {canWrite && <button className="btn-sm" onClick={() => setAdding(true)}>+ 새 건 만들기</button>}
          </span>
        </div>
        <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7 }}>
          <b>① 올해 파일</b>(작년 조서를 이어 이월본) → <b>② 단계 진행</b>(1차 중간감사 전 · 2차 중간감사 후 · 3차 기말감사 완료 후 — 웹 조서를 확인하고 확정)
          → <b>③ 엑셀 조서 현황</b>(탭 색으로 진행 보기) → <b>④ 최종본</b>. 회사를 고르면 순서가 위에 보입니다.
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
      {sub === 'proc' && <GwpProcStdCard canWrite={canWrite} />}

      {sub === 'work' && (
        <>
          <div className="card" style={{ padding: '10px 12px 12px' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 9 }}>
              <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', letterSpacing: '.04em' }}>사업연도</span>
              {years.map((y) => (
                <button key={y} onClick={() => { setFyAt(y); setListOpen(true); setProgFilter(null); }} style={{
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--fs-1)',
                  border: `1px solid ${y === fy ? 'var(--navy)' : 'var(--rule)'}`, background: y === fy ? 'var(--navy)' : '#fff',
                  color: y === fy ? '#fff' : 'var(--ink-2)', fontWeight: y === fy ? 700 : 400, borderRadius: 999, padding: '3px 11px',
                }}>FY{y}<span style={{ opacity: 0.7, marginLeft: 6, fontWeight: 400 }}>· {engs.filter((e) => e.fy === y).length}건</span></button>
              ))}
            </div>
            {engs.length === 0 && <Empty text="아직 작업 건이 없습니다. 「새 건 만들기」로 시작하세요." />}
            {inYear.length > 0 && (() => {
              const counts = new Map<string, number>();
              for (const e of inYear) { const k = progOf(e.id).key; counts.set(k, (counts.get(k) ?? 0) + 1); }
              const shown = picked && !listOpen ? inYear.filter((e) => e.id === picked.id) : inYear.filter((e) => !progFilter || progOf(e.id).key === progFilter);
              const chip = (on: boolean, n: number) => ({
                display: 'inline-flex', alignItems: 'center', gap: 5, cursor: n ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 'var(--fs-1)',
                border: `1px solid ${on ? 'var(--navy)' : 'var(--rule)'}`, background: on ? 'var(--navy-bg)' : '#fff', color: 'var(--ink-2)',
                fontWeight: on ? 700 : 400, borderRadius: 999, padding: '2px 10px', opacity: n ? 1 : 0.45,
              } as const);
              return (
                <>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 'var(--fs-1)', color: 'var(--ink-2)', marginBottom: 6 }}>
                    <button style={chip(!progFilter, inYear.length)} onClick={() => { setProgFilter(null); setListOpen(true); }}>전체 {inYear.length}</button>
                    {(Object.keys(PROGRESS) as (keyof typeof PROGRESS)[]).map((k) => (
                      <button key={k} style={chip(progFilter === k, counts.get(k) ?? 0)} disabled={!counts.get(k)} title={`${PROGRESS[k].label}인 회사만 보기 — 다시 누르면 전체`}
                        onClick={() => { setProgFilter(progFilter === k ? null : k); setListOpen(true); }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: PROGRESS[k].color }} />{PROGRESS[k].label} {counts.get(k) ?? 0}
                      </button>
                    ))}
                    {picked && (
                      <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setListOpen(!listOpen)}>
                        {listOpen ? '목록 접기 ▲' : `다른 회사 고르기 ▼ (${inYear.length - 1})`}
                      </button>
                    )}
                  </div>
                  <div style={{ border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
                    {shown.map((e, i) => {
                      const pg = progOf(e.id);
                      const y = yearsBy.get(e.id);
                      const books = progressBy.get(e.id)?.books ?? 0;
                      const on = e.id === pickedId;
                      return (
                        <button key={e.id} onClick={() => { void pick(e.id); setListOpen(false); }} style={{
                          display: 'grid', gridTemplateColumns: '6px minmax(0, 1fr) auto auto', gap: 10, alignItems: 'center', width: '100%',
                          textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', border: 0, borderTop: i ? '1px solid var(--rule)' : 0,
                          background: on ? 'var(--navy-bg)' : '#fff', padding: '7px 10px 7px 0',
                        }}>
                          <span style={{ alignSelf: 'stretch', background: pg.color }} />
                          <span style={{ minWidth: 0 }}>
                            <span style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--navy)' }}>{e.entityName}</span>
                            <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginLeft: 8 }}>
                              {e.scope}{y ? ` · 조서 ${AUDIT_BASIS_LABEL[y.auditBasis]}` : ''}{books ? ` · 최신 판 v${books}` : ''}
                            </span>
                          </span>
                          <span style={{ fontSize: 'var(--fs-1)', fontWeight: 700, color: '#fff', background: pg.color, borderRadius: 999, padding: '1px 9px', whiteSpace: 'nowrap' }}>{pg.label}</span>
                          <span style={{ color: 'var(--ink-4)', fontSize: 'var(--fs-1)' }}>{on ? '●' : '›'}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              );
            })()}
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
              {/* 작업 건 머리 + 진행 순서 — 사용자 2026-09-27 「이월 결과·조서목록상태가 이해가 안 간다, 순서와 UI 를 직관적으로」 */}
              <div className="card">
                <div className="chdr">
                  {picked.entityName}
                  <span style={{ fontSize: 'var(--fs-2)', fontWeight: 400, color: 'var(--ink-2)' }}>
                    FY{picked.fy} · {picked.scope}{picked.periodFrom ? ` · ${picked.periodFrom} ~ ${picked.periodTo}` : ''}
                  </span>
                  {year && (
                    <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-1)', color: 'var(--ink-2)', display: 'flex', gap: 8, alignItems: 'center' }}>
                      조서 <b>{AUDIT_BASIS_LABEL[year.auditBasis]}</b> · 검토자 <b>{year.partner}</b> · 작성자 <b>{year.authorDefault ?? '-'}</b>
                      {canWrite && <button className="btn-sm" onClick={() => setSetupOpen(true)}>세팅 고치기</button>}
                    </span>
                  )}
                </div>
                {year && basisMismatch(year.auditBasis, picked.basis) && (
                  <div style={{ color: 'var(--bad)', fontSize: 'var(--fs-2)', marginBottom: 8 }}>
                    조서는 「{AUDIT_BASIS_LABEL[year.auditBasis]}」인데 주석·DSD 의 재무제표 회계기준은 「{picked.basis}」입니다 — 둘 중 하나를 확인하세요.
                  </div>
                )}
                {/* 진행 순서 — 눌러서 그 칸으로 */}
                <div style={{ display: 'flex', gap: 6, alignItems: 'stretch', flexWrap: 'wrap' }}>
                  {([
                    { k: 'file' as const, n: '①', t: '올해 파일', d: latest ? `v${latest.version} ${latest.kind} · 판 ${books.length}개` : '이월본을 만드세요', done: !!latest },
                    { k: 'stage' as const, n: '②', t: '단계 진행', d: latest ? '1차 → 2차 → 3차 확정' : '올해 파일부터', done: false },
                    { k: 'status' as const, n: '③', t: '엑셀 조서 현황', d: latest ? `🔴 ${(counts['손 안 댐'] ?? 0)} · 🟡 ${(counts['수정함'] ?? 0)} · 🟢 ${(counts['변경 없음'] ?? 0)}` : '-', done: false },
                  ]).map((s, i) => (
                    <Fragment key={s.k}>
                      {i > 0 && <span style={{ alignSelf: 'center', color: 'var(--ink-4)' }}>→</span>}
                      <button onClick={() => setView(s.k)} disabled={s.k !== 'file' && !latest} style={{
                        flex: '1 1 180px', textAlign: 'left', cursor: s.k !== 'file' && !latest ? 'default' : 'pointer', fontFamily: 'inherit',
                        border: `1.5px solid ${view === s.k ? 'var(--navy)' : 'var(--rule)'}`, background: view === s.k ? 'var(--navy-bg)' : '#fff',
                        borderRadius: 10, padding: '8px 12px', opacity: s.k !== 'file' && !latest ? 0.5 : 1,
                      }}>
                        <div style={{ fontWeight: 700, color: 'var(--navy)' }}>{s.n} {s.t}{s.done ? ' ✓' : ''}</div>
                        <div style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', marginTop: 2 }}>{s.d}</div>
                      </button>
                    </Fragment>
                  ))}
                  <span style={{ alignSelf: 'center', color: 'var(--ink-4)' }}>→</span>
                  <div style={{ flex: '0 1 170px', border: '1px dashed var(--rule)', borderRadius: 10, padding: '8px 12px', fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
                    <div style={{ fontWeight: 700, color: final ? 'var(--good)' : 'var(--ink-3)' }}>④ 최종본{final ? ` ✓ v${final.version}` : ''}</div>
                    <div style={{ marginTop: 2 }}>{final ? '내년 이월은 이 판에서' : '감사 끝나면 ①의 판 목록에서'}</div>
                  </div>
                </div>
                {latest && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, fontSize: 'var(--fs-1)', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--ink-3)' }}>
                      엑셀에서 조서를 쓴 뒤에는 여기로 올리세요 — 새 판이 됩니다(별도조서를 붙였으면 새로 붙은 시트를 알려 드립니다).
                    </span>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
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
                )}
              </div>

              {/* 업무 폴더에서 가져오기 — 내가 담당회계사인 건만(사용자 2026-09-28). 다른 건은 직접 올리기. */}
              {/* 내 건 = 감사계약 담당회계사가 나, 또는 당기 세팅 작성자가 나(지정감사는 담당이 「법인(지정)」 — 윤성, 사용자 2026-09-28). */}
              {/* 세팅 전에도 보인다 — 폴더 연결·찾기는 세팅과 상관없다(사용자 2026-09-28 「어디인지 모르겠다」). 이월본만 세팅 뒤. */}
              {(view === 'file' || view === 'stage') && !!profileName && (contractCpa === profileName || year?.authorDefault === profileName) && (
                <GwpFolderCard key={`folder:${picked.id}`} eng={picked} canWrite={canWrite} canRoll={!!year && !!tpl && canWrite} hasBook={!!latest}
                  onRoll={(bytes, label) => rollFromBytes(bytes, label)} onMsg={(m) => setMsg(m)} />
              )}

              {/* ① 올해 파일 ─────────────────────────────── */}
              {view === 'file' && (
                <div className="card">
                  <div className="chdr">① 올해 파일
                    <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>작년 조서를 이어 올해 조서 파일을 만듭니다 — 한 번이면 됩니다</span>
                  </div>
                  <div style={{ fontSize: 'var(--fs-2)', lineHeight: 1.7, marginBottom: 10 }}>
                    <b>표준양식</b>{' '}
                    {!year ? (
                      <span style={{ color: 'var(--warn)' }}>당기 세팅을 먼저 마치세요 — 조서 기준이 정해져야 양식이 골라집니다.</span>
                    ) : tpl ? (
                      <span style={{ color: 'var(--good)' }}>{tpl.fy} {tpl.basis} · {tpl.fileName}</span>
                    ) : (
                      <span style={{ color: 'var(--warn)' }}>FY{picked.fy} {year.auditBasis} 묶음이 없습니다 — 위 「표준양식」에서 등록하십시오.</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button className="btn-p" disabled={!canWrite || !tpl || !!busy} onClick={() => void makeRoll()}
                      title="작년 조서 파일을 이어 올해 시작 파일(이월본)을 짓습니다.">
                      {busy === 'roll' ? '만드는 중…' : `${latest ? '이월본 다시 만들기' : '이월본 만들기'} (FY${picked.fy - 1} → FY${picked.fy})`}
                    </button>
                    <button className="btn-s" disabled={!canWrite || !tpl || !!busy} onClick={() => void makeNew()}
                      title="전기 파일이 없는 초도 외감 — 양식만으로 표지·목록·조서 시트를 짓습니다.">
                      {busy === 'new' ? '만드는 중…' : '양식으로 새로 만들기 (초도)'}
                    </button>
                    {latest && <span style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>이미 올해 파일이 있습니다 — 다시 만들 일은 거의 없습니다. 다음은 <button className="btn-sm" onClick={() => setView('stage')}>② 단계 진행 →</button></span>}
                  </div>

                  {askPrior && (
                    <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 12, background: 'var(--surface-2)', fontSize: 'var(--fs-2)', lineHeight: 1.7 }}>
                      <b>FY{picked.fy - 1} 조서가 시스템에 아직 없습니다</b> — 이 시스템을 처음 쓰는 해라 그렇습니다.
                      드롭박스에 있는 <b>전기 최종 일반조서 파일</b>을 골라 주시면 그 파일로 이월합니다.
                      <span style={{ color: 'var(--ink-3)' }}> 내년부터는 올해 최종본에서 저절로 이어집니다.</span>
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

                  {report && (
                    <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: 'var(--good-bg)', fontSize: 'var(--fs-2)', lineHeight: 1.75 }}>
                      <b>✓ 이월본을 만들었습니다</b> — 작년 조서를 그대로 이었고, 이렇게 바꿨습니다:
                      <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                        <li>결산일·대상기간 <b>{report.cover.closing ?? '-'}</b> · 본문 날짜 {report.sheets.reduce((n, s) => n + (s.dates ?? 0), 0)}칸을 한 해 올림</li>
                        <li>2120A·8110(ARP·A) 는 당기 숫자를 전기 열로 옮김({report.sheets.reduce((n, s) => n + (s.carried ?? 0), 0)}줄)</li>
                        <li>조서 머리는 표지·조서목록에 잇고 검토자는 <b>{year?.partner ?? '-'}</b>, 조서목록 작성일 {report.index.datesCleared}칸은 비움</li>
                        <li>바꾼 칸은 <span style={{ background: '#FFFF00', color: '#000', padding: '0 4px' }}>노랑</span>, 조서 탭은 모두 <b style={{ color: '#FF0000' }}>빨강</b>(올해 아직 손 안 댐)</li>
                      </ul>
                      {report.warnings.map((w) => <div key={w} style={{ color: 'var(--warn)' }}>{w}</div>)}
                      <div style={{ marginTop: 6 }}>
                        다음은 <button className="btn-sm btn-sm-navy" onClick={() => setView('stage')}>② 단계 진행 →</button>
                        <button className="btn-sm" style={{ marginLeft: 6 }} onClick={() => setRollDetail(!rollDetail)}>{rollDetail ? '자세히 접기' : '자세히(조서별 처리·올해 양식과 다른 곳)'}</button>
                      </div>
                    </div>
                  )}
                  {report && rollDetail && (
                    <div style={{ marginTop: 10 }}>
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
                    <div style={{ marginTop: 10, fontSize: 'var(--fs-2)', lineHeight: 1.7 }}>
                      <b>양식으로 지은 시트 {assembled.added.length}장</b> — {assembled.added.map((a) => a.code).join(' · ')}
                      {assembled.skipped.length > 0 && <div style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-0)' }}>뺀 것: {assembled.skipped.map((s) => `${s.name}(${s.why})`).join(' · ')}</div>}
                    </div>
                  )}

                  {smallPlan && (
                    <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--warn)', fontSize: 'var(--fs-2)', lineHeight: 1.7 }}>
                      <b>소규모 짝 정리가 필요합니다</b> — 같은 번호가 두 벌 있습니다. 소규모 감사이니 <b>「번호(소규모)」</b> 시트를 쓰고 일반 양식은 숨기겠습니다(지우지 않고 숨길 뿐 — 작년 내용은 그대로 남습니다).
                      <table className="tbl" style={{ marginTop: 6 }}>
                        <thead><tr style={{ background: 'var(--surface-2)' }}><th>번호</th><th>쓸 시트(보이게)</th><th>숨길 시트</th></tr></thead>
                        <tbody>
                          {smallPlan.pairs.map((p) => <tr key={p.code}><td>{p.code}</td><td><b>{p.small}</b> <span style={{ color: 'var(--ink-3)' }}>(작년 값은 줄 이름이 같은 곳만 옮김)</span></td><td>{p.plain}</td></tr>)}
                          {smallPlan.hide.map((n) => <tr key={n}><td>{n}</td><td style={{ color: 'var(--ink-3)' }}>— 올해 소규모 양식에 없는 일반 양식 딸림 시트</td><td>{n}</td></tr>)}
                        </tbody>
                      </table>
                      <div style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-1)', marginTop: 4 }}>작년 일반 양식과 올해 소규모 양식은 모양이 달라 옮겨지지 않는 칸이 많습니다 — 숨긴 일반 시트를 보면서 소규모 시트에 적으세요.</div>
                      <button className="btn-p" style={{ marginTop: 8 }} disabled={!canWrite || !!busy} onClick={() => void fixSmall()}>
                        {busy === 'small' ? '정리하는 중…' : `정리해서 v${(latest?.version ?? 0) + 1} 만들기`}
                      </button>
                    </div>
                  )}

                  {toSmallPlan && !smallPlan && (
                    <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--warn)', fontSize: 'var(--fs-2)', lineHeight: 1.7 }}>
                      <b>일반 → 소규모 정리가 필요합니다</b> — 조서 기준은 소규모인데 작년 조서가 일반 양식 시트를 쓰고 있습니다.
                      올해 소규모 양식의 「번호(소규모)」 시트를 넣고, 작년 값은 줄 이름이 같은 칸만 옮기고(노랑), 일반 시트는 숨기겠습니다(지우지 않음).
                      <table className="tbl" style={{ marginTop: 6 }}>
                        <thead><tr style={{ background: 'var(--surface-2)' }}><th>번호</th><th>숨길 시트</th><th>쓸 시트(보이게)</th></tr></thead>
                        <tbody>
                          {toSmallPlan.steps.map((p) => <tr key={p.to}><td>{p.code}</td><td>{p.plain}</td><td><b>{p.to}</b> <span style={{ color: 'var(--ink-3)' }}>(올해 양식에서 새로)</span></td></tr>)}
                          {toSmallPlan.hide.map((n) => <tr key={`h:${n}`}><td>{n}</td><td>{n}</td><td style={{ color: 'var(--ink-3)' }}>— 소규모 양식에 없는 일반 양식 딸림 시트</td></tr>)}
                        </tbody>
                      </table>
                      <div style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-1)', marginTop: 4 }}>
                        1000·2000번대만 바꿉니다 — 작년부터 소규모인 회사(휴식·주원)도 3000·8000번대는 일반 시트를 씁니다.
                        일반과 소규모 양식은 모양이 달라 옮겨지지 않는 칸이 많습니다 — 숨긴 일반 시트를 보면서 적으세요. 웹 조서(2110A · 2110 · 2120A · 2301 · 2520 · 2530)는 1차 확정을 하면 소규모 시트에 들어갑니다.
                        1차 확정이 되어 있으면 ② 에서 [1차 확정 취소] → 여기서 정리 → [1차 확정] 순서로 하세요.
                      </div>
                      <button className="btn-p" style={{ marginTop: 8 }} disabled={!canWrite || !!busy} onClick={() => void fixToSmall()}>
                        {busy === 'tosmall' ? '정리하는 중…' : `정리해서 v${(latest?.version ?? 0) + 1} 만들기`}
                      </button>
                    </div>
                  )}

                  {largePlan && (
                    <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--warn)', fontSize: 'var(--fs-2)', lineHeight: 1.7 }}>
                      <b>소규모 → {AUDIT_BASIS_LABEL[year!.auditBasis]} 정리가 필요합니다</b> — 조서 기준은 {AUDIT_BASIS_LABEL[year!.auditBasis]}인데 작년 조서가 「번호(소규모)」 시트를 쓰고 있습니다.
                      올해 {year!.auditBasis} 양식 시트로 바꾸고, 작년 값은 줄 이름이 같은 칸만 옮기고, 소규모 시트는 숨기겠습니다(지우지 않음).
                      <table className="tbl" style={{ marginTop: 6 }}>
                        <thead><tr style={{ background: 'var(--surface-2)' }}><th>번호</th><th>숨길 시트</th><th>쓸 시트(보이게)</th></tr></thead>
                        <tbody>
                          {largePlan.tidy?.show.map((n) => <tr key={`s:${n}`}><td>—</td><td>—</td><td><b>{n}</b> <span style={{ color: 'var(--ink-3)' }}>(숨어 있음 → 보이게)</span></td></tr>)}
                          {largePlan.unsorted && <tr><td>—</td><td>—</td><td><b>시트 차례를 조서 번호 순서로</b> <span style={{ color: 'var(--ink-3)' }}>(맨 뒤에 붙은 시트 포함)</span></td></tr>}
                          {largePlan.steps.map((p) => (
                            <tr key={p.to}><td>{p.code}</td><td>{p.small || '—'}</td><td><b>{p.to}</b> <span style={{ color: 'var(--ink-3)' }}>{p.how === '양식에서' ? (p.small ? '(올해 양식에서 새로)' : '(2700A 요약이 쓰는 짝 — 올해 양식에서 새로)') : p.how === '보이기' ? '(숨겨 둔 일반 시트)' : ''}</span></td></tr>
                          ))}
                        </tbody>
                      </table>
                      <div style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-1)', marginTop: 4 }}>
                        소규모와 일반 양식은 모양이 달라 옮겨지지 않는 칸이 많습니다(2100 · 1200 등) — 숨긴 소규모 시트를 보면서 적으세요. 웹 조서(2110A · 2110 · 2700A)는 1차 확정을 다시 하면 새 시트에 들어갑니다.
                        1차 확정이 되어 있으면 ② 에서 [1차 확정 취소] → 여기서 정리 → [1차 확정] 순서로 하세요.
                      </div>
                      <button className="btn-p" style={{ marginTop: 8 }} disabled={!canWrite || !!busy} onClick={() => void fixLarge()}>
                        {busy === 'large' ? '정리하는 중…' : `정리해서 v${(latest?.version ?? 0) + 1} 만들기`}
                      </button>
                    </div>
                  )}

                  {needSort && !largePlan && !smallPlan && !toSmallPlan && (
                    <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--warn)', fontSize: 'var(--fs-2)', lineHeight: 1.7 }}>
                      <b>시트 차례가 조서 번호 순서가 아닙니다</b> — 양식에서 새로 넣은 시트가 맨 뒤에 붙어 있습니다. 조서 번호 순서로 늘어놓겠습니다(내용은 그대로, 딸림 시트는 제 조서 뒤를 따라감).
                      <div><button className="btn-p" style={{ marginTop: 8 }} disabled={!canWrite || !!busy} onClick={() => void fixOrder()}>
                        {busy === 'order' ? '정리하는 중…' : `정리해서 v${(latest?.version ?? 0) + 1} 만들기`}
                      </button></div>
                    </div>
                  )}

                  {missing.length > 0 && !largePlan && !smallPlan && !toSmallPlan && (
                    <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${missing.some((m) => m.suggested) ? 'var(--warn)' : 'var(--line)'}`, fontSize: 'var(--fs-2)', lineHeight: 1.7 }}>
                      <b>올해 양식에 있는데 이 파일에 없는 조서 {missing.length}개</b>
                      {missing.some((m) => m.suggested)
                        ? <> — 작년 파일에 시트가 없던 조서입니다. 체크한 것을 올해 양식에서 넣습니다(머리는 표지·조서목록으로, 탭은 빨강). 3000번대는 미리 체크해 두었습니다 — 일부러 숨긴 번호대(3150·3650)와 8000번대는 고를 때만.</>
                        : <span style={{ color: 'var(--ink-3)' }}> — 필요한 것만 골라 넣으세요(대개 7000 그룹·9000 내부회계 등 이 회사에 안 쓰는 조서).</span>}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 6 }}>
                        {missing.filter((m) => m.suggested || showAllMissing).map((m) => (
                          <label key={m.code} style={{ whiteSpace: 'nowrap' }}>
                            <input type="checkbox" checked={pickMissing.has(m.code)} disabled={!canWrite || !!busy}
                              onChange={(e) => setPickMissing((s) => { const n = new Set(s); if (e.target.checked) n.add(m.code); else n.delete(m.code); return n; })} /> {m.name}
                          </label>
                        ))}
                        {missing.some((m) => !m.suggested) && (
                          <button className="btn-sm" onClick={() => setShowAllMissing((v) => !v)}>
                            {showAllMissing ? '접기' : `그 밖의 조서 ${missing.filter((m) => !m.suggested).length}개 보기`}
                          </button>
                        )}
                      </div>
                      {pickMissing.size > 0 && (
                        <div><button className="btn-p" style={{ marginTop: 8 }} disabled={!canWrite || !!busy} onClick={() => void addMissing()}>
                          {busy === 'add' ? '넣는 중…' : `${pickMissing.size}개 넣어서 v${(latest?.version ?? 0) + 1} 만들기`}
                        </button></div>
                      )}
                    </div>
                  )}

                  {books.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontWeight: 700, fontSize: 'var(--fs-2)', marginBottom: 4 }}>판 목록 <span style={{ fontWeight: 400, color: 'var(--ink-3)', fontSize: 'var(--fs-1)' }}>— 조서 파일은 판이 쌓일 뿐 지우지 않습니다(외부감사법 제19조). 맨 위가 지금 판입니다.</span></div>
                      <div className="tbl-wide">
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
                                <td>{b.fileName} <span style={{ color: 'var(--ink-3)' }}>· {fmtKb(b.fileSize)}</span>{b.memo && <div style={{ fontSize: 'var(--fs-0)', color: /확정본/.test(b.memo) ? 'var(--good)' : 'var(--ink-4)', fontWeight: /확정본/.test(b.memo) ? 700 : 400 }}>{b.memo}</div>}</td>
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
                    </div>
                  )}
                </div>
              )}

              {/* ② 단계 진행 ─────────────────────────────── */}
              {view === 'stage' && year && latest && (
                <GwpStageBoard key={picked.id} eng={picked} latest={latest} tpl={tpl} basis={year.auditBasis} canWrite={canWrite}
                  partner={year.partner} author={year.authorDefault}
                  onBooks={async () => { setBooks(await listBooks(picked.id)); void refreshProgress(); }}
                  setMsg={setMsg} setErr={setErr} />
              )}

              {/* ③ 엑셀 조서 현황 ─────────────────────────── */}
              {view === 'status' && (
                <div className="card">
                  <div className="chdr">
                    ③ 엑셀 조서 현황
                    <span style={{ fontSize: 'var(--fs-1)', fontWeight: 400, color: 'var(--ink-3)' }}>
                      {latest ? `지금 판 v${latest.version} 의 시트 탭 색으로 봅니다` : '올린 파일이 없습니다'}
                    </span>
                  </div>
                  {!cat ? (
                    <Empty text="이월본을 만들거나 파일을 올리면 조서마다 진행이 여기에 보입니다." />
                  ) : (
                    <>
                      <div style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-2)', lineHeight: 1.7, marginBottom: 8 }}>
                        엑셀에서 조서를 쓰면서 <b>시트 탭 색</b>을 바꿔 두세요 — <b style={{ color: '#FF0000' }}>빨강</b> 손 안 댐 ·
                        <b style={{ color: '#B8A000' }}> 노랑</b> 수정함 · <b style={{ color: '#00B050' }}>초록</b> 확인했고 새로 넣을 것 없음.
                        저장해 「채운 파일 올리기」로 올리면 여기 숫자가 바뀝니다.
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                        {(['all', ...STATUS_ORDER] as const).filter((k) => k === 'all' || counts[k]).map((k) => (
                          <button key={k} className={`btn-sm${statusFilter === k ? ' btn-sm-navy' : ''}`} onClick={() => setStatusFilter(k)}>
                            {k === 'all' ? `모두 ${papers.length}` : <>{STATUS_TONE[k].dot && <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: STATUS_TONE[k].dot, border: '1px solid var(--line)', marginRight: 4, verticalAlign: 'middle' }} />}{k} {counts[k]}</>}
                          </button>
                        ))}
                      </div>
                      <div className="tbl-wide">
                        <table className="tbl">
                          <thead><tr style={{ background: 'var(--surface-2)' }}>
                            <th style={{ width: 90 }}>묶음</th><th style={{ width: 90 }}>조서</th><th>조서명</th><th style={{ width: 110 }}>시트</th>
                            <th style={{ width: 80 }}>작성자</th><th style={{ width: 80 }}>검토자</th><th style={{ width: 100 }}>일자</th><th style={{ width: 90 }}>상태</th>
                          </tr></thead>
                          <tbody>
                            {papers.filter((s) => statusFilter === 'all' || statusOf(s, fromRoll) === statusFilter).map((s) => {
                              const st = statusOf(s, fromRoll);
                              const ix = indexBy.get((s.code ?? '').replace(/\(.*$/, ''));
                              return (
                                <tr key={s.name} style={{ opacity: s.hidden ? 0.5 : 1 }}>
                                  <td style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-0)' }}>{sectionOf(s.code ?? '')}</td>
                                  <td>{s.code}</td>
                                  <td>{ix?.title ?? ''}</td>
                                  <td style={{ color: 'var(--ink-3)' }}>{s.name}</td>
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
                      <div style={{ fontSize: 'var(--fs-0)', color: 'var(--ink-4)', marginTop: 6 }}>
                        작성자·일자는 각 조서 머리에서 읽습니다(조서목록에 적으면 각 조서로 따라 들어갑니다). 숨긴 시트(안 쓰는 조서)는 흐리게 보입니다.
                      </div>
                    </>
                  )}
                </div>
              )}
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
