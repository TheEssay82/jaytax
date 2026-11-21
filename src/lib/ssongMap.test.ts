// 쏭비서 지도·매출유형 목록이 앱 소스와 맞는지 지킨다(2026-11-21).
// 메뉴·개발노트·백로그·매출유형을 고치면 쏭비서도 알아야 한다 — 어긋나면 이 테스트가 실패한다.
// 고치는 법:  cd connectors/ssong-mcp  →  npm run gen:map  → 생긴 변경을 같이 커밋.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderJaytaxMapFile } from '../../connectors/ssong-mcp/scripts/jaytaxMap.ts';
import { CATEGORIES } from '../../connectors/ssong-mcp/lib/categories.ts';
import { TAXONOMY, isLeaf, type TaxNode } from './salesContractTaxonomy';

const HINT = ' — connectors/ssong-mcp 에서 npm run gen:map 을 돌리고 같이 커밋하세요.';

test('쏭비서 JAYTAX 지도가 메뉴·개발노트·백로그와 같다', () => {
  const onDisk = readFileSync(new URL('../../connectors/ssong-mcp/lib/jaytaxMap.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(onDisk, renderJaytaxMapFile(), '쏭비서 지도가 앱보다 낡았습니다' + HINT);
});

test('쏭비서 매출유형 목록이 앱 분류표와 같다', () => {
  const leaves: string[] = [];
  const walk = (n: TaxNode) => (isLeaf(n) ? leaves.push(n.code) : n.children!.forEach(walk));
  Object.values(TAXONOMY).forEach((ns) => ns.forEach(walk));
  assert.deepEqual(CATEGORIES.map((c) => c.code), leaves, '쏭비서 매출유형 목록이 낡았습니다' + HINT);
});
