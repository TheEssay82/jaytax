// 앱의 매출유형 분류(src/lib/salesContractTaxonomy.ts)에서 맨 아래 단계(leaf)만 뽑아
// lib/categories.ts 로 적는다. 규칙이 두 벌이 되지 않게 손으로 고치지 않는다.
//   npx tsx scripts/gen-categories.ts   (connectors/ssong-mcp 에서)
import { writeFileSync } from 'node:fs';
import { TAXONOMY, isLeaf, pathLabel, type TaxNode, type Team } from '../../../src/lib/salesContractTaxonomy.ts';

const out: { code: string; team: Team; label: string; needsEtcName?: true; defaultUnit?: string; defaultCycle?: string }[] = [];
const walk = (team: Team, n: TaxNode) => {
  if (isLeaf(n)) {
    out.push({
      code: n.code, team, label: pathLabel(n.code),
      ...(n.needsEtcName ? { needsEtcName: true as const } : {}),
      ...(n.defaultUnit ? { defaultUnit: n.defaultUnit } : {}),
      ...(n.defaultCycle ? { defaultCycle: n.defaultCycle } : {}),
    });
  } else n.children!.forEach((c) => walk(team, c));
};
for (const team of Object.keys(TAXONOMY) as Team[]) TAXONOMY[team].forEach((n) => walk(team, n));

writeFileSync(new URL('../lib/categories.ts', import.meta.url),
  `// 자동 생성 — scripts/gen-categories.ts. 손으로 고치지 말 것.\n` +
  `export const CATEGORIES = ${JSON.stringify(out, null, 2)} as const;\n`);
console.log(`${out.length} leaf categories`);
