// 통합엑셀(3시트) 대량등록 — 거래처관리 2.0.0 통합 Excel 라운드.
// 시트: ①거래처·사업장 ②매출계약 ③거래처담당자. 각 원본은 외부에서 캐논 포맷으로 ETL 후 업로드.
// 기존 Phase B(bizExcel.applyBizExcel) 라운드트립과 별개. 최고관리자 1회성 대량적재.
//
// 시트1 로직:
//  - 거래처코드(L0001-01) 있으면 → 그 사업장 보강(빈 칸 미변경)
//  - 없고 사업자번호가 기존 사업장과 일치 → 그 사업장 보강(중복방지)
//  - 없고 그룹키가 기존 거래처코드(L0001/I0001) → 그 거래처에 사업장 추가
//  - 없고 그룹키가 신규(G001 등) → 그룹당 거래처 1개 생성 후 사업장들 부착
//  - 없고 그룹키 공란 → 단독 신규 거래처+사업장
//  법인=대표자명→biz_representative, 개인=주민→entity resident. 상태=폐업 반영.
// 시트2: 사업자번호로 거래처·사업장 찾아 매출계약(기장 TAX.BOOK) 생성. 활성 동일유형 있으면 스킵.
// 시트3: 사업자번호(우선)·회사명(보조)로 거래처 찾아 담당자 생성. 동일(이름+전화) 있으면 스킵.
import {
  createBizEntity, createBizPlace, createBizRepresentative, assignStaff,
  updateBizPlace, setEntityResident, setPlaceHometaxPw,
  listBizEntities, parseCorpForm, listInternalStaff,
  CORP_FORMS, type CorpForm, type BizKind, type BizNature, type TaxType, type Withholding, type SalesTeam,
} from './bizRegistryApi';
import {
  createSalesContract, saveContractStaff, listSalesContracts, listContractStaffProfiles,
  type BillingCycle,
} from './salesContractApi';
import { createBizContact, listBizContacts } from './bizContactApi';

const norm = (s: string) => (s || '').replace(/\D/g, '');
const normName = (s: string) =>
  (s || '').replace(/\s+/g, '').replace(/㈜|㈲|\(주\)|주식회사|\(유\)|유한회사|\(유책\)|유한책임회사|\(합자\)|\(합\)|합자회사|사모투자합자회사|\(합명\)|합명회사|pef/gi, '').toLowerCase();
const asCorp = (s: string): CorpForm | null => (CORP_FORMS as string[]).includes(s) ? (s as CorpForm) : null;
const asNature = (s: string): BizNature => (s === '일반' ? '일반' : '매출');
const asTax = (s: string): TaxType | null => (['과세', '겸영', '면세'] as string[]).includes(s) ? (s as TaxType) : null;
const asWht = (s: string): Withholding | null => (['월별', '반기별', 'N/A'] as string[]).includes(s) ? (s as Withholding) : null;
const asCycle = (s: string): BillingCycle => (['월', '분기', '반기', '연', '발생시', '건'] as string[]).includes(s) ? (s as BillingCycle) : '월';
const isO = (s: string) => /^(o|y|예|true|1|✓)$/i.test((s || '').trim());
const parseTeams = (s: string): SalesTeam[] => (s || '').split(/[,\s]+/).map((x) => x.trim()).filter((x) => x === '감사team' || x === 'taxteam') as SalesTeam[];

