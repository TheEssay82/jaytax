// 거래처담당자 일괄등록 Excel — 양식(기존 담당자 프리필 + 거래처별 빈 행) 내보내기 + 업로드 적용.
// 매출계약판(bizContractExcel.ts)과 같은 방식: 회색=키/참고(수정금지), 노랑=입력.
// 담당자ID 가 있으면 그 담당자를 수정, 없으면 신규 등록. 같은 거래처에 담당자명+연락처가
// 같은 건이 이미 있으면 스킵해서 재업로드해도 중복이 생기지 않는다.
import {
  createBizContact, updateBizContact, listBizContacts,
  type BizContact, type ContactInput,
} from './bizContactApi';
import { corpDisplayName, type BizEntityFull } from './bizRegistryApi';
import { FONT, FILL_HEADER, frame, setWidths, saveWorkbook } from './confirmExcelStyle';

async function loadExcelJS() {
  const mod = await import('exceljs');
  const ns = (mod as unknown as { default?: unknown }).default ?? mod;
  return ns as typeof import('exceljs');
}

const OX = ['O', 'X'] as const;
const HONORIFICS = ['님', '귀하', '대표님', '사장님', '이사님', '팀장님', '과장님'] as const;

interface ColMeta { h: string; w: number; list?: readonly string[] }
const COLS: ColMeta[] = [
  { h: '담당자ID(수정금지)', w: 34 },
  { h: '거래처코드(필수)', w: 12 },
  { h: '거래처명(참고)', w: 22 },
  { h: '사업장명(비우면 거래처 전체)', w: 20 },
  { h: '담당자명(필수)', w: 12 },
  { h: '호칭', w: 8, list: HONORIFICS },
  { h: '직책', w: 12 },
  { h: '연락처', w: 15 },
  { h: '이메일', w: 22 },
  { h: '수령지주소', w: 34 },
  { h: '대표연락처(O/X)', w: 13, list: OX },
  { h: '비고', w: 20 },
];
const HEADERS = COLS.map((c) => c.h);
const REF_COLS = new Set([0, 1, 2]); // 담당자ID·거래처코드·거래처명 = 회색(키/참고)

const FILL_EDIT = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFF7D6' } };
const FILL_REF = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFECECEC' } };

/**
 * 양식 내보내기 — 기존 담당자는 1명 1행으로 프리필하고, 담당자가 없는 거래처는 빈 행을 한 줄 깔아둔다.
 * 담당자를 더 넣으려면 그 거래처 행을 복사해 담당자ID 를 비우고 채우면 된다.
 */
export async function exportContactTemplate(entities: BizEntityFull[], contacts: BizContact[]): Promise<void> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('거래처담당자', { views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }] });
  const N = COLS.length;

  ws.addRow(HEADERS);
  ws.addRow(['※ 회색=키/참고(수정금지). 노란칸=입력·수정. 담당자ID 있으면 그 담당자를 수정, 비어 있으면 신규 등록. 한 거래처에 담당자가 여럿이면 행을 복사(담당자ID 는 비우고). 담당자명 빈 행은 제외.']);
  ws.getCell(2, 1).font = { ...FONT, size: 9, color: { argb: 'FF888888' } };

  const byEntity = new Map<string, BizContact[]>();
  for (const c of contacts) {
    const arr = byEntity.get(c.entityId);
    if (arr) arr.push(c);
    else byEntity.set(c.entityId, [c]);
  }

  for (const e of entities) {
    const name = corpDisplayName(e.name, e.corpForm, e.corpFormPosition);
    const placeName = (placeId: string | null) => (placeId ? e.places.find((p) => p.id === placeId)?.placeName ?? '' : '');
    const mine = byEntity.get(e.id) ?? [];
    if (mine.length) {
      for (const c of mine) {
        ws.addRow([
          c.id, e.code, name, placeName(c.placeId), c.contactName, c.honorific, c.position,
          c.phone, c.email, c.address, c.isPrimary ? 'O' : '', c.note,
        ]);
      }
    } else {
      ws.addRow(['', e.code, name, '', '', '', '', '', '', '', '', '']);
    }
  }

  const dataStart = 3;
  const dataEnd = ws.rowCount;
  frame(ws, 1, 1, 1, N, { fill: FILL_HEADER, bold: true, align: 'center', wrap: true });
  ws.getRow(1).height = 30;

  if (dataEnd >= dataStart) {
    frame(ws, dataStart, 1, dataEnd, N);
    for (let r = dataStart; r <= dataEnd; r++) {
      for (let ci = 0; ci < N; ci++) {
        const meta = COLS[ci];
        const isRef = REF_COLS.has(ci);
        ws.getCell(r, ci + 1).fill = isRef ? FILL_REF : FILL_EDIT;
        if (!isRef && meta.list) {
          ws.getCell(r, ci + 1).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${meta.list.join(',')}"`] };
        }
      }
    }
  }
  setWidths(ws, COLS.map((c) => c.w));
  await saveWorkbook(wb, '거래처담당자_일괄등록양식.xlsx');
}

