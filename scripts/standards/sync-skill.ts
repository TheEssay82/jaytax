// 단일 소스 → 스킬 번들 동기화
// 권위 원본(accounting-standards/*.md, prompts/*.md)을 skill/reference/ 로 복사한다.
// 스킬을 ~/.claude/skills/ 로 배포해도 자기완결로 동작하게 하면서, 원본은 repo가 단일 소스로 유지.
// 사용: npm run skill:sync
import { readdirSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { ROOT } from './lib.ts';

const DEST = resolve(ROOT, 'skill/reference');
mkdirSync(DEST, { recursive: true });

const sources = [
  resolve(ROOT, 'accounting-standards'),
  resolve(ROOT, 'prompts'),
];

const copied: string[] = [];
for (const dir of sources) {
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    console.warn(`경고: ${dir} 를 읽지 못했습니다(건너뜀).`);
    continue;
  }
  for (const f of files) {
    copyFileSync(join(dir, f), join(DEST, f));
    copied.push(f);
  }
}

// 번들이 사본임을 표시(직접 수정 방지)
writeFileSync(
  join(DEST, 'README.md'),
  [
    '# reference/ — 자동 생성 사본 (직접 수정 금지)',
    '',
    '이 폴더는 repo 단일 소스의 복사본이다. 권위 원본은 다음이며, 수정은 거기서 한다:',
    '',
    '- `accounting-standards/*.md`',
    '- `prompts/*.md`',
    '',
    '갱신: repo 루트에서 `npm run skill:sync` 실행 후 재배포.',
    '',
  ].join('\n'),
  'utf8'
);

console.log(`동기화 완료 → ${DEST}`);
for (const f of copied) console.log(`  + ${f}`);
console.log(`  + README.md (사본 표시)`);