// ── 시트 파싱 (SheetJS) ──
/* eslint-disable @typescript-eslint/no-explicit-any */
async function readSheets(file: File): Promise<Record<string, Record<string, string>[]>> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const out: Record<string, Record<string, string>[]> = {};
  for (const name of wb.SheetNames) {
    const raw = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, defval: '' });
    if (raw.length < 1) { out[name] = []; continue; }
    const header = (raw[0] as any[]).map((h) => String(h).trim());
    const rows: Record<string, string>[] = [];
    for (const r of raw.slice(1)) {
      const arr = r as any[];
      const o: Record<string, string> = {};
      let empty = true;
      header.forEach((h, i) => {
        let v = arr[i];
        // 날짜 일련번호 → YYYY-MM-DD
        if (typeof v === 'number' && /일|date/i.test(h) && v > 20000 && v < 90000) {
          v = new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
        }
        const s = v == null ? '' : String(v).trim();
        o[h] = s;
        if (s) empty = false;
      });
      if (!empty) rows.push(o);
    }
    out[name] = rows;
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 헤더 키워드로 시트 찾기 */
function pickSheet(sheets: Record<string, Record<string, string>[]>, ...keywords: string[]): Record<string, string>[] {
  for (const name of Object.keys(sheets)) {
    if (keywords.some((k) => name.includes(k))) return sheets[name];
  }
  return [];
}
/** 행에서 키워드 포함 컬럼값 (첫 매치) */
function col(row: Record<string, string>, ...keywords: string[]): string {
  for (const k of Object.keys(row)) {
    if (k.startsWith('_')) continue; // 검토전용(_상태 등) 제외
    if (keywords.some((kw) => k.includes(kw))) return row[k] ?? '';
  }
  return '';
}

export interface UnifiedResult {
  places: { updated: number; created: number };
  entities: { created: number };
  contracts: { created: number; skipped: number };
  contacts: { created: number; skipped: number; unmatched: number };
  failed: { sheet: string; ref: string; error: string }[];
}

const VALID_CODE = /^[A-Za-z]\d+-\d+$/;   // 사업장 코드 L0001-01
const entityCodeOf = (gk: string) => gk.replace(/-\d+$/, ''); // 그룹키에 place코드(L0098-01) 넣어도 거래처코드(L0098)로 관용처리

// ── 드라이런(미리보기): 쓰기 없이 처리 계획만 계산 ──
export interface UnifiedPreview {
  places: { amend: number; createStandalone: number; createGrouped: number };
  entitiesNew: number;
  groups: { key: string; name: string; existing: boolean; members: number }[];
  contracts: { create: number; skip: number; unmatched: string[] };
  contacts: { create: number; skip: number; unmatched: number };
  warnings: string[];
}