export interface ContactExcelRow {
  id: string; code: string; placeName: string; contactName: string; honorific: string;
  position: string; phone: string; email: string; address: string; primary: string; note: string;
}

export async function parseContactExcelFile(file: File): Promise<ContactExcelRow[]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
  if (raw.length < 2) return [];
  const header = (raw[0] as unknown[]).map((h) => String(h).trim());
  const idx = (kw: string) => header.findIndex((h) => h.includes(kw));
  const map = {
    id: idx('담당자ID'), code: idx('거래처코드'), placeName: idx('사업장명'), contactName: idx('담당자명'),
    honorific: idx('호칭'), position: idx('직책'), phone: idx('연락처'), email: idx('이메일'),
    address: idx('수령지'), primary: idx('대표연락처'), note: idx('비고'),
  };
  const get = (row: unknown[], i: number) => (i >= 0 ? String(row[i] ?? '').trim() : '');
  const out: ContactExcelRow[] = [];
  for (const r of raw.slice(1)) {
    const row = r as unknown[];
    const code = get(row, map.code);
    const contactName = get(row, map.contactName);
    if (code.startsWith('※')) continue;
    if (!code && !contactName) continue;
    out.push({
      id: get(row, map.id), code, placeName: get(row, map.placeName), contactName,
      honorific: get(row, map.honorific), position: get(row, map.position), phone: get(row, map.phone),
      email: get(row, map.email), address: get(row, map.address), primary: get(row, map.primary),
      note: get(row, map.note),
    });
  }
  return out;
}

export interface ContactExcelResult { created: number; updated: number; skipped: number; failed: { ref: string; error: string }[] }

const isO = (s: string) => /^(o|y|예|true|1|✓)$/i.test(s.trim());
const digits = (s: string) => s.replace(/\D/g, '');

/**
 * 파싱된 행 적용.
 *  · 담당자ID 있으면 그 담당자를 수정.
 *  · 없으면 거래처코드(+사업장명)로 찾아 신규 등록 — 같은 거래처에 담당자명+연락처가 같은 건이 있으면 스킵.
 */
export async function applyContactExcel(rows: ContactExcelRow[], entities: BizEntityFull[]): Promise<ContactExcelResult> {
  const res: ContactExcelResult = { created: 0, updated: 0, skipped: 0, failed: [] };
  const byCode = new Map(entities.map((e) => [e.code, e]));
  const existing = await listBizContacts();
  const ids = new Set(existing.map((c) => c.id));
  const key = (entityId: string, name: string, phone: string) => `${entityId}|${name.trim()}|${digits(phone)}`;
  const seen = new Set(existing.map((c) => key(c.entityId, c.contactName, c.phone)));

  for (const r of rows) {
    if (!r.contactName) continue; // 담당자명 없는 행 = 미작성, 제외
    const ref = `${r.code}/${r.contactName}`;
    try {
      const e = byCode.get(r.code);
      if (!e) { res.failed.push({ ref, error: '거래처코드를 찾을 수 없음' }); continue; }
      let placeId: string | null = null;
      if (r.placeName) {
        const p = e.places.find((x) => x.placeName === r.placeName);
        if (!p) { res.failed.push({ ref, error: `사업장을 찾을 수 없음: ${r.placeName}` }); continue; }
        placeId = p.id;
      }
      const input: ContactInput = {
        entityId: e.id,
        placeId,
        contactName: r.contactName,
        honorific: r.honorific || '님',
        position: r.position,
        phone: r.phone,
        email: r.email,
        address: r.address,
        isPrimary: isO(r.primary),
        note: r.note,
      };

      if (r.id) {
        if (!ids.has(r.id)) { res.failed.push({ ref, error: '담당자ID 를 찾을 수 없음(삭제된 건)' }); continue; }
        await updateBizContact(r.id, input);
        res.updated++;
        continue;
      }

      const k = key(e.id, r.contactName, r.phone);
      if (seen.has(k)) { res.skipped++; continue; }
      await createBizContact(input);
      seen.add(k);
      res.created++;
    } catch (er) {
      res.failed.push({ ref, error: er instanceof Error ? er.message : String(er) });
    }
  }
  return res;
}
