/**
 * 인덕 ERP 화면 구조 탐색기 — 리포트 자동화를 짜기 위한 사전 조사용.
 *
 *   node scripts/erp/explore.mjs
 *
 * 하는 일
 *  1. 크롬을 띄우고 ERP 로 이동 → **사람이 직접 로그인**(비밀번호는 스크립트가 다루지 않는다)
 *  2. 회계관리 메뉴의 모든 항목과 이동 경로(onclick)를 수집
 *  3. 관심 화면(원장·거래전표·채권채무)의 폼 필드·버튼·프레임을 수집
 *  4. 조회는 하지 않는다. **읽기만 하고 저장·수정은 일절 하지 않는다.**
 *  결과: scripts/erp/_explore.json
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';

const ERP = 'http://induk.ibcenter.kr';
const PROFILE_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'jaytax-erp-profile');
const OUT = path.join(process.cwd(), 'scripts', 'erp', '_explore.json');

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
].filter(Boolean);

async function launch() {
  const base = {
    headless: false,
    acceptDownloads: true,
    args: ['--no-first-run', '--no-default-browser-check', '--start-maximized'],
  };
  try {
    return await chromium.launchPersistentContext(PROFILE_DIR, { ...base, channel: 'chrome' });
  } catch { /* 아래에서 실행파일 경로로 재시도 */ }
  for (const exe of CHROME_PATHS) {
    if (fs.existsSync(exe)) return chromium.launchPersistentContext(PROFILE_DIR, { ...base, executablePath: exe });
  }
  throw new Error('크롬을 찾지 못했습니다. CHROME_PATH 환경변수로 경로를 지정해 주세요.');
}

/** 로그인 폼이 사라질 때까지 기다린다(비밀번호는 사람이 입력). */
async function waitLogin(page) {
  const done = async () => (await page.locator('input[type="password"]').count().catch(() => 0)) === 0;
  if (await done()) return;
  console.log('\n  🔐 열린 크롬에서 직접 로그인해 주세요 (taxteam = 정남지 계정). 최대 5분 대기.\n');
  for (let i = 0; i < 200; i++) {
    await page.waitForTimeout(1500);
    if (await done()) { console.log('  ✓ 로그인 확인\n'); return; }
  }
  throw new Error('로그인 대기 시간 초과');
}

/** 그 페이지의 메뉴·폼·버튼·프레임을 통째로 뜬다. */
const snapshot = (page) => page.evaluate(() => {
  const txt = (e) => (e.textContent || '').replace(/\s+/g, ' ').trim();
  const menus = Array.from(document.querySelectorAll('[onclick]'))
    .map((e) => ({ label: txt(e).slice(0, 40), onclick: e.getAttribute('onclick') }))
    .filter((x) => x.label && x.onclick && x.onclick.includes('.jsp'));
  const forms = Array.from(document.forms).map((f) => ({
    name: f.name, action: f.getAttribute('action') || '', method: f.method,
    fields: Array.from(f.elements).map((e) => ({
      name: e.name || e.id, tag: e.tagName, type: e.type || '',
      options: e.tagName === 'SELECT' ? Array.from(e.options).slice(0, 40).map((o) => ({ t: o.text.trim(), v: o.value })) : undefined,
      value: e.tagName === 'SELECT' ? e.value : (e.type === 'text' ? e.value : undefined),
    })).filter((x) => x.name),
  }));
  const buttons = Array.from(document.querySelectorAll('input[type=button],input[type=submit],button'))
    .map((b) => ({ label: (b.value || txt(b)).slice(0, 30), onclick: b.getAttribute('onclick') || '' }))
    .filter((x) => x.label);
  // 페이지에 정의된 전역 함수 소스(이동 경로가 들어있다)
  const fns = {};
  for (const k of Object.keys(window)) {
    try {
      if (typeof window[k] === 'function' && /onclick|doSubmit|excel|xls|down/i.test(k)) {
        const s = String(window[k]);
        if (s.length < 3000) fns[k] = s.replace(/\s+/g, ' ');
      }
    } catch { /* 접근 불가 프로퍼티 무시 */ }
  }
  return { url: location.href, title: document.title, menus, forms, buttons, fns };
});