export async function previewUnifiedImport(file: File): Promise<UnifiedPreview> {
  const pv: UnifiedPreview = {
    places: { amend: 0, createStandalone: 0, createGrouped: 0 }, entitiesNew: 0, groups: [],
    contracts: { create: 0, skip: 0, unmatched: [] }, contacts: { create: 0, skip: 0, unmatched: 0 }, warnings: [],
  };
  const sheets = await readSheets(file);
  const s1 = pickSheet(sheets, '거래처·사업장', '거래처', '사업장');
  const s2 = pickSheet(sheets, '매출계약', '계약');
  const s3 = pickSheet(sheets, '거래처담당자', '담당자', '연락처');

  const entities = await listBizEntities();
  const byPlaceCode = new Set<string>();
  const byEntityCode = new Map<string, { id: string; name: string }>();
  const byBizno = new Map<string, { entityId: string; placeId: string }>();
  const existNames = new Set<string>();
  for (const e of entities) {
    byEntityCode.set(e.code, { id: e.id, name: e.name });
    existNames.add(normName(e.name));
    for (const p of e.places) {
      byPlaceCode.add(`${e.code}-${String(p.placeNo).padStart(2, '0')}`);
      const b = norm(p.bizRegNo); if (b) byBizno.set(b, { entityId: e.id, placeId: p.id });
    }
  }
  const existContracts = await listSalesContracts();
  const contractSet = new Set(existContracts.map((c) => `${c.placeId || ''}|${c.categoryCode}`));

  const willExistBizno = new Set<string>(byBizno.keys());
  const willExistName = new Set<string>(existNames);
  for (const row of s1) { const b = norm(col(row, '사업자번호')); if (b) willExistBizno.add(b); const nm = col(row, '상호', '성명'); if (nm) willExistName.add(normName(parseCorpForm(nm).name)); }

  const newGroups = new Map<string, { name: string; existing: boolean; members: number }>();
  const attachGroups = new Map<string, { name: string; existing: boolean; members: number }>();
  for (const row of s1) {
    const code = col(row, '거래처코드').trim();
    const bizno = norm(col(row, '사업자번호'));
    const gk = col(row, '그룹키').trim();
    const gkE = entityCodeOf(gk);
    const matched = (code && VALID_CODE.test(code) && byPlaceCode.has(code)) || (!code && bizno && byBizno.has(bizno));
    if (matched) { pv.places.amend++; continue; }
    if (gk && byEntityCode.has(gkE)) {
      pv.places.createGrouped++;
      const g = attachGroups.get(gkE) ?? { name: byEntityCode.get(gkE)!.name, existing: true, members: 0 };
      g.members++; attachGroups.set(gkE, g);
    } else if (gk) {
      pv.places.createGrouped++;
      const g = newGroups.get(gk) ?? { name: col(row, '상호', '성명') || '(미상)', existing: false, members: 0 };
      if (!g.name || g.name === '(미상)') { const nm = col(row, '상호', '성명'); if (nm) g.name = nm; }
      g.members++; newGroups.set(gk, g);
    } else {
      pv.places.createStandalone++;
      if (!col(row, '상호', '성명')) pv.warnings.push(`신규 행에 상호/성명 없음 (사업자번호 ${col(row, '사업자번호') || '-'})`);
    }
  }
  pv.entitiesNew = pv.places.createStandalone + newGroups.size;
  pv.groups = [...newGroups.entries(), ...attachGroups.entries()].map(([key, v]) => ({ key, ...v }));

  for (const row of s2) {
    const bizno = norm(col(row, '사업자번호'));
    if (!bizno || !willExistBizno.has(bizno)) { pv.contracts.unmatched.push(col(row, '거래처명') || bizno || '(빈칸)'); continue; }
    const loc = byBizno.get(bizno);
    if (loc && contractSet.has(`${loc.placeId}|TAX.BOOK`)) pv.contracts.skip++;
    else pv.contracts.create++;
  }
  for (const row of s3) {
    const bizno = norm(col(row, '사업자번호'));
    const company = col(row, '거래처명');
    if (!col(row, '담당자명').trim()) continue;
    const matched = (bizno && willExistBizno.has(bizno)) || (company && willExistName.has(normName(parseCorpForm(company).name)));
    if (matched) pv.contacts.create++; else pv.contacts.unmatched++;
  }
  return pv;
}

