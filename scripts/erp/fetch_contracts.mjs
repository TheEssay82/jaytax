// IBCENTER 확정계약 목록 4종(회계감사·임의감사·세무조정·용역) — 31기 · 2본부5팀, 엑셀 응답을 가로채 저장.
//   정우철 계정(audit 프로필). 사람이 로그인만 한다. 조회·내려받기만(읽기).
//   node scripts/erp/fetch_contracts.mjs <저장폴더> [기수=31] [부서=2본부5팀]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ERP = 'https://induk.ibcenter.kr';
const PROFILE = path.join(process.env.LOCALAPPDATA, 'jaytax-erp-audit');
const OUT = process.argv[2];
const GISU = process.argv[3] ?? '31';
const BU = process.argv[4] ?? '2본부5팀';
fs.mkdirSync(OUT, { recursive: true });

const LISTS = [
  { key: 'audit', url: '/apps/sales/accfirm/sojunpyono_audit_list.jsp?menu=BCC', bu: BU },
  { key: 'otheraudit', url: '/apps/sales/accfirm/sojunpyono_otheraudit_list.jsp?menu=BCC', bu: BU },
  { key: 'tax', url: '/apps/sales/accfirm/sojunpyono_tax_list.jsp?menu=BCC', bu: BU },
  { key: 'consulting', url: '/apps/sales/accfirm/sojunpyono_consulting_list.jsp?menu=ACCQC', bu: '0205' },
];

const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, channel: 'chrome', acceptDownloads: true, args: ['--no-first-run', '--start-maximized'] });
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto(ERP, { waitUntil: 'commit', timeout: 180000 }).catch(() => {});
console.log('🔐 크롬에서 정우철 계정으로 로그인해 주세요(이미 로그인돼 있으면 그대로 진행, 최대 5분).');
const t0 = Date.now();
while (Date.now() - t0 < 300000) {
  const pw = await page.locator('input[type="password"]').count().catch(() => 1);
  if (pw === 0 && !/login/i.test(page.url())) break;
  await page.waitForTimeout(2000);
}
await page.waitForTimeout(6000);
console.log('✓ 로그인 확인');

// 엑셀 응답 가로채기(크롬 다운로드에 기대지 않는다 — fetch.mjs 와 같은 이유)
let captured = null;
await ctx.route('**/xls/xls_*.jsp*', async (route) => {
  const res = await route.fetch();
  captured = { body: await res.body(), ct: res.headers()['content-type'] ?? '' };
  await route.fulfill({ response: res });
});

for (const L of LISTS) {
  try {
    await page.goto(ERP + L.url, { waitUntil: 'commit', timeout: 180000 });
    await page.waitForFunction(() => !!document.forms['myform'] && typeof window.search === 'function', undefined, { timeout: 180000 });
    await page.evaluate(({ gisu, bu }) => {
      const f = document.forms['myform'];
      f.elements['SearchGisu'].value = gisu;
      if (f.elements['Search_BuName']) f.elements['Search_BuName'].value = bu;
    }, { gisu: GISU, bu: L.bu });
    await Promise.all([page.waitForLoadState('load', { timeout: 180000 }).catch(() => {}), page.evaluate(() => window.search('search'))]);
    await page.waitForFunction(() => !!document.forms['myform'] && typeof window.xls_click === 'function', undefined, { timeout: 180000 });
    await page.waitForTimeout(3000);
    const n = await page.evaluate(() => (typeof rowcount !== 'undefined' ? rowcount : -1));
    captured = null;
    await page.evaluate(() => window.xls_click()).catch(() => {});
    const t1 = Date.now();
    while (!captured && Date.now() - t1 < 120000) await page.waitForTimeout(1000);
    if (!captured) { console.log(`  ✗ ${L.key} — 엑셀 응답을 못 받음(표 ${n}행)`); continue; }
    const file = path.join(OUT, `${GISU}기_${L.key}.xls`);
    fs.writeFileSync(file, captured.body);
    console.log(`  ✓ ${L.key} — 표 ${n}행 → ${file} (${captured.body.length}B, ${captured.ct})`);
    await page.goto('about:blank').catch(() => {});
  } catch (e) { console.log(`  ✗ ${L.key} — ${String(e).slice(0, 200)}`); }
}
await ctx.close();
console.log('끝');
