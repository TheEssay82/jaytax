// lib/jaytaxMap.ts 를 앱 소스에서 다시 만든다.  npx tsx scripts/gen-jaytax-map.ts
import { writeFileSync } from 'node:fs';
import { renderJaytaxMapFile, buildJaytaxMap } from './jaytaxMap.ts';
writeFileSync(new URL('../lib/jaytaxMap.ts', import.meta.url), renderJaytaxMapFile());
const m = buildJaytaxMap();
console.log(`jaytaxMap v${m.version} — 메뉴 ${m.menus.length}묶음 · 최근 변경 ${m.recentChanges.length} · 계획 ${m.planned.length}묶음`);
