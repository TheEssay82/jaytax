// 일반조서 이월 결과를 화면 밖에서 다시 계산한다 — 사용자가 본 「이월 결과」 표를 재현·점검하는 개발용 도구.
//   npx tsx scripts/gwp-roll-report.ts <양식.zip> <전기.xlsx> <당기연도> [결과.xlsx]
import fs from 'node:fs';
import { readBundle } from '../src/lib/gwpTemplate';
import { rollWorkbook } from '../src/lib/gwpRoll';

const [zipPath, priorPath, fyArg, outPath] = process.argv.slice(2);
if (!zipPath || !priorPath) { console.error('사용: tsx scripts/gwp-roll-report.ts <양식.zip> <전기.xlsx> <당기연도>'); process.exit(1); }
const { catalog, files } = readBundle(new Uint8Array(fs.readFileSync(zipPath)));
const r = rollWorkbook(new Uint8Array(fs.readFileSync(priorPath)), catalog, files, { fy: Number(fyArg || 2026), reviewer: '조현규' });
if (outPath) fs.writeFileSync(outPath, r.bytes);
const by: Record<string, number> = {};
for (const s of r.report.sheets) by[s.action] = (by[s.action] ?? 0) + 1;
console.log(JSON.stringify({ counts: by, warnings: r.report.warnings, cover: r.report.cover, index: r.report.index }, null, 1));
for (const s of r.report.sheets) {
  const left = s.left?.length ?? 0;
  console.log([s.action, s.code ?? '', s.name, s.score != null ? `${Math.round(s.score * 100)}%` : '', s.moved ?? '', left || '', s.note ?? (s.template ? s.template.split('/').pop() : '')].join('\t'));
}
