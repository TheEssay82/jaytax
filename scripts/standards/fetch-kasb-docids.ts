// KASB 기준서 딥링크 인덱스 생성 — 카탈로그의 숫자 기준서번호마다
// KASB 비공식 API(/api/standard/{no}/first-document-id)로 '존재'를 검증하고 문서id를 받아
// public/standards-kasb.json 으로 저장한다. 프런트는 이 맵에 있는 번호에 한해 'KASB 원문 보기' 링크를 건다.
//
// 저작권: 기준서 본문은 한국회계기준원(KASB) 저작물이다. 본문은 저장하지 않고(요지만 유지),
//   원문은 link(db.kasb.or.kr/standard/{no})로 KASB에서 직접 열람·내려받게 한다(포인터).
// 주의: /api/standard/... 는 KASB 비공식(내부) 엔드포인트라 변경될 수 있다 — 이 스크립트로 재생성한다.
// 사용: npm run std:fetch:kasb
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './lib.ts';
import { CATALOG } from '../../src/lib/standardsCatalog.ts';

const FIRST_DOC = (no: string) => `https://db.kasb.or.kr/api/standard/${no}/first-document-id`;
const PAGE_BASE = 'https://db.kasb.or.kr/standard/';

// 카탈로그에서 '숫자' 기준서번호만 추출(K-IFRS 1xxx·해석서 2xxx, 기타 5xxx). 장/개념체계 등 비숫자는 제외.
const numbers = [
  ...new Set(
    CATALOG.flatMap((c) => c.groups.flatMap((g) => g.items.map((it) => it.no))).filter((no) =>
      /^\d{3,4}$/.test(no)
    )
  ),
].sort();

console.log(`대상 숫자 기준서 ${numbers.length}건 — first-document-id 검증 시작`);

const items: Record<string, string> = {};
let ok = 0;
let miss = 0;
for (const no of numbers) {
  try {
    const res = await fetch(FIRST_DOC(no), { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      miss++;
      continue;
    }
    const j = (await res.json()) as { status?: number; documentId?: string };
    if (j.documentId) {
      items[no] = j.documentId;
      ok++;
    } else {
      miss++;
    }
  } catch {
    miss++;
  }
  process.stdout.write(`  확인 ${ok + miss}/${numbers.length} (존재 ${ok}, 없음 ${miss})\r`);
  // KASB 부담 완화용 소폭 지연
  await new Promise((r) => setTimeout(r, 80));
}
process.stdout.write('\n');

const outPath = resolve(ROOT, 'public/standards-kasb.json');
const payload = {
  source: 'KASB 회계기준열람서비스 (db.kasb.or.kr) — 기준서 원문 딥링크 인덱스(본문 미포함)',
  note: '본문은 한국회계기준원(KASB) 저작물. 링크(standard/{no})로 KASB 원문 열람·내려받기.',
  fetchedAt: new Date().toISOString().slice(0, 10),
  base: PAGE_BASE,
  count: ok,
  items, // { "1115": "491f32", ... }
};
writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
console.log(`인덱스 저장: ${outPath} (존재 ${ok}건 / 시도 ${numbers.length}건)`);
