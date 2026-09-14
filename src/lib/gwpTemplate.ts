// 한공회 표준 일반조서 **묶음(zip)** 을 읽어 어느 파일에 어느 조서 시트가 있는지 목록으로.
//
// 묶음은 「Section 1000 - 감사계약/1200_1200_감사계약(1200~1300).xlsx」처럼 폴더에 파일이 흩어져 있고,
// 한 파일에 시트가 여럿이다(K-IFRS 37파일·약 90시트, 2026-09-15). 4000(계정별)·JE Test·sample 은
// 설계 밖이라 뺀다(사용자 결정). docx·pdf 도 뺀다 — 엑셀 조서만 다룬다.
import { unzipSync } from 'fflate';
import { sheetNames } from './xlsxRead';
import { codeOf } from './gwpCatalog';
import { sheetEntries } from './xlsxTransplant';

export interface TemplateSheet {
  /** 묶음 안 파일 경로 */ file: string;
  name: string;
  code: string | null;
  hidden: boolean;
}

export interface TemplateCatalog {
  files: string[];
  sheets: TemplateSheet[];
  /** 뺀 파일(왜 뺐는지 함께) */ skipped: { file: string; why: string }[];
}

/** 이 항목이 다룰 엑셀 조서 파일인가. 아니면 왜 아닌지. */
export function skipReason(path: string): string | null {
  const p = path.replace(/\\/g, '/');
  const base = p.split('/').pop() ?? p;
  if (p.includes('__MACOSX') || base.startsWith('._') || base.startsWith('~$')) return '시스템 파일';
  if (!/\.xls[xm]$/i.test(base)) return '엑셀이 아님';
  if (/Section 4000|계정별 입증감사절차|계정별 실증절차/.test(p)) return '4000 계정별(설계 밖)';
  if (/JE ?Test/i.test(p)) return 'JE Test(설계 밖)';
  if (/sample|아카이브전 삭제|\(참고\)|참고\)/.test(p)) return '참고·예시';
  return null;
}

/** 묶음을 읽는다 — 파일은 풀어 둔 채 돌려준다(이식할 때 그대로 쓴다). */
export function readBundle(zipBytes: Uint8Array): { catalog: TemplateCatalog; files: Record<string, Uint8Array> } {
  if (!(zipBytes[0] === 0x50 && zipBytes[1] === 0x4b)) throw new Error('zip 파일이 아닌 것 같습니다.');
  const all = unzipSync(zipBytes);
  const catalog: TemplateCatalog = { files: [], sheets: [], skipped: [] };
  const files: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(all)) {
    if (path.endsWith('/')) continue;
    const why = skipReason(path);
    if (why) { if (/\.xls[xm]$/i.test(path)) catalog.skipped.push({ file: path, why }); continue; }
    let names: string[];
    let hidden = new Set<string>();
    try {
      names = sheetNames(bytes);
      hidden = new Set(sheetEntries(unzipSync(bytes, { filter: (f) => f.name === 'xl/workbook.xml' || f.name === 'xl/_rels/workbook.xml.rels' }))
        .filter((e) => e.state && e.state !== 'visible').map((e) => e.name));
    } catch {
      catalog.skipped.push({ file: path, why: '엑셀로 읽히지 않음' });
      continue;
    }
    files[path] = bytes;
    catalog.files.push(path);
    for (const name of names) catalog.sheets.push({ file: path, name, code: codeOf(name), hidden: hidden.has(name) });
  }
  catalog.files.sort();
  catalog.sheets.sort((a, b) => a.file.localeCompare(b.file) || 0);
  return { catalog, files };
}

/**
 * 조서 코드로 양식 시트를 찾는다 — 코드가 같은 것 가운데 **보이는 시트**를 먼저.
 *
 * 소규모 묶음의 「1100(소규모)」와 회사 파일의 「1100」은 코드가 같다(codeOf 가 「(소규모)」를 뺀다).
 */
export function findTemplateSheet(catalog: TemplateCatalog, code: string): TemplateSheet | null {
  const hits = catalog.sheets.filter((s) => s.code === code);
  if (hits.length) return hits.find((s) => !s.hidden) ?? hits[0];
  // 꼬리만 다른 같은 조서 — 회사 「2700A-2」(원래 「2700A-2(소규모)」)와 양식 「2700A-2(감사계획단계)」.
  // 회사 쪽에 꼬리가 없고 양식 쪽에 그 앞 토막이 **하나뿐**일 때만 짝짓는다. 「8500(별첨1)」처럼
  // 회사 쪽에 꼬리가 있으면 양식 「8500」과 다른 시트다.
  if (/\(/.test(code)) return null;
  const base = (c: string) => c.replace(/\(.*$/, '');
  const loose = catalog.sheets.filter((s) => s.code && base(s.code) === code);
  const codes = new Set(loose.map((s) => s.code));
  if (codes.size !== 1) return null;
  return loose.find((s) => !s.hidden) ?? loose[0];
}

/** 묶음이 담은 조서 코드 전부(차례대로, 겹침 없이). */
export function templateCodes(catalog: TemplateCatalog): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of catalog.sheets) {
    if (!s.code || seen.has(s.code)) continue;
    seen.add(s.code);
    out.push(s.code);
  }
  return out;
}