async function visit(ctx, url, label) {
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1200);
    const snap = await snapshot(page);
    console.log(`  · ${label} — 메뉴 ${snap.menus.length} · 폼 ${snap.forms.length} · 버튼 ${snap.buttons.length} · 함수 ${Object.keys(snap.fns).length}`);
    return { label, ...snap };
  } catch (e) {
    console.log(`  · ${label} — 실패: ${e.message.split('\n')[0]}`);
    return { label, url, error: e.message.split('\n')[0] };
  } finally {
    await page.close();
  }
}

const ctx = await launch();
const page = ctx.pages()[0] || await ctx.newPage();
// 팝업 경고창이 떠서 멈추지 않게 자동으로 닫는다(조회 전 단계라 안전).
ctx.on('page', (p) => p.on('dialog', (d) => d.dismiss().catch(() => {})));
page.on('dialog', (d) => d.dismiss().catch(() => {}));

await page.goto(`${ERP}/`, { waitUntil: 'domcontentloaded' });
await waitLogin(page);

console.log('  화면 구조를 수집합니다(조회는 하지 않습니다)…');
const pages = [];
// 1차 탐색에서 확인된 화면들 — 필요한 것만 콕 집어 본다.
const TARGETS = [
  ['/apps/menu/tab_browse/tab_browse_dispatch.jsp?top_menu_id=FI', '회계관리 메뉴'],
  ['/apps/invjunpyo/invjunpyonolist.jsp?PageAction=OrderByNo', '거래전표 리스트'],
  ['/apps/sales/accfirm/arlistbybucode.jsp?menu=BCC&ReadBU=1', '기준일자 미수금현황'],
  ['/apps/sales/accfirm/arlistbybucode_flow.jsp?menu=BCC&ReadBU=1', '기간 미수금대장'],
  ['/apps/common/buperiodselect.jsp', '부서별원장-조건선택'],
];
for (const [rel, label] of TARGETS) pages.push(await visit(ctx, ERP + rel, label));

// 부서별원장은 조건 → 결과 화면으로 넘어가야 엑셀 버튼이 보인다.
// 아래는 **조회(읽기)만** 수행한다. 저장·수정은 하지 않는다.
{
  const pg = await ctx.newPage();
  pg.on('dialog', (d) => d.dismiss().catch(() => {}));
  try {
    await pg.goto(`${ERP}/apps/common/buperiodselect.jsp`, { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(800);
    await pg.evaluate(() => {
      const f = document.forms['myform'];
      const g = f.elements['Gisu']; if (g) { g.value = '31'; g.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await pg.waitForTimeout(800);
    await pg.evaluate(() => {
      const f = document.forms['myform'];
      const set = (n, v) => { const e = f.elements[n]; if (e) e.value = v; };
      set('JunpyoDateYear1', '2026'); set('JunpyoDateMonth1', '7'); set('JunpyoDateDay1', '1');
      set('JunpyoDateYear2', '2026'); set('JunpyoDateMonth2', '7'); set('JunpyoDateDay2', '31');
      window.buttonPeriod_onclick();
    });
    await pg.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    await pg.waitForTimeout(2500);
    const snap = await snapshot(pg);
    console.log(`  · 부서별원장-조회결과 — ${snap.url.replace(ERP, '')} 버튼 ${snap.buttons.length} 함수 ${Object.keys(snap.fns).length}`);
    pages.push({ label: '부서별원장-조회결과(2026-07)', ...snap });
  } catch (e) {
    console.log('  · 부서별원장-조회결과 — 실패: ' + String(e.message).split(String.fromCharCode(10))[0]);

  } finally { await pg.close(); }
}

fs.writeFileSync(OUT, JSON.stringify({ collectedAt: new Date().toISOString(), pages }, null, 1), 'utf8');
console.log(`\n  ✓ 저장: ${OUT}`);
console.log('    이 파일을 Claude 에게 보여주면 자동화 코드를 채웁니다. 브라우저는 닫아도 됩니다.');
await ctx.close();