/** 통합엑셀 적용 — 최고관리자 전용. */
export async function applyUnifiedImport(file: File): Promise<UnifiedResult> {
  const res: UnifiedResult = {
    places: { updated: 0, created: 0 }, entities: { created: 0 },
    contracts: { created: 0, skipped: 0 }, contacts: { created: 0, skipped: 0, unmatched: 0 }, failed: [],
  };
  const sheets = await readSheets(file);
  const s1 = pickSheet(sheets, '거래처·사업장', '거래처', '사업장');
  const s2 = pickSheet(sheets, '매출계약', '계약');
  const s3 = pickSheet(sheets, '거래처담당자', '담당자', '연락처');

  const [entities, staffProfiles] = await Promise.all([listBizEntities(), listInternalStaff()]);
  const staffByName = new Map(staffProfiles.map((s) => [s.name, s.id]));
  // 색인
  const byPlaceCode = new Map<string, { entityId: string; placeId: string; staffNames: Set<string> }>();
  const byEntityCode = new Map<string, { entityId: string; kind: BizKind; hasRepNames: Set<string> }>();
  const byBizno = new Map<string, { entityId: string; placeId: string; staffNames: Set<string> }>();
  for (const e of entities) {
    byEntityCode.set(e.code, { entityId: e.id, kind: e.kind, hasRepNames: new Set(e.representatives.map((r) => r.repName)) });
    for (const p of e.places) {
      const pc = `${e.code}-${String(p.placeNo).padStart(2, '0')}`;
      const staffNames = new Set(p.staff.map((s) => s.staffName));
      byPlaceCode.set(pc, { entityId: e.id, placeId: p.id, staffNames });
      const b = norm(p.bizRegNo);
      if (b) byBizno.set(b, { entityId: e.id, placeId: p.id, staffNames });
    }
  }
  // 그룹키 → 새로 만든 entityId 캐시
  const groupEntity = new Map<string, string>();

  async function assignStaffName(placeId: string, name: string, already: Set<string>) {
    const nm = (name || '').trim();
    if (!nm || already.has(nm)) return;
    const sid = staffByName.get(nm);
    if (!sid) return; // 화이트리스트/프로필 없는 이름 무시
    try { await assignStaff(placeId, sid, nm); already.add(nm); }
    catch (e) { if (!/duplicate|unique|23505|이미/i.test(e instanceof Error ? e.message : String(e))) throw e; }
  }

  // 그룹 신규 거래처의 entity identity 사전수집 (식별필드가 그룹 첫 행에만 있을 수 있음)
  const groupIdentity = new Map<string, { kind: BizKind; name: string; corpForm: CorpForm | null; corpPos: '앞' | '뒤' | null; resident: string; repName: string }>();
  for (const row of s1) {
    const gk = col(row, '그룹키').trim();
    if (!gk || byEntityCode.has(entityCodeOf(gk))) continue; // 기존 거래처 그룹은 신규생성 아님
    const name = col(row, '상호', '성명');
    if (!name) continue;
    if (groupIdentity.has(gk)) continue;
    const kind: BizKind = col(row, '구분') === '개인' ? '개인' : '법인';
    groupIdentity.set(gk, {
      kind, name, corpForm: asCorp(col(row, '법인격')), corpPos: (col(row, '법인격위치') === '앞' ? '앞' : col(row, '법인격위치') === '뒤' ? '뒤' : null),
      resident: col(row, '주민등록번호'), repName: col(row, '대표자명'),
    });
  }

  // ── 시트1: 거래처·사업장 ──
  for (const row of s1) {
    const code = col(row, '거래처코드').trim();
    const bizno = norm(col(row, '사업자번호'));
    const ref = code || col(row, '상호', '성명') || col(row, '사업장명') || bizno;
    try {
      // 보강 대상 사업장 찾기
      let hit = code && VALID_CODE.test(code) ? byPlaceCode.get(code) : undefined;
      if (!hit && !code && bizno) hit = byBizno.get(bizno);

      const tax = asTax(col(row, '과세유형'));
      const wht = asWht(col(row, '원천세'));
      const cpa = col(row, '담당CPA');
      const htId = col(row, '홈텍스ID');
      const htPw = col(row, '홈텍스PW');
      const resident = col(row, '주민등록번호');
      const repName = col(row, '대표자명');
      const status = col(row, '상태');
      const note = col(row, '비고');
      const staffCell = col(row, '담당직원');

      if (hit) {
        // ── 보강 ── (기존 거래처: 빈칸 채우기만 · 회사명/사업장명/사업자번호 등 식별정보는 절대 덮어쓰지 않음)
        const pp: Record<string, unknown> = {};
        const addr = col(row, '사업장주소'); if (addr) pp.address = addr;
        if (tax) pp.taxType = tax;
        if (wht) pp.withholding = wht;
        const od = col(row, '개업일'); if (od) pp.openedDate = od;
        if (col(row, '사업자단위과세')) pp.unitTaxation = isO(col(row, '사업자단위과세'));
        if (cpa) pp.cpa = cpa;
        if (htId) pp.hometaxId = htId;
        if (status === '폐업') pp.status = '폐업';
        if (note) pp.note = note;
        if (Object.keys(pp).length) await updateBizPlace(hit.placeId, pp);
        if (htPw) await setPlaceHometaxPw(hit.placeId, htPw);
        // 대표자/주민
        const eInfo = [...byEntityCode.values()].find((v) => v.entityId === hit!.entityId);
        const entKind = eInfo?.kind;
        if (entKind === '개인' && resident) await setEntityResident(hit.entityId, resident);
        if (entKind === '법인' && repName && !(eInfo?.hasRepNames.has(repName))) {
          await createBizRepresentative({ entityId: hit.entityId, repName, residentNo: resident || undefined });
          eInfo?.hasRepNames.add(repName);
        }
        if (staffCell) await assignStaffName(hit.placeId, staffCell, hit.staffNames);
        res.places.updated++;
      } else {
        // ── 신규 사업장 (거래처는 그룹/단독) ──
        const gk = col(row, '그룹키').trim();
        const gkE = entityCodeOf(gk);
        let entityId: string;
        let entKind: BizKind;
        if (gk && byEntityCode.has(gkE)) {
          // 기존 거래처에 사업장 추가
          const ec = byEntityCode.get(gkE)!;
          entityId = ec.entityId; entKind = ec.kind;
        } else if (gk && groupEntity.has(gk)) {
          entityId = groupEntity.get(gk)!;
          entKind = groupIdentity.get(gk)?.kind ?? '법인';
        } else {
          // 신규 거래처 생성
          const id = groupIdentity.get(gk);
          const kind: BizKind = id?.kind ?? (col(row, '구분') === '개인' ? '개인' : '법인');
          const rawName = id?.name ?? col(row, '상호', '성명');
          let name = rawName, corpForm = id?.corpForm ?? asCorp(col(row, '법인격')), corpPos = id?.corpPos ?? null;
          if (kind === '법인' && !corpForm && rawName) { const p = parseCorpForm(rawName); name = p.name; corpForm = p.form; corpPos = p.position; }
          if (kind === '법인' && corpForm && !corpPos) corpPos = '앞'; // 위치 미지정 시 앞(㈜) 기본
          if (!name) { res.failed.push({ sheet: '거래처·사업장', ref, error: '신규 거래처: 상호/성명 없음' }); continue; }
          entityId = await createBizEntity({
            kind, name, corpForm: kind === '법인' ? corpForm : null, corpFormPosition: kind === '법인' ? corpPos : null,
            residentNo: kind === '개인' ? (id?.resident || resident || undefined) : undefined, note: note || undefined,
          });
          entKind = kind;
          if (kind === '법인' && (id?.repName || repName)) {
            await createBizRepresentative({ entityId, repName: (id?.repName || repName), residentNo: (id?.resident || resident) || undefined });
          }
          res.entities.created++;
          if (gk) groupEntity.set(gk, entityId);
        }
        // 사업장 생성
        const placeName = col(row, '사업장명') || (entKind === '개인' ? col(row, '상호', '성명') : '본점');
        const bt2 = col(row, '본점', '지점');
        const placeId = await createBizPlace({
          entityId, placeName, isHeadquarters: bt2 !== '지점', branchType: bt2 === '지점' ? '지점' : '본점',
          bizRegNo: col(row, '사업자번호') || undefined, noBiz: isO(col(row, '사업자없음')), address: col(row, '사업장주소') || undefined,
          nature: asNature(col(row, '성격')), salesTeams: parseTeams(col(row, '매출팀') || 'taxteam'),
          taxType: tax, withholding: wht, openedDate: col(row, '개업일') || null, unitTaxation: isO(col(row, '사업자단위과세')),
          status: status === '폐업' ? '폐업' : '정상', cpa: cpa || undefined, hometaxId: htId || undefined, hometaxPw: htPw || undefined, note: note || undefined,
        });
        if (staffCell) await assignStaffName(placeId, staffCell, new Set());
        res.places.created++;
      }
    } catch (e) {
      res.failed.push({ sheet: '거래처·사업장', ref, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // ── 시트1 반영 후 재조회로 bizno/이름 색인 재구성 ──
  const fresh = await listBizEntities();
  const placeByBizno = new Map<string, { entityId: string; placeId: string }>();
  const entityByName = new Map<string, string>();
  for (const e of fresh) {
    entityByName.set(normName(e.name), e.id);
    for (const p of e.places) { const b = norm(p.bizRegNo); if (b) placeByBizno.set(b, { entityId: e.id, placeId: p.id }); }
  }
  const contractStaffProfiles = await listContractStaffProfiles();
  const contractStaffByName = new Map(contractStaffProfiles.map((s) => [s.name, s.id]));

  // ── 시트2: 매출계약 ──
  const existingContracts = await listSalesContracts();
  const contractKey = (entityId: string, placeId: string | null, code: string) => `${entityId}|${placeId || ''}|${code}`;
  const haveContract = new Set(existingContracts.map((c) => contractKey(c.entityId, c.placeId, c.categoryCode)));
  for (const row of s2) {
    const bizno = norm(col(row, '사업자번호'));
    const ref = col(row, '거래처명') || bizno;
    try {
      const loc = bizno ? placeByBizno.get(bizno) : undefined;
      if (!loc) { res.failed.push({ sheet: '매출계약', ref, error: '사업자번호로 거래처를 찾을 수 없음' }); continue; }
      const cat = 'TAX.BOOK'; // 이번 라운드=기장
      if (haveContract.has(contractKey(loc.entityId, loc.placeId, cat))) { res.contracts.skipped++; continue; }
      const amountRaw = col(row, '계약금액');
      const amount = Number(norm(amountRaw)) || 0;
      const cid = await createSalesContract({
        entityId: loc.entityId, placeId: loc.placeId, occurrenceUnit: '사업장', billingUnit: '사업장',
        team: 'taxteam', categoryCode: cat, includesVat: isO(col(row, '부가포함')), includesWht: isO(col(row, '원천포함')),
        billingCycle: asCycle(col(row, '청구주기')), amount, cpa: col(row, '담당CPA') || undefined,
        contractDate: col(row, '계약일') || null, startDate: col(row, '개시일') || null, endDate: col(row, '종료일') || null,
        fiscalYear: col(row, '귀속연도') ? Number(norm(col(row, '귀속연도'))) || null : null, note: col(row, '비고') || undefined,
      });
      const stName = col(row, '담당직원').trim();
      const sid = contractStaffByName.get(stName);
      if (sid) await saveContractStaff(cid, [{ staffId: sid, staffName: stName }]);
      haveContract.add(contractKey(loc.entityId, loc.placeId, cat));
      res.contracts.created++;
    } catch (e) {
      res.failed.push({ sheet: '매출계약', ref, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // ── 시트3: 거래처담당자 ──
  const existingContacts = await listBizContacts();
  const contactKey = (entityId: string, name: string, phone: string) => `${entityId}|${name.trim()}|${norm(phone)}`;
  const haveContact = new Set(existingContacts.map((c) => contactKey(c.entityId, c.contactName, c.phone)));
  for (const row of s3) {
    const bizno = norm(col(row, '사업자번호'));
    const company = col(row, '거래처명');
    const name = col(row, '담당자명').trim();
    const ref = `${company} / ${name}`;
    if (!name) continue;
    try {
      let entityId = bizno ? placeByBizno.get(bizno)?.entityId : undefined;
      if (!entityId && company) entityId = entityByName.get(normName(parseCorpForm(company).name));
      if (!entityId) { res.contacts.unmatched++; continue; }
      const phone = col(row, '전화', '휴대폰');
      if (haveContact.has(contactKey(entityId, name, phone))) { res.contacts.skipped++; continue; }
      await createBizContact({
        entityId, contactName: name, honorific: col(row, '호칭') || '님', position: col(row, '직책') || undefined,
        phone: phone || undefined, email: col(row, '이메일') || undefined, address: col(row, '수령지', '주소') || undefined,
        isPrimary: isO(col(row, '대표여부')), note: col(row, '비고') || undefined,
      });
      haveContact.add(contactKey(entityId, name, phone));
      res.contacts.created++;
    } catch (e) {
      res.failed.push({ sheet: '거래처담당자', ref, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return res;
}
