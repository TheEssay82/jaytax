// 업무 폴더에서 이 작업 건의 파일 찾기 — 순수 로직(브라우저 폴더 읽기는 folderAccess.ts).
//
// 사용자 2026-09-28: 「제 모든 과거 감사파일은 D:\Dropbox\0_우철업무\1000.업무\업무파일 안의 회사명 폴더로 관리 …
// 회사명 하부에 연도별 폴더, 그 하부에 보고서·정산표·일반관리조서 폴더」 → 폴더에서 자동으로 올리기는 **내 거래처만**,
// 다른 거래처는 직접 올리기를 그대로 둔다.
//
// 실측(209개 회사 폴더, 2025 회계감사 27곳): 연도 폴더는 「2025_회계감사」 꼴이 대부분이지만 그 아래 폴더 이름은 회사마다
// 다르다(000_A파일 · 000_일반관리조서 · 000_일반관리자료 · A File · 보고서및A-file …). 그래서 **폴더 이름이 아니라 파일 이름**으로 찾는다:
//   일반조서  「기말감사일반조서_알티스트_FY25.xlsx」
//   감사보고서 「감사보고서_알티스트_FY2025_260311_Final.dsd」 (기업개황·감사인중요성 DSD 는 뺀다)
//   정산표    「WTB_알티스트_FY251231_260225_Final.xlsx」 (「삭제」 폴더·중간 정산표는 뺀다)
// 여럿이면 점수로 고르고, 비기면 사람이 고른다. 연도는 올린 뒤에도 자료함의 연도 확인이 한 번 더 거른다.

/** 이 이름의 폴더·파일은 보지 않는다. */
export const SKIP = /삭제|^old$|백업|^~\$|\.bak$|^\./i;
/** 파일이 많고 찾을 것이 없는 폴더 — 회사가 준 자료·조회서(속도). */
export const SKIP_DIR = /PBC|요청자료|조회서|전달자료|강평|AuditLobby|Audit Lobby/i;

export type FolderKind = '일반조서' | '감사보고서' | '정산표';
export interface Candidate { path: string; name: string; score: number; why: string[] }
export interface Found { 일반조서: Candidate[]; 감사보고서: Candidate[]; 정산표: Candidate[] }

const norm = (s: string) => s.replace(/\s|주식회사|㈜|\(주\)|\(유\)|유한회사|사모투자합자회사|\(.*?\)/g, '');

/**
 * 거래처명 → 회사 폴더. 같으면 그것, 한쪽이 다른 쪽을 품으면 후보(「오큘러스제1호」 ↔ 「오큘러스제1호사모투자합자회사」).
 * 후보가 하나면 그것, 여럿·없으면 null(사람이 고른다). remembered 가 있으면 그것.
 */
export function matchCompany(folders: string[], entity: string, remembered?: string | null): { pick: string | null; options: string[] } {
  if (remembered && folders.includes(remembered)) return { pick: remembered, options: [remembered] };
  const e = norm(entity);
  const exact = folders.filter((f) => norm(f) === e);
  if (exact.length === 1) return { pick: exact[0], options: exact };
  const part = folders.filter((f) => { const n = norm(f); return n.length >= 2 && (n.includes(e) || e.includes(n)); });
  if (part.length) return { pick: part.length === 1 ? part[0] : null, options: part };
  // 글자는 같고 순서만 다르다 — 「이니어스제1호블라인드」 ↔ 「이니어스블라인드제1호(사모투자합자회사)」(사용자 2026-09-28).
  const sorted = (s: string) => [...s].sort().join('');
  const ana = folders.filter((f) => norm(f).length >= 4 && sorted(norm(f)) === sorted(e));
  return { pick: ana.length === 1 ? ana[0] : null, options: ana };
}

/** 이 해의 감사 폴더 — 「2025_회계감사」 > 「2025_기말감사」·「2025_개별감사」 > 「2025…감사」. 없으면 null. */
export function pickYearFolder(folders: string[], fy: number): string | null {
  const mine = folders.filter((f) => f.startsWith(String(fy)) && /감사/.test(f) && !/중간|실사|평가|용역/.test(f));
  const rank = (f: string) => (/회계감사$/.test(f) ? 0 : /(기말|개별)감사/.test(f) ? 1 : 2);
  return mine.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** 파일 이름 속 날짜(「260311」·「20260311」) — 같은 점수면 늦은 것. */
function stamp(name: string): number {
  const m = [...name.matchAll(/(?:^|[_\s-])((?:20)?\d{6})(?=[_.\s-]|$)/g)].map((x) => x[1]);
  const v = m.map((s) => Number(s.length === 8 ? s.slice(2) : s)).filter((n) => n > 100000 && n < 991231);
  return v.length ? Math.max(...v) : 0;
}

/** 이름이 이 해(FY)를 가리키는가 — 「FY25」·「FY2025」·「FY251231」·「_2025_」. 다른 해면 false, 모르면 null. */
export function fyOfName(name: string): number | null {
  const m = /FY\s?(\d+)/i.exec(name);
  if (!m) return null;
  const d = m[1];
  if ((d.length === 4 || d.length === 8) && d.startsWith('20')) return Number(d.slice(0, 4));   // FY2025 · FY20251231
  if (d.length === 2 || d.length === 4 || d.length === 6) return 2000 + Number(d.slice(0, 2));   // FY25 · FY2512 · FY251231
  return null;
}

/** 폴더 안 파일들(연도 폴더 기준 상대 경로) → 종류별 후보, 점수 높은 순. fy = 그 폴더의 해. */
export function classify(paths: string[], fy: number): Found {
  const out: Found = { 일반조서: [], 감사보고서: [], 정산표: [] };
  for (const path of paths) {
    const parts = path.split('/');
    if (parts.some((p) => SKIP.test(p)) || parts.slice(0, -1).some((p) => SKIP_DIR.test(p))) continue;
    const name = parts[parts.length - 1];
    const y = fyOfName(name);
    const why: string[] = [];
    let score = 0;
    if (y === fy) { score += 3; why.push(`FY${fy}`); } else if (y != null) { score -= 6; why.push(`FY${y}(다른 해)`); }
    if (/final|최종|_완\b|완료/i.test(name)) { score += 1; why.push('최종'); }
    if (/\.xls[xm]?$/i.test(name) && /일반.*조서/.test(name) && !/목록|template|열람/i.test(name)) {
      if (/기말/.test(name)) { score += 2; why.push('기말'); }
      if (/반기|분기/.test(name)) { score -= 5; why.push('반기·분기'); }
      if (/^\d{4}[_\s]/.test(name)) { score -= 1; why.push('나눈 파일'); }
      out.일반조서.push({ path, name, score, why });
    } else if (/\.dsd$/i.test(name) && !/개황|중요성/.test(name)) {
      if (/감사보고서/.test(name)) { score += 2; why.push('감사보고서'); }
      if (/연결/.test(name)) { score -= 1; why.push('연결'); }
      if (/반기|분기|검토보고서/.test(name)) { score -= 3; why.push('반기·분기'); }
      if (/final/i.test(name)) { score += 1; }
      out.감사보고서.push({ path, name, score, why });
    } else if (/\.xls[xm]?$/i.test(name) && /WTB|정산표/i.test(name)) {
      if (/기말/.test(name)) { score += 2; why.push('기말'); }
      if (/중간|반기|분기|0930|0630|0331/.test(name)) { score -= 3; why.push('중간·분기'); }
      if (/연결/.test(name)) { score -= 1; why.push('연결'); }
      out.정산표.push({ path, name, score, why });
    }
  }
  // 이름으로 못 알아본 종류 — 같은 확장자 파일을 모두 후보로(사용자 2026-10-02 「폴더 이름 형식이 나와 달라 자동으로 못 가져온다」).
  // 점수 0 이라 저절로 고르지 않는다 — 사람이 목록에서 고른다. 연도는 올릴 때 자료함 검사가 한 번 더 본다.
  const fallback = (k: FolderKind, ext: RegExp) => {
    if (out[k].length) return;
    for (const path of paths) {
      const parts = path.split('/');
      if (parts.some((p) => SKIP.test(p)) || !ext.test(path)) continue;
      out[k].push({ path, name: parts[parts.length - 1], score: 0, why: ['이름으로 못 알아봄'] });
    }
  };
  fallback('일반조서', /\.xls[xm]?$/i);
  fallback('감사보고서', /\.dsd$/i);
  fallback('정산표', /\.xls[xm]?$/i);
  for (const k of Object.keys(out) as FolderKind[]) out[k].sort((a, b) => b.score - a.score || stamp(b.name) - stamp(a.name) || a.path.length - b.path.length);
  return out;
}

/** 확실한가 — 1등이 있고 2등보다 점수가 높거나(또는 혼자), 점수가 0 보다 크다. */
export function sure(c: Candidate[]): Candidate | null {
  if (!c.length || c[0].score <= 0) return null;
  return c.length === 1 || c[0].score > c[1].score || stamp(c[0].name) > stamp(c[1].name) ? c[0] : null;
}
